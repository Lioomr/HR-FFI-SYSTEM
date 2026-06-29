# Loan Management Skill

Use when working with loan requests, approval stages, disbursement, or payroll deduction.

## Key Files

| File | Purpose |
|---|---|
| `Backend/loans/models.py` | LoanRequest, LoanWorkflowConfig |
| `Backend/loans/views.py` | ViewSets per actor (Employee, Manager, HR, CFO, CEO, Finance) |
| `Backend/loans/serializers.py` | Create/read/action serializers |

## Loan PDF Download

Before changing loan PDF generation, read `.agents/context/pdf_template_library.md`.

Current rule: `_build_loan_request_pdf` must use `loan_request_blank.pdf` from the HR template library (`/hr/templates` in production, bundled fallback in `Backend/static/pdf_templates`) and overlay values onto the original blank form. Keep `_build_loan_request_pdf_fallback` only for missing-template fallback.

Regression check:
`docker exec ffi_hr_backend pytest loans/tests_pdf.py -q`

## LoanRequest Status Machine

```
submitted
  ↓ (if require_manager_stage)
pending_manager ──reject──→ rejected
  ↓ approve
pending_hr ──────────────→ always routes to CFO (with recommendation)
  ↓
pending_cfo ─────reject───→ rejected
  ↓ approve              ↓ refer_to_ceo
pending_disbursement    pending_ceo ──reject──→ rejected
  ↓ mark_disbursed         ↓ approve
approved              pending_disbursement
                           ↓ mark_disbursed
                         approved
                         → deducted (after payroll run)
```

`cancelled` — employee cancels their own pending request (terminal)

## Initial Status Routing (`perform_create`)

| Employee type | Initial status |
|---|---|
| In `HRManager` group | `pending_ceo` |
| Has manager AND `require_manager_stage=True` | `pending_manager` |
| Otherwise | `pending_hr` |

## Approval Chain Per Role

| Actor | ViewSet | Acts on | Action → Next status |
|---|---|---|---|
| Manager | `ManagerLoanRequestViewSet` | `pending_manager` | approve → `pending_hr` / reject → `pending_hr` (with REJECT recommendation) |
| HR/Finance | `LoanRequestViewSet` | `pending_hr`, `pending_finance` | approve → `pending_cfo` (APPROVE rec) / reject → `pending_cfo` (REJECT rec) |
| CFO | `CFOLoanRequestViewSet` | `pending_cfo` | approve → `pending_disbursement` / reject → `rejected` / refer_to_ceo → `pending_ceo` |
| CEO | `CEOLoanRequestViewSet` | `pending_ceo` | approve → `pending_disbursement` / reject → `rejected` |
| Finance | `DisbursementLoanRequestViewSet` | `pending_disbursement` | mark_disbursed → `approved` |

**Note:** HR never terminates a loan — it always forwards to CFO with a recommendation. The CFO or CEO makes the final decision.

## Loan Types & Validation Rules

**OPEN**:
- Can only be requested in last 10 days of the month
- Max amount: 25% of basic salary
- Deducted from current payroll run (or next if current is COMPLETED/PAID)
- No `installment_months`

**INSTALLMENT**:
- `installment_months`: 1–10 months
- Minimum 6 months service required
- Max amount: 1× basic salary
- Employee must have `hire_date` or `contract_date` set

## Decision Tracking Fields

| Stage | Fields set |
|---|---|
| Manager | `manager_decision_at`, `manager_decision_by`, `manager_decision_note`, `manager_recommendation` |
| HR | `finance_decision_at`, `finance_decision_by`, `finance_decision_note`, `hr_recommendation` |
| CFO | `cfo_decision_at`, `cfo_decision_by`, `cfo_decision_note`, `approved_amount`, `approved_year/month`, `target_deduction_year/month` |
| CEO | `ceo_decision_at`, `ceo_decision_by`, `ceo_decision_note` + same approval fields |
| Finance | `disbursed_at`, `disbursed_by`, `disbursement_note` |

## Payroll Deduction Integration

- CFO/CEO approval sets `target_deduction_year` and `target_deduction_month`
- After disbursement, payroll run marks the loan with `deducted_amount` and `deduction_payroll_run` FK
- Loan status transitions to `deducted` after payroll deduction
- Open loans defer deduction to next month if current payroll is already `COMPLETED` or `PAID`
- There is no separate installment table — installments are tracked via `installment_months` field only

## LoanWorkflowConfig (Singleton)

Configuration in `LoanWorkflowConfig`:
- `require_manager_stage` (default: True) — whether Manager stage is included
- `finance_department_id`, `finance_position_id` — who counts as HR/Finance approver
- `cfo_position_id`, `ceo_position_id` — position-based CFO/CEO resolution

## Notifications

- Submit → employee notified; next approver (manager/HR/CEO) notified
- Manager approve/reject → HR notified
- HR forward → CFO notified
- CFO approve → Finance/disbursement notified
- CFO refer_to_ceo → CEO notified
- CEO approve → Finance/disbursement notified
- All via `notify_users_for_pending_status()` from `core.services`

## Security Rules

- Only the requesting employee can cancel their own loan
- HR recommendation is informational — CFO makes the binding decision
- `approved_amount` is set by CFO/CEO, not by the employee's `requested_amount`
- Status transitions must be server-side only — never let clients write `status` directly
- Emit `AuditLog` at each stage transition

## Checklist

- [ ] Initial routing respects `require_manager_stage` from `LoanWorkflowConfig`
- [ ] Loan type validation enforced in serializer (last-10-days for OPEN, 6-month tenure for INSTALLMENT)
- [ ] `approved_amount` set by CFO/CEO (not passed by client)
- [ ] Deduction targets calculated based on loan type and current payroll state
- [ ] Each stage transition emits `AuditLog`
- [ ] Notifications sent to next approver at each stage
- [ ] Frontend loan inbox pages filter by `status=pending_<role>` for the current user's role
- [ ] Disbursement action restricted to Finance role only
