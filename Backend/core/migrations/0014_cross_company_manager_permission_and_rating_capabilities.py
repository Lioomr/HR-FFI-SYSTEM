"""Add ``permission_requests.approve`` and ``contract_ratings.rate`` to cross-company managers.

1. The capability guard trigger (from 0006) accepts the two new values.
2. Every active assignment gains them. Revoked rows stay as they were granted.

Both steps are idempotent and no-ops on an empty table. Rows that still miss
older capabilities are widened to the full set by
``manage.py consolidate_manager_relationships --apply``.
"""

from django.db import migrations

NEW_CAPABILITIES = ("permission_requests.approve", "contract_ratings.rate")

GUARD_FUNCTION_SQL = r"""
CREATE OR REPLACE FUNCTION ffi_validate_cross_company_manager_capabilities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF jsonb_typeof(NEW.capabilities) <> 'array' OR jsonb_array_length(NEW.capabilities) = 0 THEN
        RAISE EXCEPTION 'Cross-company manager assignments require explicit capabilities.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.capabilities) capability
        WHERE capability NOT IN (
            {allowed}
        )
    ) THEN
        RAISE EXCEPTION 'Cross-company manager assignment contains an unsupported capability.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
"""

PREVIOUS_CAPABILITIES = (
    "employees.view",
    "leaves.approve",
    "attendance.approve",
    "loans.approve",
    "assets.approve",
    "announcements.manage",
)


def _guard_sql(capabilities):
    return GUARD_FUNCTION_SQL.replace("{allowed}", ", ".join(f"'{value}'" for value in capabilities))


FORWARD_GUARD_SQL = _guard_sql(PREVIOUS_CAPABILITIES + NEW_CAPABILITIES)
REVERSE_GUARD_SQL = _guard_sql(PREVIOUS_CAPABILITIES)

GRANT_SQL = "".join(
    f"""
UPDATE core_crosscompanymanagerassignment
SET capabilities = capabilities || '["{capability}"]'::jsonb
WHERE is_active AND revoked_at IS NULL
  AND jsonb_typeof(capabilities) = 'array'
  AND NOT capabilities @> '["{capability}"]'::jsonb;
"""
    for capability in NEW_CAPABILITIES
)

# Reverse only: drop the new values (never leaving a row without capabilities)
# before the old guard, which rejects them, is restored.
STRIP_SQL = "".join(
    f"""
UPDATE core_crosscompanymanagerassignment
SET capabilities = capabilities - '{capability}'
WHERE capabilities @> '["{capability}"]'::jsonb
  AND jsonb_array_length(capabilities - '{capability}') > 0;
"""
    for capability in NEW_CAPABILITIES
)


class Migration(migrations.Migration):
    dependencies = [("core", "0013_remove_crosscompanymanagerassignment_end_at")]

    operations = [
        migrations.RunSQL(FORWARD_GUARD_SQL, REVERSE_GUARD_SQL),
        migrations.RunSQL(GRANT_SQL, STRIP_SQL),
    ]
