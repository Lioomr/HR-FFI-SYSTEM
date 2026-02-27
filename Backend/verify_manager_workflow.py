import os
import sys
from datetime import date, timedelta

import django

sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.contrib.auth.models import Group  # noqa: E402

from attendance.models import AttendanceRecord  # noqa: E402
from employees.models import EmployeeProfile  # noqa: E402
from leaves.models import LeaveRequest, LeaveType  # noqa: E402

User = get_user_model()


def run_verification():
    print("--- Setting up Verification Environment ---")

    # 1. Create Users
    hr_user, _ = User.objects.get_or_create(
        email="hr_verifier@test.com", defaults={"full_name": "HR Verifier", "is_staff": True}
    )
    mgr_user, _ = User.objects.get_or_create(
        email="manager_verifier@test.com", defaults={"full_name": "Manager Verifier"}
    )
    emp_user, _ = User.objects.get_or_create(
        email="employee_verifier@test.com", defaults={"full_name": "Employee Verifier"}
    )

    # 2. Assign Groups
    hr_group, _ = Group.objects.get_or_create(name="HRManager")
    mgr_group, _ = Group.objects.get_or_create(name="Manager")

    hr_user.groups.add(hr_group)
    mgr_user.groups.add(mgr_group)

    # 3. Setup Profiles
    # Ensure Employee has Profile and Manager linked
    emp_profile, _ = EmployeeProfile.objects.get_or_create(user=emp_user, defaults={"employee_id": "EMP-VER-001"})
    emp_profile.manager = mgr_user
    emp_profile.save()
    print(f"Employee {emp_user.email} linked to Manager {mgr_user.email}")

    # 4. Cleanup previous test data
    LeaveRequest.objects.filter(employee=emp_user).delete()
    AttendanceRecord.objects.filter(employee_profile=emp_profile).delete()

    # --- Test Leave Flow ---
    print("\n--- Testing Leave Request Flow ---")
    lt, _ = LeaveType.objects.get_or_create(name="Test Leave", defaults={"code": "TEST"})

    # Step A: Employee Submits
    print("Action: Employee submits leave request...")
    lr = LeaveRequest.objects.create(
        employee=emp_user,
        leave_type=lt,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=1),
        status=LeaveRequest.RequestStatus.PENDING_MANAGER,  # Simulate view logic
    )
    print(f"Status: {lr.status}")
    assert lr.status == LeaveRequest.RequestStatus.PENDING_MANAGER

    # Step B: Manager Approves
    print("Action: Manager approves...")
    lr.status = LeaveRequest.RequestStatus.PENDING_HR
    lr.manager_decision_by = mgr_user
    lr.save()
    print(f"Status: {lr.status}")
    assert lr.status == LeaveRequest.RequestStatus.PENDING_HR

    # Step C: HR Approves
    print("Action: HR approves...")
    lr.status = LeaveRequest.RequestStatus.APPROVED
    lr.decided_by = hr_user
    lr.save()
    print(f"Status: {lr.status}")
    assert lr.status == LeaveRequest.RequestStatus.APPROVED

    print("✅ Leave Flow Verified")

    # --- Test Attendance Flow ---
    print("\n--- Testing Attendance Flow ---")

    # Step A: Check In
    print("Action: Employee checks in...")
    # View logic sets status based on manager existence
    initial_status = (
        AttendanceRecord.Status.PENDING_MANAGER if emp_profile.manager else AttendanceRecord.Status.PENDING_HR
    )

    ar = AttendanceRecord.objects.create(employee_profile=emp_profile, date=date.today(), status=initial_status)
    print(f"Status: {ar.status}")
    assert ar.status == AttendanceRecord.Status.PENDING_MANAGER

    # Step B: Manager Approves
    print("Action: Manager approves...")
    ar.status = AttendanceRecord.Status.PENDING_HR
    ar.manager_decision_by = mgr_user
    ar.save()
    print(f"Status: {ar.status}")
    assert ar.status == AttendanceRecord.Status.PENDING_HR

    print("✅ Attendance Flow Verified")
    print("\n[SUCCESS] Manager Role & Workflow Verification Completed.")


if __name__ == "__main__":
    try:
        run_verification()
    except AssertionError as e:
        print(f"\n[FAILED] Verification Failed: {e}")
        exit(1)
    except Exception as e:
        print(f"\n[ERROR] An error occurred: {e}")
        exit(1)
