import logging
from pathlib import Path

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.utils import audit
from core.permissions import IsHRManagerOrAdmin, get_role, is_department_ceo_approver_user
from core.responses import error, success
from core.services.messaging_providers import is_e164
from core.services.workflow_engine import can_user_act_on_instance, sync_workflow
from organization.models import OrganizationNode
from organization.services import filter_queryset_by_company_scope, get_active_company_for_request

from .automation import generate_hiring_request_reference_number, generate_reference_number, signer_snapshot
from .models import HiringRequest, JobOffer
from .notifications import (
    notify_hiring_request_decided,
    notify_hiring_request_submitted,
    notify_job_offer_biotime_mapping_missing,
)
from .pdf import build_job_offer_pdf
from .serializers import (
    HiringRequestDecisionSerializer,
    HiringRequestSerializer,
    JobOfferResponseSerializer,
    JobOfferSerializer,
    PublicJobOfferSerializer,
)
from .services import (
    create_and_send_employee_invite,
    deliver_job_offer,
    ensure_prehire_profile_for_offer,
    get_biotime_status,
    update_employee_profile_from_offer,
)

logger = logging.getLogger(__name__)


def _is_hr_or_admin(user) -> bool:
    return get_role(user) in {"HRManager", "SystemAdmin"}


def _can_view_hiring_requests(user) -> bool:
    return _is_hr_or_admin(user) or is_department_ceo_approver_user(user)


def _hiring_request_audit_metadata(hiring_request: HiringRequest, **extra) -> dict:
    return {
        "company_id": hiring_request.company_id,
        "reference_number": hiring_request.reference_number,
        "requested_by_id": hiring_request.requested_by_id,
        "ceo_decision_by_id": hiring_request.ceo_decision_by_id,
        **extra,
    }


def _offer_audit_metadata(offer: JobOffer, **extra) -> dict:
    return {
        "company_id": offer.company_id,
        "reference_number": offer.reference_number,
        "hr_signer_user_id": offer.hr_signer_user_id,
        "hr_signer_name": offer.hr_signer_name,
        **extra,
    }


def _scoped_offer_rows(request):
    """Return company-scoped rows without joins so PostgreSQL can lock them safely."""

    return filter_queryset_by_company_scope(JobOffer.objects.all(), request)


def _scoped_offers(request):
    queryset = JobOffer.objects.select_related(
        "company",
        "employee_profile",
        "account_invite",
        "hiring_request",
        "department_ref",
        "position_ref",
        "hr_signer_user",
        "created_by",
        "updated_by",
    )
    return filter_queryset_by_company_scope(queryset, request)


def _scoped_hiring_request_rows(request):
    return filter_queryset_by_company_scope(HiringRequest.objects.all(), request)


def _scoped_hiring_requests(request):
    queryset = HiringRequest.objects.select_related(
        "company", "requested_by", "ceo_decision_by", "created_by", "updated_by"
    )
    return filter_queryset_by_company_scope(queryset, request)


def _visible_hiring_requests(request):
    queryset = _scoped_hiring_requests(request)
    if _is_hr_or_admin(request.user):
        return queryset
    if is_department_ceo_approver_user(request.user):
        return queryset.filter(Q(status=HiringRequest.Status.SUBMITTED) | Q(ceo_decision_by=request.user))
    return queryset.none()


def _get_visible_hiring_request(request, hiring_request_id: int):
    return _visible_hiring_requests(request).filter(id=hiring_request_id).first()


def _expire_sent_offers(queryset) -> None:
    queryset.filter(status=JobOffer.Status.SENT, expiry_date__lt=timezone.localdate()).update(
        status=JobOffer.Status.EXPIRED
    )


def _get_internal_offer(request, offer_id: int) -> JobOffer | None:
    _expire_sent_offers(_scoped_offers(request))
    return _scoped_offers(request).filter(id=offer_id).first()


