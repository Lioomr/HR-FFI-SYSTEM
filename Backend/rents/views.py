from django.db.models import Q
from django.db import IntegrityError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from employees.permissions import IsHRManagerOnly
from organization.services import ensure_company_write_allowed, filter_queryset_by_company_scope, get_active_company_for_request

from .models import Rent, RentType
from .serializers import (
    RentPaymentSerializer,
    RentPaymentWriteSerializer,
    RentReadSerializer,
    RentTypeSerializer,
    RentTypeWriteSerializer,
    RentWriteSerializer,
)
from .services import compute_rent_state, send_rent_notifications


def _to_bool_rent(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _fmt_date_rent(value):
    if not value:
        return "-"
    try:
        return value.strftime("%Y-%m-%d")
    except Exception:
        return str(value)


def _build_rent_pdf(rent: Rent) -> bytes:
    from core.pdf import (
        ApprovalStage,
        DetailRow,
        EmployeeBlock,
        ExtraSection,
        RequestDocument,
        render_request_pdf,
    )

    rent_type = rent.rent_type
    asset = rent.asset
    property_name = (
        rent.property_name_en
        or rent.property_name_ar
        or (asset.name_en if asset else "")
        or (asset.name_ar if asset else "")
        or "-"
    )

    details = [
        DetailRow(
            "Rent Type",
            "نوع الإيجار",
            f"{rent_type.name_en or rent_type.code} / {rent_type.name_ar or rent_type.code}",
        ),
        DetailRow("Property", "العقار", str(property_name)),
        DetailRow("Address", "العنوان", str(rent.property_address or "-")),
        DetailRow("Recurrence", "التكرار", str(rent.recurrence or "-")),
        DetailRow("Lease Start", "بداية العقد", _fmt_date_rent(rent.lease_start_date)),
        DetailRow("Lease End", "نهاية العقد", _fmt_date_rent(rent.lease_end_date)),
        DetailRow(
            "Annual Rent",
            "الإيجار السنوي",
            str(rent.annual_rent_value) if rent.annual_rent_value is not None else "-",
        ),
        DetailRow(
            "Security Deposit",
            "التأمين",
            str(rent.security_deposit) if rent.security_deposit is not None else "-",
        ),
        DetailRow("Amount", "المبلغ", str(rent.amount) if rent.amount is not None else "-"),
        DetailRow("Auto Renewal", "تجديد تلقائي", "Yes" if rent.auto_renewal else "No"),
    ]

    if rent.recurrence == Rent.Recurrence.ONE_TIME:
        details.append(DetailRow("Due Date", "تاريخ الاستحقاق", _fmt_date_rent(rent.one_time_due_date)))
    else:
        details.append(DetailRow("Start Date", "تاريخ البدء", _fmt_date_rent(rent.start_date)))
        details.append(
            DetailRow("Due Day", "يوم الاستحقاق", str(rent.due_day) if rent.due_day else "-")
        )

    approvals = [
        ApprovalStage(
            stage_en="Created",
            stage_ar="إنشاء السجل",
            actor=str(
                getattr(rent.created_by, "full_name", None)
                or getattr(rent.created_by, "email", None)
                or "-"
            ),
            at=_fmt_date_rent(rent.created_at),
            note="Rent record created",
        ),
        ApprovalStage(
            stage_en="Last Updated",
            stage_ar="آخر تحديث",
            actor=str(
                getattr(rent.updated_by, "full_name", None)
                or getattr(rent.updated_by, "email", None)
                or "-"
            ),
            at=_fmt_date_rent(rent.updated_at),
            note="-",
        ),
    ]

    extra = []
    if rent.payment_schedule:
        extra.append(
            ExtraSection(
                title_en="Payment Schedule", title_ar="جدول الدفعات", body=str(rent.payment_schedule)
            )
        )
    if rent.notice:
        extra.append(ExtraSection(title_en="Notice", title_ar="إشعار", body=str(rent.notice)))

    doc = RequestDocument(
        title_en="Rent Agreement",
        title_ar="اتفاقية إيجار",
        reference_no=str(rent.id),
        employee=EmployeeBlock(),
        details=details,
        approvals=approvals,
        extra=extra,
        status_label=str(rent.recurrence or ""),
    )
    return render_request_pdf(doc)


class RentTypeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
    queryset = RentType.objects.filter(is_active=True).order_by("code")

    def get_queryset(self):
        return filter_queryset_by_company_scope(super().get_queryset(), self.request)

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return RentTypeWriteSerializer
        return RentTypeSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"]._active_company = get_active_company_for_request(self.request)
        return context

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return success(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        ensure_company_write_allowed(request)
        company = get_active_company_for_request(request)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        instance = serializer.save(company=company)
        audit(request, "rent_type_created", entity="rent_type", entity_id=instance.id, metadata=serializer.data)
        return success(RentTypeSerializer(instance).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        updated = serializer.save()
        audit(request, "rent_type_updated", entity="rent_type", entity_id=updated.id, metadata=serializer.data)
        return success(RentTypeSerializer(updated).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        audit(request, "rent_type_deleted", entity="rent_type", entity_id=instance.id, metadata={"code": instance.code})
        return success({})


class RentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
    pagination_class = StandardPagination
    queryset = Rent.objects.filter(is_active=True).select_related("rent_type", "asset", "created_by", "updated_by")

    def get_queryset(self):
        return filter_queryset_by_company_scope(super().get_queryset(), self.request)

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return RentWriteSerializer
        return RentReadSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"]._active_company = get_active_company_for_request(self.request)
        return context

    def _apply_query_filters(self, queryset):
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(rent_type__name_en__icontains=search)
                | Q(rent_type__name_ar__icontains=search)
                | Q(rent_type__code__icontains=search)
                | Q(asset__name_en__icontains=search)
                | Q(asset__name_ar__icontains=search)
                | Q(property_name_en__icontains=search)
                | Q(property_name_ar__icontains=search)
                | Q(property_address__icontains=search)
                | Q(payment_schedule__icontains=search)
                | Q(notice__icontains=search)
                | Q(payments__icontains=search)
            )

        rent_type_id = params.get("rent_type")
        if rent_type_id:
            queryset = queryset.filter(rent_type_id=rent_type_id)

        return queryset.order_by("id")

    def _filter_by_status(self, queryset):
        status_filter = (self.request.query_params.get("status") or "all").strip().lower()
        if status_filter not in {"all", "upcoming", "overdue"}:
            return None, error("Validation error", errors={"status": ["Must be one of: all, upcoming, overdue."]}, status=422)

        items = []
        for rent in queryset:
            computed = compute_rent_state(rent)
            if status_filter == "upcoming" and computed.status != "UPCOMING":
                continue
            if status_filter == "overdue" and computed.status != "OVERDUE":
                continue
            items.append(rent)
        return items, None

    def list(self, request, *args, **kwargs):
        queryset = self._apply_query_filters(self.get_queryset())
        filtered, err = self._filter_by_status(queryset)
        if err:
            return err

        page = self.paginate_queryset(filtered)
        serializer = self.get_serializer(page if page is not None else filtered, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": len(serializer.data), "page": 1, "page_size": len(serializer.data), "total_pages": 1})

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        ensure_company_write_allowed(request)
        company = get_active_company_for_request(request)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        instance = serializer.save(created_by=request.user, updated_by=request.user, company=company)
        audit(
            request,
            "rent_created",
            entity="rent",
            entity_id=instance.id,
            metadata={"rent_type": instance.rent_type.name_en},
        )
        return success(RentReadSerializer(instance).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        updated = serializer.save(updated_by=request.user)
        audit(
            request,
            "rent_updated",
            entity="rent",
            entity_id=updated.id,
            metadata={"rent_type": updated.rent_type.name_en},
        )
        return success(RentReadSerializer(updated).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.updated_by = request.user
        instance.save(update_fields=["is_active", "updated_by", "updated_at"])
        audit(
            request,
            "rent_deleted",
            entity="rent",
            entity_id=instance.id,
            metadata={"rent_type": instance.rent_type.name_en},
        )
        return success({})

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        rent = self.get_object()
        pdf_bytes = _build_rent_pdf(rent)
        audit(request, "rent_exported_pdf", entity="rent", entity_id=rent.id)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = f"rent_{rent.id}.pdf"
        disposition = "attachment" if _to_bool_rent(request.query_params.get("download", "1")) else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="notify")
    def notify(self, request, pk=None):
        if get_role(request.user) != "HRManager":
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        rent = self.get_object()
        delivery = send_rent_notifications(rent, manual=True)
        audit(request, "rent_manual_notified", entity="rent", entity_id=rent.id, metadata={"delivery": delivery})
        return success({"delivery": delivery})

    @action(detail=True, methods=["post"], url_path="payments")
    def add_payment(self, request, pk=None):
        ensure_company_write_allowed(request)
        rent = self.get_object()
        serializer = RentPaymentWriteSerializer(data=request.data, context={"request": request, "rent": rent})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)

        try:
            payment = serializer.save(rent=rent, created_by=request.user, updated_by=request.user)
        except IntegrityError:
            return error(
                "Validation error",
                errors={"payment_number": ["A payment record with this number already exists for this rent."]},
                status=422,
            )

        audit(
            request,
            "rent_payment_created",
            entity="rent_payment",
            entity_id=payment.id,
            metadata={"rent_id": rent.id, "payment_number": payment.payment_number, "category": payment.category},
        )
        return success(RentPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)
