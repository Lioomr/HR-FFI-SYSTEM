# Notifications Context

> **TL;DR:** Bird (MessageBird) for Email + WhatsApp. Public API entry points in `Backend/core/notifications.py`. Call from views/services only (not models/serializers). Always try/except — a failed notification must never break the workflow action. WhatsApp phone must be E.164. Next-approver recipients resolved by status: `PENDING_MANAGER` → direct manager, `PENDING_HR` → HRManager/SystemAdmin groups, `PENDING_CEO` → users with `IsDepartmentCEOApprover`. No per-user preferences model exists.

The system sends notifications via **Bird (MessageBird)** over two channels: Email and WhatsApp.

## Key Files

| File | Purpose |
|---|---|
| `Backend/core/notifications.py` | Public notification API — call these functions from views/services |
| `Backend/core/services/notification_service.py` | `NotificationService` orchestrator |
| `Backend/core/services/email_service.py` | `EmailService` — Bird email API wrapper |
| `Backend/core/services/bird_email_service.py` | `BirdEmailService` — HTML email templates |
| `Backend/core/services/whatsapp_service.py` | WhatsApp template registry + sender |
| `Backend/core/whatsapp_service.py` | `BirdWhatsAppTemplateService` — low-level WhatsApp API |
| `Backend/core/services/pending_approval_email.py` | `notify_users_for_pending_status()` — notifies next approver |
| `Backend/core/services/request_submission_email.py` | `send_request_submission_email()` — confirms submission to employee |
| `Backend/leaves/notifications.py` | Leave-specific notification helpers |
| `Backend/employees/notifications.py` | Document expiry notification helpers |

## Channels

### Email (`EmailService`)
- `send_html_email(to_email, subject, html_content, fallback_text, attachments)`
- Returns `{"success": bool, "provider": "bird", "status_code": int, "message_id": str, "error": str}`
- Supports HTML + plain text, media attachments, base64 logo embedding
- Auto-retries without logo if payload returns 413

### WhatsApp (`BirdWhatsAppTemplateService`)
- `send_template(phone_number, template_key, variables, language, context)`
- Phone number **must be E.164 format** (e.g., `+966501234567`)
- Retrieved from `EmployeeProfile.mobile` — validated before sending
- Returns `{"sent": bool, "provider": "bird_whatsapp", "status_code": int, "reason": str}`

## WhatsApp Template Registry

| Template key | Variables | Event |
|---|---|---|
| `leave_request_submitted_v1` | manager_name, employee_name, leave_type, start_date, end_date, total_days | Leave submitted — sent to manager |
| `leave_request_approved_v1` | employee_name, leave_type, start_date, end_date, total_days | Leave approved — sent to employee |
| `leave_request_rejected_v1` | employee_name, leave_type, start_date, end_date, rejection_reason | Leave rejected — sent to employee |
| `leave_delegation_assigned_v1` | delegate_name, employee_name, leave_type, start_date, end_date, total_days | Leave delegation assigned — sent to delegated employee |
| `document_expiry_reminder` | employee_name, document_type, expiry_date | Document expiry — sent to employee |
| `new_announcement_notification` | employee_name, announcement_title | New announcement — sent to employee |

## Events That Trigger Notifications

| Event | Email | WhatsApp |
|---|---|---|
| Leave submitted | `send_request_submission_email()` to employee | `leave_request_submitted_v1` to manager |
| Leave moved to PENDING_HR | `notify_users_for_pending_status()` to HR approvers | — |
| Leave moved to PENDING_CEO | `notify_users_for_pending_status()` to CEO approvers | — |
| Leave approved (HR or CEO) | — | `leave_request_approved_v1` to employee |
| Leave rejected | `send_leave_rejected_email()` to employee | `leave_request_rejected_v1` to employee |
| Document expiry approaching | `send_document_expiry_reminder_email()` | `document_expiry_reminder` to employee |

## Required Environment Variables

```
BIRD_API_KEY
BIRD_WORKSPACE_ID
BIRD_EMAIL_CHANNEL_ID
BIRD_WHATSAPP_CHANNEL_ID
BIRD_WHATSAPP_LEAVE_DELEGATION_PROJECT_ID
BIRD_WHATSAPP_LEAVE_DELEGATION_VERSION_ID
BIRD_SMS_CHANNEL_ID         # configured, not actively used
BIRD_API_BASE_URL           # default: https://api.bird.com/workspaces
DEFAULT_FROM_EMAIL          # default: no-reply@fficontracting.com
NOTIFICATION_HTTP_TIMEOUT_SECONDS   # default: 10
```

## Recipient Resolution

- **Next approver (email)**: `notify_users_for_pending_status(leave_request)` resolves recipients by status:
  - `PENDING_MANAGER` → direct manager (from `EmployeeProfile`)
  - `PENDING_HR` → all users in `HRManager` or `SystemAdmin` groups
  - `PENDING_CEO` → users with `IsDepartmentCEOApprover` permission for the dept
- **Employee (WhatsApp)**: `EmployeeProfile.mobile` — must be valid E.164

## Rules for New Notifications

- Call notification functions from views/services, **not** from models or serializers.
- Always wrap notification calls in try/except — a failed notification must never break the workflow action.
- Never expose Bird API errors to the client — log them server-side only.
- If `EmployeeProfile.mobile` is missing or invalid, skip WhatsApp silently and log.
- Add new WhatsApp templates to the registry in `Backend/core/services/whatsapp_service.py` with the template key and expected variables documented.
- There is no per-user notification preference model currently — all notifications are system-wide.

## Frontend Notification UI

- Uses Ant Design `notification` component for toast alerts on user actions (not persistent).
- There is no persistent bell/notification list in the current UI.
