# AWS Deployment Handoff for Agents

This document is the operational guide for AI agents working on the deployed HR FFI system in AWS. Use it when investigating production issues, rebuilding containers, comparing local versus production behavior, or explaining how deployment works.

## 1) Current AWS Deployment Shape

The production host is an Ubuntu EC2 instance.

Known host:
- SSH user: `ubuntu`
- App server path: `/opt/hr-ffi`

The deployed stack is Docker Compose based and runs from:
- `/opt/hr-ffi/docker-compose.prod.yml`

Current production containers:
- `ffi_hr_frontend_prod`
- `ffi_hr_backend_prod`
- `ffi_hr_db_prod`

Public domains currently in use:
- Frontend app: `https://app.asecopro.com`
- Backend API: `https://api.asecopro.com`

## 2) Important Path Rule

Production compose commands must be run from `/opt/hr-ffi`, not from `/home/ubuntu`.

If an agent runs:

```bash
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build frontend
```

from `/home/ubuntu`, Docker will look for:

```bash
/home/ubuntu/.env.prod.compose
```

and fail with:

```text
couldn't find env file: /home/ubuntu/.env.prod.compose
```

Correct usage:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build frontend
```

Or in one command:

```bash
docker compose --env-file /opt/hr-ffi/.env.prod.compose -f /opt/hr-ffi/docker-compose.prod.yml up -d --build frontend
```

## 3) Production Environment Files

Agents should know there are two different production env responsibilities:

### Compose-time env
File:
- `/opt/hr-ffi/.env.prod.compose`

Used by Docker Compose for variable substitution in `docker-compose.prod.yml`, especially:
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `VITE_API_BASE_URL`

### Backend runtime env
File:
- `/opt/hr-ffi/Backend/.env.production`

Used by the Django backend container for:
- Django settings
- DB connection
- allowed hosts
- CORS/CSRF
- email and notification settings

### Frontend source env
File:
- `/opt/hr-ffi/FrontEnd/.env`

Important:
- This file can affect what gets baked into the frontend bundle at build time.
- If it contains `VITE_API_BASE_URL=http://localhost:8000`, a production rebuild may accidentally ship a localhost API target unless the compose build arg overrides it correctly.

## 4) Local vs Production Differences

Agents must not assume local and production behave the same.

### Local/development
- Usually runs from the repository on a developer machine
- Often uses `docker-compose.dev.yml` or direct Django/Vite commands
- Frontend API target may be `http://localhost:8000`
- Debugging is easier and logs are local
- TLS and public-domain CORS are usually not involved

### Production/AWS
- Runs on EC2 under `/opt/hr-ffi`
- Uses `docker-compose.prod.yml`
- Frontend must target the public API domain, not localhost
- Domain, CORS, CSRF, cookies, and reverse-proxy behavior matter
- Build-time frontend variables are critical
- A frontend rebuild can change behavior even if backend code is unchanged

## 5) Known Production Gotcha Already Observed

This system already had a real production issue caused by frontend API configuration.

Observed facts:
- `/opt/hr-ffi/.env.prod.compose` had `VITE_API_BASE_URL=https://api.asecopro.com`
- `/opt/hr-ffi/FrontEnd/.env` had `VITE_API_BASE_URL=http://localhost:8000`
- The deployed frontend bundle contained `localhost:8000`

Meaning:
- The production frontend was trying to call `http://localhost:8000` from the user's browser
- That points to the user's own machine, not the EC2 backend
- The browser request failed
- The page then surfaced a misleading UI error

Lesson for agents:
- When production frontend behavior looks like a backend bug, inspect frontend build-time env first
- Search the built frontend bundle for unexpected API targets

Helpful verification command:

```bash
docker exec ffi_hr_frontend_prod sh -lc 'grep -R -n localhost:8000 /usr/share/nginx/html 2>/dev/null | head'
```

## 6) Safe Production Debugging Workflow

When debugging production, agents should follow this order.

### Step 1: Confirm current directory and files

```bash
cd /opt/hr-ffi
pwd
ls -la
```

### Step 2: Check running containers

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

### Step 3: Check compose rendering

```bash
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml config
```

This confirms Compose variable substitution before rebuilding.

### Step 4: Inspect env files

```bash
sed -n '1,80p' .env.prod.compose
sed -n '1,120p' Backend/.env.production
sed -n '1,80p' FrontEnd/.env
```

Be careful with secrets. Read only what is necessary.

### Step 5: Check logs

Backend logs:

```bash
docker logs --tail 200 ffi_hr_backend_prod
```

Frontend logs:

```bash
docker logs --tail 200 ffi_hr_frontend_prod
```

### Step 6: Probe the backend locally from the server

```bash
curl -I http://127.0.0.1:8000/
curl -I http://127.0.0.1:8000/api/leaves/leave-requests/
```

Notes:
- `400` or `401` can still prove the service is reachable
- reachability is different from authorization

### Step 7: Verify frontend bundle config

```bash
docker exec ffi_hr_frontend_prod sh -lc 'grep -R -n api.asecopro.com /usr/share/nginx/html 2>/dev/null | head'
docker exec ffi_hr_frontend_prod sh -lc 'grep -R -n localhost:8000 /usr/share/nginx/html 2>/dev/null | head'
```

### Step 8: Rebuild only the service you changed

Frontend only:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build frontend
```

Backend only:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build backend
```

Whole stack:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build
```

## 7) Production Debugging Heuristics

Agents should use these heuristics before changing code.

### If the UI shows a misleading error
- Check the browser network response first if available
- Then check whether frontend build config points to the wrong API host
- Then inspect backend logs

### If only production fails
- Compare build-time variables
- Compare domains, CORS, CSRF, and cookie settings
- Compare active env files rather than source examples

### If a page shows empty data and an error toast
- Distinguish between:
  - a successful empty API result
  - a thrown frontend request error
  - a backend permission error
  - a reverse proxy or DNS issue

### If backend logs are quiet
- The request may not be reaching the backend at all
- That often points to frontend config, proxy routing, or wrong host

## 8) How Agents Should Explain the `localhost` Class of Bug

Use language like this:

- The frontend was built with a localhost API URL.
- In production, browsers interpret `localhost` as the user's own device.
- That means the request never reaches the AWS API server.
- The UI then catches the network failure and may display a misleading business message.

This is usually more accurate than saying “the backend returned no data.”

## 9) Recommended Production Commands

Status:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml ps
```

Backend logs:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml logs --tail 200 backend
```

Frontend logs:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml logs --tail 200 frontend
```

Rebuild frontend:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build frontend
```

Rebuild backend:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml up -d --build backend
```

## 10) Agent Rules for Production Work

1. Do not assume local `.env` values are safe for production.
2. Always check the real files under `/opt/hr-ffi` before concluding root cause.
3. Prefer service-specific rebuilds over rebuilding everything.
4. Treat frontend build-time variables as part of deployment state.
5. When a production-only issue appears, compare:
   - repo source
   - deployed env files
   - rendered compose config
   - built frontend bundle
6. If changing deployment behavior, update this file and `DEPLOYMENT_DOCKER.md`.

## 11) Suggested Future Improvement

To reduce production mistakes, consider one of these changes:

- Remove or rethink the default `ARG VITE_API_BASE_URL=http://localhost:8000` in `FrontEnd/Dockerfile`
- Use a relative API path if the reverse proxy supports it
- Keep production frontend config out of `FrontEnd/.env` if that file is likely to drift

These are not mandatory for every fix, but agents should keep them in mind.
