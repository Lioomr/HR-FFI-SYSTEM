# Local Dev Setup Context

The system runs fully in Docker. Three containers form the dev stack.

## Containers (Dev)

| Service | Container name | Port | Notes |
|---|---|---|---|
| Database | `ffi_hr_db` | `5432:5432` | postgres:16-alpine |
| Backend | `ffi_hr_backend` | `8000:8000` | Django + Gunicorn |
| Frontend | `ffi_hr_frontend` | `5173:80` | React built → Nginx |

Dev env file: `Backend/.env.docker` (debug=true, local DB config)

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

## Backend Boot Sequence (entrypoint.sh)

1. Wait for PostgreSQL to accept connections (2 s polling loop)
2. `python manage.py migrate --noinput`
3. `gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120`

## Common Gotchas

| Problem | Cause | Fix |
|---|---|---|
| Migrations fail on startup | DB not ready in time | `down -v` then `up -d --build` |
| Port already in use | Another process on 5432/8000/5173 | Stop the conflicting process |
| CORS errors in browser | `VITE_API_BASE_URL` mismatch | Check build arg in docker-compose.dev.yml |
| `curl` prompts in PowerShell | PS alias conflict | Use `curl.exe` explicitly |
| Slow first build | apt-get + pip install | Normal — 3–5 min first time |
| New backend tests/code not visible in container | Backend source is baked into the image | Rebuild backend with `docker compose -f docker-compose.dev.yml up -d --build backend` before Docker validation |

## URLs (Dev)

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Database: localhost:5432 (ffi_hr_db / postgres / postgres)
