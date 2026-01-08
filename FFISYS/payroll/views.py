from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import IsAuthenticated
from .models import Salary
from .serializers import SalarySerializer


class SalaryViewSet(ModelViewSet):
    serializer_class = SalarySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        # Employee → only their salary
        if user.role == "EMPLOYEE":
            return Salary.objects.filter(employee__user=user)

        # Admin & HR → all
        return Salary.objects.all()

    def has_permission(self, request, view):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            return request.user.role in ("ADMIN", "HR")
        return True
