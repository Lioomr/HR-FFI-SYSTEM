from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsHRManagerOrAdmin
from core.responses import success
from employees.models import EmployeeProfile


class HrSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        total_employees = EmployeeProfile.objects.count()
        active_employees = EmployeeProfile.objects.filter(
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE
        ).count()

        data = {
            "total_employees": total_employees,
            "active_employees": active_employees,
        }
        return success(data)
