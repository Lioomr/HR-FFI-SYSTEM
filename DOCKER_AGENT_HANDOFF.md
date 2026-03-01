# Docker System Handoff for Agents

This document is for any agent working in this repository. It explains the Dockerized system structure, what has already been implemented, and how to operate it safely in development and production.

## 1) Current Docker State

Docker support is already implemented for:
- Backend (Django + Gunicorn)
- Frontend (React/Vite build served by Nginx)
- Database (PostgreSQL 16)

There are two compose profiles:
- Development: `docker-compose.dev.yml` (local workflow)
- Production-like: `docker-compose.prod.yml` (deployment workflow)

Legacy compatibility:
- `docker-compose.yml` currently mirrors the dev setup and can still be used.

## 2) Files Added for Dockerization

### Backend
- `Backend/Dockerfile`
- `Backend/entrypoint.sh`
- `Backend/.dockerignore`
- `Backend/.env.docker` (development env)
- `Backend/.env.production.example` (production template)
- `Backend/requirements.txt` updated with `gunicorn`

### Frontend
- `FrontEnd/Dockerfile`
- `FrontEnd/nginx.conf`
- `FrontEnd/.dockerignore`

### Root
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `docker-compose.yml` (dev-equivalent compatibility)
- `.env.prod.compose.example`
- `DEPLOYMENT_DOCKER.md`
- `.gitignore` updated to keep tracked Docker env examples

## 3) Runtime Architecture

### Development profile
Services:
1. `db`:
   - Image: `postgres:16-alpine`
   - Port: `5432:5432`
   - Volume: `postgres_data`
2. `backend`:
   - Build context: `./Backend`
   - Entrypoint: `/app/entrypoint.sh`
   - Port: `8000:8000`
   - Env file: `Backend/.env.docker`
   - Runs migrations on startup, then starts Gunicorn
3. `frontend`:
   - Build context: `./FrontEnd`
   - Build arg `VITE_API_BASE_URL=http://localhost:8000`
   - Served by Nginx
   - Port: `5173:80`

### Production profile
Services:
1. `db`:
   - Uses `Backend/.env.production` for DB credentials
   - Persistent volume `postgres_data_prod`
2. `backend`:
   - Uses production env file
   - Still runs migrations during startup
3. `frontend`:
   - Build arg `VITE_API_BASE_URL` comes from compose env substitution
   - Exposes `80:80`

Important:
- Dev and prod stacks should not run at the same time on one host without changing ports.

## 4) Backend Boot Sequence

`Backend/entrypoint.sh` does:
1. Wait for PostgreSQL using a simple `psycopg2` connection check loop.
2. Run `python manage.py migrate --noinput`.
3. Start Gunicorn:
   - `gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120`

Reasoning:
- Ensures DB is ready before migrations.
- Ensures schema is current at container startup.
- Uses production-grade server instead of Django `runserver`.

## 5) Environment Files and Responsibilities

### `Backend/.env.docker` (development)
- Debug enabled
- Local hosts and CORS
- Local DB values (`db`, `5432`, `postgres/postgres`)
- Safe for local containerized development only

### `Backend/.env.production.example`
- Template only
- Must be copied to `Backend/.env.production` and filled with real values
- Must set:
  - `DJANGO_DEBUG=false`
  - Strong `DJANGO_SECRET_KEY`
  - Real `DJANGO_ALLOWED_HOSTS`
  - Real `CORS_ALLOWED_ORIGINS`
  - Real `CSRF_TRUSTED_ORIGINS`
  - Secure DB credentials
  - `DEFAULT_FROM_EMAIL`
  - `BIRD_API_KEY`
  - `BIRD_WORKSPACE_ID`
  - `BIRD_EMAIL_CHANNEL_ID` (or `BIRD_CHANNEL_ID`)

### `.env.prod.compose.example`
- Compose-time variable substitution template
- Must be copied to `.env.prod.compose`
- Used for:
  - `DB_NAME`
  - `DB_USER`
  - `DB_PASSWORD`
  - `VITE_API_BASE_URL`

## 6) Commands Agents Should Use

### Development start
```powershell
docker compose -f docker-compose.dev.yml up -d --build
```

### Development status/logs
```powershell
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f backend
```

### Development stop/reset
```powershell
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml down -v
```

### Production-like start
```powershell
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build
```

### Production-like status/logs
```powershell
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml ps
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml logs -f backend
```

### Production-like stop
```powershell
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml down
```

## 7) Verification Checklist

After boot:
1. `docker compose ... ps` shows all services `Up` and DB `healthy`.
2. Backend logs show:
   - `Running migrations...`
   - `No migrations to apply.` or migration success lines
   - `Starting Gunicorn...`
3. Frontend check:
   - `curl.exe -i http://localhost:5173/` returns HTTP 200 in dev.
4. Backend check:
   - `curl.exe -i http://localhost:8000/admin/login/` returns HTTP 200.
5. App login works from browser.

## 8) Known Operational Notes

- PowerShell `curl` maps to `Invoke-WebRequest`; use `curl.exe` to avoid script parsing prompts.
- First startup may take longer due to image build and initial migrations.
- Existing database files like `Backend/db.sqlite3` are not part of containerized Postgres flow.
- If CORS errors appear, verify:
  - Backend env values (`CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`)
  - Frontend build arg `VITE_API_BASE_URL`
- If emails are not delivered but API calls succeed, check Bird suppression lists.
  Bird may return `InvalidPayload` with message `all contact identifiers are suppressed`.

## 9) Agent Rules for Future Docker Changes

When changing Docker-related config:
1. Keep dev and prod compose files aligned in structure where possible.
2. Never commit real production secrets.
3. Update both:
   - `DEPLOYMENT_DOCKER.md`
   - this file (`DOCKER_AGENT_HANDOFF.md`)
4. Validate compose syntax:
   - `docker compose -f docker-compose.dev.yml config`
   - `docker compose --env-file .env.prod.compose -f docker-compose.prod.yml config`
5. If ports or env names change, include migration notes in docs.

## 10) Quick Decision Guide for Agents

- Need local feature work: use `docker-compose.dev.yml`.
- Need deployment rehearsal: use `docker-compose.prod.yml`.
- Need cloud rollout docs: start from `DEPLOYMENT_DOCKER.md`.
- Need to explain architecture quickly: reference sections 3 and 4 in this file.
