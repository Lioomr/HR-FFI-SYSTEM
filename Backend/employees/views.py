import random
import string
from rest_framework import viewsets, mixins, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied, MethodNotAllowed

from core.permissions import IsSystemAdmin, get_role
from audit.utils import audit
from core.responses import success, error

from .models import EmployeeProfile
from .serializers import EmployeeProfileSerializer, EmployeeProfileCreateUpdateSerializer
from .permissions import IsHRManagerOrAdmin, IsEmployeeOwner

import random
import string
from django.db import IntegrityError, transaction
from rest_framework import viewsets, mixins, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, MethodNotAllowed

from core.permissions import IsSystemAdmin, get_role
from audit.utils import audit
from core.responses import success, error

from .models import EmployeeProfile
from .serializers import EmployeeProfileSerializer, EmployeeProfileCreateUpdateSerializer
from .permissions import IsHRManagerOrAdmin, IsEmployeeOwner

def generate_employee_id():
    # Simple deterministic format: EMP+6 digits. 
    suffix = ''.join(random.choices(string.digits, k=6))
    return f"EMP-{suffix}"

class EmployeeProfileViewSet(viewsets.ModelViewSet):
    # Default permissions, overridden by get_permissions()
    permission_classes = [IsAuthenticated] 

    def get_permissions(self):
        if self.action in ["list", "retrieve", "me"]:
            # Read: HR/Admin OR Owner
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin | IsEmployeeOwner]
        else:
            # Write: HR/Admin Only
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)
        
        if role in ["SystemAdmin", "HRManager"]:
            return EmployeeProfile.objects.all().select_related("user", "manager")
        
        # Employee: only own profile
        return EmployeeProfile.objects.filter(user=user).select_related("user", "manager")

    def get_serializer_class(self):
        if self.action in ["list", "retrieve", "me"]:
            return EmployeeProfileSerializer
        return EmployeeProfileCreateUpdateSerializer

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        try:
            profile = EmployeeProfile.objects.get(user=request.user)
        except EmployeeProfile.DoesNotExist:
             return error("Profile not found.", status=status.HTTP_404_NOT_FOUND)
        
        serializer = self.get_serializer(profile)
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        # Wrap create to return success envelope
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        # Re-serialize with read serializer for full details in response
        read_serializer = EmployeeProfileSerializer(serializer.instance)
        return success(read_serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        # Retry loop for ID generation
        max_retries = 5
        for _ in range(max_retries):
            eid = generate_employee_id()
            try:
                with transaction.atomic():
                    instance = serializer.save(employee_id=eid)
                    audit(self.request, "employee_profile_created", entity="employee_profile", entity_id=instance.id, metadata={
                        "employee_id": instance.employee_id,
                        "user_email": instance.user.email,
                        "department": instance.department
                    })
                    return # Success
            except IntegrityError:
                continue # Retry
        
        raise IntegrityError("Failed to generate unique Employee ID after multiple attempts.")

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return success(response.data)

    def perform_update(self, serializer):
        previous_status = serializer.instance.employment_status
        instance = serializer.save()
        
        audit(self.request, "employee_profile_updated", entity="employee_profile", entity_id=instance.id, metadata={
            "employee_id": instance.employee_id,
            "changes": serializer.validated_data, 
            "status_change": f"{previous_status} -> {instance.employment_status}" if previous_status != instance.employment_status else None
        })

    def destroy(self, request, *args, **kwargs):
        return error("Hard delete is not allowed. Please update status to TERMINATED.", status=status.HTTP_405_METHOD_NOT_ALLOWED)
