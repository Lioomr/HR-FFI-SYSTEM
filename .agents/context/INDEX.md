# Context Index — Token-Efficient Map

Scan this file first. Each row lists the file, size, and the exact keywords that route a task to it. Load only the files whose keywords match your task. Do not bulk-load this directory.

## Cross-Cutting (load when the relevant concept appears in your task)

| File | Size | Load when task mentions |
|---|---:|---|
| `system_design.md` | ~3.5K | stack overview, domain app map, cross-cutting concerns summary |
| `local_dev_setup.md` | ~4K | docker, `compose`, ports, migrations, `sync_biotime`, rebuild, containers |
| `database_schema.md` | ~3.7K | models, relations, FKs, indexes, company FK, migrations |
| `multi_company.md` | ~3K | `x-active-company-id`, `filter_queryset_by_company_scope`, tenant, scoping |
| `audit_system.md` | ~2.3K | `audit.utils.audit`, AuditLog, compliance, `_waived`, `_approved` action names |
| `auth_and_permissions.md` | ~3K | JWT, `permission_classes`, `RequireRole`, role groups, `IsDepartmentCEOApprover` |
| `api_design.md` | ~2.5K | REST envelope, pagination, error shape, kebab-case URLs |
| `file_uploads.md` | ~3K | `PrivateUploadStorage`, `private_uploads/`, signed URL, attachments |
| `i18n.md` | ~1.8K | `useI18n`, `translations.ts`, `name_en`/`name_ar`, bilingual |
| `notifications.md` | ~5.1K | Bird, email, WhatsApp, template, `notify_users_for_pending_status` |
| `workflow_engine.md` | ~4K | `WorkflowDefinition`, approval chain, `DelegationRule`, `RequestObligation`, `advance_workflow` |
| `biotime_integration.md` | ~2.8K | BioTime, ZKTeme 8.5, `biotime_client.py`, `sync_biotime`, singleton |
| `deployment.md` | ~3K | env vars, staging, prod, Gunicorn, Nginx |

## Frontend-Only

| File | Size | Load when task mentions |
|---|---:|---|
| `frontend_architecture.md` | ~4.3K | folder layout, pages list, `apiClient.ts`, Zustand, routes |
| `frontend_design_system.md` | ~0.7K | Ant Design patterns, spacing, icons |
| `admin_dashboard_design.md` | ~0.6K | admin UX language, density |

## Planning-Only

| File | Size | Load when task mentions |
|---|---:|---|
| `testing_strategy.md` | ~0.6K | test plan, coverage expectations |

## Load Discipline

1. Read this `INDEX.md` (~1K). It stays in context.
2. Read **only** the rows whose keywords match your task.
3. If unsure between two files, read the shorter one first.
4. Never load every context file — the full set is ~45K of tokens and almost always wasteful.
5. After reading a context file, check it for inline links before expanding to others.

## Domain Skills & Global Rules

- **Skills (`.agents/skills/`)**: Contains workflow-specific guides (e.g., `approval_workflow.md`, `leave_management.md`, `payroll_processing.md`). Only read the specific skill file if your task involves that domain.
- **Rules (`.agents/rules/`)**: Contains specific conventions (e.g., `api_conventions.md`, `code_style.md`, `security_auditor.md`). Reference these if you are unsure about formatting or project standards.
