import pandas as pd
from datetime import datetime, date

from django.core.management.base import BaseCommand
from organization.models import Department, JobTitle
from employees.models import Employee
from payroll.models import Salary


def parse_excel_date(value):
    """
    Safely parse Excel date values.
    Supports:
    - Excel datetime/date
    - DD/MM/YYYY strings
    - Empty / NaN
    Returns Python date or None
    """
    if pd.isna(value):
        return None

    if isinstance(value, (datetime, date)):
        return value.date() if isinstance(value, datetime) else value

    try:
        return datetime.strptime(str(value).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


class Command(BaseCommand):
    help = "Import employees and salaries from Excel file"

    def add_arguments(self, parser):
        parser.add_argument(
            "file_path",
            type=str,
            help="Path to Excel file (e.g. FFI HR.xlsx)",
        )

    def handle(self, *args, **kwargs):
        file_path = kwargs["file_path"]

        df = pd.read_excel(file_path)

        self.stdout.write(
            self.style.WARNING(f"Detected columns: {list(df.columns)}")
        )

        for index, row in df.iterrows():
            try:
                # -----------------------------
                # Department
                # -----------------------------
                department_name = str(row["department"]).strip()

                department, _ = Department.objects.get_or_create(
                    name=department_name
                )

                # -----------------------------
                # Job Title (fallback-safe)
                # -----------------------------
                job_title_name = (
                    row["Position Name"]
                    if "Position Name" in df.columns and pd.notna(row["Position Name"])
                    else "Employee"
                )

                job_title, _ = JobTitle.objects.get_or_create(
                    title=str(job_title_name).strip(),
                    department=department,
                )

                # -----------------------------
                # Full Name Split
                # -----------------------------
                full_name = str(row["Emp Full Name"]).strip().split()
                first_name = full_name[0]
                last_name = " ".join(full_name[1:]) if len(full_name) > 1 else ""

                # -----------------------------
                # Employee Code (safe fallback)
                # -----------------------------
                employee_code = row.get("Employee number ")
                if pd.isna(employee_code):
                    employee_code = f"AUTO-{index + 1}"

                employee_code = str(employee_code).strip()

                # -----------------------------
                # Dates (SAFE parsing)
                # -----------------------------
                date_of_birth = parse_excel_date(row.get("Date Of Birth"))
                hire_date = parse_excel_date(row.get(" Joining Date"))

                # -----------------------------
                # Create Employee
                # -----------------------------
                employee, created = Employee.objects.get_or_create(
                    employee_code=employee_code,
                    defaults={
                        "first_name": first_name,
                        "last_name": last_name,
                        "gender": "Unknown",
                        "nationality": str(row.get("Nationality ", "")).strip(),
                        "date_of_birth": date_of_birth,
                        "national_id": str(row.get(" ID", "")).strip(),
                        "phone": str(row.get("Mobile Number", "")).strip(),
                        "email": f"auto_{index}@example.com",
                        "address": "",
                        "emergency_contact": "",
                        "department": department,
                        "job_title": job_title,
                        "employment_type": "FULL_TIME",
                        "hire_date": hire_date,
                        "work_location": department_name,
                        "status": "ACTIVE",
                    },
                )

                # -----------------------------
                # Salary (SID monthly expense)
                # -----------------------------
                monthly_expense = row.get("SID monthly expense")

                if pd.notna(monthly_expense):
                    Salary.objects.get_or_create(
                        employee=employee,
                        effective_from=datetime.today().date(),
                        defaults={
                            "basic_salary": float(monthly_expense),
                            "allowances": 0,
                            "deductions": 0,
                        },
                    )

                self.stdout.write(
                    self.style.SUCCESS(f"Imported: {employee.employee_code}")
                )

            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(
                        f"Row {index + 2} failed: {str(e)}"
                    )
                )
