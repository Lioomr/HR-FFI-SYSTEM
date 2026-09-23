# Docker web performance verification — 2026-09-22

The frontend image precompresses text assets at build time and Nginx serves gzip
sidecars with encoding negotiation. Original files and SPA no-store policy remain.
Hashed assets use sendfile and a bounded file cache; 404 responses no longer inherit
the immutable one-year cache header. No authenticated response caching was added.

Validation:
- `npm run build`: passed (existing large-chunk warning remains).
- `node scripts/precompress.mjs`: passed against the local build and a copy of deployed assets.
- `npx prettier --check scripts/precompress.mjs`: passed.
- `git diff --check`: passed.
- Isolated nginx:1.27-alpine container, no network, copied production assets:
  `nginx -t` passed; gzip and identity requests returned 200; SPA returned no-store;
  missing asset returned 404; health endpoint returned 200.
- Largest deployed JS: existing runtime gzip 447,014 bytes; precompressed 381,909
  bytes (14.6% smaller); original 1,272,296 bytes. This measures transfer size, not
  a claim of equivalent end-to-end page latency improvement.

## Release-gate repairs

GitHub run 35742685601 failed before the Docker optimization. This release candidate
also repairs the following issues without disabling CI checks:

- Move the leave error helper and legacy redirect to appropriate modules so React
  refresh lint passes. No visual UI change is intended.
- Retain explicit cross-company leave-manager authority during automatic fallback.
- Let an assigned cross-company alternative employee read their leave request,
  preserving the existing approver checks and unrelated-request denial.
- Extend starting-work HR verification holds to subsequent synced attendance rows.
- Join the employee's company when reading leave lists, removing repeated queries.
- Repair migration-test state construction, fixture lengths, platform-dependent
  JSON checksums, and the employee-evaluation template/map inventory.
- Align older assertions with migration 0024 (explicit cross-company alternatives),
  immutable legacy attendance plus daily results, per-punch import counters, and
  the current Exit Permission label. Tenant, requester and leave-type checks remain.

Frontend lint and type-check pass; the focused leave-page suite passes (8 tests).
The manager-routing, leave-query-count and delegation-candidate checks pass.
The template, migration and database-integrity regression run passes (90 tests
plus 83 subtests); manager-form tests pass (7 tests). Route and forbidden-page
fixtures now match the current application (20 tests pass). Permission form
tests wait for time-picker state to settle between input and commit events (5
tests pass). The frontend dependency audit reports zero vulnerabilities.
The GitHub release gate remains pending.
No migrations, API renames, runtime environment variables or dependency upgrades
are introduced by these repairs.

## Deployment status

Production has not been changed. SSH access was restored on September 23, and
the public API liveness endpoint `/healthz/` returns 200. Production is still at
`a365dd27`. Compose validation passes and the frontend build uses the same-origin
API proxy. A resource snapshot shows low CPU and memory usage, not a load test.
Recent worker logs show contract auto-renewal blocked by a legacy manager profile
without a linked user. This requires an HR data correction; validation has not
been bypassed and reporting relationships have not been changed. The repository
release gate still requires successful CI. Rebuild frontend and backend plus the
backend-image worker/beat services only after the candidate passes; retain old
image IDs for rollback, do not remove persistent volumes, and verify health,
proxy routing, compression negotiation and cache headers afterward.

Full-repository pre-commit was attempted in an isolated checkout: five existing
Ruff findings remain in generated PDF scripts and the BioTime sync agent. Checks
on the changed files pass; unrelated generated files were not reformatted here.
