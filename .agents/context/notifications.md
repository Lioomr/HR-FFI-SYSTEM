# Notifications Context

> **TL;DR:** Eligible user notifications are persisted synchronously, then Celery sends through Evolution WhatsApp first and
> falls back asynchronously to Bird email only after a definitive failure or skip.
> Bird is used for email only. WhatsApp is Evolution-only through
> `Backend/core/services/whatsapp_service.py`. SMS uses TextBee when enabled.
> Call notification helpers from views/services only, wrap calls in try/except,
> and never let a failed notification block a workflow action. WhatsApp phone
> numbers must be valid E.164.

## Providers

| Channel | Provider | Main code path |
|---|---|---|
| Email | Bird / MessageBird | `Backend/core/services/email_service.py`, `Backend/core/services/bird_email_service.py` |
| WhatsApp | Evolution API | `Backend/core/services/whatsapp_service.py`, `Backend/core/services/messaging_providers.py` |
| SMS | TextBee | `Backend/core/notifications.py`, `Backend/core/services/messaging_providers.py` |

Bird WhatsApp is intentionally removed. Do not add Bird WhatsApp project IDs,
version IDs, channels, or provider fallback paths.

## Key Files

| File | Purpose |
|---|---|
| `Backend/core/notifications.py` | Public email/SMS API helpers |
| `Backend/core/services/notification_service.py` | Channel orchestrator |
| `Backend/core/services/email_service.py` | Bird email API wrapper |
| `Backend/core/services/bird_email_service.py` | Bird HTML email helpers/templates |
| `Backend/core/services/whatsapp_service.py` | WhatsApp template registry and Evolution sender |
| `Backend/core/services/messaging_providers.py` | Evolution renderer/provider and TextBee provider |
| `Backend/core/whatsapp_service.py` | Legacy helper `send_whatsapp_notification()` backed by `WhatsAppService` |
| `Backend/core/services/pending_approval_email.py` | `notify_users_for_pending_status()` for next approvers |
| `Backend/core/services/whatsapp_notifications.py` | Pending-approval and request-status WhatsApp helpers |
| `Backend/leaves/notifications.py` | Leave-specific notification helpers |
| `Backend/employees/notifications.py` | Document expiry WhatsApp helper |
| `Backend/in_app_notifications/dispatcher.py` | Persists notifications/deliveries and queues WhatsApp after commit |
| `Backend/in_app_notifications/tasks.py` | Celery WhatsApp delivery, email fallback, retries, and cleanup task |
| `Backend/config/worker_readiness.py` | Bounded Redis/Evolution readiness gate before Celery starts |

## Email

- `EmailService.send_html_email(...)` returns `{"success": bool, "provider": "bird", "status_code": int, "message_id": str, "error": str}`.
- Bird remains valid for email only.
- Email helpers may embed/upload media and retry without inline logo when payloads are too large.

## WhatsApp

- Use `WhatsAppService().send_template_message(...)`.
- Provider responses must use `provider: "evolution_whatsapp"`.
- Templates are rendered as bilingual plain text by `render_template_message()` in `Backend/core/services/messaging_providers.py`.
- Template text must be Arabic first, English second.
- Phone numbers are normalized/validated as E.164. Missing or invalid phone numbers should skip or fail cleanly without blocking the workflow.

## WhatsApp Template Registry

| Template key | Variables | Event |
|---|---|---|
| `pending_approval` | approver_name, request_type, request_id, requester_name, status_label, details, action_url | Next approver notification |
| `request_status_update` | employee_name, request_type, request_id, status_label, reason, details, action_url | Final decision/status update |
| `leave_request_submitted_v1` | manager_name, employee_name, leave_type, start_date, end_date, total_days | Leave submitted |
| `leave_request_approved_v1` | employee_name, leave_type, start_date, end_date, total_days | Leave approved |
| `leave_request_rejected_v1` | employee_name, leave_type, start_date, end_date, rejection_reason | Leave rejected |
| `leave_delegation_assigned_v1` | delegate_name, employee_name, leave_type, start_date, end_date, total_days | Leave delegation assigned |
| `document_expiry_reminder` | employee_name, document_type, expiry_date | Document expiry |
| `new_announcement_notification` | employee_name, announcement_title | Announcement |
| `meeting_notification_v1` | employee_name, meeting_title, meeting_date, meeting_time, organizer_name, google_meet_url, microsoft_teams_url, zoom_url | Meeting announcement |

