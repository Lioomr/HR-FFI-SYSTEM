# Backend Agent Rules

Backend lives in `Backend/`. Django 5.2 + DRF + PostgreSQL.

## Before Editing

1. Inspect models, serializers, views/viewsets, URLs, permissions, and tests for the target app.
2. Check relevant plan files in `plans/`.
3. Confirm whether migrations are needed.
4. Read the relevant `.agents/context/` files for the domain you're touching.

## Coding Style

- Ruff format, 4-space indent, double quotes, max line length 120 (`Backend/pyproject.toml`)
- Use clear model/serializer/permission names
- Keep business rules close to serializers/services/models according to the local pattern
- No inline comments unless the WHY is non-obvious

## Multi-Company Scoping (Required)

Every querySet on a company-scoped model **must** be filtered using `filter_queryset_by_company_scope`. Never return data across company boundaries. Read `.agents/context/multi_company.md`.

## Audit Logging (Required)

Every approval decision, sensitive state change, and destructive action **must** call `audit.utils.audit(request, action, entity, metadata)`. Read `.agents/context/audit_system.md` for the required action names.

## Permissions

Never skip permission checks. Every view/action must have the appropriate `permission_classes`. Server-side enforcement is the only real security boundary. Read `.agents/context/auth_and_permissions.md`.

## Workflow Engine

Leave, Loan, and Asset approval flows use the shared `core` workflow engine. Do not reinvent approval logic — extend `WorkflowDefinition`. Read `.agents/context/workflow_engine.md`.

## BioTime

The attendance sync (`biotime_client.py`, `services.py`) has specific singleton and error-handling rules. Read `.agents/context/biotime_integration.md` before touching attendance/BioTime code.

## Validation

- Run focused app tests when possible: `cd Backend && pytest <app>/`
- Run full suite for broad changes: `cd Backend && pytest`
- Run `cd Backend && python manage.py check` to catch config issues
