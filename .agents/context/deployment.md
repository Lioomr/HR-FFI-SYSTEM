# Deployment Context

## Docker Services

Defined in `docker-compose.yml` (dev default), `docker-compose.dev.yml`, `docker-compose.prod.yml`:

| Service | Image | Port | Notes |
|---|---|---|---|
| `db` | postgres:16-alpine | 5432 | Volume: `postgres_data`, health check: `pg_isready` |
| `backend` | Custom Dockerfile | 8000 | Django app, reads `.env` |
| `frontend` | Custom Dockerfile | 5173→80 | React, VITE_API_BASE_URL env var |

## Required Environment Variables

**Core Django** (Backend/.env):
- `DJANGO_SECRET_KEY` — required, min 32 chars
- `DJANGO_DEBUG` — false in production
- `DJANGO_ALLOWED_HOSTS` — comma-separated
- `DJANGO_ENV` — local|development|production

**Database**:
- `DB_ENGINE=django.db.backends.postgresql`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`

**CORS / Frontend**:
- `CORS_ALLOWED_ORIGINS` — e.g. `http://localhost:5173`
- `CSRF_TRUSTED_ORIGINS`
- `FRONTEND_URL` — used in email links

**Bird (MessageBird) Notifications**:
- `BIRD_API_KEY`, `BIRD_CHANNEL_ID`, `BIRD_ACCESS_KEY`, `BIRD_WORKSPACE_ID`
- `BIRD_EMAIL_CHANNEL_ID`, `BIRD_SMS_CHANNEL_ID`, `BIRD_WHATSAPP_CHANNEL_ID`
- `BIRD_WHATSAPP_MEETING_PROJECT_ID`, `BIRD_WHATSAPP_MEETING_VERSION_ID` — Bird WhatsApp template identifiers for meeting notifications; backend uses them for `meeting_notification_v1`
- `BIRD_WHATSAPP_LEAVE_DELEGATION_PROJECT_ID`, `BIRD_WHATSAPP_LEAVE_DELEGATION_VERSION_ID` — Bird WhatsApp template identifiers for leave delegation assignment notifications; backend uses them for `leave_delegation_assigned_v1`
- `BIRD_API_BASE_URL`
- `DEFAULT_FROM_EMAIL`

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

- `DEPLOYMENT_DOCKER.md` — full deployment walkthrough
- `DOCKER_AGENT_HANDOFF.md` — agent handoff / environment notes

## Migration Checklist

1. Run `python manage.py migrate` after deploy — review migration operations before committing
2. For nullable-to-NOT-NULL column additions: three-step (add nullable → data migration → enforce NOT NULL)
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
