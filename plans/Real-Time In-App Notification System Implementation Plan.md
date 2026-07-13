# Real-Time In-App Notification System — Backend Contract

Status: implemented (backend)

## Persistence

`in_app_notifications.Notification` stores one row per recipient and includes:

- `company`, `title`, `message`, `event_key`, `category`, and `action_url`
- `related_object_type` and `related_object_id`
- JSON `metadata`, `deduplication_key`, `read_at`, and `created_at`
- a conditional unique constraint on `(recipient, deduplication_key)` when the key is non-empty

Records are always recipient-owned. REST lists and write actions are additionally scoped to the active company from
`x-active-company-id`; global (`company = null`) notifications remain visible to their recipient. Head-office context includes
the recipient's accessible companies.

## REST API

All routes require the existing JWT authentication and return the standard `{status, data, message?}` envelope.

### `GET /api/notifications/`

Query parameters: `page`, `page_size`, optional `unread=true|false`, and optional `category`.

```json
{
  "status": "success",
  "data": {
    "items": [{
      "id": 42,
      "title": "Leave request approved",
      "message": "Your leave request #17 was approved.",
      "event_key": "leave.approved",
      "category": "leave",
      "action_url": "/employee/leave/requests",
      "related_object_type": "leaves.leaverequest",
      "related_object_id": "17",
      "metadata": {},
      "deduplication_key": "leave.approved:17",
      "is_read": false,
      "read_at": null,
      "created_at": "2026-07-11T12:00:00Z",
      "deliveries": [{
        "channel": "whatsapp",
        "status": "failed",
        "provider": "evolution_whatsapp",
        "provider_message_id": "",
        "error": "Evolution WhatsApp provider is unavailable.",
        "attempt_count": 1,
        "created_at": "2026-07-11T12:00:00Z",
        "updated_at": "2026-07-11T12:00:01Z"
      }, {
        "channel": "email",
        "status": "sent",
        "provider": "bird",
        "provider_message_id": "email-message-id",
        "error": null,
        "attempt_count": 1,
        "created_at": "2026-07-11T12:00:01Z",
        "updated_at": "2026-07-11T12:00:02Z"
      }]
    }],
    "page": 1,
    "page_size": 25,
    "count": 1,
    "total_pages": 1
  }
}
```

### `GET /api/notifications/unread-count/`

Returns `data.unread_count` for the authenticated recipient and active company scope.

### `POST /api/notifications/{id}/read/`

Idempotently sets `read_at`. Returns the serialized notification and the remaining `unread_count`. A notification owned by
another user or outside the active company scope returns 404.

### `POST /api/notifications/read-all/`

Marks all unread notifications in the current recipient/company scope as read. Returns `updated_count` and
`unread_count: 0`.

## WebSocket API

Endpoint: `ws(s)://<backend>/ws/notifications/`

Authentication uses either the existing Django session cookie or an access JWT supplied as:

- `?access_token=<JWT>` (preferred for browser clients)
- `?token=<JWT>` (compatibility alias)
- `Authorization: Bearer <JWT>` where the WebSocket client can set headers

Unauthenticated/invalid connections are rejected before acceptance (the ASGI consumer uses code `4401`; Daphne exposes the
pre-accept rejection as an HTTP 403 handshake response). Each accepted socket joins only
`notifications.user.<authenticated_user_id>`.

Created event:

```json
{
  "type": "notification.created",
  "notification": {
    "id": 42,
    "event_key": "leave.approved",
    "deliveries": [{ "channel": "whatsapp", "status": "pending" }]
  },
  "unread_count": 3
}
```

Redis is the production channel layer (`REDIS_URL`, default `redis://localhost:6379/0`). WebSocket delivery failures are
logged and never roll back the persisted notification or block the originating workflow.

## Workflow coverage

In-app events are emitted from service/view orchestration points—not models or serializers—for pending approvals, request
submissions and status changes, leave decisions/delegates, generic workflow delegations, announcements, meetings, document
expiry, accepted invites, generated payslips, and rent reminders. These seams cover existing leave, loan, assets, attendance,
employee approvals, payroll, and other outbound-notification call sites with valid user recipients. Existing email, Evolution
WhatsApp, and TextBee SMS calls retain their prior ordering and non-blocking behavior.

## Operations

- Apply migration: `python manage.py migrate`
- Cleanup preview: `python manage.py cleanup_notifications --dry-run`
- Delete records older than 90 days: `python manage.py cleanup_notifications`
- Optional retention override: `python manage.py cleanup_notifications --days <positive integer>`

Docker Compose provides `ffi_hr_redis`, supplies `REDIS_URL` to Daphne, and starts the separate
`ffi_hr_notification_worker` Celery service against Redis databases 2 (broker) and 3 (result backend).

## WhatsApp-first external delivery

Eligible notifications with a valid user recipient are routed through
`in_app_notifications.dispatcher.dispatch_notification_channels()`:

1. Persist or reuse the deduplicated in-app `Notification`.
2. Create or reuse the unique pending WhatsApp delivery row.
3. After the database transaction commits, queue `deliver_whatsapp_notification`; the business request returns without an
   Evolution or Bird HTTP call.
4. The worker reloads the notification and recipient, then sends through Evolution using a dedicated bilingual template
   where available, otherwise Arabic-first generic text.
