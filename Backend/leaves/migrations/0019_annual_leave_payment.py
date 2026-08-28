import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

ANNUAL_TENANT_SQL = r"""
CREATE OR REPLACE FUNCTION ffi_validate_annual_leave_payment_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'AnnualLeavePaymentRequest must belong to a company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM employees_employeeprofile profile
        WHERE profile.id = NEW.employee_profile_id
          AND profile.company_id = NEW.company_id
          AND (NEW.employee_id IS NULL OR profile.user_id = NEW.employee_id)
    ) THEN
        RAISE EXCEPTION 'AnnualLeavePaymentRequest employee must belong to the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER leaves_annualpayment_tenant_guard
BEFORE INSERT OR UPDATE OF company_id, employee_id, employee_profile_id
ON leaves_annualleavepaymentrequest
FOR EACH ROW
EXECUTE FUNCTION ffi_validate_annual_leave_payment_tenant();

CREATE OR REPLACE FUNCTION ffi_guard_annual_payment_profile_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND EXISTS (
        SELECT 1
        FROM leaves_annualleavepaymentrequest payment
        WHERE payment.employee_profile_id = OLD.id
          AND payment.company_id IS DISTINCT FROM NEW.company_id
    ) THEN
        RAISE EXCEPTION 'Changing this employee company would create cross-company Annual Leave payments.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id AND EXISTS (
        SELECT 1
        FROM leaves_annualleavepaymentrequest payment
        WHERE payment.employee_profile_id = OLD.id
          AND payment.employee_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Changing this employee user would orphan Annual Leave payments.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER employees_annualpayment_relationship_guard
BEFORE UPDATE OF company_id, user_id
ON employees_employeeprofile
FOR EACH ROW
EXECUTE FUNCTION ffi_guard_annual_payment_profile_change();
"""


ANNUAL_TENANT_REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS employees_annualpayment_relationship_guard ON employees_employeeprofile;
DROP FUNCTION IF EXISTS ffi_guard_annual_payment_profile_change();
DROP TRIGGER IF EXISTS leaves_annualpayment_tenant_guard ON leaves_annualleavepaymentrequest;
DROP FUNCTION IF EXISTS ffi_validate_annual_leave_payment_tenant();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0018_hr_manual_policy_warnings"),
        ("employees", "0013_employeeprofile_work_license_expiry"),
        ("organization", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="AnnualLeavePaymentRequest",
            fields=[
                (
                    "id",
                    models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
                ),
                ("cycle_start", models.DateField()),
                ("cycle_end", models.DateField()),
                ("accrued_days", models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                ("used_days", models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                ("eligible_unused_days", models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                ("salary_at_year_end", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("payment_amount", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("carry_forward_days", models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                (
                    "resolution",
                    models.CharField(
                        choices=[("pay", "Pay"), ("carry_forward", "Carry Forward")],
                        default="pay",
                        max_length=20,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending_hr", "Pending HR"),
                            ("pending_ceo", "Pending CEO"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("carried_forward", "Carried Forward"),
                        ],
                        default="pending_hr",
                        max_length=20,
                    ),
                ),
                ("is_termination_settlement", models.BooleanField(default=False)),
                ("employee_note", models.TextField(blank=True)),
                ("hr_review_note", models.TextField(blank=True)),
                ("ceo_decision_note", models.TextField(blank=True)),
                ("submitted_at", models.DateTimeField(auto_now_add=True)),
                ("hr_reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("ceo_decided_at", models.DateTimeField(blank=True, null=True)),
                ("settled_at", models.DateTimeField(blank=True, null=True)),
                (
                    "ceo_decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="ceo_decided_annual_leave_payment_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="annual_leave_payment_requests",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "employee",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="annual_leave_payment_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="annual_leave_payment_requests",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "hr_reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="hr_reviewed_annual_leave_payment_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="submitted_annual_leave_payment_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-submitted_at", "-id"],
                "indexes": [
                    models.Index(fields=["company", "status"], name="annual_pay_company_status_idx"),
                    models.Index(fields=["employee_profile", "cycle_start"], name="annual_pay_profile_cycle_idx"),
                ],
            },
        ),
        migrations.RunSQL(ANNUAL_TENANT_SQL, ANNUAL_TENANT_REVERSE_SQL),
    ]
