# Audit System Context

The `audit` app provides compliance-grade logging for all sensitive actions.

## AuditLog Model (`Backend/audit/models.py`)

| Field | Type | Notes |
|---|---|---|
| `actor` | FK(User, null) | null for system-initiated actions |
| `action` | CharField | e.g. `login_success`, `leave_approved`, `payroll_finalized` |
| `entity` | CharField | Model/domain name, e.g. `LeaveRequest`, `User`, `PayrollRun` |
| `entity_id` | CharField | String PK of the affected object |
| `ip_address` | GenericIPAddressField | From request |
| `metadata` | JSONField | Arbitrary context (old/new values, reason, etc.) |
| `created_at` | DateTimeField | Auto, indexed |

Indexes: `action`, `(entity, entity_id)`, `created_at`.

## Logging Utility

```python
from audit.utils import audit

audit(request, action="leave_approved", entity="LeaveRequest", metadata={"leave_id": obj.pk, "employee": str(obj.employee)})
```

Call this from views/services — not from serializers or models.

## Where Audit Logging Is Required

- Authentication: `login_success`, `login_failed`, `logout`, `password_changed`
- User management: `user_created`, `user_updated`, `user_status_changed`, `role_changed`
- Approval decisions: `leave_approved`, `leave_rejected`, `loan_approved`, `loan_rejected`, `asset_approved`
- Payroll: `payroll_run_created`, `payroll_finalized`, `payroll_cancelled`, `payslip_viewed`
- Employee data changes: `employee_created`, `employee_updated`, `employee_status_changed`
- BioTime: `biotime_sync_triggered`, `biotime_config_updated`
- Settings: `system_settings_updated`

## Viewing Audit Logs

- **Backend**: `GET /audit-logs/` (SystemAdmin only) — filterable by `action`, `actor_email`, `entity`, date range
- **Export**: `GET /audit-logs/export/` — returns CSV or XLSX
- **Frontend**: `AdminAuditLogsPage` (`FrontEnd/src/pages/admin/AdminAuditLogsPage.tsx`)

## Rules

- Every workflow approval/rejection must emit an audit log.
- Every destructive admin action (user deactivate, payroll cancel, employee terminate) must emit an audit log.
- Include enough `metadata` to reconstruct what changed — at minimum the entity PK and key status transition.
- Do not include raw passwords, tokens, or PII beyond what is necessary for investigation.
- AuditLog rows are immutable — never update or delete them.
