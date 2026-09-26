# Deployment Context

## Docker Services and Source-of-Truth

- `docker-compose.dev.yml` is the local development stack.
- `docker-compose.yml` is a dev-compatible root configuration with optional `messaging-trial`, `memory`, and `marketing` profiles; it is not the production configuration.
- This local checkout does not contain `docker-compose.prod.yml`; it contains only a dated `.bak` file. The AWS handoff documents the deployed EC2 stack at `/opt/hr-ffi/docker-compose.prod.yml`. Follow that handoff for production operations and verify remote state before changes.

| Service | Image | Port | Notes |
|---|---|---|---|
| `db` | postgres:16-alpine | 5432 | Volume: `postgres_data`, health check: `pg_isready` |
| `redis` | redis:7-alpine | Internal | Cache, Celery broker, and results use separate Redis DBs |
| `backend` | Custom Dockerfile | 8000 | Django ASGI app served by Daphne; startup applies migrations |
| `frontend` | Custom Dockerfile | 5173 -> 80 | React build served by Nginx |
| `notification-worker` | Custom Dockerfile | — | Celery worker only (no `-B` — beat is a separate service) |
| `celery-beat` | Custom Dockerfile | — | Runs `celery beat` alone; do not recombine with the worker |
| `evolution-api`, `evolution-db`, `evolution-redis` | Evolution/PostgreSQL/Redis | 8080 (API) | Evolution services start by default in dev; root Compose puts them under `messaging-trial` |
| `cinematic-site` | Custom Dockerfile | 5174 -> 80 | Separate marketing site (`CinematicSite/`); opt-in via `profiles: ["marketing"]`, not started by default |

The root Compose file also defines `cognee` and `cognee-db` under the opt-in `memory` profile. See `local_dev_setup.md` for local start, stop, logs, and volume behavior.

See `reliability_and_perf_fixes.md` for why the worker/beat split and the gzip config exist — both were reliability/perf fixes and should not be reverted.

## Required Environment Variables

**Core Django** (Backend/.env):
- `DJANGO_SECRET_KEY` - required, min 32 chars
- `DJANGO_DEBUG` - false in production
- `DJANGO_ALLOWED_HOSTS` - comma-separated
- `DJANGO_ENV` - local|development|production

**Database**:
- `DB_ENGINE=django.db.backends.postgresql`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`

**CORS / Frontend**:
- `CORS_ALLOWED_ORIGINS` - e.g. `http://localhost:5173`
- `CSRF_TRUSTED_ORIGINS`
- `FRONTEND_URL` - used in email links

**Notifications**:
- Email uses Bird/MessageBird: `BIRD_API_KEY`, `BIRD_CHANNEL_ID`, `BIRD_ACCESS_KEY`, `BIRD_WORKSPACE_ID`
- Email channel: `BIRD_EMAIL_CHANNEL_ID`
- Bird API base: `BIRD_API_BASE_URL`
- Sender: `DEFAULT_FROM_EMAIL`
- WhatsApp uses Evolution: `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`
- SMS uses TextBee: `MESSAGING_SMS_PROVIDER=textbee`, `TEXTBEE_API_BASE_URL`, `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`
- Do not configure Bird WhatsApp channel/template IDs; WhatsApp sends rendered bilingual text through Evolution.

**Security (production)**:
- `SECURE_SSL_REDIRECT=true`
- `SESSION_COOKIE_SECURE=true`
- `CSRF_COOKIE_SECURE=true`
- `SECURE_HSTS_SECONDS=31536000`

**File Uploads**:
- `MAX_LEAVE_DOCUMENT_SIZE_BYTES` (default 5MB)
- `MAX_ASSET_INVOICE_SIZE_BYTES` (default 5MB)
- `MAX_ANNOUNCEMENT_ATTACHMENT_SIZE_BYTES` (default 5MB)

**Other**:
- `PASSWORD_RESET_TOKEN_TTL_SECONDS` (default 3600)
- `NOTIFICATION_HTTP_TIMEOUT_SECONDS`

Reference: `Backend/.env.example`

## Deployment Docs

- `DEPLOYMENT_DOCKER.md` - full deployment walkthrough
- `DOCKER_AGENT_HANDOFF.md` - agent handoff / environment notes

## Migration Checklist

1. Run `python manage.py migrate` after deploy - review migration operations before committing
2. For nullable-to-NOT-NULL column additions: three-step (add nullable -> data migration -> enforce NOT NULL)
3. Never auto-squash migrations without review
4. Document breaking migrations in the PR description

## Pre-Deploy Checks

```bash
# Backend
cd Backend && pre-commit run --all-files && pytest

# Frontend
cd FrontEnd && npm run type-check && npm run lint && npm run build
```

## Deployment Change Checklist

When deploying, document in the PR:
- New environment variables added
- Database migrations required
- Static/media file handling changes
- New background jobs or management commands
- Breaking API or frontend routing changes

Never commit credentials. Keep secrets in `.env` or deployment secret storage.
