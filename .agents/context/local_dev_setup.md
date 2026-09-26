# Local Dev Setup Context

The system runs fully in Docker. The notification worker waits for required infrastructure before consuming jobs.

## Containers (Dev)

| Service | Container name | Port | Notes |
|---|---|---|---|
| Database | `ffi_hr_db` | `5432:5432` | postgres:16-alpine |
| Redis | `ffi_hr_redis` | Internal only | Redis databases separate broker, cache, and result data |
| Backend | `ffi_hr_backend` | `8000:8000` | Django ASGI app served by Daphne |
| Frontend | `ffi_hr_frontend` | `5173:80` | React built → Nginx |
| Celery worker | `ffi_hr_notification_worker` | Internal only | Runs asynchronous notification and background tasks |
| Celery Beat | `ffi_hr_celery_beat` | Internal only | Separate scheduler process; do not combine with worker |
| Evolution API | `ffi_hr_evolution_api` | `8080:8080` | Local WhatsApp provider |
| Evolution database | `ffi_hr_evolution_db` | Internal only | PostgreSQL for Evolution API |
| Evolution Redis | `ffi_hr_evolution_redis` | Internal only | Redis for Evolution API |

Dev env file: `Backend/.env.docker` (debug=true, local DB config)

The notification stack also includes `ffi_hr_redis`, `ffi_hr_notification_worker` (Celery worker only, no `-B`),
`ffi_hr_celery_beat` (scheduled/periodic tasks — a separate container from the worker; see
`reliability_and_perf_fixes.md` before recombining them), and the development Evolution services
(`ffi_hr_evolution_db`, `ffi_hr_evolution_redis`, and `ffi_hr_evolution_api` on port 8080).

`ffi_cinematic_site` (the separate marketing site, `CinematicSite/`) is defined under
`profiles: ["marketing"]` and does not start with a plain `docker compose up`. Start it explicitly:
`docker compose -f docker-compose.dev.yml --profile marketing up -d cinematic-site` (port `5174:80`).

The root `docker-compose.yml` is a dev-compatible configuration with Evolution services behind the `messaging-trial` profile and Cognee behind the `memory` profile. Unlike it, `docker-compose.dev.yml` starts Evolution by default and does not define Cognee. Always check which Compose file and profile started a container before assuming the service set.

The local checkout does not contain `docker-compose.prod.yml`; only a dated backup exists. Production commands and container details are maintained in `AWS_AGENT_DEPLOYMENT_HANDOFF.md` for the separate EC2 checkout. Do not run the production commands in older local handoff text against this checkout without a reviewed production Compose file.

## Start / Stop

```bash
# Start dev stack (with rebuild)
docker compose -f docker-compose.dev.yml up -d --build

# Start without rebuild (faster)
docker compose -f docker-compose.dev.yml up -d

# Stop (keep volumes)
docker compose -f docker-compose.dev.yml down

# Stop + wipe DB volume (full reset)
docker compose -f docker-compose.dev.yml down -v

# Check running containers
docker compose -f docker-compose.dev.yml ps
```

## Rebuild After Changes

Rebuild through `tools/dev-compose.sh` (Git Bash) or `tools\dev-compose.ps1` (PowerShell). They pass arguments to `docker compose -f docker-compose.dev.yml`, stamp images with the commit/dirty flag/checkout, and refuse to change the shared stack from a git worktree. See "Shared Docker Stack" in `AGENTS.md`.

```bash
# After backend code/dependency changes (API, worker, and scheduler share backend code)
tools/dev-compose.sh up -d --build backend notification-worker celery-beat

# After frontend code/dependency changes
tools/dev-compose.sh up -d --build frontend

# After docker-compose.dev.yml changes
tools/dev-compose.sh up -d --build

# Verify rebuilt services, and that they run your build
tools/dev-compose.sh ps
curl http://localhost:5173/build-info.json
docker inspect ffi_hr_frontend --format "{{json .Config.Labels}}"
```

A worktree that needs its own running stack sets `FFI_CONTAINER_PREFIX`, `FFI_FRONTEND_PORT`, `FFI_BACKEND_PORT`, `FFI_DB_PORT` and `EVOLUTION_API_PORT`, and passes its own `-p <project>` (example in the header of `docker-compose.dev.yml`). Defaults keep the shared `ffi_hr_*` names and 5173/8000/5432 ports.

