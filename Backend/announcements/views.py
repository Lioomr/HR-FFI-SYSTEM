from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Min
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.db.models.functions import TruncMinute

from core.pagination import StandardPagination
from core.responses import success, error
from employees.permissions import IsHRManagerOrAdmin
from core.permissions import get_role
from audit.utils import audit
from employees.models import EmployeeProfile

from .models import Announcement
from .serializers import (
    AnnouncementSerializer,
    AnnouncementListSerializer,
    AnnouncementCreateSerializer
)
from .utils import send_announcement_email, send_announcement_whatsapp

User = get_user_model()


class AnnouncementViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing announcements.
    
    - HR Managers can create, update, delete announcements
    - All users can view announcements targeted to their role
    """
    pagination_class = StandardPagination

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated()]
        if self.action in ['update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), IsHRManagerOrAdmin()]
        return [IsAuthenticated()]

    def _manager_team_user_ids(self, user):
        manager_profile = getattr(user, "employee_profile", None)
        reports_qs = EmployeeProfile.objects.filter(manager=user)
        if manager_profile:
            reports_qs = EmployeeProfile.objects.filter(Q(manager=user) | Q(manager_profile=manager_profile))
        return reports_qs.exclude(user__isnull=True).values_list("user_id", flat=True)

    def _ceo_team_user_ids(self, user):
        ceo_profile = getattr(user, "employee_profile", None)
        direct_reports_q = Q(manager=user)
        if ceo_profile:
            direct_reports_q = direct_reports_q | Q(manager_profile=ceo_profile)

        leadership_user_ids = User.objects.filter(groups__name__in=["Manager", "HRManager"]).values_list("id", flat=True)
        direct_report_user_ids = EmployeeProfile.objects.filter(direct_reports_q).exclude(user__isnull=True).values_list(
            "user_id", flat=True
        )
        return set(leadership_user_ids).union(set(direct_report_user_ids))

    def _collapse_broadcast_duplicates(self, queryset):
        grouped_ids = list(
            Announcement.objects.filter(
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

    def get_queryset(self):
        user = self.request.user

        # Determine user role from groups using core permissions logic
        user_group_role = get_role(user)
        
        # Map group roles to Announcement model constants
        # SystemAdmin -> ADMIN
        # HRManager -> HR_MANAGER
        # Manager -> MANAGER
        # Employee -> EMPLOYEE
        role_map = {
            "SystemAdmin": "ADMIN",
            "HRManager": "HR_MANAGER",
            "Manager": "MANAGER",
            "CEO": "CEO",
            "Employee": "EMPLOYEE"
        }
        
        user_role = role_map.get(user_group_role, "EMPLOYEE")
        
        # HR Managers and Admins can see all announcements
        if user_role in ['ADMIN', 'HR_MANAGER']:
            return self._collapse_broadcast_duplicates(Announcement.objects.filter(is_active=True))
        
        # Managers can also see what they created for their team.
        if user_role == "MANAGER":
            base_qs = Announcement.objects.filter(
                is_active=True,
            ).filter(
                Q(created_by=user) | Q(target_user=user) | Q(target_roles__contains=["MANAGER"])
            )
            return self._collapse_broadcast_duplicates(base_qs)

        if user_role == "CEO":
            base_qs = Announcement.objects.filter(
                is_active=True,
            ).filter(Q(created_by=user) | Q(target_user=user))
            return self._collapse_broadcast_duplicates(base_qs)

        # Other users only see announcements targeted to their role
        return self._collapse_broadcast_duplicates(
            Announcement.objects.filter(
            is_active=True,
            publish_to_dashboard=True,
        ).filter(
            Q(target_user=user) | Q(target_roles__contains=[user_role])
            )
        )
    
    def get_serializer_class(self):
        if self.action == 'list':
            return AnnouncementListSerializer
        elif self.action == 'create':
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
    
    def create(self, request, *args, **kwargs):
        user_role = get_role(request.user)
        serializer_context = self.get_serializer_context()
        if user_role in ["Manager", "CEO"]:
            serializer_context["allow_empty_targets_for_manager"] = True

        serializer = self.get_serializer(data=request.data, context=serializer_context)

        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        validated = serializer.validated_data

        if user_role not in ["SystemAdmin", "HRManager", "Manager", "CEO"]:
            return error("Forbidden", errors=["You are not allowed to create announcements."], status=status.HTTP_403_FORBIDDEN)

        # Manager can only target own team (direct reports), never global roles.
        if user_role in ["Manager", "CEO"]:
            if validated.get("target_roles"):
                return error(
                    "Validation error",
                    errors=["Role-based targets are not allowed. Target a team member or all team."],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            team_user_ids = (
                set(self._manager_team_user_ids(request.user))
                if user_role == "Manager"
                else set(self._ceo_team_user_ids(request.user))
            )
            if not team_user_ids:
                return error("Validation error", errors=["No team members found for this user."], status=422)

            target_user = validated.get("target_user")
            if target_user:
                if target_user.id not in team_user_ids:
                    return error("Validation error", errors=["Selected user is not in your team."], status=422)
                announcement = serializer.save(created_by=request.user, target_roles=[])
                created_announcements = [announcement]
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
                            created_at=now,
                            updated_at=now,
                        )
                    )
                created_announcements = Announcement.objects.bulk_create(payloads)
        else:
            # Save announcement with current user as creator
            announcement = serializer.save(created_by=request.user)
            created_announcements = [announcement]

        # Send notifications based on publishing options
        try:
            for announcement in created_announcements:
                if announcement.publish_to_email:
                    send_announcement_email(announcement)
                if announcement.publish_to_sms:
                    send_announcement_whatsapp(announcement)
        except Exception as e:
            print(f"Error sending notifications: {e}")

        # Audit log
        audit(
            request,
            "announcement_created",
            entity="Announcement",
            entity_id=created_announcements[0].id if created_announcements else None,
            metadata={"created_count": len(created_announcements)},
        )

        # Return full announcement data (single for HR/Admin, list/count for team broadcast)
        if len(created_announcements) == 1:
            response_serializer = AnnouncementSerializer(created_announcements[0])
            payload = {"announcement": response_serializer.data, "message": "Announcement created successfully"}
        else:
            payload = {
                "created_count": len(created_announcements),
                "message": "Announcement sent to your team successfully",
            }

        return success(
            payload,
            status=status.HTTP_201_CREATED
        )
    
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success({"announcement": serializer.data})
    
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = AnnouncementCreateSerializer(instance, data=request.data, partial=partial)
        
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        
        serializer.save()
        
        # Audit log
        audit(request, "announcement_updated", entity="Announcement", entity_id=instance.id)
        
        response_serializer = AnnouncementSerializer(instance)
        return success({"announcement": response_serializer.data, "message": "Announcement updated successfully"})
    
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        
        # Soft delete
        instance.is_active = False
        instance.save()
        
        # Audit log
        audit(request, "announcement_deleted", entity="Announcement", entity_id=instance.id)
        
        return success({"message": "Announcement deleted successfully"})