def _public_offer(token: str, *, for_update: bool = False) -> JobOffer | None:
    if for_update:
        # PostgreSQL cannot lock nullable sides of the outer joins introduced
        # by select_related("employee_profile"). Lock only the offer row.
        queryset = JobOffer.objects.select_for_update()
    else:
        queryset = JobOffer.objects.select_related("company", "employee_profile", "created_by", "updated_by")
    return queryset.filter(response_token=token).first()


def _validate_public_response_state(offer: JobOffer):
    if offer.status == JobOffer.Status.SENT and offer.is_expired():
        offer.status = JobOffer.Status.EXPIRED
        offer.save(update_fields=["status", "updated_at"])
        return error("This job offer has expired.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    if offer.status != JobOffer.Status.SENT:
        return error(
            f"This job offer cannot be responded to because it is {offer.get_status_display().lower()}.",
            status=status.HTTP_409_CONFLICT,
        )
    return None


class JobOfferPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response(self, data):
        return success(
            {
                "items": data,
                "page": self.page.number,
                "page_size": self.get_page_size(self.request),
                "count": self.page.paginator.count,
                "total_pages": self.page.paginator.num_pages,
            }
        )


class JobOfferListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        queryset = _scoped_offers(request)
        _expire_sent_offers(queryset)
        queryset = _scoped_offers(request)
        status_filter = (request.query_params.get("status") or "").strip()
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(candidate_full_name__icontains=search)
                | Q(candidate_email__icontains=search)
                | Q(candidate_phone_number__icontains=search)
                | Q(reference_number__icontains=search)
                | Q(position_title__icontains=search)
            )
        paginator = JobOfferPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(JobOfferSerializer(page, many=True).data)

    def post(self, request):
        company = get_active_company_for_request(request)
        if not company:
            return error("Select a company before creating a job offer.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        hiring_request_id = request.data.get("hiring_request_id")
        hiring_request = None
        if hiring_request_id in (None, ""):
            return error(
                "An approved hiring_request_id is required.",
                errors={"hiring_request_id": ["This field is required."]},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        if hiring_request_id not in (None, ""):
            if not str(hiring_request_id).isdigit():
                return error(
                    "Validation error",
                    errors={"hiring_request_id": ["A valid integer is required."]},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            hiring_request = _scoped_hiring_request_rows(request).filter(id=int(hiring_request_id)).first()
            if not hiring_request:
                return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
            if hiring_request.status != HiringRequest.Status.APPROVED:
                return error(
                    "Only an approved, unconverted hiring request can create a job offer.",
                    status=status.HTTP_409_CONFLICT,
                )

        payload = request.data.copy()
        if hiring_request:
            payload["hiring_request_id"] = str(hiring_request.id)
            payload["candidate_full_name"] = hiring_request.candidate_full_name
            payload["candidate_email"] = hiring_request.candidate_email
            payload["candidate_phone_number"] = hiring_request.candidate_phone_number
            payload["nationality"] = hiring_request.nationality
            payload["basic_salary"] = str(hiring_request.proposed_salary)
            payload.pop("employee_profile_id", None)
            payload.pop("total_salary_package", None)
        serializer = JobOfferSerializer(data=payload, context={"request": request, "company": company})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        with transaction.atomic():
            locked_company = OrganizationNode.objects.select_for_update().get(pk=company.pk)
            locked_hiring_request = None
            if hiring_request:
                locked_hiring_request = HiringRequest.objects.select_for_update().get(pk=hiring_request.pk)
                if locked_hiring_request.company_id != locked_company.id:
                    return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
                if locked_hiring_request.status != HiringRequest.Status.APPROVED:
                    return error(
                        "Only an approved, unconverted hiring request can create a job offer.",
                        status=status.HTTP_409_CONFLICT,
                    )
                if JobOffer.objects.filter(hiring_request=locked_hiring_request).exists():
                    return error("This hiring request has already been converted.", status=status.HTTP_409_CONFLICT)
            reference_number = generate_reference_number(
                locked_company,
                serializer.validated_data.get("offer_date"),
            )
            offer = serializer.save(
                company=locked_company,
                created_by=request.user,
                updated_by=request.user,
                reference_number=reference_number,
                hiring_request=locked_hiring_request,
                **signer_snapshot(request.user),
            )
            profile_created = None
            if locked_hiring_request:
                _, profile_created = ensure_prehire_profile_for_offer(offer)
                locked_hiring_request.status = HiringRequest.Status.CONVERTED
                locked_hiring_request.updated_by = request.user
                locked_hiring_request.save(update_fields=["status", "updated_by", "updated_at"])
                sync_workflow(locked_hiring_request, actor=request.user)
        audit(
            request,
            "job_offer_created",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer),
        )
        if locked_hiring_request:
            audit(
                request,
                "job_offer_prehire_profile_created" if profile_created else "job_offer_prehire_profile_reused",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(offer, employee_profile_id=offer.employee_profile_id),
            )
            audit(
                request,
                "hiring_request_converted_to_job_offer",
                entity="HiringRequest",
                entity_id=locked_hiring_request.id,
                metadata=_hiring_request_audit_metadata(locked_hiring_request, job_offer_id=offer.id),
            )
        return success(JobOfferSerializer(offer).data, message="Job offer created.", status=status.HTTP_201_CREATED)


class HiringRequestListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_view_hiring_requests(request.user):
            return error("You do not have permission to view hiring requests.", status=status.HTTP_403_FORBIDDEN)
        queryset = _visible_hiring_requests(request)
        status_filter = (request.query_params.get("status") or "").strip()
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(candidate_full_name__icontains=search)
                | Q(candidate_email__icontains=search)
                | Q(reference_number__icontains=search)
            )
        paginator = JobOfferPagination()
        page = paginator.paginate_queryset(queryset, request)
        serializer = HiringRequestSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        if not _is_hr_or_admin(request.user):
            return error("Only HR can create hiring requests.", status=status.HTTP_403_FORBIDDEN)
        company = get_active_company_for_request(request)
        if not company:
            return error(
                "Select a company before creating a hiring request.", status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        serializer = HiringRequestSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        with transaction.atomic():
            locked_company = OrganizationNode.objects.select_for_update().get(pk=company.pk)
            hiring_request = serializer.save(
                company=locked_company,
                reference_number=generate_hiring_request_reference_number(locked_company),
                requested_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
            sync_workflow(hiring_request, actor=request.user)
        audit(
            request,
            "hiring_request_created",
            entity="HiringRequest",
            entity_id=hiring_request.id,
            metadata=_hiring_request_audit_metadata(hiring_request),
        )
        return success(
            HiringRequestSerializer(hiring_request, context={"request": request}).data,
            message="Hiring request created.",
            status=status.HTTP_201_CREATED,
        )


class HiringRequestDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, hiring_request_id: int):
        if not _can_view_hiring_requests(request.user):
            return error("You do not have permission to view hiring requests.", status=status.HTTP_403_FORBIDDEN)
        hiring_request = _get_visible_hiring_request(request, hiring_request_id)
        if not hiring_request:
            return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
        return success(HiringRequestSerializer(hiring_request, context={"request": request}).data)

    def patch(self, request, hiring_request_id: int):
        if not _is_hr_or_admin(request.user):
            return error("Only HR can edit hiring requests.", status=status.HTTP_403_FORBIDDEN)
        hiring_request = _scoped_hiring_requests(request).filter(id=hiring_request_id).first()
        if not hiring_request:
            return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
        if hiring_request.status != HiringRequest.Status.DRAFT:
            return error("Only draft hiring requests can be updated.", status=status.HTTP_409_CONFLICT)
        serializer = HiringRequestSerializer(
            hiring_request,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        changed_fields = sorted(serializer.validated_data.keys())
        hiring_request = serializer.save(updated_by=request.user)
        sync_workflow(hiring_request, actor=request.user)
        audit(
            request,
            "hiring_request_updated",
            entity="HiringRequest",
            entity_id=hiring_request.id,
            metadata=_hiring_request_audit_metadata(hiring_request, changed_fields=changed_fields),
        )
        return success(HiringRequestSerializer(hiring_request, context={"request": request}).data)


class HiringRequestSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, hiring_request_id: int):
        if not _is_hr_or_admin(request.user):
            return error("Only HR can submit hiring requests.", status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            hiring_request = (
                _scoped_hiring_request_rows(request).select_for_update().filter(id=hiring_request_id).first()
            )
            if not hiring_request:
                return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
            if hiring_request.status != HiringRequest.Status.DRAFT:
                return error("Only draft hiring requests can be submitted.", status=status.HTTP_409_CONFLICT)
            if not hiring_request.cv_file:
                return error("A CV is required before submission.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            hiring_request.status = HiringRequest.Status.SUBMITTED
            hiring_request.submitted_at = timezone.now()
            hiring_request.updated_by = request.user
            hiring_request.save(update_fields=["status", "submitted_at", "updated_by", "updated_at"])
            sync_workflow(hiring_request, actor=request.user)
        delivery = notify_hiring_request_submitted(hiring_request)
        audit(
            request,
            "hiring_request_submitted",
            entity="HiringRequest",
            entity_id=hiring_request.id,
            metadata=_hiring_request_audit_metadata(hiring_request, ceo_recipient_count=len(delivery)),
        )
        data = HiringRequestSerializer(hiring_request, context={"request": request}).data
        return success({"hiring_request": data, "notifications": delivery}, message="Hiring request submitted.")


class HiringRequestCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, hiring_request_id: int):
        if not _is_hr_or_admin(request.user):
            return error("Only HR can cancel hiring requests.", status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            hiring_request = (
                _scoped_hiring_request_rows(request).select_for_update().filter(id=hiring_request_id).first()
            )
            if not hiring_request:
                return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
            if hiring_request.status not in {HiringRequest.Status.DRAFT, HiringRequest.Status.SUBMITTED}:
                return error("This hiring request cannot be cancelled.", status=status.HTTP_409_CONFLICT)
            hiring_request.status = HiringRequest.Status.CANCELLED
            hiring_request.updated_by = request.user
            hiring_request.save(update_fields=["status", "updated_by", "updated_at"])
            sync_workflow(hiring_request, actor=request.user)
        audit(
            request,
            "hiring_request_cancelled",
            entity="HiringRequest",
            entity_id=hiring_request.id,
            metadata=_hiring_request_audit_metadata(hiring_request),
        )
        return success(HiringRequestSerializer(hiring_request, context={"request": request}).data)


class HiringRequestDecisionView(APIView):
    permission_classes = [IsAuthenticated]
    decision = ""

    def post(self, request, hiring_request_id: int):
        if not is_department_ceo_approver_user(request.user):
            return error("Only a CEO approver can decide hiring requests.", status=status.HTTP_403_FORBIDDEN)
        serializer = HiringRequestDecisionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        with transaction.atomic():
            hiring_request = (
                _scoped_hiring_request_rows(request).select_for_update().filter(id=hiring_request_id).first()
            )
            if not hiring_request:
                return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
            workflow = sync_workflow(hiring_request, actor=request.user)
            if hiring_request.status != HiringRequest.Status.SUBMITTED:
                return error("Only submitted hiring requests can be decided.", status=status.HTTP_409_CONFLICT)
            if not can_user_act_on_instance(request.user, hiring_request, workflow):
                return error("You cannot act on this hiring request.", status=status.HTTP_403_FORBIDDEN)
            hiring_request.status = self.decision
            hiring_request.ceo_decision_by = request.user
            hiring_request.ceo_decision_at = timezone.now()
            hiring_request.ceo_decision_note = serializer.validated_data["note"].strip()
            hiring_request.updated_by = request.user
            hiring_request.save(
                update_fields=[
                    "status",
                    "ceo_decision_by",
                    "ceo_decision_at",
                    "ceo_decision_note",
                    "updated_by",
                    "updated_at",
                ]
            )
            sync_workflow(hiring_request, actor=request.user)
        notification = notify_hiring_request_decided(hiring_request)
        action = (
            "hiring_request_approved" if self.decision == HiringRequest.Status.APPROVED else "hiring_request_rejected"
        )
        audit(
            request,
            action,
            entity="HiringRequest",
            entity_id=hiring_request.id,
            metadata=_hiring_request_audit_metadata(hiring_request, requester_notification=notification),
        )
        return success(HiringRequestSerializer(hiring_request, context={"request": request}).data)


class HiringRequestApproveView(HiringRequestDecisionView):
    decision = HiringRequest.Status.APPROVED


class HiringRequestRejectView(HiringRequestDecisionView):
    decision = HiringRequest.Status.REJECTED


class HiringRequestCvView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, hiring_request_id: int):
        if not _can_view_hiring_requests(request.user):
            return error("You do not have permission to view hiring requests.", status=status.HTTP_403_FORBIDDEN)
        hiring_request = _get_visible_hiring_request(request, hiring_request_id)
        if not hiring_request:
            return error("Hiring request not found.", status=status.HTTP_404_NOT_FOUND)
        if not hiring_request.cv_file:
            return error("CV not found.", status=status.HTTP_404_NOT_FOUND)
        try:
            hiring_request.cv_file.open("rb")
        except FileNotFoundError:
            return error("CV not found.", status=status.HTTP_404_NOT_FOUND)
        audit(
            request,
            "hiring_request_cv_downloaded",
            entity="HiringRequest",
            entity_id=hiring_request.id,
            metadata=_hiring_request_audit_metadata(hiring_request),
        )
        response = FileResponse(
            hiring_request.cv_file,
            content_type="application/octet-stream",
            as_attachment=True,
            filename=Path(hiring_request.cv_file.name).name,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response


class JobOfferDetailView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, offer_id: int):
        offer = _get_internal_offer(request, offer_id)
        if not offer:
            return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
        return success(JobOfferSerializer(offer).data)

    def patch(self, request, offer_id: int):
        offer = _get_internal_offer(request, offer_id)
        if not offer:
            return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
        if offer.status != JobOffer.Status.DRAFT:
            return error("Only draft job offers can be updated.", status=status.HTTP_409_CONFLICT)
        serializer = JobOfferSerializer(
            offer,
            data=request.data,
            partial=True,
            context={"request": request, "company": offer.company},
        )
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        changed_fields = sorted(serializer.validated_data.keys())
        offer = serializer.save(updated_by=request.user)
        if offer.hiring_request_id and offer.employee_profile_id:
            update_employee_profile_from_offer(offer)
        audit(
            request,
            "job_offer_updated",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer, changed_fields=changed_fields),
        )
        return success(JobOfferSerializer(offer).data, message="Job offer updated.")


class JobOfferSendView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, offer_id: int):
        with transaction.atomic():
            offer = _scoped_offer_rows(request).select_for_update().filter(id=offer_id).first()
            if not offer:
                return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
            if offer.is_expired():
                if offer.status in {JobOffer.Status.DRAFT, JobOffer.Status.SENT}:
                    offer.status = JobOffer.Status.EXPIRED
                    offer.save(update_fields=["status", "updated_at"])
                return error("Expired job offers cannot be sent.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            if offer.status in {
                JobOffer.Status.ACCEPTED,
                JobOffer.Status.REJECTED,
                JobOffer.Status.CANCELLED,
                JobOffer.Status.EXPIRED,
            }:
                return error(
                    f"A {offer.get_status_display().lower()} job offer cannot be sent.",
                    status=status.HTTP_409_CONFLICT,
                )
            if offer.status == JobOffer.Status.SENT:
                return error("This job offer has already been sent.", status=status.HTTP_409_CONFLICT)
            if not offer.candidate_email and not offer.candidate_phone_number:
                return error(
                    "Candidate email or phone number is required.", status=status.HTTP_422_UNPROCESSABLE_ENTITY
                )
            if offer.candidate_phone_number and not is_e164(offer.candidate_phone_number):
                return error(
                    "Candidate phone number must be in E.164 format.", status=status.HTTP_422_UNPROCESSABLE_ENTITY
                )
            if not offer.response_token:
                offer.response_token = JobOffer.generate_response_token()
            offer.status = JobOffer.Status.SENT
            offer.sent_at = timezone.now()
            offer.updated_by = request.user
            signer = signer_snapshot(request.user)
            offer.hr_signer_user = signer["hr_signer_user"]
            offer.hr_signer_name = signer["hr_signer_name"]
            offer.hr_signer_title = signer["hr_signer_title"]
            offer.save(
                update_fields=[
                    "response_token",
                    "status",
                    "sent_at",
                    "updated_by",
                    "hr_signer_user",
                    "hr_signer_name",
                    "hr_signer_title",
                    "updated_at",
                ]
            )

        try:
            delivery_metadata = deliver_job_offer(offer)
        except Exception:
            logger.exception("job_offer_delivery_unhandled_exception", extra={"job_offer_id": offer.id})
            delivery_metadata = {"channels": {}, "warnings": ["Job offer delivery failed."]}
        offer.delivery_metadata = delivery_metadata
        offer.save(update_fields=["delivery_metadata", "updated_at"])
        audit(
            request,
            "job_offer_sent",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(
                offer,
                channels=list(delivery_metadata.get("channels", {}).keys()),
                has_warnings=bool(delivery_metadata.get("warnings")),
            ),
        )
        candidate_whatsapp_pdf = delivery_metadata.get("candidate", {}).get("whatsapp_pdf", {})
        if candidate_whatsapp_pdf.get("sent"):
            audit(
                request,
                "job_offer_whatsapp_pdf_sent",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(offer, recipient_type="candidate"),
            )
        for recipient_delivery in delivery_metadata.get("ceo", {}).get("recipients", []):
            whatsapp_pdf = recipient_delivery.get("whatsapp_pdf", {})
            email_pdf = recipient_delivery.get("email_pdf", {})
            if whatsapp_pdf.get("sent"):
                audit(
                    request,
                    "job_offer_whatsapp_pdf_sent",
                    entity="JobOffer",
                    entity_id=offer.id,
                    metadata=_offer_audit_metadata(
                        offer,
                        recipient_type="ceo",
                        recipient_user_id=recipient_delivery.get("user_id"),
                    ),
                )
            if whatsapp_pdf.get("sent") or email_pdf.get("sent"):
                audit(
                    request,
                    "job_offer_ceo_copy_sent",
                    entity="JobOffer",
                    entity_id=offer.id,
                    metadata=_offer_audit_metadata(
                        offer,
                        recipient_user_id=recipient_delivery.get("user_id"),
                        whatsapp_pdf_sent=bool(whatsapp_pdf.get("sent")),
                        email_pdf_sent=bool(email_pdf.get("sent")),
                    ),
                )
        if delivery_metadata.get("warnings"):
            audit(
                request,
                "job_offer_delivery_failed",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(
                    offer,
                    stage="offer",
                    warning_details=delivery_metadata.get("warning_details", {}),
                ),
            )
        return success(
            {"offer": JobOfferSerializer(offer).data, "delivery": delivery_metadata}, message="Job offer sent."
        )


class JobOfferPdfView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, offer_id: int):
        offer = _get_internal_offer(request, offer_id)
        if not offer:
            return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
        pdf_bytes = build_job_offer_pdf(offer)
        audit(
            request,
            "job_offer_pdf_downloaded",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer),
        )
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="job-offer-{offer.reference_number}.pdf"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response


