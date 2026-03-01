# Docker Deployment Guide (Dev + Prod)

## 1) Files You Use

- Development: `docker-compose.dev.yml` (or existing `docker-compose.yml`)
- Production: `docker-compose.prod.yml`
- Dev backend env: `Backend/.env.docker`
- Prod backend env template: `Backend/.env.production.example`
- Prod compose env template: `.env.prod.compose.example`

## 2) Development Version

Run:

```powershell
docker compose -f docker-compose.dev.yml up -d --build
```

Check:

```powershell
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f backend
```

URLs:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

Stop:

```powershell
docker compose -f docker-compose.dev.yml down
```

Reset DB volume:

```powershell
docker compose -f docker-compose.dev.yml down -v
```

## 3) Production Version

Create real env files:

1. Copy `Backend/.env.production.example` to `Backend/.env.production` and fill real secrets/domains.
2. Copy `.env.prod.compose.example` to `.env.prod.compose` and fill values.

Start production stack:

```powershell
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build
```

Check:

```powershell
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml ps
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml logs -f backend
```

Stop:

```powershell
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml down
```

## 4) Required Production Settings

- `DJANGO_DEBUG=false`
- strong `DJANGO_SECRET_KEY`
- correct `DJANGO_ALLOWED_HOSTS`
- correct `CORS_ALLOWED_ORIGINS`
- correct `CSRF_TRUSTED_ORIGINS`
- correct `VITE_API_BASE_URL` (public API domain)
- strong DB credentials
- `DEFAULT_FROM_EMAIL`
- `BIRD_API_KEY`
- `BIRD_WORKSPACE_ID`
- `BIRD_EMAIL_CHANNEL_ID` (or `BIRD_CHANNEL_ID`)

## 5) Deployment Notes

- On cloud or VPS, run the production compose file only.
- Put reverse proxy/TLS in front (Nginx/Caddy/Cloud LB).
- Keep database backups enabled.
- If invite/reset/notification email appears successful in API but does not arrive, inspect Bird suppression lists for recipient addresses.
