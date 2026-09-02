# Contract Expiry Deployment Runbook

## Preconditions

- Deploy from a clean release checkout containing the contract-expiry code and migrations.
- Confirm `DJANGO_DEBUG=false`, `SECURE_SSL_REDIRECT=true`, the database settings, `FRONTEND_URL`, Celery Redis settings, and the Evolution/Bird notification settings.
- Confirm the worker and `celery-beat` services are separate. Do not run Celery beat inside the worker container.
- Take a PostgreSQL backup and record the backup identifier before applying migrations.

## Deploy

```bash
cd Backend
python manage.py migrate --plan
python manage.py migrate --noinput
python manage.py check --deploy
```

Restart the backend, notification worker, and Celery beat after the migration. Confirm the scheduled task is registered:

```bash
docker compose ps backend notification-worker celery-beat
celery -A config inspect registered | grep process_contract_expiry_notifications
celery -A config inspect ping
```

The backend, notification worker, and Celery beat services must report
`healthy`. Celery beat has a process-liveness healthcheck; worker `inspect ping`
proves that the broker-connected worker is responding.

Run one controlled staging invocation and verify the returned summary contains `milestones`, `ceo_reminders`, `auto_approved`, `auto_renewed`, `renewal_failures`, `manual_resolutions`, `profile_failures`, and `notification_failures`.

## Monitoring and alerts

Create alerts for:

- `contract_expiry_scheduler_requires_attention` at any occurrence.
- `contract_expiry_scheduler_completed` missing for more than two hours.
- Celery task retries or a task in `FAILURE` state for `employees.tasks.process_contract_expiry_notifications`.
- `notification_whatsapp_delivery_failed_terminal`, `notification_email_delivery_failed_terminal`, and notification queue failures.
- Any `AUTO_RENEWAL_FAILED` or `MANUAL_RESOLUTION_REQUIRED` decision.

The scheduler logs a structured summary on every successful run. The task retries database/connection failures up to three times with backoff; record exhausted retries as an operational incident.

## Safe pause

Pause only the scheduler when investigating contract processing:

```bash
docker compose stop celery-beat
```

Keep the notification worker running so already-persisted notification deliveries can retry. Resume with:

```bash
docker compose start celery-beat
```

## Rollback and recovery

1. Stop `celery-beat` before rolling back application code to prevent new contract decisions during the change.
2. Keep the database backup and inspect `ContractDecision` rows in `AUTO_RENEWED`, `AUTO_APPROVED`, `AUTO_RENEWAL_FAILED`, or `MANUAL_RESOLUTION_REQUIRED` states.
3. Prefer rolling forward with a corrective application release. The contract migrations add tables/columns and do not delete existing employee data.
4. Do not reverse migration `0019_contractdecision_automatic_renewal_metadata` in production unless the two automatic-renewal metadata columns have been exported; reversing it loses those fields.
5. If a full database restore is required, restore to a new PostgreSQL instance first, validate employee contract dates and decision records, then switch the application connection only after verification.
6. Restart the backend and worker, run `migrate --plan` and `check --deploy`, then resume `celery-beat`.

## Test commands

```bash
cd Backend
pytest employees/test_contract_expiry.py
python manage.py check
python manage.py makemigrations --check --dry-run
cd ../FrontEnd
npm run type-check
npm run lint
npm run build
```

For local tests with production HTTPS redirect enabled, send test requests with an HTTPS test scheme or set `SECURE_SSL_REDIRECT=false` only in the test environment. Never disable it in production.
