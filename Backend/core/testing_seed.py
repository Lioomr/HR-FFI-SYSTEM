"""Restore migration-seeded rows after a ``TransactionTestCase`` flushed them.

``TransactionTestCase`` truncates every table after each test, including rows that data
migrations seed (the FFI/ASECO_PRO/ATHROYA organization nodes, the penalty catalog). On a
database created fresh for the run, later tests are unaffected because the runner orders
transaction tests last; but with ``--reuse-db`` the flushed database is kept, and the next
run starts without those rows and fails with ``OrganizationNode.DoesNotExist`` /
``PenaltyCatalog.DoesNotExist``. Call :func:`restore_migration_seed_data` from
``tearDownClass`` of every ``TransactionTestCase`` that does not restore its own data.
"""

from __future__ import annotations

from django.core.management import call_command
from django.db import connections


def restore_migration_seed_data() -> None:
    for alias in connections:
        contents = getattr(connections[alias], "_test_serialized_contents", None)
        if contents:
            call_command("flush", verbosity=0, interactive=False, database=alias, inhibit_post_migrate=True)
            connections[alias].creation.deserialize_db_from_string(contents)

    from organization.services import seed_default_organization
    from penalties.catalog import CATALOG
    from penalties.models import PenaltyCatalog

    # Idempotent: covers databases without serialized contents (reused databases).
    seed_default_organization()
    PenaltyCatalog.objects.bulk_create([PenaltyCatalog(**row) for row in CATALOG], ignore_conflicts=True)
