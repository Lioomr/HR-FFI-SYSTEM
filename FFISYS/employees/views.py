from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import IsAuthenticated
from .models import Employee
from .serializers import EmployeeSerializer
from .permissions import IsAdminOrHR


class EmployeeViewSet(ModelViewSet):
    serializer_class = EmployeeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        # Employee → only self
        if user.role == "EMPLOYEE":
            return Employee.objects.filter(user=user)

        # Admin & HR → all
        return Employee.objects.all()

    def get_permissions(self):
        # Only Admin/HR can create/update/delete
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsAdminOrHR()]
        return super().get_permissions()
