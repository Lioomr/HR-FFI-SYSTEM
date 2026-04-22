# Payroll Processing Skill

Use when working with payroll runs, payslips, or payroll-related employee data.

## PayrollRun Status Machine

```
DRAFT → COMPLETED → PAID
              ↓
          CANCELLED
```

- `DRAFT`: being configured, items can be edited.
- `COMPLETED`: locked, payslips generated. No item edits.
- `PAID`: disbursed, final state.
- `CANCELLED`: voided from COMPLETED (not from PAID).

Status transitions must be validated server-side — never let clients set `status` directly. Use dedicated actions:
- `POST /payroll-runs/<id>/complete/`
- `POST /payroll-runs/<id>/mark-paid/`
- `POST /payroll-runs/<id>/cancel/`

## Audit Requirements

Every status transition emits an `AuditLog`:
- `payroll_run_created`
- `payroll_finalized` (DRAFT → COMPLETED)
- `payroll_cancelled`
- `payslip_viewed` (when an employee opens their payslip)

## Company Scoping

`PayrollRun` and `Payslip` carry `company` FK. Filter with `filter_queryset_by_company_scope`. HR can only process payroll for their accessible companies.

## Throttling

`PayrollThrottle` is applied to payroll run operations — do not remove or bypass.

## Export Formats

Payroll runs support export in CSV, XLSX, and PDF. Use `core/exporting.py` helpers. PDF generation for individual payslips is a separate action.

## Frontend Patterns

- `PayrollDashboardPage` lists runs with status badges and filter by period/status.
- `CreatePayrollRunPage` — select company, period; system pre-fills employees.
- `PayrollRunDetailsPage` — shows run items, allows edits in DRAFT, shows action buttons per status.
- After status transition, re-fetch the run to reflect new state.
- Disable action buttons based on current status (Complete disabled if not DRAFT, etc.).

## Integration with Loans

Loan installments may be deducted from payroll. When finalizing a payroll run, check `LoanRequest` installment schedule for the period and include deductions in `PayrollRunItem`.

## Checklist

- [ ] Status transitions validated server-side with correct permission class (`IsHRManagerOrAdmin`).
- [ ] Each transition emits `AuditLog`.
- [ ] `company` scope applied to all querysets.
- [ ] Loan deductions included in payroll items where applicable.
- [ ] PayrollThrottle applied on run operations.
- [ ] Frontend disables actions based on current status.
- [ ] PDF/CSV/XLSX export available on completed runs.
