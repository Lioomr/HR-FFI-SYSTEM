## 2026-08-23 — Recreate reused Django test databases after schema changes

- Context: Tenant-scoping regression tests run with the repository's production-hardened Django settings and Pytest defaults.
- Failure: Initial test setup used a stale reused schema, and HTTP tests were redirected or rejected before reaching the views.
- Cause: `--nomigrations --reuse-db` retained an older test schema, while HTTPS redirect and allowed-host protections remained enabled.
- Prevention: Recreate the test database after model or migration changes, and make the test request scheme and allowed hosts explicit when using hardened settings.
- Verification: The tenant-scoping suite passed after recreating the database; focused asset, document, and dashboard tests also passed.

## 2026-08-24 — Avoid sequence resets when post-migrate creates seed rows

- Context: PostgreSQL `TransactionTestCase` coverage for tenant-integrity triggers on bulk inserts and direct queryset updates.
- Failure: A later test setup failed with a duplicate organization primary key after the database flush and post-migrate seed handlers ran.
- Cause: `reset_sequences = True` rewound sequences even though post-migrate recreated deterministic organization rows; the tests did not require fixed primary keys.
- Prevention: Do not reset sequences in transactional database-constraint tests unless assertions depend on exact IDs; create records normally and compare captured IDs.
- Verification: All five migration-backed database-integrity tests passed after removing the unnecessary sequence reset.
