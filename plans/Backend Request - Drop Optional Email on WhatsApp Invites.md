# Backend request: drop the optional `email` on WhatsApp invite creation

**Status:** requested by HR/frontend
**Affects:** `POST /invites/` (`Backend/invites/serializers.py::InviteCreateSerializer`, `Backend/invites/views.py::InvitesView.post`)
**Frontend state:** already shipped — the WhatsApp send form no longer renders an email field and never sends `email` on a WhatsApp payload.

---

## What changed on the frontend

The "Employee email (optional)" field was removed from the WhatsApp branch of the HR
invite form. HR found it low value: the employee supplies their own email during
signup anyway, and an optional field that HR usually skips is just noise on the form.

The WhatsApp create payload is now exactly:

```json
{ "channel": "whatsapp", "phone_number": "+966512345678", "role": "Employee" }
```

The email-channel payload is unchanged:

```json
{ "channel": "email", "email": "name@company.com", "role": "Employee" }
```

## What we would like changed on the backend

Reject `email` on WhatsApp invite creation instead of accepting and storing it.

1. In `InviteCreateSerializer.validate`, when `channel == Invite.Channel.WHATSAPP` and a
   non-empty `email` was supplied, raise:

   ```python
   {"email": ["Email is not accepted for WhatsApp invites. The employee provides it during signup."]}
   ```

   Do not silently drop it — a silent drop hides an integration bug from any caller
   that is still sending the field.

2. Leave `attrs["email"] = None` for WhatsApp invites (current behavior when absent).

3. Keep everything else exactly as-is. Specifically **do not** touch:
   - The accept flow writing the employee's email onto the invite
     (`Backend/invites/views.py` lines ~594-600: `if not invite.email: invite.email = email`).
     This is what makes the address show up on the HR Invites table after signup, and
     the frontend depends on it.
   - `InviteSerializer.email` in the list/detail response. WhatsApp rows legitimately
     carry an email *after* acceptance and the HR table renders it as a secondary line.
   - The email-channel path, where `email` stays required.

## Rollout order

The frontend change is already live, so it never sends the field. That means the
backend change is non-breaking and can go out whenever convenient. If any other client
(mobile, scripts, Postman collections) still posts `email` alongside `channel=whatsapp`,
it will start receiving a 422 — worth a quick grep before merging.

## Tests to add

In `Backend/invites/tests.py`:

- `POST /invites/` with `channel=whatsapp`, a valid `phone_number`, and an `email`
  returns **422** with the `email` key in the error body.
- `POST /invites/` with `channel=whatsapp` and no `email` still returns **201** and
  stores `invite.email is None`.
- The accept flow still backfills `invite.email` for a WhatsApp invite (regression
  guard for the behavior in point 3).

## Note on SQL injection hardening

While auditing the frontend for injection surface I grepped the whole backend for raw
SQL — `.raw(`, `.extra(`, `cursor.execute`, `RawSQL` — and found **zero occurrences**.
Every query goes through the Django ORM, which parameterizes. That is the actual
protection and it is currently correct.

The ask is only to keep it that way: if a future report or dashboard needs raw SQL,
use `cursor.execute(sql, params)` with placeholders and never f-strings or `%`
formatting on request data.
