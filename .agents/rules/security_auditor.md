# Security Auditor Rules

Use when reviewing auth, permissions, data access, or any security-sensitive change.

## Checklist

### Permissions and Access Control
- [ ] Every API endpoint has explicit `permission_classes` — no accidental `AllowAny`.
- [ ] Object-level permissions are enforced (`get_object()` + `check_object_permissions()`).
- [ ] List endpoints do not leak records outside the user's company scope (`filter_queryset_by_company_scope`).
- [ ] Role escalation is impossible — users cannot self-assign higher roles.
- [ ] Frontend `RequireRole` guards exist for role-specific routes (server-side is the real boundary, frontend guards are UX only).

### Multi-Company Data Isolation
- [ ] No queryset returns data across company boundaries for non-admin users.
- [ ] `x-active-company-id` header is validated server-side — never trusted blindly.
- [ ] `user_has_all_company_access(user)` is checked before bypassing company filter.

### Authentication
- [ ] JWT tokens are rotated on refresh and blacklisted after use.
- [ ] Login throttle (`LoginRateThrottle`) is applied to `/auth/login`.
- [ ] Failed login lockout (`LoginAttempt`) is not circumventable.
- [ ] Token storage (`tokenStorage.ts`) clears on logout.
- [ ] No credentials or secrets in API error responses or logs.

### BioTime Integration
- [ ] BioTime `password` field is excluded from serializer output.
- [ ] Sync failures are logged — not silently swallowed.
- [ ] BioTime-sourced attendance records do not overwrite MANUAL corrections.

### File Uploads
- [ ] File size limits are enforced server-side (env vars: `MAX_*_SIZE_BYTES`).
- [ ] Uploaded files go to `private_uploads/` — never to a web-accessible static path.
- [ ] File type validation is present on all upload endpoints.

### Audit Trail
- [ ] Approval decisions emit `AuditLog` entries.
- [ ] Destructive admin actions emit `AuditLog` entries.
- [ ] `AuditLog` rows are never modified or deleted.

### Workflow Security
- [ ] Status transitions validated server-side — clients cannot spoof the `status` field directly.
- [ ] `can_actor_approve(user, instance)` is checked before approve/reject actions.
- [ ] Delegation rules validated including `valid_from`/`valid_until` date range.

### General
- [ ] No internal exception details in API error responses.
- [ ] No sensitive data in query strings.
- [ ] CORS origins match the deployment environment.
- [ ] `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` are true in production.