5. Only after WhatsApp definitively fails or is skipped does the worker queue `deliver_email_notification` for Bird.
6. Never queue email after a successful or still-pending WhatsApp attempt.
7. Record provider, provider message ID, status, privacy-safe error, and attempt count without failing the business workflow.

`NotificationDelivery` has one row per `(notification, channel)` and statuses `pending`, `sent`, `failed`, and `skipped`.
This constraint, together with the notification's recipient-scoped deduplication key, row locking, and the comparison between
stored attempts and the Celery retry number, makes repeated workflow callbacks/tasks idempotent. A sent or terminal delivery
is never resent. Temporary network/provider failures retry with exponential backoff and jitter up to three retries (four
total attempts); permanent 4xx/configuration/validation failures do not retry. A definitive WhatsApp failure queues one email
fallback, whose task applies the same sent/terminal guards.

Delivery tracking is exposed as the read-only nested `deliveries` field on notification list, mark-read, and
`notification.created` WebSocket payloads. There is no standalone delivery endpoint. Stored statuses are returned unchanged:
`pending`, `sent`, `failed`, and `skipped`. Entries are ordered WhatsApp first and email second, then by creation time.

Delivery records remain company- and recipient-isolated through the parent notification query. Provider credentials, raw
payloads, full phone numbers, multiline traces, and authorization tokens are never serialized. The public `error` value is a
single privacy-filtered line; it is `null` when no error was stored.

### Channel configuration

```text
NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=true
NOTIFICATION_EMAIL_FALLBACK_ENABLED=true
NOTIFICATION_DELIVERY_TIMEOUT_SECONDS=10
```

The existing `NOTIFICATION_HTTP_TIMEOUT_SECONDS` is used when the delivery-specific timeout is absent. A user preference at
scope `notifications`, key `channels`, may contain `whatsapp_enabled` and `email_enabled` booleans. A disabled WhatsApp channel
is recorded as skipped and proceeds to email; a disabled email channel is recorded as skipped.

Pre-account invitation transport remains on the existing invite provider path because an invitee does not yet have a user
that can own an in-app notification. The post-acceptance welcome notification uses the centralized dispatcher.

### Celery configuration and operations

```text
CELERY_BROKER_URL=redis://redis:6379/2
CELERY_RESULT_BACKEND=redis://redis:6379/3
CELERY_TASK_ALWAYS_EAGER=false
CELERY_TASK_ACKS_LATE=true
CELERY_TASK_REJECT_ON_WORKER_LOST=true
CELERY_TASK_TRACK_STARTED=true
NOTIFICATION_DELIVERY_MAX_RETRIES=3
NOTIFICATION_DELIVERY_RETRY_BACKOFF_SECONDS=2
```

Start a worker with `celery -A config worker --loglevel=INFO`, or use the `notification-worker` Compose service. A pending
delivery with no corresponding worker activity indicates broker/worker unavailability; inspect the worker logs and Redis
health, then safely redispatch the same deduplication key. Provider timeouts are bounded by
`NOTIFICATION_DELIVERY_TIMEOUT_SECONDS`.

Before Celery starts, `config.worker_readiness` verifies that the broker/result Redis hostname resolves and accepts `PING`.
When `NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=true`, it also resolves and performs a credential-free HTTP request against the
configured `EVOLUTION_API_BASE_URL`. HTTP/API readiness is separate from WhatsApp instance connection state. Bundled Compose
Evolution has an equivalent root-endpoint health check; external Evolution URLs work without a hard-coded container hostname.

```text
NOTIFICATION_WORKER_READINESS_TIMEOUT_SECONDS=60
NOTIFICATION_WORKER_READINESS_INTERVAL_SECONDS=2
NOTIFICATION_WORKER_READINESS_REQUEST_TIMEOUT_SECONDS=5
```

On timeout the worker exits non-zero with a sanitized hostname-level error. Set
`NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=false` to intentionally run without Evolution. Troubleshoot with
`docker compose ps`, `docker compose logs notification-worker`, and `docker compose logs evolution-api`.

The existing cleanup command remains authoritative. For a daily cron/beat schedule, invoke either
`python manage.py cleanup_notifications` or the safe Celery task
`celery -A config call in_app_notifications.tasks.cleanup_expired_notifications --args='[90]'`. Notification deletion
cascades to its delivery audit rows only after the configured retention period.

Production should normally run `python manage.py cleanup_notifications` once daily through the deployment's existing cron or
task scheduler; a second scheduler is not required.

## Security visibility and WhatsApp administration

Delivery visibility is enforced server-side for notification list, mark-read, and `notification.created` WebSocket
payloads. `SystemAdmin` and `HRManager` receive the full delivery audit shape. `Employee`, `Manager`, `CEO`, and `CFO`
retain the additive `deliveries` array but receive only `channel` and `status`; provider, provider message ID, error, attempt
count, and delivery timestamps are omitted. WebSocket serialization uses the recipient's server-resolved role.

WhatsApp template list, detail/update, reset, and preview retain their existing `SystemAdmin` or `HRManager` permission.
Live template test sending (`POST /api/core/whatsapp-templates/{key}/test/`) requires both authentication and `SystemAdmin`.
Authorization runs before any provider call.

WhatsApp integration endpoints expose only allowlisted operational fields such as `connected`, `connection_state`,
`provider_status_code`, and `qr_available` (plus the QR value required by the connect/QR workflow). Raw provider responses
and exception details remain server-side in logs and are never copied into API responses.
