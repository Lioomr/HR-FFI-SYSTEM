import logging
import uuid
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

from .automation import generate_reference_number, signer_snapshot
from .models import JobOffer, StartingWorkAcknowledgment
from .notifications import (
    notify_job_offer_biotime_mapping_missing,
    notify_job_offer_decided,
    notify_job_offer_submitted,
)
from .pdf import build_job_offer_pdf
from .serializers import (
    JobOfferApprovalSerializer,
    JobOfferRejectionSerializer,
    JobOfferResponseSerializer,
    JobOfferRevisionSerializer,
    JobOfferSerializer,
    PublicJobOfferSerializer,
    StartingWorkAcknowledgmentSerializer,
    StartingWorkRejectionSerializer,
)
from .services import (
    create_and_send_employee_invite,
    deliver_job_offer,
    ensure_prehire_profile_for_offer,
    get_biotime_status,
    update_employee_profile_from_offer,
)
from .starting_work_service import approve_starting_work_acknowledgment, reject_starting_work_acknowledgment

logger = logging.getLogger(__name__)

CEO_COMMERCIAL_FIELDS = {
    "department_id",
    "position_id",
    "position_title",
    "classification",
    "department",
    "location",
    "basic_salary",
    "housing_allowance",
    "transportation_allowance",
    "other_allowance",
    "total_salary_package",
    "vacation",
    "tickets",
    "contract_status",
    "contract_type",
    "contract_duration",
    "medical_insurance",
    "offer_date",
    "expiry_date",
}


def _scoped_starting_work_acknowledgments(request):
    queryset = StartingWorkAcknowledgment.objects.select_related(
        "employee_profile",
        "employee_profile__user",
        "attendance_record",
        "company",
        "document",
        "approved_by",
        "rejected_by",
    ).prefetch_related("affected_attendance_records")
    return filter_queryset_by_company_scope(queryset, request)


def _serialize_starting_work_acknowledgment(acknowledgment, request):
    return StartingWorkAcknowledgmentSerializer(acknowledgment, context={"request": request}).data


def _is_hr_or_admin(user) -> bool:
    return get_role(user) in {"HRManager", "SystemAdmin"}


def _can_view_job_offers(user) -> bool:
    return _is_hr_or_admin(user) or is_department_ceo_approver_user(user)


def _offer_audit_metadata(offer: JobOffer, **extra) -> dict:
    return {
        "company_id": offer.company_id,
        "reference_number": offer.reference_number,
        "approval_status": offer.approval_status,
        "hr_signer_user_id": offer.hr_signer_user_id,
        "hr_signer_name": offer.hr_signer_name,
        "ceo_decision_by_id": offer.ceo_decision_by_id,
        **extra,
    }


def _scoped_offer_rows(request):
    return filter_queryset_by_company_scope(JobOffer.objects.all(), request)


def _scoped_offers(request):
    queryset = JobOffer.objects.select_related(
        "company",
        "employee_profile",
        "account_invite",
        "department_ref",
        "position_ref",
        "hr_signer_user",
        "ceo_decision_by",
        "created_by",
        "updated_by",
    )
    return filter_queryset_by_company_scope(queryset, request)


def _visible_offers(request):
    queryset = _scoped_offers(request)
    if _is_hr_or_admin(request.user):
        return queryset
    if is_department_ceo_approver_user(request.user):
        return queryset.filter(Q(approval_status=JobOffer.ApprovalStatus.PENDING_CEO) | Q(ceo_decision_by=request.user))
    return queryset.none()


def _expire_sent_offers(queryset) -> None:
    queryset.filter(status=JobOffer.Status.SENT, expiry_date__lt=timezone.localdate()).update(
        status=JobOffer.Status.EXPIRED
    )


def _get_internal_offer(request, offer_id: int) -> JobOffer | None:
    _expire_sent_offers(_scoped_offers(request))
    return _visible_offers(request).filter(id=offer_id).first()


