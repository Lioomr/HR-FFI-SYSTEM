import logging
import os
import re
import uuid

from django.core import signing
from django.core.files.base import ContentFile
from django.db import connection, transaction
from django.db.models import Min, Q
from django.db.models.functions import TruncMinute
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from employees.models import EmployeeProfile
from employees.permissions import IsHRManagerOrAdmin
from employees.services.manager_relationships import has_manager_access, manager_scope_q
from organization.models import OrganizationNode
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
    get_user_accessible_company_ids,
    is_head_office_context,
)

from .models import Announcement
from .serializers import AnnouncementCreateSerializer, AnnouncementListSerializer, AnnouncementSerializer
from .tasks import enqueue_announcement_group
from .utils import (
    ANNOUNCEMENT_ATTACHMENT_SALT,
    send_announcement_in_app,
)
from .whatsapp_groups import available_groups

logger = logging.getLogger(__name__)

# Roles that may send announcements to every company from Main Head Office.
# Editing and deleting stay HR/Admin-only, as for company announcements.
HEAD_OFFICE_BROADCAST_ROLES = {"SystemAdmin", "HRManager", "CEO"}
# A head-office broadcast always goes to everyone in every company; employee
# lists, role targets and WhatsApp groups are per company, so they are refused.
BROADCAST_FORBIDDEN_FIELDS = ("target_user", "target_user_ids", "target_roles", "whatsapp_group_id")
BROADCAST_AUDIENCE_ERROR = "Announcements from Main Head Office go to every employee in every company."
BROADCAST_EDIT_IN_HEAD_OFFICE = (
    "This announcement was sent to every company from Main Head Office. Switch to Main Head Office to change it."
)


def _broadcast_audience_errors(data):
    used = [field for field in BROADCAST_FORBIDDEN_FIELDS if data.get(field) not in (None, "", "null", "[]", [])]
    return {field: [BROADCAST_AUDIENCE_ERROR] for field in used}


def _download_filename(file_name):
    filename = os.path.basename(file_name)
    stem, extension = os.path.splitext(filename)
    stem = re.sub(r"_[A-Za-z0-9]{7}$", "", stem)
    return f"{stem}{extension}"


class AnnouncementViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing announcements.

    - HR Managers can create, update, delete announcements
    - All users can view announcements targeted to their role
    """

    pagination_class = StandardPagination

    def get_permissions(self):
        if self.action == "attachment_public":
            return [IsAuthenticated()]
        if self.action == "create":
            return [IsAuthenticated()]
        if self.action in ["update", "partial_update", "destroy", "whatsapp_groups"]:
            return [IsAuthenticated(), IsHRManagerOrAdmin()]
        return [IsAuthenticated()]

    @action(detail=False, methods=["get"], url_path="whatsapp-groups")
    def whatsapp_groups(self, request):
        ensure_company_write_allowed(request)
        company = get_active_company_for_request(request)
        payload = available_groups(company)
        audit(
            request,
            "announcement_whatsapp_groups_listed",
            entity="OrganizationNode",
            entity_id=company.pk,
            metadata={"state": payload["state"], "group_count": len(payload["groups"])},
        )
        return success(payload)

    def _manager_team_user_ids(self, user):
        reports_qs = EmployeeProfile.objects.filter(
            manager_scope_q(user, cross_company_capability="announcements.manage")
        )
        return (
            reports_qs.filter(
                is_archived=False,
                employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                user__is_active=True,
            )
            .exclude(user__isnull=True)
            .values_list("user_id", flat=True)
        )

    def _ceo_team_user_ids(self, user):
        ceo_profile = getattr(user, "employee_profile", None)
        direct_reports_q = Q(pk__in=[])
        if ceo_profile:
            direct_reports_q = Q(manager_profile=ceo_profile, company_id=ceo_profile.company_id)

        team_profiles = EmployeeProfile.objects.filter(
            Q(user__groups__name__in=["Manager", "HRManager"]) | direct_reports_q
        )
        team_profiles = filter_queryset_by_company_scope(team_profiles, self.request)
        return set(team_profiles.exclude(user__isnull=True).values_list("user_id", flat=True).distinct())

    def _collapse_broadcast_duplicates(self, queryset):
        grouped_ids = list(
            queryset.filter(
                is_active=True,
                target_user__isnull=False,
                target_roles=[],
            )
            .annotate(created_minute=TruncMinute("created_at"))
            .values(
                "created_by_id",
                "title",
                "content",
                "publish_to_dashboard",
                "publish_to_email",
                "publish_to_sms",
                "created_minute",
            )
            .annotate(rep_id=Min("id"))
            .values_list("rep_id", flat=True)
        )
        return queryset.filter(~Q(target_user__isnull=False, target_roles=[]) | Q(id__in=grouped_ids))

    @staticmethod
    def _role_target_filter(role):
        """Use a JSON lookup supported by the active database backend."""
        if connection.vendor == "postgresql":
            return Q(target_roles__contains=[role])
        return Q(target_roles__icontains=f'"{role}"')

    def _head_office_broadcasts(self):
        """One row per head-office broadcast the user can reach, never plain company rows."""
        user = self.request.user
        if get_role(user) not in HEAD_OFFICE_BROADCAST_ROLES:
            return Announcement.objects.none()
        rows = Announcement.objects.filter(
            is_active=True,
            broadcast_id__isnull=False,
            company_id__in=get_user_accessible_company_ids(user),
        )
        representative_ids = list(
            rows.order_by().values("broadcast_id").annotate(rep_id=Min("id")).values_list("rep_id", flat=True)
        )
        return rows.filter(id__in=representative_ids).select_related("company", "created_by", "whatsapp_group_delivery")

    def _broadcast_copies(self, announcement):
        """Every live copy of a broadcast inside the companies this user can access."""
        return Announcement.objects.filter(
            broadcast_id=announcement.broadcast_id,
            is_active=True,
            company_id__in=get_user_accessible_company_ids(self.request.user),
        )

    def get_queryset(self):
        if is_head_office_context(self.request):
            return self._head_office_broadcasts()
        user = self.request.user
        scoped_announcements = filter_queryset_by_company_scope(
            Announcement.objects.filter(is_active=True).select_related("company", "whatsapp_group_delivery"),
            self.request,
        )

        # Determine user role from groups using core permissions logic
        user_group_role = get_role(user)

        if user_group_role in {"SystemAdmin", "HRManager"}:
            # Each private record is independently editable; never hide recipients.
            return scoped_announcements
        audience = Q(target_user=user) | Q(whole_company=True)
        if user_group_role == "CEO":
            audience |= self._role_target_filter("CEO")
        visible = Q(publish_to_dashboard=True) & audience
        if user_group_role in {"Manager", "CEO"} or has_manager_access(
            user, cross_company_capability="announcements.manage"
        ):
            visible |= Q(created_by=user)
        return self._collapse_broadcast_duplicates(scoped_announcements.filter(visible))

    @staticmethod
    def _attachment_response(announcement, *, deprecated=False):
        filename = _download_filename(announcement.attachment.name)
        try:
            announcement.attachment.open("rb")
        except FileNotFoundError:
            logger.warning("announcement_attachment_missing", extra={"announcement_id": announcement.id})
            return error("Attachment not found.", status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(
            announcement.attachment,
            content_type="application/octet-stream",
            as_attachment=True,
            filename=filename,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        if deprecated:
            response["Deprecation"] = "true"
            response["Link"] = f'</api/announcements/{announcement.id}/attachment/>; rel="successor-version"'
        return response

    def get_serializer_class(self):
        if self.action == "list":
            return AnnouncementListSerializer
        elif self.action == "create":
            return AnnouncementCreateSerializer
        return AnnouncementSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)

        if page is not None:
            return self.get_paginated_response(serializer.data)

        # Keep contract consistent with StandardPagination data shape.
        return success(
            {
                "items": serializer.data,
                "page": 1,
                "page_size": len(serializer.data),
                "count": len(serializer.data),
                "total_pages": 1,
            }
        )

    def _create_head_office_broadcast(self, request):
        if get_role(request.user) not in HEAD_OFFICE_BROADCAST_ROLES:
            return error(
                "Forbidden",
                errors=["Switch to a company to create announcements."],
                status=status.HTTP_403_FORBIDDEN,
            )
        # Checked before validation: those fields are validated against a single
        # active company, which Main Head Office is not.
        audience_errors = _broadcast_audience_errors(request.data)
        if audience_errors:
            return error("Validation error", errors=audience_errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        serializer = AnnouncementCreateSerializer(data=request.data, context=self.get_serializer_context())
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        validated = dict(serializer.validated_data)
        if not validated.get("whole_company"):
            return error(
                "Validation error",
                errors={"whole_company": [BROADCAST_AUDIENCE_ERROR]},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        companies = list(
            OrganizationNode.objects.filter(
                id__in=get_user_accessible_company_ids(request.user),
                node_type=OrganizationNode.NodeType.COMPANY,
                is_active=True,
            ).order_by("name", "id")
        )
        if not companies:
            return error(
                "Validation error",
                errors=["Your account has no company access to send this announcement to."],
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        attachment = validated.pop("attachment", None)
        attachment_bytes = attachment.read() if attachment else None
        for field in ("target_roles", "target_user", "whatsapp_group_id"):
            validated.pop(field, None)
        broadcast_id = uuid.uuid4()
        created = []
        with transaction.atomic():
            for company in companies:
                announcement = Announcement.objects.create(
                    **validated,
                    target_roles=[],
                    company=company,
                    broadcast_id=broadcast_id,
                    created_by=request.user,
                )
                if attachment is not None:
                    announcement.attachment.save(attachment.name, ContentFile(attachment_bytes), save=True)
                created.append(announcement)

        for announcement in created:
            try:
                send_announcement_in_app(announcement)
            except Exception:
                logger.exception(
                    "announcement_notification_unhandled_exception",
                    extra={"announcement_id": announcement.id},
                )

        audit(
            request,
            "announcement_broadcast_created",
            entity="Announcement",
            entity_id=created[0].id,
            metadata={
                "broadcast_id": str(broadcast_id),
                "company_ids": [company.id for company in companies],
                "created_count": len(created),
            },
        )
        data = AnnouncementSerializer(created[0], context=self.get_serializer_context()).data
        return success(
            {"announcement": data, "created_count": len(created), "message": "Announcement sent to every company"},
            status=status.HTTP_201_CREATED,
        )

    def create(self, request, *args, **kwargs):
        if is_head_office_context(request):
            return self._create_head_office_broadcast(request)
        ensure_company_write_allowed(request)
        active_company = get_active_company_for_request(request)
        user_role = get_role(request.user)
        manager_capability = user_role not in ["SystemAdmin", "HRManager", "CEO"] and has_manager_access(
            request.user, cross_company_capability="announcements.manage"
        )
        serializer_context = self.get_serializer_context()
        if user_role in ["Manager", "CEO"] or manager_capability:
            serializer_context["allow_empty_targets_for_manager"] = True

        serializer = self.get_serializer(data=request.data, context=serializer_context)

        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        validated = serializer.validated_data
        target_user_ids = validated.pop("target_user_ids", [])
        attachment = validated.get("attachment")

        if user_role not in ["SystemAdmin", "HRManager", "Manager", "CEO"] and not manager_capability:
            return error(
                "Forbidden", errors=["You are not allowed to create announcements."], status=status.HTTP_403_FORBIDDEN
            )

        if target_user_ids and user_role not in ["SystemAdmin", "HRManager"]:
            return error(
                "Forbidden",
                errors=["Only HR managers can create selected-employee notifications."],
                status=status.HTTP_403_FORBIDDEN,
            )

        if target_user_ids:
            attachment_name = None
            attachment_bytes = None
            if attachment:
                attachment_name = attachment.name
                attachment_bytes = attachment.read()
                attachment.seek(0)

            created_announcements = []
            with transaction.atomic():
                for user_id in target_user_ids:
                    announcement_data = {
                        key: value
                        for key, value in validated.items()
                        if key not in {"target_roles", "target_user", "attachment"}
                    }
                    announcement = Announcement.objects.create(
                        **announcement_data,
                        target_roles=[],
                        target_user_id=user_id,
                        created_by=request.user,
                        company=active_company,
                    )
                    if attachment_name and attachment_bytes is not None:
                        announcement.attachment.save(attachment_name, ContentFile(attachment_bytes), save=True)
                    created_announcements.append(announcement)
        # Manager can only target own team (direct reports), never global roles.
        elif user_role in ["Manager", "CEO"] or manager_capability:
            if validated.get("target_roles") or validated.get("whole_company"):
                return error(
                    "Validation error",
                    errors=["Role-based targets are not allowed. Target a team member or all team."],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            team_user_ids = (
                set(self._manager_team_user_ids(request.user))
                if user_role == "Manager" or manager_capability
                else set(self._ceo_team_user_ids(request.user))
            )
            if not team_user_ids:
                return error("Validation error", errors=["No team members found for this user."], status=422)

            target_user = validated.get("target_user")
            if target_user:
                if target_user.id not in team_user_ids:
                    return error("Validation error", errors=["Selected user is not in your team."], status=422)
                announcement = serializer.save(created_by=request.user, target_roles=[], company=active_company)
                created_announcements = [announcement]
            else:
                if attachment:
                    created_announcements = []
                    attachment_name = attachment.name
                    attachment_bytes = attachment.read()
                    attachment.seek(0)
                    with transaction.atomic():
                        for user_id in team_user_ids:
                            announcement = Announcement.objects.create(
                                title=validated["title"],
                                content=validated["content"],
                                target_roles=[],
                                target_user_id=user_id,
                                publish_to_dashboard=validated.get("publish_to_dashboard", True),
                                publish_to_email=validated.get("publish_to_email", False),
                                publish_to_sms=validated.get("publish_to_sms", False),
                                created_by=request.user,
                                company=active_company,
                            )
                            announcement.attachment.save(attachment_name, ContentFile(attachment_bytes), save=True)
                            created_announcements.append(announcement)
                else:
                    now = timezone.now()
                    payloads = []
                    for user_id in team_user_ids:
                        payloads.append(
                            Announcement(
                                title=validated["title"],
                                content=validated["content"],
                                target_roles=[],
                                target_user_id=user_id,
                                publish_to_dashboard=validated.get("publish_to_dashboard", True),
                                publish_to_email=validated.get("publish_to_email", False),
                                publish_to_sms=validated.get("publish_to_sms", False),
                                created_by=request.user,
                                company=active_company,
                                created_at=now,
                                updated_at=now,
                            )
                        )
                    created_announcements = Announcement.objects.bulk_create(payloads)
        else:
            # Save announcement with current user as creator
            announcement = serializer.save(created_by=request.user, company=active_company)
            created_announcements = [announcement]

        # Send notifications based on publishing options. Keep failures isolated so
        # one recipient/channel cannot prevent the remaining announcements from sending.
        for announcement in created_announcements:
            try:
                send_announcement_in_app(announcement)
            except Exception:
                logger.exception(
                    "announcement_notification_unhandled_exception",
                    extra={"announcement_id": announcement.id},
                )

        # One group post per creation batch, regardless of selected-employee fanout.
        try:
            if created_announcements:
                enqueue_announcement_group(created_announcements[0])
        except Exception:
            logger.warning("announcement_group_schedule_failed", extra={"announcement_id": created_announcements[0].pk})

        # Audit log
        audit(
            request,
            "announcement_created",
            entity="Announcement",
            entity_id=created_announcements[0].id if created_announcements else None,
            metadata={
                "created_count": len(created_announcements),
                "whatsapp_group_selected": bool(validated.get("whatsapp_group_id")),
            },
        )

        # Return full announcement data (single for HR/Admin, list/count for team broadcast)
        if len(created_announcements) == 1:
            response_serializer = AnnouncementSerializer(
                created_announcements[0], context=self.get_serializer_context()
            )
            payload = {"announcement": response_serializer.data, "message": "Announcement created successfully"}
        else:
            payload = {
                "created_count": len(created_announcements),
                "message": "Announcement sent to your team successfully",
            }

        return success(payload, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success({"announcement": serializer.data})

    @action(detail=True, methods=["get"], url_path="attachment")
    def attachment(self, request, *args, **kwargs):
        announcement = self.get_object()
        if not announcement.attachment:
            return error("Attachment not found.", status=status.HTTP_404_NOT_FOUND)
        response = self._attachment_response(announcement)
        if isinstance(response, FileResponse):
            audit(request, "announcement_attachment_downloaded", entity="Announcement", entity_id=announcement.id)
        return response

    @action(detail=True, methods=["get"], url_path="attachment-public")
    def attachment_public(self, request, *args, **kwargs):
        announcement = self.get_object()
        if not announcement.attachment:
            return error("Attachment not found.", status=status.HTTP_404_NOT_FOUND)

        token = (request.query_params.get("token") or "").strip()
        if not token:
            return error("Unauthorized", status=status.HTTP_401_UNAUTHORIZED)

        try:
            payload = signing.loads(
                token,
                salt=ANNOUNCEMENT_ATTACHMENT_SALT,
                max_age=7 * 24 * 60 * 60,
            )
        except signing.SignatureExpired:
            return error("Link expired.", status=status.HTTP_401_UNAUTHORIZED)
        except signing.BadSignature:
            return error("Unauthorized", status=status.HTTP_401_UNAUTHORIZED)

        if payload.get("announcement_id") != announcement.id:
            return error("Unauthorized", status=status.HTTP_401_UNAUTHORIZED)

        response = self._attachment_response(announcement, deprecated=True)
        if isinstance(response, FileResponse):
            audit(request, "announcement_attachment_downloaded", entity="Announcement", entity_id=announcement.id)
        return response

    def _update_broadcast(self, request, instance, partial):
        audience_errors = _broadcast_audience_errors(request.data)
        if audience_errors:
            return error("Validation error", errors=audience_errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        serializer = AnnouncementCreateSerializer(
            instance, data=request.data, partial=partial, context=self.get_serializer_context()
        )
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        validated = dict(serializer.validated_data)
        if validated.get("whole_company") is False:
            return error(
                "Validation error",
                errors={"whole_company": [BROADCAST_AUDIENCE_ERROR]},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        attachment = validated.pop("attachment", None)
        attachment_bytes = attachment.read() if attachment else None
        for field in ("target_roles", "target_user", "whatsapp_group_id", "whole_company"):
            validated.pop(field, None)

        with transaction.atomic():
            copies = list(self._broadcast_copies(instance).select_for_update())
            for copy in copies:
                for field, value in validated.items():
                    setattr(copy, field, value)
                copy.save()
                if attachment is not None:
                    copy.attachment.save(attachment.name, ContentFile(attachment_bytes), save=True)

        audit(
            request,
            "announcement_broadcast_updated",
            entity="Announcement",
            entity_id=instance.id,
            metadata={"broadcast_id": str(instance.broadcast_id), "updated_count": len(copies)},
        )
        instance.refresh_from_db()
        response_serializer = AnnouncementSerializer(instance, context=self.get_serializer_context())
        return success({"announcement": response_serializer.data, "message": "Announcement updated successfully"})

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        if is_head_office_context(request):
            return self._update_broadcast(request, self.get_object(), partial)
        ensure_company_write_allowed(request)
        instance = self.get_object()
        if instance.broadcast_id:
            return error(
                "Validation error",
                errors=[BROADCAST_EDIT_IN_HEAD_OFFICE],
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        serializer = AnnouncementCreateSerializer(
            instance,
            data=request.data,
            partial=partial,
            context=self.get_serializer_context(),
        )

        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        target_user_ids = serializer.validated_data.pop("target_user_ids", [])
        with transaction.atomic():
            if target_user_ids:
                serializer.save(target_user_id=target_user_ids[0])
                for user_id in target_user_ids[1:]:
                    values = {
                        field.attname: getattr(instance, field.attname)
                        for field in Announcement._meta.concrete_fields
                        if field.name not in {"id", "created_at", "updated_at", "target_user"}
                    }
                    Announcement.objects.create(**values, target_user_id=user_id)
            else:
                serializer.save()

        # Audit log
        audit(request, "announcement_updated", entity="Announcement", entity_id=instance.id)

        response_serializer = AnnouncementSerializer(instance, context=self.get_serializer_context())
        return success({"announcement": response_serializer.data, "message": "Announcement updated successfully"})

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        if instance.broadcast_id:
            if not is_head_office_context(request):
                return error(
                    "Validation error",
                    errors=[BROADCAST_EDIT_IN_HEAD_OFFICE],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            deleted_count = self._broadcast_copies(instance).update(is_active=False, updated_at=timezone.now())
            audit(
                request,
                "announcement_broadcast_deleted",
                entity="Announcement",
                entity_id=instance.id,
                metadata={"broadcast_id": str(instance.broadcast_id), "deleted_count": deleted_count},
            )
            return success({"message": "Announcement deleted successfully"})

        # Soft delete
        instance.is_active = False
        instance.save()

        # Audit log
        audit(request, "announcement_deleted", entity="Announcement", entity_id=instance.id)

        return success({"message": "Announcement deleted successfully"})