class JobOfferCancelView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, offer_id: int):
        with transaction.atomic():
            offer = _scoped_offer_rows(request).select_for_update().filter(id=offer_id).first()
            if not offer:
                return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
            if offer.status not in {JobOffer.Status.DRAFT, JobOffer.Status.SENT}:
                return error(
                    f"A {offer.get_status_display().lower()} job offer cannot be cancelled.",
                    status=status.HTTP_409_CONFLICT,
                )
            previous_status = offer.status
            offer.status = JobOffer.Status.CANCELLED
            offer.cancelled_at = timezone.now()
            offer.updated_by = request.user
            offer.save(update_fields=["status", "cancelled_at", "updated_by", "updated_at"])
        audit(
            request,
            "job_offer_cancelled",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer, previous_status=previous_status),
        )
        return success(JobOfferSerializer(offer).data, message="Job offer cancelled.")


class JobOfferRespondView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "job_offer_response"

    def get(self, request):
        token = (request.query_params.get("token") or "").strip()
        if not token:
            return error("Token is required.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        offer = _public_offer(token)
        if not offer:
            return error("Invalid job offer token.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        state_error = _validate_public_response_state(offer)
        if state_error:
            return state_error
        return success(PublicJobOfferSerializer(offer).data)

    def post(self, request):
        serializer = JobOfferResponseSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        token = serializer.validated_data["token"].strip()
        decision = serializer.validated_data["decision"]
        reason = serializer.validated_data.get("reason", "").strip()

        with transaction.atomic():
            offer = _public_offer(token, for_update=True)
            if not offer:
                return error("Invalid job offer token.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            state_error = _validate_public_response_state(offer)
            if state_error:
                return state_error
            now = timezone.now()
            if decision == "rejected":
                offer.status = JobOffer.Status.REJECTED
                offer.rejected_at = now
                offer.rejection_reason = reason
                offer.save(update_fields=["status", "rejected_at", "rejection_reason", "updated_at"])
            else:
                offer.status = JobOffer.Status.ACCEPTED
                offer.accepted_at = now
                offer.save(update_fields=["status", "accepted_at", "updated_at"])
                updated_profile = update_employee_profile_from_offer(offer)

        if decision == "rejected":
            audit(
                request,
                "job_offer_rejected",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(offer, has_reason=bool(reason)),
            )
            return success({"status": offer.status, "status_label": offer.get_status_display()})

        audit(
            request,
            "job_offer_accepted",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer, employee_profile_id=offer.employee_profile_id),
        )
        audit(
            request,
            "job_offer_accepted_profile_updated",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(
                offer,
                employee_profile_id=updated_profile.id if updated_profile else None,
            ),
        )
        try:
            invite, invitation = create_and_send_employee_invite(offer, created_by=offer.updated_by)
        except Exception:
            logger.exception("job_offer_invitation_creation_failed", extra={"job_offer_id": offer.id})
            invite = None
            invitation = {"created": False, "reason": "invitation_creation_failed"}
        if invite:
            offer.account_invite = invite
            offer.save(update_fields=["account_invite", "updated_at"])
            audit(
                request,
                "job_offer_invitation_sent",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(
                    offer,
                    invite_id=invite.id,
                    channel=invite.channel,
                    delivered=bool(invitation.get("delivery", {}).get("sent")),
                ),
            )
            if not invitation.get("delivery", {}).get("sent"):
                audit(
                    request,
                    "job_offer_delivery_failed",
                    entity="JobOffer",
                    entity_id=offer.id,
                    metadata=_offer_audit_metadata(offer, stage="invitation", channel=invite.channel),
                )

        biotime = get_biotime_status(updated_profile)
        if updated_profile and biotime["is_mapped"]:
            audit(
                request,
                "job_offer_biotime_mapping_present",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(
                    offer,
                    employee_profile_id=updated_profile.id,
                    mapping_id=biotime["mapping_id"],
                ),
            )
        elif updated_profile:
            try:
                notification_results = notify_job_offer_biotime_mapping_missing(offer)
            except Exception:
                logger.exception("job_offer_biotime_missing_notification_failed", extra={"job_offer_id": offer.id})
                notification_results = []
            audit(
                request,
                "job_offer_biotime_mapping_missing_notified",
                entity="JobOffer",
                entity_id=offer.id,
                metadata=_offer_audit_metadata(
                    offer,
                    employee_profile_id=updated_profile.id,
                    recipient_count=len(notification_results),
                ),
            )
        return success(
            {
                "status": offer.status,
                "status_label": offer.get_status_display(),
                "employee_profile_id": offer.employee_profile_id,
                "invitation": invitation,
                "biotime": biotime,
            }
        )