def _public_offer(token: str, *, for_update: bool = False) -> JobOffer | None:
    if for_update:
        queryset = JobOffer.objects.select_for_update()
    else:
        queryset = JobOffer.objects.select_related("company", "employee_profile", "created_by", "updated_by")
    return queryset.filter(response_token=token).first()


def _serialize_offer(offer: JobOffer, request) -> dict:
    return JobOfferSerializer(offer, context={"request": request, "company": offer.company}).data


def _append_approval_event(
    offer: JobOffer,
    *,
    event_type: str,
    actor,
    from_status: str,
    to_status: str,
    reason: str = "",
    recommendation: str = "",
) -> None:
    events = list(offer.approval_events or [])
    events.append(
        {
            "id": uuid.uuid4().hex,
            "type": event_type,
            "actor_id": actor.id,
            "at": timezone.now().isoformat(),
            "from_status": from_status,
            "to_status": to_status,
            "reason": reason,
            "recommendation": recommendation,
        }
    )
    offer.approval_events = events


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
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_view_job_offers(request.user):
            return error("You do not have permission to view job offers.", status=status.HTTP_403_FORBIDDEN)
        queryset = _visible_offers(request)
        _expire_sent_offers(queryset)
        queryset = _visible_offers(request)
        status_filter = (request.query_params.get("status") or "").strip()
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        approval_status = (request.query_params.get("approval_status") or "").strip()
        if approval_status:
            queryset = queryset.filter(approval_status=approval_status)
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
        serializer = JobOfferSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        if not _is_hr_or_admin(request.user):
            return error("Only HR can create job offers.", status=status.HTTP_403_FORBIDDEN)
        company = get_active_company_for_request(request)
        if not company:
            return error("Select a company before creating a job offer.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        serializer = JobOfferSerializer(data=request.data, context={"request": request, "company": company})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        with transaction.atomic():
            locked_company = OrganizationNode.objects.select_for_update().get(pk=company.pk)
            offer = serializer.save(
                company=locked_company,
                created_by=request.user,
                updated_by=request.user,
                reference_number=generate_reference_number(
                    locked_company,
                    serializer.validated_data.get("offer_date"),
                ),
                **signer_snapshot(request.user),
            )
            _, profile_created = ensure_prehire_profile_for_offer(offer)
            sync_workflow(offer, actor=request.user)
        audit(
            request,
            "job_offer_created",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer, employee_profile_created=profile_created),
        )
        return success(
            _serialize_offer(offer, request),
            message="Job offer created.",
            status=status.HTTP_201_CREATED,
        )


class JobOfferDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, offer_id: int):
        if not _can_view_job_offers(request.user):
            return error("You do not have permission to view job offers.", status=status.HTTP_403_FORBIDDEN)
        offer = _get_internal_offer(request, offer_id)
        if not offer:
            return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
        return success(_serialize_offer(offer, request))

    def patch(self, request, offer_id: int):
        if not _can_view_job_offers(request.user):
            return error("You do not have permission to edit job offers.", status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            offer = _scoped_offer_rows(request).select_for_update().filter(id=offer_id).first()
            if not offer:
                return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)

            is_hr = _is_hr_or_admin(request.user)
            if is_hr:
                if offer.approval_status not in {
                    JobOffer.ApprovalStatus.DRAFT,
                    JobOffer.ApprovalStatus.CHANGES_REQUESTED,
                }:
                    return error(
                        "HR can edit only draft job offers or offers returned for changes.",
                        status=status.HTTP_409_CONFLICT,
                    )
            else:
                workflow = sync_workflow(offer, actor=request.user)
                if offer.approval_status != JobOffer.ApprovalStatus.PENDING_CEO:
                    return error("Only job offers pending CEO review can be edited.", status=status.HTTP_409_CONFLICT)
                if not can_user_act_on_instance(request.user, offer, workflow):
                    return error("You cannot act on this job offer.", status=status.HTTP_403_FORBIDDEN)
                forbidden_fields = set(request.data.keys()) - CEO_COMMERCIAL_FIELDS
                if forbidden_fields:
                    return error(
                        "CEO may edit commercial job-offer fields only.",
                        errors={field: ["This field cannot be edited by CEO."] for field in sorted(forbidden_fields)},
                        status=status.HTTP_403_FORBIDDEN,
                    )

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
            if offer.employee_profile_id:
                update_employee_profile_from_offer(offer)

        action = "job_offer_updated" if is_hr else "job_offer_ceo_commercial_fields_updated"
        audit(
            request,
            action,
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer, changed_fields=changed_fields),
        )
        return success(_serialize_offer(offer, request), message="Job offer updated.")


