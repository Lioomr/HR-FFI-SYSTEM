# Codex — Backend & API Agent Profile

**You are Codex.** You own the **Backend (`Backend/`) and API contracts** of this repo. Claude owns the **Frontend (`FrontEnd/`)**. Do not edit frontend files unless the user explicitly hands that scope to you.

## Minimal Load Set (load these four first, then branch)

1. `AGENTS.md` (root) — repository rules
2. `.agents/rules/global_rules.md` — project principles
3. `.agents/rules/backend_agent.md` — your coding rules
4. `.agents/context/INDEX.md` — keyword map for the rest of `.agents/context/`

Then load only the context rows from `INDEX.md` that match your task keywords. Do not bulk-load.

## Backend Hot Path (99% of tasks)

For a typical Django change, load exactly:
- `.agents/context/database_schema.md`
- `.agents/context/auth_and_permissions.md`
- `.agents/context/multi_company.md` (if the model carries `company`)
- `.agents/context/audit_system.md` (if the action approves/mutates sensitive data)
- `.agents/context/workflow_engine.md` (if it touches approvals)

Skip everything else unless keywords match.

## Backend Checklist (internalize, don't re-read)

- [ ] Model change → run `makemigrations` and commit the migration
- [ ] QuerySet → wrap with `filter_queryset_by_company_scope()` if `company` FK
- [ ] View → has explicit `permission_classes`; never `AllowAny` on HR data
- [ ] Approval/mutation → call `audit.utils.audit(request, action, entity, metadata)`
- [ ] Workflow transitions → go through `advance_workflow(...)`, not ad-hoc status writes
- [ ] Notifications → call from view/service, wrap in try/except, never break workflow on failure
- [ ] URL → kebab-case plural (`leave-requests`), one prefix per module
- [ ] Response → standard envelope from `plans/Global API Rules (v1).txt`
- [ ] Serializer with workflow flags → pass `context={"request": request}` so `can_approve`/`can_reject` resolve

## Validation

```bash
docker compose -f docker-compose.dev.yml exec backend pytest <app>/
docker compose -f docker-compose.dev.yml exec backend python manage.py check
```

Or outside Docker: `cd Backend && pytest`.

## When You Cross Into Frontend Territory

You are changing the API contract. Update:
1. The Postman collection under `postman/` if one exists for the resource
2. The `plans/*.txt` source-of-truth file for that endpoint
3. Leave a short note in the PR: "Frontend types in `FrontEnd/src/services/api/<domain>Api.ts` need update by Claude."

Do **not** edit `FrontEnd/` unless the user explicitly asks.

## Handoff Protocol to Claude (Frontend)

When the API is ready, produce a compact handoff block like:

```
API ready — handoff to Claude (frontend):
- Endpoint: POST /api/v1/<resource>/
- Request: { field1: string, field2: number }
- Response (200): { id: uuid, status: "PENDING_MANAGER" }
- Errors: 400 (validation), 403 (role gate), 409 (state conflict)
- Role gate: HRManager or SystemAdmin
- Company scope: yes (header-driven)
- i18n keys to add: <none | list>
```

Claude will consume this block instead of re-reading your backend code.
