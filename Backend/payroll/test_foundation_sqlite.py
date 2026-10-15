"""Exercise only the new migration chain against a genuine SQLite legacy schema.

The repository's older tenant-trigger migrations are PostgreSQL-only. This probe
creates their model state directly, rather than claiming a fresh SQLite bootstrap.
"""

import os
import subprocess
import sys
from pathlib import Path


def test_new_migrations_forward_reverse_on_sqlite():
    environment = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "DJANGO_ENV": "local",
        "DJANGO_DEBUG": "true",
        "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1",
        "DJANGO_SECRET_KEY": "isolated-payroll-migration-probe-only",
        "DB_ENGINE": "django.db.backends.sqlite3",
        "DB_NAME": ":memory:",
    }
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--probe"],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "SQLite foundation forward/backfill/reverse verified" in result.stdout


def probe():
    import importlib

    import django

    django.setup()
    from django.db import connection
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(connection)
    targets = [n for n in loader.graph.leaf_nodes() if n[0] != "payroll"] + [
        ("payroll", "0006_attendancepayrolldeduction_claim_state")
    ]
    state = loader.project_state(targets)
    models = list(state.apps.get_models())
    with connection.schema_editor() as editor:
        for model in models:
            editor.create_model(model)
    Run = state.apps.get_model("payroll", "PayrollRun")
    run = Run.objects.create(year=2026, month=6, status="CANCELLED")
    assert connection.vendor == "sqlite"
    chain = [
        importlib.import_module("payroll.migrations." + name).Migration(name, "payroll")
        for name in (
            "0007_payroll_rebuild_foundation",
            "0008_backfill_legacy_payroll",
            "0009_accommodation_exclusion",
            "0010_payroll_model_validation",
            "0011_nullable_assignment_actors",
            "0012_payrollrunitem_is_active",
        )
    ]
    before = []
    for migration in chain:
        before.append(state.clone())
        with connection.schema_editor() as editor:
            state = migration.apply(state, editor)
    Settings = state.apps.get_model("payroll", "PayrollSettings")
    assert Settings._meta.get_field("provision_proration").default == "FULL_MONTH"
    Run = state.apps.get_model("payroll", "PayrollRun")
    assert Run.objects.get(pk=run.pk).settings_snapshot == {"schema_version": 0, "legacy_unknown": True}
    assert "payroll_payrollline" in connection.introspection.table_names()
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, "payroll_accommodationassignment")
    assert "payroll_assignment_no_overlap" not in constraints
    assert "payroll_assignment_date_order" in constraints
    for migration, old in reversed(list(zip(chain, before))):
        with connection.schema_editor() as editor:
            migration.unapply(old, editor)
    assert "payroll_payrollline" not in connection.introspection.table_names()
    assert before[0].apps.get_model("payroll", "PayrollRun").objects.get(pk=run.pk).status == "CANCELLED"
    print("SQLite foundation forward/backfill/reverse verified")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    probe()
