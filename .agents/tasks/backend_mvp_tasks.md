# Backend MVP Tasks

Use this checklist when building a new backend feature or domain.

## 1. Confirm Scope

- [ ] Read the relevant plan file in `plans/` (e.g., `Global API Rules (v1).txt`, screen specs)
- [ ] Identify all actors and their roles (Employee/Manager/HRManager/CFO/CEO/SystemAdmin)
- [ ] Identify all status values and valid transitions if the feature is workflow-based
- [ ] Confirm whether the feature is company-scoped (requires `company` FK)
- [ ] Confirm whether the feature needs audit logging

## 2. Model

- [ ] Add `company` FK (OrganizationNode) if data is company-scoped
- [ ] Define all status choices as `TextChoices` inner class
- [ ] Add decision tracking fields for each approval stage (decided_by, decided_at, note)
- [ ] Add `is_active` for soft-delete if the model will support deletion
- [ ] Add `created_at` / `updated_at` timestamps
- [ ] Review generated migration before committing — check for unsafe operations
- [ ] For nullable → NOT NULL changes: two-step migration (add nullable → enforce)

## 3. Serializers

- [ ] `ReadSerializer` — include computed fields (status display, actor name)
- [ ] `CreateSerializer` — write-only fields, all validation in `validate()` or `validate_<field>()`
- [ ] `ActionSerializer` — for approve/reject/etc. (comment or reason field)
- [ ] File upload fields: add size validation + MIME type check in `validate_<field>()`
- [ ] Company-scoped FK fields: validate that referenced objects belong to the active company

## 4. Views / ViewSets

- [ ] One ViewSet per actor role if permission logic differs significantly
- [ ] Set correct `permission_classes` on every view/action
- [ ] Filter querysets using `filter_queryset_by_company_scope(qs, request.user)` for all company-scoped data
- [ ] Use `get_object()` + `check_object_permissions()` for detail views
- [ ] Workflow actions as `@action(detail=True, methods=['post'])` — validate status before acting
- [ ] Emit `audit(request, action, entity, metadata)` at every sensitive action
- [ ] Wrap notification calls in try/except — never let a failed notification break the action
- [ ] Return correct HTTP status codes (201 for create, 200 for actions, 204 for delete)

## 5. URL Registration

- [ ] Register ViewSet in the correct app's `urls.py` using DRF router
- [ ] Use kebab-case plural resource names (`loan-requests`, `payroll-runs`)
- [ ] Include in `config/urls.py` under the correct prefix
- [ ] Confirm no conflicting prefix with existing endpoints

## 6. Permissions

- [ ] Use existing permission classes from `accounts/permissions.py` where possible
- [ ] New permission class only if the logic truly differs from existing ones
- [ ] Object-level permission check: can this specific user act on this specific object?
- [ ] Never use `AllowAny` on any endpoint that accesses HR data

## 7. Approval Workflow (if applicable)

- [ ] Status transitions validated server-side — no direct client writes to `status`
- [ ] Initial status determined in `perform_create` based on actor role and config
- [ ] Each stage transition notifies next approver
- [ ] Self-approval block where required (CEO stage for HR managers)
- [ ] Read `.agents/context/workflow_engine.md`

## 8. Tests

- [ ] Happy path: create, approve at each stage, reach final approved state
- [ ] Permission tests: each role can only act on their stage (wrong-stage → 403)
- [ ] Validation tests: invalid inputs return 400 with descriptive errors
- [ ] Company isolation test: user from Company A cannot see Company B's data
- [ ] If file upload: test at-limit size, over-limit, invalid type
- [ ] Run: `cd Backend && pytest <app>/` then `cd Backend && pytest` for broad changes

## 9. Validation (before marking done)

```bash
# Inside container
docker compose -f docker-compose.dev.yml exec backend python manage.py check
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate --check
docker compose -f docker-compose.dev.yml exec backend pytest <app>/

# Or with local venv
cd Backend && python manage.py check && pytest <app>/
```

## 10. PR Checklist

- [ ] Migration files included and reviewed
- [ ] New env vars documented in `Backend/.env.example`
- [ ] Endpoint paths listed in PR description
- [ ] Plan deviations noted (if any)
- [ ] Audit log actions named and listed
