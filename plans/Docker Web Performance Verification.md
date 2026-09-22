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
Broader backend/frontend regression runs and the GitHub release gate are pending.
No migrations, API renames, runtime environment variables or dependency upgrades
are introduced by these repairs.

## Deployment status

Production has not been changed. SSH to 13.51.209.116 timed out during release
preparation, and the local AWS CLI reports an expired login session. Public HTTPS
probes also timed out from this computer; that alone does not establish root cause.
Restore AWS access and verify the instance/IP before rollout. The repository
release gate still requires successful CI. Rebuild frontend and backend plus the
backend-image worker/beat services only after the candidate passes; retain old
image IDs for rollback, do not remove persistent volumes, and verify health,
proxy routing, compression negotiation and cache headers afterward.