class JobOfferSubmitView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, offer_id: int):
        with transaction.atomic():
            offer = _scoped_offer_rows(request).select_for_update().filter(id=offer_id).first()
            if not offer:
                return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
            allowed = {JobOffer.ApprovalStatus.DRAFT, JobOffer.ApprovalStatus.CHANGES_REQUESTED}
            if offer.approval_status not in allowed:
                return error(
                    "Only draft job offers or offers returned for changes can be submitted.",
                    status=status.HTTP_409_CONFLICT,
                )
            if offer.status != JobOffer.Status.DRAFT:
                return error("Only unsent job offers can be submitted.", status=status.HTTP_409_CONFLICT)
            if not offer.cv_file:
                return error("A CV is required before submission.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            if offer.is_expired():
                return error("Expired job offers cannot be submitted.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            previous_status = offer.approval_status
            offer.approval_status = JobOffer.ApprovalStatus.PENDING_CEO
            offer.submitted_at = timezone.now()
            offer.updated_by = request.user
            _append_approval_event(
                offer,
                event_type="submit",
                actor=request.user,
                from_status=previous_status,
                to_status=offer.approval_status,
            )
            offer.save(update_fields=["approval_status", "submitted_at", "updated_by", "approval_events", "updated_at"])
            sync_workflow(offer, actor=request.user)
        try:
            delivery = notify_job_offer_submitted(offer)
        except Exception:
            logger.exception("job_offer_submission_notification_failed", extra={"job_offer_id": offer.id})
            delivery = []
        audit(
            request,
            "job_offer_submitted_for_ceo_approval",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer, ceo_recipient_count=len(delivery)),
        )
        return success(
            {"job_offer": _serialize_offer(offer, request), "notifications": delivery},
            message="Job offer submitted for CEO approval.",
        )


class JobOfferDecisionView(APIView):
    permission_classes = [IsAuthenticated]
    target_status = ""
    event_type = ""
    audit_action = ""
    serializer_class = JobOfferApprovalSerializer

    def post(self, request, offer_id: int):
        if not is_department_ceo_approver_user(request.user):
            return error("Only a CEO approver can decide job offers.", status=status.HTTP_403_FORBIDDEN)
        serializer = self.serializer_class(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        reason = serializer.validated_data.get("reason", "").strip()
        recommendation = serializer.validated_data.get("recommendation", "").strip()
        with transaction.atomic():
            offer = _scoped_offer_rows(request).select_for_update().filter(id=offer_id).first()
            if not offer:
                return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
            workflow = sync_workflow(offer, actor=request.user)
            if offer.approval_status != JobOffer.ApprovalStatus.PENDING_CEO:
                return error("Only job offers pending CEO review can be decided.", status=status.HTTP_409_CONFLICT)
            if not can_user_act_on_instance(request.user, offer, workflow):
                return error("You cannot act on this job offer.", status=status.HTTP_403_FORBIDDEN)
            previous_status = offer.approval_status
            offer.approval_status = self.target_status
            offer.ceo_decision_by = request.user
            offer.ceo_decision_at = timezone.now()
            offer.ceo_decision_reason = reason
            offer.ceo_recommendation = recommendation
            offer.updated_by = request.user
            _append_approval_event(
                offer,
                event_type=self.event_type,
                actor=request.user,
                from_status=previous_status,
                to_status=self.target_status,
                reason=reason,
                recommendation=recommendation,
            )
            offer.save(
                update_fields=[
                    "approval_status",
                    "ceo_decision_by",
                    "ceo_decision_at",
                    "ceo_decision_reason",
                    "ceo_recommendation",
                    "updated_by",
                    "approval_events",
                    "updated_at",
                ]
            )
            sync_workflow(offer, actor=request.user)
        try:
            delivery = notify_job_offer_decided(offer)
        except Exception:
            logger.exception("job_offer_decision_notification_failed", extra={"job_offer_id": offer.id})
            delivery = []
        audit(
            request,
            self.audit_action,
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(
                offer,
                has_reason=bool(reason),
                has_recommendation=bool(recommendation),
                hr_recipient_count=len(delivery),
            ),
        )
        return success(_serialize_offer(offer, request))


class JobOfferApproveView(JobOfferDecisionView):
    target_status = JobOffer.ApprovalStatus.APPROVED
    event_type = "approve"
    audit_action = "job_offer_ceo_approved"
    serializer_class = JobOfferApprovalSerializer


class JobOfferRequestChangesView(JobOfferDecisionView):
    target_status = JobOffer.ApprovalStatus.CHANGES_REQUESTED
    event_type = "request_changes"
    audit_action = "job_offer_changes_requested"
    serializer_class = JobOfferRevisionSerializer


class JobOfferRejectView(JobOfferDecisionView):
    target_status = JobOffer.ApprovalStatus.REJECTED
    event_type = "reject"
    audit_action = "job_offer_ceo_rejected"
    serializer_class = JobOfferRejectionSerializer


class JobOfferCvView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, offer_id: int):
        if not _can_view_job_offers(request.user):
            return error("You do not have permission to view job-offer CVs.", status=status.HTTP_403_FORBIDDEN)
        offer = _get_internal_offer(request, offer_id)
        if not offer:
            return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
        if not offer.cv_file:
            return error("CV not found.", status=status.HTTP_404_NOT_FOUND)
        try:
            offer.cv_file.open("rb")
        except FileNotFoundError:
            return error("CV not found.", status=status.HTTP_404_NOT_FOUND)
        audit(
            request,
            "job_offer_cv_downloaded",
            entity="JobOffer",
            entity_id=offer.id,
            metadata=_offer_audit_metadata(offer),
        )
        response = FileResponse(
            offer.cv_file,
            content_type="application/octet-stream",
            as_attachment=True,
            filename=Path(offer.cv_file.name).name,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response


class JobOfferSendView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, offer_id: int):
        with transaction.atomic():
            offer = _scoped_offer_rows(request).select_for_update().filter(id=offer_id).first()
            if not offer:
                return error("Job offer not found.", status=status.HTTP_404_NOT_FOUND)
            if offer.approval_status != JobOffer.ApprovalStatus.APPROVED:
                return error(
                    "CEO approval is required before sending this job offer.",
                    status=status.HTTP_409_CONFLICT,
                )
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
            {"offer": _serialize_offer(offer, request), "delivery": delivery_metadata}, message="Job offer sent."
        )


