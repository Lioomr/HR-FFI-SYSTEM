# Local Dev Setup Context

The system runs fully in Docker. The notification worker waits for required infrastructure before consuming jobs.

## Containers (Dev)

| Service | Container name | Port | Notes |
|---|---|---|---|
| Database | `ffi_hr_db` | `5432:5432` | postgres:16-alpine |
| Backend | `ffi_hr_backend` | `8000:8000` | Django + Gunicorn |
| Frontend | `ffi_hr_frontend` | `5173:80` | React built → Nginx |

Dev env file: `Backend/.env.docker` (debug=true, local DB config)

The notification stack also includes `ffi_hr_redis`, `ffi_hr_notification_worker`, and the development Evolution services
(`ffi_hr_evolution_db`, `ffi_hr_evolution_redis`, and `ffi_hr_evolution_api` on port 8080).

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

```bash
# After Python/Django changes
docker compose -f docker-compose.dev.yml up -d --build backend

# After frontend changes
docker compose -f docker-compose.dev.yml up -d --build frontend

# After docker-compose.dev.yml changes
docker compose -f docker-compose.dev.yml up -d --build
```

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
