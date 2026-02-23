from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from datetime import timedelta
from django.db.models import Q

from core.permissions import IsHRManagerOrAdmin
from core.responses import success
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest
from attendance.models import AttendanceRecord
from payroll.models import PayrollRun


class HrSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        today = timezone.now().date()
        warning_date = today + timedelta(days=30)

        # 1. Employee Stats
        total_employees = EmployeeProfile.objects.count()
        active_employees = EmployeeProfile.objects.filter(
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE
        ).count()

        # 2. Expiring Documents (next 30 days)
        expiring_docs = EmployeeProfile.objects.filter(
            Q(passport_expiry__range=[today, warning_date])
            | Q(id_expiry__range=[today, warning_date])
            | Q(contract_expiry__range=[today, warning_date])
            | Q(health_card_expiry__range=[today, warning_date])
        ).count()

        # 3. Pending Leave (HR Action)
        pending_leaves_count = LeaveRequest.objects.filter(status=LeaveRequest.RequestStatus.PENDING_HR).count()

        # 4. Pending Approvals List (Leave + Attendance)
        pending_approvals = []

        pending_leave_qs = (
            LeaveRequest.objects.filter(status=LeaveRequest.RequestStatus.PENDING_HR)
            .select_related("employee__employee_profile", "leave_type")
            .order_by("-created_at")[:10]
        )
        for req in pending_leave_qs:
            profile = getattr(req.employee, "employee_profile", None)
            full_name = profile.full_name if profile else req.employee.email
            pending_approvals.append(
                {
                    "id": req.id,
                    "name": full_name,
                    "request_type": "LEAVE",
                    "action": f"Leave: {req.leave_type.name}",
                    "time": req.created_at.strftime("%Y-%m-%d"),
                    "avatar": "",
                    "review_path": f"/hr/leave/requests/{req.id}",
                    "sort_key": req.created_at,
                }
            )

        pending_attendance_qs = (
            AttendanceRecord.objects.filter(status__in=[AttendanceRecord.Status.PENDING_HR, AttendanceRecord.Status.PENDING])
            .select_related("employee_profile__user")
            .order_by("-created_at")[:10]
        )
        for rec in pending_attendance_qs:
            profile = rec.employee_profile
            user = profile.user if profile else None
            full_name = profile.full_name if profile and profile.full_name else (user.email if user else f"Employee {rec.id}")
            pending_approvals.append(
                {
                    "id": rec.id,
                    "name": full_name,
                    "request_type": "ATTENDANCE",
                    "action": "Attendance: Check-in/out review",
                    "time": rec.created_at.strftime("%Y-%m-%d"),
                    "avatar": "",
                    "review_path": "/hr/attendance",
                    "sort_key": rec.created_at,
                }
            )

        pending_approvals.sort(key=lambda x: x["sort_key"], reverse=True)
        pending_approvals = pending_approvals[:5]
        for item in pending_approvals:
            del item["sort_key"]

        # 5. Recent Activity (Combine recent leaves and recent employees)
        # This acts as a pseudo-audit log
        recent_activity = []

        # Latest Leaves
        latest_leaves = LeaveRequest.objects.select_related("employee__employee_profile").order_by("-created_at")[:5]
        for l in latest_leaves:
            profile = getattr(l.employee, "employee_profile", None)
            name = profile.full_name if profile else l.employee.email

            status_color = "orange"
            if l.status == LeaveRequest.RequestStatus.APPROVED:
                status_color = "green"
            elif l.status == LeaveRequest.RequestStatus.REJECTED:
                status_color = "red"
            elif l.status == LeaveRequest.RequestStatus.CANCELLED:
                status_color = "default"

            recent_activity.append(
                {
                    "key": f"leave_{l.id}",
                    "employee": name,
                    "action": "Leave Request",
                    "date": l.created_at.strftime("%b %d, %I:%M %p"),
                    "status": l.status.replace("_", " ").title(),
                    "statusColor": status_color,
                    "sort_key": l.created_at,
                }
            )

        # New Employees
        new_employees = EmployeeProfile.objects.order_by("-created_at")[:5]
        for e in new_employees:
            recent_activity.append(
                {
                    "key": f"emp_{e.id}",
                    "employee": e.full_name or e.employee_id,
                    "action": "New Joiner",
                    "date": e.created_at.strftime("%b %d, %I:%M %p"),
                    "status": "Active",
                    "statusColor": "blue",
                    "sort_key": e.created_at,
                }
            )

        # Sort combined list and slice
        recent_activity.sort(key=lambda x: x["sort_key"], reverse=True)
        recent_activity = recent_activity[:6]

        # Remove sort_key before sending
        for item in recent_activity:
            del item["sort_key"]

        # 6. Latest Payroll Run
        latest_payroll = PayrollRun.objects.order_by("-year", "-month").first()
        payroll_data = {
            "latest_total_net": None,
            "latest_period": None,
            "trend_percentage": None,
        }
        
        if latest_payroll:
            payroll_data["latest_total_net"] = float(latest_payroll.total_net)
            payroll_data["latest_period"] = f"{latest_payroll.month}/{latest_payroll.year}"
            
            # Calculate trend vs previous month
            if latest_payroll.month == 1:
                prev_month = 12
                prev_year = latest_payroll.year - 1
            else:
                prev_month = latest_payroll.month - 1
                prev_year = latest_payroll.year
            
            prev_payroll = PayrollRun.objects.filter(
                year=prev_year, month=prev_month
            ).first()
            
            if prev_payroll and prev_payroll.total_net > 0:
                diff = latest_payroll.total_net - prev_payroll.total_net
                trend = (diff / prev_payroll.total_net) * 100
                payroll_data["trend_percentage"] = round(float(trend), 1)

        data = {
            "total_employees": total_employees,
            "active_employees": active_employees,
            "expiring_docs": expiring_docs,
            "pending_leaves": pending_leaves_count,
            "pending_approvals": pending_approvals,
            "recent_activity": recent_activity,
            "latest_payroll": payroll_data,
        }
        return success(data)