class JobOfferPdfView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, offer_id: int):
        if not _can_view_job_offers(request.user):
            return error("You do not have permission to view job offers.", status=status.HTTP_403_FORBIDDEN)
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
        response = HttpResponse(pdf_bytes, content_type="application/octet-stream")
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
            if offer.approval_status == JobOffer.ApprovalStatus.PENDING_CEO:
                return error("A job offer under CEO review cannot be cancelled.", status=status.HTTP_409_CONFLICT)
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
        return success(_serialize_offer(offer, request), message="Job offer cancelled.")


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


class StartingWorkAcknowledgmentListView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        queryset = _scoped_starting_work_acknowledgments(request)
        status_filter = (request.query_params.get("status") or "").strip()
        if status_filter:
            valid_statuses = {value for value, _label in StartingWorkAcknowledgment.Status.choices}
            if status_filter not in valid_statuses:
                return error(
                    "Invalid status.",
                    errors={"status": [f"Use one of: {', '.join(sorted(valid_statuses))}."]},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            queryset = queryset.filter(status=status_filter)
        paginator = JobOfferPagination()
        page = paginator.paginate_queryset(queryset, request)
        serializer = StartingWorkAcknowledgmentSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)


class StartingWorkAcknowledgmentDetailView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, acknowledgment_id: int):
        acknowledgment = _scoped_starting_work_acknowledgments(request).filter(pk=acknowledgment_id).first()
        if acknowledgment is None:
            return error("Starting work acknowledgement not found.", status=status.HTTP_404_NOT_FOUND)
        return success(_serialize_starting_work_acknowledgment(acknowledgment, request))


