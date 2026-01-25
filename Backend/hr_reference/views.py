from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsHRManagerOrAdmin
from core.responses import success
from audit.utils import audit

from .models import Department, Position, TaskGroup, Sponsor
from .serializers import (
    DepartmentSerializer,
    PositionSerializer,
    TaskGroupSerializer,
    SponsorSerializer,
)


class BaseReferenceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    pagination_class = None
    audit_entity = ""

    def get_queryset(self):
        return self.queryset.filter(is_active=True)

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        return success(response.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return success(response.data)

    def partial_update(self, request, *args, **kwargs):
        response = super().partial_update(request, *args, **kwargs)
        return success(response.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        before = {
            "id": instance.id,
            "code": instance.code,
            "name": instance.name,
            "description": instance.description,
        }
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        audit(
            self.request,
            f"{self.audit_entity}.deleted",
            entity=self.audit_entity,
            entity_id=instance.id,
            metadata={"before": before, "after": None},
        )
        return success({})

    def perform_create(self, serializer):
        instance = serializer.save()
        audit(
            self.request,
            f"{self.audit_entity}.created",
            entity=self.audit_entity,
            entity_id=instance.id,
            metadata={"before": None, "after": serializer.data},
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        before = {
            "id": instance.id,
            "code": instance.code,
            "name": instance.name,
            "description": instance.description,
        }
        updated = serializer.save()
        audit(
            self.request,
            f"{self.audit_entity}.updated",
            entity=self.audit_entity,
            entity_id=updated.id,
            metadata={"before": before, "after": serializer.data},
        )


class DepartmentViewSet(BaseReferenceViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    audit_entity = "department"


class PositionViewSet(BaseReferenceViewSet):
    queryset = Position.objects.all()
    serializer_class = PositionSerializer
    audit_entity = "position"


class TaskGroupViewSet(BaseReferenceViewSet):
    queryset = TaskGroup.objects.all()
    serializer_class = TaskGroupSerializer
    audit_entity = "task_group"


class SponsorViewSet(BaseReferenceViewSet):
    queryset = Sponsor.objects.all()
    serializer_class = SponsorSerializer
    audit_entity = "sponsor"