Before reporting a code/runtime task complete, rebuild and recreate each affected app service, then check its status. Rebuild all three backend-based services (`backend`, `notification-worker`, `celery-beat`) after backend changes because each runs code from the Backend image. Rebuild `frontend` after frontend changes. Docs-only changes do not need a rebuild. Never use `down -v` for a routine rebuild because that removes database, upload, and provider volumes.

## View Logs

```bash
# Follow all services
docker compose -f docker-compose.dev.yml logs -f

# Follow one service
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f frontend
docker compose -f docker-compose.dev.yml logs -f db
```

## Exec Into Containers

```bash
# Backend shell (run management commands, inspect)
docker compose -f docker-compose.dev.yml exec backend bash

# Django interactive shell
docker compose -f docker-compose.dev.yml exec backend python manage.py shell

# Run a management command
docker compose -f docker-compose.dev.yml exec backend python manage.py <command>

# psql into database
docker compose -f docker-compose.dev.yml exec db psql -U postgres -d ffi_hr_db
```

## Migrations

Migrations run **automatically** on backend startup via `Backend/entrypoint.sh`:
```
python manage.py migrate --noinput
```

To run manually (after adding a new migration file):
```bash
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate

# Create a new migration after model changes
docker compose -f docker-compose.dev.yml exec backend python manage.py makemigrations <app_name>
```

## Run Tests

```bash
# All backend tests
docker compose -f docker-compose.dev.yml exec backend pytest

# Single app
docker compose -f docker-compose.dev.yml exec backend pytest leaves/

# Single test file
docker compose -f docker-compose.dev.yml exec backend pytest leaves/tests/test_approval.py
```

Or run outside Docker (if venv is active):
```bash
cd Backend && pytest
```

## BioTime Sync (Manual)

```bash
docker compose -f docker-compose.dev.yml exec backend python manage.py sync_biotime --days 7
```

## Backend and Worker Boot Sequence (entrypoint.sh)

1. Wait for PostgreSQL to accept connections (2 s polling loop)
2. `python manage.py migrate --noinput`
3. Start Daphne with `config.asgi:application`.

For a Celery command, the entrypoint waits for PostgreSQL and runs `python -m config.worker_readiness` before starting the
worker. The readiness gate checks Celery Redis connectivity and, when WhatsApp is globally enabled, the configured Evolution
HTTP API. It does not require the WhatsApp account to be connected. The default timeout is 60 seconds and failures contain
only sanitized host-level details.

Development Compose waits for PostgreSQL, Redis, the backend process, and healthy bundled Evolution. In tracked Compose,
bundled Evolution remains under `--profile messaging-trial` and is an optional worker dependency. For an external provider,
set `EVOLUTION_API_BASE_URL` to its URL. Set `NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=false` to start without Evolution.

## Common Gotchas

| Problem | Cause | Fix |
|---|---|---|
| Migrations fail on startup | DB not ready in time | `down -v` then `up -d --build` |
| Port already in use | Another process on 5432/8000/5173 | Stop the conflicting process |
| CORS errors in browser | `VITE_API_BASE_URL` mismatch | Check build arg in docker-compose.dev.yml |
| `curl` prompts in PowerShell | PS alias conflict | Use `curl.exe` explicitly |
| Slow first build | apt-get + pip install | Normal — 3–5 min first time |
| New backend tests/code not visible in container | Backend source is baked into the image | Rebuild backend with `docker compose -f docker-compose.dev.yml up -d --build backend` before Docker validation |
| Worker exits before Celery starts | Redis/Evolution readiness timed out | Check worker logs, DNS, and `EVOLUTION_API_BASE_URL` |
| Evolution is healthy but WhatsApp is disconnected | API readiness and account connection are separate | Reconnect the instance; delivery retries/fallback remain active |

## Notification Cleanup

Run `python manage.py cleanup_notifications` daily through the existing production cron/deployment scheduler. Do not add a
second scheduler solely for notification cleanup.

## URLs (Dev)

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Database: localhost:5432 (ffi_hr_db / postgres / postgres)
