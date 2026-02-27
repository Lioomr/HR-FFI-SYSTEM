from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response

from attendance.models import AttendanceRecord
from core.permissions import IsHRManagerOrAdmin
from core.responses import success
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest
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
            AttendanceRecord.objects.filter(
                status__in=[AttendanceRecord.Status.PENDING_HR, AttendanceRecord.Status.PENDING]
            )
            .select_related("employee_profile__user")
            .order_by("-created_at")[:10]
        )
        for rec in pending_attendance_qs:
            profile = rec.employee_profile
            user = profile.user if profile else None
            full_name = (
                profile.full_name if profile and profile.full_name else (user.email if user else f"Employee {rec.id}")
            )
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
        for leave in latest_leaves:
            profile = getattr(leave.employee, "employee_profile", None)
            name = profile.full_name if profile else leave.employee.email

            status_color = "orange"
            if leave.status == LeaveRequest.RequestStatus.APPROVED:
                status_color = "green"
            elif leave.status == LeaveRequest.RequestStatus.REJECTED:
                status_color = "red"
            elif leave.status == LeaveRequest.RequestStatus.CANCELLED:
                status_color = "default"

            recent_activity.append(
                {
                    "key": f"leave_{leave.id}",
                    "employee": name,
                    "action": "Leave Request",
                    "date": leave.created_at.strftime("%b %d, %I:%M %p"),
                    "status": leave.status.replace("_", " ").title(),
                    "statusColor": status_color,
                    "sort_key": leave.created_at,
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

            prev_payroll = PayrollRun.objects.filter(year=prev_year, month=prev_month).first()

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


class ReportErrorAPIView(APIView):
    """
    Endpoint for frontend to report unhandled errors.
    This will send an email to the system admin.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        message = request.data.get("message", "Unknown error")
        stack = request.data.get("stack", "No stack trace provided")
        url = request.data.get("url", "Unknown URL")
        
        user_info = "Anonymous/Unauthenticated User"
        if request.user.is_authenticated:
            user_info = f"User: {request.user.email} (Role: {request.user.role})"

        email_subject = f"[FFISYS Error Report] Error at {url}"
        email_body = f"""
An error was reported from the frontend application:

URL: {url}
Reported By: {user_info}
Time: {timezone.now().strftime("%Y-%m-%d %H:%M:%S UTC")}

Message:
{message}

Stack Trace:
{stack}
"""

        try:
            admin_email = getattr(settings, "ADMIN_EMAIL", "admin@ffisystem.com")
            # If deploying, make sure you configure EMAIL_HOST_USER or DEFAULT_FROM_EMAIL
            from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@ffisystem.com")
            
            send_mail(
                subject=email_subject,
                message=email_body,
                from_email=from_email,
                recipient_list=[admin_email],
                fail_silently=False,
            )
            return success({"detail": "Error reported successfully."})
        except Exception as e:
            return Response({"detail": f"Failed to send error report: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
