from django.db import migrations

FORWARD_SQL = r"""
CREATE OR REPLACE FUNCTION ffi_validate_leave_request_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'LeaveRequest must belong to a company.' USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM leaves_leavetype leave_type
        WHERE leave_type.id = NEW.leave_type_id AND leave_type.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest leave type must belong to the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NEW.employee_id IS NULL THEN
        RAISE EXCEPTION 'LeaveRequest must resolve to an employee profile.' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.id = NEW.employee_profile_id
          AND profile.company_id = NEW.company_id
          AND (NEW.employee_id IS NULL OR profile.user_id = NEW.employee_id)
    ) THEN
        RAISE EXCEPTION 'LeaveRequest employee profile must belong to the request company and employee.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.employee_id AND profile.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest employee must have a profile in the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delegated_to_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.delegated_to_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest delegate must have an employee profile.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_guard_leave_profile_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND (
        EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.employee_profile_id = OLD.id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalancesnapshot snapshot
            JOIN leaves_leavetype leave_type ON leave_type.id = snapshot.leave_type_id
            WHERE snapshot.employee_profile_id = OLD.id AND leave_type.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalanceadjustment adjustment
            WHERE adjustment.employee_profile_id = OLD.id AND adjustment.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.employee_id = OLD.user_id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalanceadjustment adjustment
            WHERE adjustment.employee_id = OLD.user_id AND adjustment.company_id IS DISTINCT FROM NEW.company_id
        )
    ) THEN
        RAISE EXCEPTION 'Changing this employee company would create cross-company leave relationships.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id AND EXISTS (
        SELECT 1 FROM leaves_leaverequest request
        WHERE request.employee_id = OLD.user_id OR request.delegated_to_id = OLD.user_id
        UNION ALL
        SELECT 1 FROM leaves_leavebalanceadjustment adjustment
        WHERE adjustment.employee_id = OLD.user_id
    ) THEN
        RAISE EXCEPTION 'Changing this employee user would orphan leave relationships.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;
"""


REVERSE_SQL = r"""
CREATE OR REPLACE FUNCTION ffi_validate_leave_request_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'LeaveRequest must belong to a company.' USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM leaves_leavetype leave_type
        WHERE leave_type.id = NEW.leave_type_id AND leave_type.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest leave type must belong to the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NEW.employee_id IS NULL THEN
        RAISE EXCEPTION 'LeaveRequest must resolve to an employee profile.' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.id = NEW.employee_profile_id
          AND profile.company_id = NEW.company_id
          AND (NEW.employee_id IS NULL OR profile.user_id = NEW.employee_id)
    ) THEN
        RAISE EXCEPTION 'LeaveRequest employee profile must belong to the request company and employee.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.employee_id AND profile.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest employee must have a profile in the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delegated_to_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.delegated_to_id AND profile.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest delegate must belong to the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_guard_leave_profile_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND (
        EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.employee_profile_id = OLD.id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalancesnapshot snapshot
            JOIN leaves_leavetype leave_type ON leave_type.id = snapshot.leave_type_id
            WHERE snapshot.employee_profile_id = OLD.id AND leave_type.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalanceadjustment adjustment
            WHERE adjustment.employee_profile_id = OLD.id AND adjustment.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.employee_id = OLD.user_id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalanceadjustment adjustment
            WHERE adjustment.employee_id = OLD.user_id AND adjustment.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.delegated_to_id = OLD.user_id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
    ) THEN
        RAISE EXCEPTION 'Changing this employee company would create cross-company leave relationships.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id AND EXISTS (
        SELECT 1 FROM leaves_leaverequest request
        WHERE request.employee_id = OLD.user_id OR request.delegated_to_id = OLD.user_id
        UNION ALL
        SELECT 1 FROM leaves_leavebalanceadjustment adjustment
        WHERE adjustment.employee_id = OLD.user_id
    ) THEN
        RAISE EXCEPTION 'Changing this employee user would orphan leave relationships.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0023_leave_type_drop_ceo_flag_add_delegate_return"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
