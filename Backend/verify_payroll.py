import os
from decimal import Decimal

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

from employees.models import EmployeeProfile  # noqa: E402
from payroll.models import PayrollRun, PayrollRunItem, Payslip  # noqa: E402
from payroll.views import _generate_payroll_items  # noqa: E402

User = get_user_model()


def run_test():
    print("Setting up test data...")

    # 1. Create User
    email = "payroll_test@example.com"
    user, created = User.objects.get_or_create(email=email, defaults={"full_name": "Payroll Tester"})
    if created:
        user.set_password("password")
        user.save()

    # 2. Create Employee Profile
    profile, created = EmployeeProfile.objects.get_or_create(
        employee_id="PAYROLL-001",
        defaults={
            "user": user,
            "full_name": "Payroll Tester",
            "employment_status": EmployeeProfile.EmploymentStatus.ACTIVE,
            "basic_salary": Decimal("5000.00"),
            "transportation_allowance": Decimal("500.00"),
            "accommodation_allowance": Decimal("1000.00"),
            "telephone_allowance": Decimal("100.00"),
            "petrol_allowance": Decimal("200.00"),
            "other_allowance": Decimal("50.00"),
        },
    )

    # Ensure values are correct if it already existed
    profile.user = user
    profile.employment_status = EmployeeProfile.EmploymentStatus.ACTIVE
    profile.basic_salary = Decimal("5000.00")
    profile.transportation_allowance = Decimal("500.00")
    profile.accommodation_allowance = Decimal("1000.00")
    profile.telephone_allowance = Decimal("100.00")
    profile.petrol_allowance = Decimal("200.00")
    profile.other_allowance = Decimal("50.00")
    profile.save()

    print(f"Employee {profile.employee_id} ready. Expected Gross: 6850.00")

    # 3. Create Payroll Run
    # Clean up old run for this month/year first
    PayrollRun.objects.filter(year=2025, month=12).delete()

    run = PayrollRun.objects.create(year=2025, month=12, status=PayrollRun.Status.DRAFT)
    print(f"Created Payroll Run {run}")

    # 4. Generate Items
    print("Generating items...")
    _generate_payroll_items(run)

    # 5. Verify
    run.refresh_from_db()
    print(f"Run Total Net: {run.total_net}")
    print(f"Run Total Employees: {run.total_employees}")

    if run.total_employees < 1:
        print("FAIL: No employees in run.")
        return

    item = PayrollRunItem.objects.get(payroll_run=run, employee_id="PAYROLL-001")
    print(f"Item Net Salary: {item.net_salary}")

    expected_gross = (
        Decimal("5000") + Decimal("500") + Decimal("1000") + Decimal("100") + Decimal("200") + Decimal("50")
    )
    if item.net_salary == expected_gross:
        print("SUCCESS: Item Net Salary matches Expected Gross.")
    else:
        print(f"FAIL: Expected {expected_gross}, got {item.net_salary}")

    payslip = Payslip.objects.get(payroll_run=run, employee=user)
    print(f"Payslip Net Salary: {payslip.net_salary}")

    if payslip.net_salary == expected_gross:
        print("SUCCESS: Payslip Net Salary matches Expected Gross.")
    else:
        print("FAIL: Payslip mismatch.")

    # Cleanup
    # run.delete()
    # profile.delete()
    # user.delete()
    print("Test Complete.")


if __name__ == "__main__":
    run_test()
