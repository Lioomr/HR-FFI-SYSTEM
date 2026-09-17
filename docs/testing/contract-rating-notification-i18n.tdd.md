# Contract-rating notification translation - TDD evidence

Source plan: no plan was supplied. The journey was derived from the Arabic CEO dashboard showing the English contract-rating notification, `Contract Rating: Opened`.

## User journey

As an Arabic-interface recipient, I receive a contract-rating notification in Arabic so I can understand the required action without switching languages.

## Results

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A contract-rating event has a human Arabic label. | `NotificationCatalogTests.test_contract_rating_event_uses_a_human_arabic_label` | Unit | PASS |
| 2 | Historical `contract.rating` rows with the standard opened message are translated when read in Arabic. | `LegacyNotificationTranslationTests.test_legacy_contract_rating_notification_is_translated` | Unit | PASS |
| 3 | The complete notification catalog keeps matching English and Arabic placeholders. | `NotificationCatalogTests.test_every_message_has_english_and_arabic_with_the_same_placeholders` | Unit | PASS |

RED command:

```text
docker compose -f docker-compose.dev.yml run --rm --build backend python manage.py test in_app_notifications.test_i18n --keepdb
```

The added test failed at import time because `contract_rating_event_label` did not exist.

GREEN command:

```text
docker compose -f docker-compose.dev.yml run --rm --build backend python manage.py test in_app_notifications.test_i18n --keepdb
```

Result: `Ran 15 tests ... OK`.

## Coverage and known gaps

Coverage was attempted with the same container image, but its `coverage` executable is not installed (`sh: 1: coverage: not found`). No coverage percentage is claimed. Entered free-text reasons/comments intentionally remain exactly as written because the system cannot safely translate arbitrary user-authored content.

## Checkpoints

- RED: `ca45016f test: reproduce contract rating notification translation`
- GREEN: `7194f6a4 fix: translate contract rating notifications`