Do not store Bird template `project_id` or `version_id` values in this registry.
Evolution sends rendered text, not Bird template IDs.

## Workflow Notifications

| Event | Email | WhatsApp |
|---|---|---|
| Pending approver | Bird fallback only | `pending_approval` through Evolution first |
| Generic final decision/status | Optional domain email | `request_status_update` through Evolution |
| Leave submitted | Bird fallback only | Leave template through Evolution first |
| Leave approved/rejected | Bird fallback only | Leave final-decision template through Evolution first |
| Leave delegation assigned | WhatsApp first; email fallback if WhatsApp does not send and email exists | `leave_delegation_assigned_v1` |
| Announcement/meeting | Email when enabled | WhatsApp through Evolution when publish-to-SMS/WhatsApp flag is enabled |
| Document expiry | Email when selected | WhatsApp through Evolution when selected |

## Required Environment Variables

```
BIRD_API_KEY
BIRD_WORKSPACE_ID
BIRD_EMAIL_CHANNEL_ID
BIRD_API_BASE_URL
DEFAULT_FROM_EMAIL

EVOLUTION_API_BASE_URL
EVOLUTION_API_KEY
EVOLUTION_INSTANCE_NAME

MESSAGING_SMS_PROVIDER=textbee
TEXTBEE_API_BASE_URL
TEXTBEE_API_KEY
TEXTBEE_DEVICE_ID

NOTIFICATION_HTTP_TIMEOUT_SECONDS
NOTIFICATION_DELIVERY_TIMEOUT_SECONDS
CELERY_BROKER_URL
CELERY_RESULT_BACKEND
NOTIFICATION_WORKER_READINESS_TIMEOUT_SECONDS
NOTIFICATION_WORKER_READINESS_INTERVAL_SECONDS
NOTIFICATION_WORKER_READINESS_REQUEST_TIMEOUT_SECONDS
```

## Recipient Resolution

- Next approvers are resolved by the workflow/domain helper:
  - `PENDING_MANAGER` -> direct manager
  - `PENDING_HR` -> HRManager/SystemAdmin groups
  - `PENDING_CEO` -> CEO approver users
- WhatsApp numbers come from `EmployeeProfile.mobile`.
- Provider calls run in the notification worker. Initial in-app delivery state is normally `pending`.
- Temporary failures retry up to three times with exponential backoff and jitter; invalid recipient data is skipped.
- Worker startup requires Redis and Evolution HTTP reachability when WhatsApp is enabled. A connected WhatsApp account is not
  required, and globally disabling WhatsApp skips Evolution readiness.

## Rules for New Notifications

- Call notification functions from views/services, not models or serializers.
- Always wrap notification calls in try/except.
- Never expose provider errors to API clients; log or summarize server-side.
- If `EmployeeProfile.mobile` is missing or invalid, skip WhatsApp silently or return a non-blocking failure result.
- Add new WhatsApp templates to `WHATSAPP_TEMPLATE_REGISTRY` and `EVOLUTION_TEMPLATE_RENDERERS`.
- Keep WhatsApp text Arabic first, English second.
- Do not reintroduce Bird WhatsApp provider paths or Bird WhatsApp env vars.

## Frontend Notification UI

- The persistent notification inbox uses authenticated REST polling; WebSocket delivery is deferred and every handshake is rejected with `4403`.
- Delivery status is read from the nested `deliveries` array; later worker outcomes are visible on REST refresh.