class StartingWorkAcknowledgmentPdfView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, acknowledgment_id: int):
        acknowledgment = _scoped_starting_work_acknowledgments(request).filter(pk=acknowledgment_id).first()
        if acknowledgment is None:
            return error("Starting work acknowledgement not found.", status=status.HTTP_404_NOT_FOUND)
        try:
            filename = acknowledgment.document.original_filename or f"starting-work-{acknowledgment.id}.pdf"
            response = FileResponse(
                acknowledgment.document.file.open("rb"),
                content_type="application/pdf",
                as_attachment=True,
                filename=Path(filename).name,
            )
            response["X-Content-Type-Options"] = "nosniff"
            response["Cache-Control"] = "private, no-store"
            audit(
                request,
                "starting_work_acknowledgment_pdf_downloaded",
                entity="StartingWorkAcknowledgment",
                entity_id=acknowledgment.id,
                metadata={"company_id": acknowledgment.company_id, "document_id": acknowledgment.document_id},
            )
            return response
        except FileNotFoundError:
            return error("Acknowledgement PDF is missing from storage.", status=status.HTTP_404_NOT_FOUND)


class StartingWorkAcknowledgmentApproveView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, acknowledgment_id: int):
        acknowledgment = _scoped_starting_work_acknowledgments(request).filter(pk=acknowledgment_id).first()
        if acknowledgment is None:
            return error("Starting work acknowledgement not found.", status=status.HTTP_404_NOT_FOUND)
        previous_status = acknowledgment.status
        try:
            acknowledgment = approve_starting_work_acknowledgment(acknowledgment, request.user)
        except ValueError as exc:
            return error(str(exc), status=status.HTTP_409_CONFLICT)
        audit(
            request,
            "starting_work_acknowledgment_approved",
            entity="StartingWorkAcknowledgment",
            entity_id=acknowledgment.id,
            metadata={
                "company_id": acknowledgment.company_id,
                "from_status": previous_status,
                "to_status": acknowledgment.status,
                "affected_attendance_count": acknowledgment.affected_attendance_records.count(),
            },
        )
        return success(
            _serialize_starting_work_acknowledgment(acknowledgment, request),
            message="Starting work attendance approved.",
        )


class StartingWorkAcknowledgmentRejectView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, acknowledgment_id: int):
        serializer = StartingWorkRejectionSerializer(data=request.data)
        if not serializer.is_valid():
            return error(
                "Validation error",
                errors=serializer.errors,
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        acknowledgment = _scoped_starting_work_acknowledgments(request).filter(pk=acknowledgment_id).first()
        if acknowledgment is None:
            return error("Starting work acknowledgement not found.", status=status.HTTP_404_NOT_FOUND)
        try:
            acknowledgment = reject_starting_work_acknowledgment(
                acknowledgment, request.user, serializer.validated_data["reason"]
            )
        except ValueError as exc:
            return error(str(exc), status=status.HTTP_409_CONFLICT)
        audit(
            request,
            "starting_work_acknowledgment_rejected",
            entity="StartingWorkAcknowledgment",
            entity_id=acknowledgment.id,
            metadata={
                "company_id": acknowledgment.company_id,
                "rejection_reason": acknowledgment.rejection_reason,
                "affected_attendance_count": acknowledgment.affected_attendance_records.count(),
            },
        )
        return success(
            _serialize_starting_work_acknowledgment(acknowledgment, request),
            message="Starting work attendance rejected.",
        )
