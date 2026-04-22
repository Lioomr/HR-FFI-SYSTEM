# Leave Management Skill

Use when working with leave types, requests, balances, carry-over, or the leave approval chain.

## Key Files

| File | Purpose |
|---|---|
| `Backend/leaves/models.py` | LeaveType, LeaveRequest, LeaveBalanceSnapshot, LeaveBalanceAdjustment |
| `Backend/leaves/utils.py` | `calculate_leave_balance()`, `validate_leave_request_policy()`, `get_used_days_for_type()` |
| `Backend/leaves/views.py` | ViewSets for each actor role (Employee, Manager, HR, CEO) |
| `Backend/leaves/serializers.py` | Create/read/action serializers |
| `Backend/leaves/notifications.py` | Leave-specific notification helpers |

## LeaveRequest Status Machine

```
submitted → pending_manager → pending_hr → [pending_ceo →] approved
                ↓                 ↓              ↓
            rejected          rejected        rejected
                                         (cancelled by employee, any pending stage)
```

- `hr_manual` source: auto-approved on creation (no approval chain).
- `requires_ceo_approval` on `LeaveType` gates the `pending_ceo` stage.
- No direct status writes from clients — only via approve/reject actions.

## Approval Chain (views.py)

| Actor | ViewSet | Handled statuses | Next status |
|---|---|---|---|
| Manager | `ManagerLeaveRequestViewSet` | `submitted`, `pending_manager` | `pending_hr` |
| HR | `LeaveRequestViewSet` | `submitted`, `pending_hr` | `pending_ceo` or `approved` |
| CEO | `CEOLeaveRequestViewSet` | `pending_ceo` only | `approved` |

Initial status on creation (`perform_create`):
- Employee has manager → `pending_manager`
- Employee is HRManager → `pending_ceo`
- Otherwise → `pending_hr`

## Balance Calculation (`leaves/utils.py`)

**Function**: `calculate_leave_balance(user, year, profile=None)`

Formula per leave type:
```
remaining = opening_balance + annual_quota + adjustments - used_days
```

**Opening balance (carry-over)**:
- Only if `LeaveType.allow_carry_over = True` and `year > hire_year`
- Recursively calculates previous year's remaining
- Capped by `LeaveType.max_carry_over` (null = unlimited)

**Service length tiers (Annual Leave)**:
- < 1 year service: Proportional up to 21 days
- 1–5 years: 21 days
- ≥ 5 years: 30 days

**Used days**: `get_used_days_for_type()` sums approved requests in the year, accounting for official holidays (Feb 22, Sep 23 excluded).

**Emergency Leave**: deducted from the employee's remaining Annual Leave balance — not an independent quota.

## Leave Type Policy Defaults

| Code | Days | Paid | Carry-over | Notes |
|---|---|---|---|---|
| ANNUAL | 21–30 (service-based) | Yes | Configurable | Prorated first year; emergency deducted here |
| SICK | 120 | Tiered (100%/50%/0%) | No | Requires attachment; 30/30/60 day pay tiers |
| EMERGENCY | 10 | Yes | No | Deducted from ANNUAL balance |
| UNPAID | 60 | No | No | Annual overflow flows here |
| MARRIAGE | 5 | Yes | No | Once per lifetime |
| DEATH | 5 | Yes | No | Bereavement |
| BIRTH | 3 | Yes | No | |
| MATERNITY | Configurable | Yes | No | Extension: +30 days unpaid if "extension" in reason |

## Policy Validation (`validate_leave_request_policy`)

Called in `LeaveRequestCreateSerializer.validate()`. Checks:
- Start date ≤ end date, at least 1 day
- Annual: 6-month service requirement, sufficient balance
- Emergency: sufficient annual balance remaining
- Sick: document required, ≤ 120 days/year
- Unpaid: ≤ 60 days/year
- Marriage: only once per service lifetime
- Death: ≤ 5 days, Birth: ≤ 3 days
- Maternity extension: "extension" in reason, ≤ 30 days

## Balance Snapshot (`LeaveBalanceSnapshot`)

Cached balance for performance. Fields: `employee_profile`, `leave_type`, `year`, `opening_balance`, `used`, `remaining`, `calculated_at`. Invalidated on leave approval/rejection.

## Manual Adjustments (`LeaveBalanceAdjustment`)

HR can add/subtract days. Fields: `adjustment_days` (positive or negative), `reason`, `created_by`. Included in `calculate_leave_balance`.

## Notifications (on every status change)

- Submitted → WhatsApp to manager + email to employee (see `context/notifications.md`)
- Approved → WhatsApp to employee
- Rejected → WhatsApp + email to employee
- Moved to PENDING_HR / PENDING_CEO → email to next approvers

Always wrap notification calls in try/except — never let a failed notification block the approval action.

## Frontend Checklist

- [ ] `RequestLeavePage`: load leave types, show available balance, validate overlap client-side, enforce `requires_attachment` hint.
- [ ] Balance display: use `leaveApi.getMyBalance(year)` — never calculate client-side.
- [ ] Inbox pages: filter by `status=pending_<role>` for the current user's role.
- [ ] After approve/reject: re-fetch the request to reflect updated status.
- [ ] Show full approval history (manager/HR/CEO decisions) in the detail view.
- [ ] `HrLeaveBalancesPage`: search by employee + year, show per-type breakdown.
- [ ] Handle `cancelled` state — employee can cancel their own pending request.

## Tests to Write

- Balance calculation: correct quota per service length, carry-over respects max.
- Policy validation: reject invalid ranges, enforce once-per-lifetime (marriage), document required (sick).
- Approval chain: each actor can only act on their stage; wrong-stage actors get 403.
- CEO stage gating: only triggered when `requires_ceo_approval = True`.
- HR manual entry: auto-approved, no notification chain.
