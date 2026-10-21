# Payroll Rebuild API Contract

Version: 0.8.0. Date: 2026-10-21 (Africa/Cairo). Delivery: **Phase 2 implemented; inclusive payroll date ranges added**.

**Status: v0.3.0 was approved; the user authorized Phase 1 and then instructed “continue with phase 2”.** Phase 2 wires the transactional writer, source/carry/loan lifecycle, approved endpoints, employee itemized JSON/PDF, HR exports and integration/security tests. Provision proration remains FULL_MONTH by default, configurable and snapshotted. CFO remains in the single PAYROLL_MANAGER_ROLES constant. The original task ended at the Phase 2 handoff and did not authorize Phase 3. This is historical task scope, not a standing limit on later user-authorized work. Contract changes in this version are listed below and in the Phase 2 handoff.


## 1. Authority, scope and verified baseline

Scope is `Backend/` and this contract/route matrix in `plans/`. No edits to `FrontEnd/` or `MobileApp/`, no commit/push, no production operations. Phase 0 changed documentation only. Phase 1 code changes were rebuilt through the approved local Docker wrapper for backend, notification-worker and celery-beat. Source observations in the baseline table below describe the pre-rebuild implementation; Phase 1 historical evidence and Phase 2 delivery are in section 11.

Read: root `AGENTS.md`; `.agents/context/INDEX.md`, `system_map.md`, `database_schema.md`, `multi_company.md`, `audit_system.md`, `penalties.md`, `auth_and_permissions.md`, `i18n.md`, `testing_strategy.md`, `engineering_references.md`; `.agents/rules/backend_rules.md`, `api_conventions.md`; `.agents/skills/payroll_processing.md`; `.agents/tasks/backend_mvp_tasks.md`; `SECURITY_POLICY.md`; relevant portions of the mobile master plan, Global API Rules and route matrix.

Verified source: `Backend/config/urls.py`; `payroll/{models,serializers,views,urls,permissions,throttles,services}.py`; `penalties/{models,payroll,services}.py`; `loans/{models,services}.py`; employee, attendance, leave and rent models; rent routes; `organization/services.py`; `core/{permissions,pagination,responses,exceptions}.py`; `audit/utils.py`; relevant settings and payroll/security/penalty tests. This is a local-source inventory, not a claim that tests or live requests passed.

| Verified current behavior | Contract disposition |
|---|---|
| Payroll router is mounted at the root; rent router is `/api/hr/` | Retain `/payroll-runs/`, `/employee/payslips/`; new payroll resources also root-mounted. Assignment resource belongs to payroll and references existing `/api/hr/rents/`. No invented `/api/payroll/` family. |
| Run year/month are persisted | New runs persist required inclusive `period_start`/`period_end`, may cross month/year boundaries, and contain at most 30 days. Compatibility year/month use the period-end month and `calendar_days` is the inclusive length. Historical full-month rows are backfilled to actual month dates with `LEGACY_FULL_MONTH`, retaining prior 30-day calculation semantics. |
| Run access is `IsAuthenticated` + `employees.permissions.IsHRManagerOrAdmin` | Proposed payroll permission adds existing `CFO` role; no new finance role. |
| Lists use `StandardPagination`, `data.items`, default 25 | Retain exact envelope; never return DRF `results/next/previous`. |
| Payslip user FK is mandatory; no payslip for an employee without a login | Add profile and item links, allow null user, one payslip per included employee; accountless records remain HR-only. |
| Payslip starts PAID even for DRAFT | New payslip status follows run status; DRAFT remains employee-invisible. |
| Immediate full loan deduction in DRAFT, first due approved loan only | Preserve existing full-loan selector and `apply_payroll_deduction`; unaffordable loan stays approved, with no partial deduction or new instalment schedule. Cancel restores its recorded previous state. |
| Both penalty syncs independently write item/payslip/run monetary deltas | One calculator and one transactional persistence path replace duplicate arithmetic; preserve claim identity, locking and idempotency. |
| Article 70 cap reads nullable `profile.total_salary` | Use calculated, earned run gross / 30 x 5; shared fine budget for both claim sources. |
| Penalty claims can contain disciplinary fine plus unworked wages | Preserve issued amounts/evidence; expose separate lines and prevent same-date wage double charging. |
| XLSX export converts money to float | Remove that conversion in Phase 2; export Decimal-derived whole-riyal integers or exact decimal text. |

The payroll skill's `/complete/`, `/mark-paid/`, COMPLETED cancellation, and loan schedule examples are stale or conflict with this request. They are not added. `finalize`, `generate-payslips`, and **DRAFT-only cancellation** are the contract. The database context's claimed direct payslip-item link was absent in the Phase 0 baseline; Phase 1 adds that nullable link without wiring new endpoint behavior.

## 2. Calculation and lifecycle rules

### 2.1 Monetary rules and salary bases

All input/calculation money uses `Decimal`, never binary float. API money is **a JSON string with two fractional digits**, e.g. `"733.00"`; new posted lines are whole riyals even though the wire format retains `.00`. Monetary inputs may contain halalas. IDs, counts, months and revisions are JSON integers; day/hour quantities are decimal strings with up to two fractional digits; booleans are JSON booleans. Reject numeric JSON values for new decimal inputs, nonfinite values, negative inputs, exponents and formulas. Existing requests have no money input to break.

Calculate without rounding daily/hourly rates; apply `ROUND_HALF_UP` to **each final money line** at one riyal. Sum rounded lines for all payroll totals. Do not round a subtotal independently or round a daily rent share before summing it. Salary components remain distinct: Basic, Housing (`accommodation_allowance`), Transportation, Telephone, Petrol, Other Allowance. Housing is a salary component; rent is a separate company cost.

Salary base selections are fixed enums, never formulas. Resolve against the **full monthly contractual components**, except Article 70, which explicitly uses **earned run gross**. `FIXED_AMOUNT` has a nonnegative monthly `fixed_amount`; other selectors require `fixed_amount: null`. Defaults: absence GROSS, GOSI BASIC_HOUSING, leave BASIC, EOS BASIC, overtime BASIC. BASIC overtime and the once-per-payroll-window period for the normal-overtime hours limit are labelled assumptions in settings and the response. Provision proration is configurable, with FULL_MONTH as the default. HR's later statement that absence uses full monthly gross resolves the proration question; the company absence selector remains configurable as originally required, with GROSS default.

Gross paid = sum of independently rounded, prorated salary component lines. `total_allowances` excludes Basic and includes the five allowance lines. Full monthly gross is a separate snapshot, not `EmployeeProfile.total_salary`. A mismatched/null profile total never drives pay or the fine cap; mismatches produce a warning.

### 2.2 Employment, attendance and leave

Use a 30-day divisor for every payroll window. A new explicit range earns its actual inclusive employed days, capped at 30; a 28-day February range therefore earns 28/30. Historical `LEGACY_FULL_MONTH` rows preserve the prior rule that a fully employed calendar month earns 30 salary days, including February. For an actual mid-window join/end, count dates inclusively within the employed interval and cap at 30. Store both actual employed dates/days and payable salary days.

An archive date is the inclusive last employed date. An archived employee before the month is excluded; an employee archived within the month is included up to that date; an archive date after the month permits historical inclusion. Read `archived_at` as a date in the configured application payroll timezone (existing Django TIME_ZONE, frozen with the run). Do not invent an end date from updated_at. ACTIVE profiles are included. Future hire_date after month end excludes a profile without a warning. PREHIRE profiles are excluded; if hire_date is on/before month end, emit blocking prehire_status_conflict. Non-archived SUSPENDED profiles are included, with blocking suspended_pay_decision_required until HR selects FULL_PAY or ZERO_PAY for this run; ZERO_PAY requires zero_salary_reason=suspended and an audit reason. Non-archived TERMINATED profiles lacking an end date are excluded with blocking terminated_without_end_date. Dated archival inclusion above remains the historical exception. An excluded profile can still be present in validation and the pre-go-live audit.

Missing hire_date does **not** abort draft generation: provisionally use full-month salary and under-five-year provisions, expose the assumption, and block finalize with `missing_hire_date`. HR fixes the actual profile and recalculates; no per-run hire-date override. An archived employee with no archived_at is excluded but appears in run validation as blocking `archived_without_date`. This report must include excluded employees, not just run items. Provide a one-time management command/report before go-live.

Count distinct employed dates from `AttendanceRecord.status = ABSENT`, union approved unpaid leave dates, minus approved paid leave dates and already withheld penalty-wage dates. Do not infer absence from a missing attendance row or infer confirmed zero absence from an unmapped employee having no ABSENT rows. Resolve leaves by employee_profile, with same-company legacy user-linked fallback; only approved active leaves affect pay. Paid leave is never absence. Keep the original evidence sets, union, exclusions and count in HR-only input snapshots. Known overlaps with penalty wage evidence are removed once, not once per penalty row. Use collected/applied wage evidence, not merely pending assessed wages, when subtracting previously withheld liability; within this run the selected whole penalty claim and its absence offset are calculated together so an unaffordable uncollected claim cannot erase payable absence. Missing historic wage-date evidence is a blocking reconciliation error rather than a guessed duplicate deduction.

Assess active BioTime mapping coverage over **every employed calendar date** in the payroll month, using the existing `attendance.biotime_policy` active-mapping rules and `BioTimeEmployeeMap.attendance_start_date` (null adds no start restriction). The map has no is_active column; do not invent one. `attendance/absence.py` generates ABSENT only for mapped employees from that start date. A missing or partially covering mapping emits one per-employee nonblocking `attendance_source_unavailable` warning for every included employee; no special exemption for site/visitor staff. Snapshot coverage, mapping start and uncovered dates. For those employees, HR supplies the total `absence_days_override`; retain any observed attendance/approved-leave evidence separately, but never present a zero-row result as confirmed zero. Without an override and with no known absent/unpaid dates, the draft effective absence is provisionally 0, with the warning visible; known approved unpaid leave remains chargeable under the existing rule. A manual total replaces, rather than adds to, the observed total and must preserve paid-leave protection and penalty-overlap exclusions.

Company setting `require_manual_absence_confirmation` defaults to false and is snapshotted. If true and coverage is unavailable, an explicit absence_days_override (including `"0.00"`) with reason is required before finalize: retain the coverage warning and add a blocking error using the **same** attendance_source_unavailable code with params.manual_confirmation_required=true. After confirmation the error clears but the source warning remains. This is a context-specific severity, not an additional validation code.

An HR absence-day override requires a reason, keeps original and new values, and is run-local. Recalculation preserves it until explicitly cleared. It cannot silently overwrite the attendance record or leave workflow.

Normal absence: full monthly selected base / 30 x effective absent days. Cap at the absence base and at pay actually earned for the month; cap at available nonnegative pay during collection. An employee earning 5,500 from monthly gross 11,000 with two absence days loses **733**, leaving 4,767. Absence amounts beyond the authorized absence cap are not a debt. Distinguish that cap from an authorized but uncollected debt.

Full-month absence: if every scheduled day the employee was due to work within their actual employment interval is absent/unpaid leave, use 100% of the absence base, capped at earned pay. Approved paid leave must remain protected. February 28/28 absent yields 100%, while 27/28 yields 90% when the remaining date was a due-work date and therefore prevents the full-month predicate. Authoritative weekly/global working-day evidence is `attendance.schedule.is_working_day(profile, date)`, `get_work_schedule()` and `is_rest_day_for_everyone(date)`, combined with supplied approved holiday/leave evidence. These helpers use the global SystemSettings schedule/defaults and fixed weekly rules (Friday rest for all; Saturday rest for Saudi employees); there is no separate employee schedule in the current source. An employee without an individual schedule therefore uses those existing global/default helpers. If that evidence cannot be resolved, emit blocking attendance_calendar_missing and do not guess a full-month predicate. The helpers themselves do not supply an official-holiday calendar. Missing ABSENT rows, incomplete mapping coverage or a manual day count alone cannot prove every due-work date was absent; without reliable date-level evidence use the normal days/30 formula and its caps, not the 100% shortcut. A zero-workday interval is not vacuously full absence. Paid leave on any due-work date prevents the full-month shortcut. Unpaid leave counts as absence in the predicate. Evaluate the predicate before removing already-withheld wage dates, then subtract the wage already withheld for the same days from the full-month liability: max(0, min(full monthly absence base, earned pay) - exact same-date prior wage withholding). For normal partial absence, exclude already-withheld dates before applying day-rate arithmetic. Never charge protected or previously withheld days again. Store exact/raw liability and round the final absence line once; do not subtract rounded values from an unrounded formula.

### 2.3 Additions, deductions and carry-forward

Normal overtime quantity is eligible hours beyond an eight-hour day, entered as **excess hours**, not total shift hours. Amount = overtime base / 30 / 8 x 1.5 x excess hours. Weekly rest/Friday = base / 30 x 1.5 x worked days. Official holiday = base / 30 x 2 x worked days. Bonus, incentives, other additions are independent amount lines. No inferred attendance overtime approval. Apply the configured normal-hour cap before calculating the final normal-overtime line.

`allowed_overtime` is an **HOURS value**, applying only to normal excess hourly overtime, once per payroll window (explicit assumption). It does not limit day-based weekly-rest/Friday or official-holiday work. A positive value caps total normally payable excess hours for that employee/window at that value. Value 0 pays no normal overtime automatically. Save the entered hours; pay only min(entered hours, configured limit) without an override, and expose excess/unpaid hours with nonblocking `overtime_over_allowed` (including cap 0). Excess hours are not automatically paid or carried as a debt. HR may explicitly authorize them using the existing `override_overtime_eligibility: true` field with a mandatory reason and audit; a reason alone is not an override. Keep the excess warning with the overridden/payable quantities visible. Null means no limit configured: entry/pay are allowed with nonblocking `overtime_limit_not_set` when normal overtime is entered. Day-based work alone emits neither normal-limit warning. Recalculation aggregates the employee's normal hours for this payroll window, never treating separate edits as fresh allowance. Retain the existing override field/adjustment wire names for compatibility, but their meaning is a normal-hours limit override.

Pre-go-live data risk: `employees/services/importer.py` maps yes/no to 1/0 while also accepting integers. The audit must list all employees with allowed_overtime in (0, 1) for HR review; these are candidates, not proof of bad data. Do not auto-convert or reinterpret their stored values.

Collection order, approved by HR: **ABSENCE, GOSI_EMPLOYEE, penalties (both sources, including associated wage withholding), LOAN, OTHER_DEDUCTION**. Carry-forward retains its original category and follows the same priority. Existing claim ordering (held claims first, then stable IDs; existing loan due-date order) remains within a category. Available collection budget is earned Gross + rounded additions. Net = Gross + additions - collected deductions, always >= 0. The earned-pay absence cap cannot be expanded by a bonus.

Fine budget is earned run Gross / 30 x 5, shared between legacy attendance fines and schedule fines. Wage withholding is not a disciplinary fine. A penalty not eligible under this cap remains pending, with its uncollected amount visible. Do not rerate issued penalties using current salary; replace only the **collection cap** basis. Apply the Article70 per-fine and cumulative comparisons on exact issued two-decimal fine amounts against the unrounded earned-gross/30x5 budget, using cross-multiplication where necessary. Round the posted line afterwards; do not round the cap or re-compare the rounded line. Gross1,000 and fine166.50 are compliant (166.50 <=166.666...), and post167. The difference is a known rounding effect of less than one riyal per line, not a new fine. Claim audit metadata includes exact_amount, rounded_amount, exact_fine_amount, cap provenance and rounding_delta. Net affordability still uses actual rounded posted lines.

Loan selector remains the earliest single active approved undeducted loan due in/before the run (including overdue/null-target legacy cases), using approved amount or requested amount exactly as the existing mechanism. Collect it in full only if affordable at its priority; otherwise collect 0 and leave it **approved**, with no deduction_run or deducted_at. The word "instalment" in the follow-up does not authorize a new loan schedule. Never split a loan into a new instalment model.

Authorized uncollected amounts are never forgiven. Expose requested, collected, uncollected and carried-in amounts per category and source. Loan/penalty obligations stay in their existing models; **do not also create a generic carry-forward debt for them**. Use a payroll carry-forward ledger only for authorized absence/GOSI obligations that lack a source ledger. HR manual OTHER_DEDUCTION is the later approved exception: cap it to available net, retain/report its uncollected remainder, and require HR to re-enter it next month. Do not automatically recollect or create a carry ledger row for that remainder; mark manual_reentry_required=true in its HR collection breakdown. Do not silently lose the outstanding amount or history. Source keys prevent recollecting the same original amount. Draft reservations are reversible; finalization freezes actual collection and commits outstanding balances. Uncollected amounts from a finalized run become due for the next eligible draft. Capped, unauthorized absence excess is reported as capped, not carried. The ledger cannot alter a completed/paid source run.

Both existing penalty claim sources remain **whole-claim, all-or-nothing**: no partial collection or splitting a fine across runs. An unaffordable approved/pending claim stays eligible for the next draft and gets warning claim_unaffordable with employee, penalty/source and full amount. Do not mark an uncollected claim applied. The same warning applies to an unaffordable full loan. Other deductions alone may be partly collected with explicit uncollected/manual-reentry amounts. The requested/collected/uncollected DTO is in posted rounded riyals; by_category entries include manual_reentry_required (true only for an unpaid HR Other remainder), and source entries identify penalty/loan IDs in HR data only; exact source values remain in HR claim evidence/audit.

When Net is zero, require `zero_salary_reason` before finalize: `full_leave`, `full_absence`, `unpaid_leave`, `not_joined`, `suspended`, `other`; `other` requires free-text detail before finalization. Missing detail produces blocking zero_salary_detail_required in the validation report. An otherwise valid item PATCH accepts the change (HTTP200); missing detail itself does not return422 from PATCH. Finalization is blocked (HTTP422) until detail is supplied. Supplying a reason does not change a salary or excuse another validation error.

Phase 2 determinism clarification: within the penalty priority tier, retain eligible claims already reserved/applied by this run first. Other eligible claims are ordered by created_at, then source_kind, then source PK. Both compatibility sync entrypoints invoke the same writer and therefore select the same claims; invocation order no longer selects the winning fine source. Exact shared Article70 comparison, whole-claim affordability and source states are unchanged. This replaces the old entrypoint-order behavior, recorded explicitly as a contract change.

### 2.4 GOSI and provisions

Company setting `provision_proration` has exact values `FULL_MONTH` and `PRORATED_BY_DAYS`, default FULL_MONTH. Snapshot the selected value with the run; do not hard-code one mode or reinterpret an existing run after a settings change. Resolve the full monthly formulas below first. FULL_MONTH applies factor 1; PRORATED_BY_DAYS applies payable salary_days / 30 to each non-accommodation provision's unrounded monthly formula, then rounds each final line once. This proposed proration scope includes medical, ID, ticket, leave, EOS and the single GOSI amount before deciding its bearing party, so employee-deducted GOSI still makes company GOSI 0. Accommodation continues its own occupied-slot calculation and is never prorated a second time. Missing/null costs remain null in either mode. Company provisions never affect employee Net.

| Line | Formula/default |
|---|---|
| GOSI | Selected base (default Basic + Housing) x foreign rate 0.02 or Saudi rate 0.0975, according to is_saudi; rates configurable. Exactly one bearing party: employee flag true gives employee deduction and company GOSI 0; otherwise company provision and employee deduction 0. |
| Medical | Annual company invoice / 12 / number of included employees (including accountless/zero-pay employees). With no_medical_insurance=true the provision is0 and no warning. Otherwise a missing invoice is null, cost_incomplete=true for every included employee and ONE run-level medical_invoice_missing warning; HR may explicitly configure a zero invoice as well. Zero included employees produces no per-employee division. |
| ID cost | Foreign only, monthly 862.50 -> 863 default; Saudi 0; company configurable. |
| Air ticket | Annual 1500 / 12 = 125 default; company configurable, all included employees. |
| Leave | Selected monthly base / 30 x 1.75 through anniversary month; x 2.50 beginning the month after completion of five years. |
| EOS | Selected monthly base / 24 through anniversary month; /12 beginning the following month. |
| Accommodation | Daily rent allocation in section 2.5; independent of Housing. |

Five-year anniversaries use calendar-year arithmetic; Feb 29 becomes Feb 28 in a non-leap anniversary year. Hire Feb 29, 2020: old tier through February 2025, new tier March 2025. Snapshot the anniversary and effective tier month. Missing hire dates block finalize despite the provisional old tier.

Total Company Cost = Net + sum of known, rounded company provisions. Missing accommodation is null, excluded from the known subtotal, with `cost_incomplete: true` and a nonblocking warning. Explicit status `none` means accommodation 0 and no accommodation incompleteness. A missing medical invoice is nonblocking and reported once at run level; item cost_incomplete remains true. no_medical_insurance is an explicit configurable boolean default false, independent of a null invoice. When true, the medical provision is explicitly0 regardless of any retained prior invoice value; the snapshot records both fields and the flag controls the calculation.

### 2.5 Accommodation and exact rent reconciliation

Assignment enum: `assigned`, `none`, `unknown`. `assigned` requires a same-company Rent with annual_rent_value; `none` explicitly means no company accommodation and rent_id null; `unknown` means missing information and rent_id null. No overlapping assignment intervals for any status per employee. Dates are inclusive and **both start/end are required**. No assignment for the employed month yields unknown/null; it does not automatically create an assignment. Ending/creating assignments must preserve historical records.

Historical monthly runs retain 30 allocation slots. Slot d uses real calendar day d if present; in February, legacy slots after the last real day reuse the last real day's occupancy. New date-range runs use each actual selected calendar date, including cross-month dates. For either mode, each slot share = annual_rent_value / 12 / 30 / all assigned residents on the slot. Include residents outside payroll; their costs are marked not in payroll and never redistributed. Slots with zero residents remain vacant/unallocated. An archived employee's assigned interval ends automatically on the archive date, through an audited assignment service.

Sum each resident's unrounded slot shares before independently rounding their monthly money line. Keep raw allocation provenance in storage and the rent report. Never give a rounding remainder to an employee. Report:

`rounding_difference = sum(raw resident shares) - sum(rounded resident shares)`.

This signed difference is not an employee provision and never enters Total Company Cost. Company payroll totals remain sums of posted rounded employee lines. Raw shares + raw vacant slots must reconcile to annual_rent_value /12 **exactly, with no tolerance**; not_in_payroll_raw is a subset of resident shares, not an additional term.

Repeating divisions cannot be represented exactly as finite decimal strings. Therefore the **raw-only rent fields use ExactShare objects**: `{numerator: "1000.00", denominator: 3, decimal: "333.3333333333333333333333333"}`. Numerator is always a two-decimal currency string (for example "1.00", "0.00" or "-1.00"), including rent reports, daily/resident shares, summary rent_rounding_difference and exports. This normalizes the response representation of older snapshots without changing their stored ratios. Denominator is a positive integer; decimal is a display approximation and is never the source for reconciliation or pay. Store and reconcile the rational provenance by cross-multiplying Decimal numerators with integer denominators. No float and no residual employee adjustment. Payroll amounts remain ordinary decimal strings. Use exact provenance to decide HALF_UP ties before posting the rounded Decimal.

### 2.6 State, snapshots and one writer

Run and payslip status enum: DRAFT -> COMPLETED -> PAID; DRAFT -> CANCELLED only. No status PATCH. DRAFT payslips exist but employee endpoints exclude them. Finalize locks run, persists calculator output, reconciles all included payslips, freezes claims, sets both run and payslips COMPLETED in one transaction. Existing generate-payslips action publishes/marks both PAID and dispatches existing deduplicated notifications after commit; it remains a legacy payment-state action, not bank settlement.

Recalculate is DRAFT-only. Refresh employee/attendance/leave/rent/claim inputs, retain run-local manual adjustments and stable item/payslip IDs, release obsolete draft reservations, and calculate once. Reuse the run settings snapshot unless `refresh_settings: true` is explicitly requested with reason; audit old/new snapshots. Changing company settings never changes an existing frozen run, including provision_proration, require_manual_absence_confirmation and the normal-overtime calendar-month period assumption. An unchanged recalculate is a monetary no-op; source syncs cannot add claims twice.

Cancel is DRAFT-only and idempotent when already CANCELLED. Clear each deducted loan's deduction_payroll_run, deducted_at, deducted_amount and restore recorded approved pre-deduction state. Release attendance/penalty reservations using valid current source eligibility (never turn void/held into payable). Restore carry-in balances reserved by this draft. Make all draft payslips inactive; retain items, snapshots, adjustments and audit evidence. Audit the cancellation and each restoration/release. No hard delete, no rewriting applied claims or completed/paid runs.

`payroll/calculator.py` is pure: employee inputs + immutable settings/run allocation snapshot -> salary/addition/deduction/provision lines, collection/deferred amounts, totals, assumptions and validation issues. It has no DB/auth/audit/notification access. A single transactional run persistence service is the **only writer of calculated money**, including legacy scalar projections on items, payslips and run totals. Claim services supply eligibility/reservation changes and call that service; they no longer do independent arithmetic. Pure calculation cannot itself persist database rows.

A company-row lock serializes period creation, settings and cross-run carry reservations before the run lock. Within that lock keep order: run; sorted profiles; penalty/violation source records; loans/deductions/carry balances; items/payslips. Re-read eligibility after locks. Do not delete/recreate items referenced by PROTECT claim FKs. Audit inside the transaction; source transition notifications after commit. Revision checks prevent lost HR edits. Reconciliation failures block finalize and roll back claims/status/money together.

### 2.7 Executive payroll exemption (v0.6.0)

The server computes the subject employee's exemption exclusively with `core.executives.is_executive_profile(profile)`; do not maintain a second title/group list. The helper recognizes the existing CEO group and its canonical exact executive titles (Chief Executive Officer, General Manager, المدير العام, including its existing normalized title/position handling); Assistant General Manager alone is not exempt. This is a subject calculation rule, not a new role or a grant of payroll-management access.

`Backend/payroll/engine.py` computes the flag once per profile during input normalization and passes `EmployeeInput.executive_exempt` to the pure calculator. Store it in item.input_snapshot.source so historical calculation/DTO output remains reproducible. A second private input, accommodation_assignment_present, preserves whether an active overlapping assignment exists. No model column, migration, company setting or endpoint is added. Draft recalculation refreshes classification and records old/new employment inputs; completed/paid history remains frozen. Older snapshots without the flag report false (no exemption recorded in that calculation); they are never reclassified on GET.

Only for executive_exempt=true:

- Ignore AttendanceRecord ABSENT dates when calculating absence; retain raw observations in the private source evidence, but I.absence.attendance_days is0.00. Attendance alone cannot establish full-month absence. Approved unpaid leave remains chargeable, paid leave remains protected, and an audited HR absence_days_override still applies. Approved unpaid-leave evidence may establish the normal full-month predicate with authoritative schedule evidence; an unavailable BioTime source does not create a confirmation prerequisite for an executive.
- Do not emit attendance_source_unavailable as a warning or its manual-confirmation blocking facet. require_manual_absence_confirmation does not apply and I.absence.manual_confirmation_required is false. Actual mapping/coverage evidence is still reported; exemption does not fabricate a BioTime mapping.
- Normal entered overtime hours are payable without the monthly allowed_overtime cap. Do not emit overtime_limit_not_set or overtime_over_allowed; over_allowed_hours/unpaid_normal_hours are0.00. The stored cap remains visible as source data. Weekly-rest/official-holiday day-based calculations and mandatory audit reasons for edits remain unchanged.
- With no active overlapping accommodation assignment, report status none, accommodation line0.00, no accommodation_unknown warning and no accommodation contribution to cost_incomplete. Do not create an assignment row. If an assignment exists, use normal occupancy/price/status/completeness rules, including assigned rent costs and unknown/incomplete assignments. Missing medical costs and other incomplete costs still apply.
- Do not select or claim AttendancePayrollDeduction late fines. Do not generate penalty_pending_fine_cap/claim_unaffordable for those excluded fines. A mutable draft reservation made before classification changed is released through the existing audited release logic; its source amount is not forgiven or deleted. PenaltyRecord/PenaltyDeduction disciplinary claims still follow ordinary collection, exact Article70 cap, affordability and pending/warning rules. The existing upstream penalty creation API rejects executive subjects; this payroll change does not alter that API and still collects eligible issued disciplinary claims already present (including claims preceding promotion).

All other rules are unchanged: salary and employment proration, both configurable provision modes, GOSI bearing party, earned pay/Net/company totals, loans and previously authorized carry balances, medical costs, validation/reconciliation and audit/revision guards. Never suppress other errors, including missing_hire_date, zero-pay reasons/details, suspended_pay_decision_required, attendance_calendar_missing, rent_value_missing or stale_revision. Compute issue counts, can_finalize and totals from the exempt-adjusted result; an exempt employee never contributes to manual-absence confirmation requirements.

Visibility uses the additive readonly HR Item field executive_exempt. No executive_attendance_exempt code or informational entry is emitted for this exemption; draft error/warning counts and finalization requirements are unchanged. The v0.6.1 finalized-report projection in section6 applies to all completed/paid runs independently of this flag. I.warnings still contains warnings only. Employee payslip JSON/PDF do not expose the flag. Executive subjects do not gain HR API access from this calculation flag.

## 3. Proposed models and migration strategy

Existing money columns remain Decimal(12,2); new payroll totals/lines use Decimal(18,2). Reject any projection that overflows a legacy Decimal(12,2) field; do not truncate or widen silently. Quantities use Decimal(8,2). Exact raw rent provenance uses JSON containing Decimal strings and integer denominators. User/employee names below are example data, never identifiers for authorization.

| Model/table proposal | Fields/types and constraints |
|---|---|
| PayrollSettings (`payroll_payrollsettings`) | id bigint; company OneToOne(OrganizationNode, PROTECT, COMPANY only); revision positive integer; absence_base_type/gosi_base_type/leave_base_type/eos_base_type/overtime_base_type Char(32); absence_fixed_amount/gosi_fixed_amount/leave_fixed_amount/eos_fixed_amount/overtime_fixed_amount Decimal(18,2) nullable (DTO nests type/fixed_amount under each base); foreign_gosi_rate, saudi_gosi_rate Decimal(8,6), [0,1]; annual_medical_invoice Decimal(18,2) nullable; no_medical_insurance bool default false; monthly_foreign_id_cost and annual_air_ticket Decimal(18,2); provision_proration Char(24), FULL_MONTH/PRORATED_BY_DAYS, default FULL_MONTH; require_manual_absence_confirmation bool default false; timestamps. Read-only constants day_basis=30, rounding=ROUND_HALF_UP, overtime_default_is_assumption=true, normal_overtime_limit_period=PAYROLL_WINDOW. |
| EmployeeProfile additions | deduct_gosi_from_employee bool default false; payroll_config_revision positive integer default 0. All payroll config writes use a request/service audit; no serializer/model-side audit. |
| PayrollRun extensions | existing fields retained; revision integer; total_gross, total_additions, total_deductions, total_provisions, total_company_cost Decimal(18,2); cost_incomplete bool; settings_snapshot JSON (schema_version, company, settings revision, bases, constants, timezone and assumption); calculated_at nullable datetime; finalized_at/paid_at/cancelled_at nullable datetimes; cancelled_by User nullable SET_NULL; cancel_reason Text; calculator_version Char; validation_snapshot JSON including excluded profiles; legacy_calculation bool. company/year/month noncancelled unique; cancelled runs retained and replacement for same period permitted. |
| PayrollRunItem extensions | is_active bool default true, internal inclusion marker (not a DTO field); employee_profile FK PROTECT nullable during migration; existing employee_id/name/department/position snapshot; input_snapshot JSON (monthly salary, lifecycle, employee flag/nationality/OT limit, entered/payable/excess/unpaid hours and override evidence, mapping coverage/manual absence confirmation, absent/leave/penalty evidence, allocations); gross_salary, total_additions, total_provisions, total_company_cost Decimal(18,2); cost_incomplete bool; zero_salary_reason Char(24) nullable, zero_salary_reason_detail Text nullable; suspended_pay_decision Char(12) nullable (FULL_PAY/ZERO_PAY); accommodation_status Char(12); company FK PROTECT, consistent with run/profile; one item per (run, profile). Existing scalar basic/allowances/deductions/net projected by one writer. |
| PayrollLine (`payroll_payrollline`) | id bigint; company FK PROTECT; item FK CASCADE; category Char(16), type Char(40), stable source_key Char(160); source_kind Char(40), source_id Char nullable; source_period year/month nullable; quantity Decimal(8,2) nullable; amount Decimal(18,2) nullable ONLY unknown provisions; requested_amount, collected_amount, uncollected_amount Decimal(18,2) nullable by category; carried_in bool; calculation_snapshot JSON (unrounded inputs/provenance, no float); unique(item, source_key). Provision records are HR-only; employee serializer whitelists allowed categories/types. |
| Payslip extensions | retain existing fields/IDs; employee_profile FK PROTECT; payroll_run_item OneToOne PROTECT; company FK PROTECT matching run; employee User FK becomes nullable SET_NULL; total_additions Decimal(18,2); status with exact run choices, default DRAFT; calculation_version Char. Legacy salary columns project same item output. **No provisions fields on the employee DTO**. Snapshot salary/identity survives profile changes. |
| PayrollAdjustment (`payroll_payrolladjustment`) | immutable history/read projection referencing AuditLog OneToOne PROTECT; company FK; run/item FKs; type Char(32); changed_fields JSON; original_value/new_value JSON (Decimal strings); reason Text; actor FK User nullable SET_NULL; created_at datetime; input_revision integer. Current effective overrides live in item input_snapshot; this table is not a second audit system. |
| Existing claim-source extensions | AttendancePayrollDeduction and penalties.PenaltyDeduction retain amount/claim/state/run/item links; add claimed_exact_amount Decimal(12,2) default0 to distinguish original collected liability from rounded claimed_amount reflected in posted lines. Article70 counts exact **fine** source amounts only, not wage portions or rounded claims; audit both. claimed_amount remains the actual posted total used for idempotent reconciliation. LoanRequest retains its existing full-loan exact deducted_amount; add payroll_pre_deduction_snapshot JSON nullable for audited DRAFT restoration; rounded payroll amount lives in the single calculator line. No new loan schedule. |
| PayrollCarryForward (`payroll_payrollcarryforward`) | company FK PROTECT; profile FK PROTECT; origin_run FK PROTECT; source_key unique by company/profile/category/origin; type ABSENCE/GOSI_EMPLOYEE only; original_authorized_amount, remaining_amount Decimal(18,2); source_period year/month; status PENDING/SETTLED; created_at/updated_at. Provisional draft debts are snapshots, not committed carry balances. No Loan, Penalty or HR manual Other duplicate ledger rows. |
| PayrollCarryForwardCollection | company FK; carry FK PROTECT; run/item FK PROTECT; amount Decimal(18,2); state CLAIMED/APPLIED/RELEASED; one reservation per (carry, run); audit reference and timestamps. Frozen collections remain historical. |
| AccommodationAssignment (`payroll_accommodationassignment`) | company FK PROTECT; employee_profile FK PROTECT; rent FK Rent PROTECT nullable; status assigned/none/unknown; start_date and end_date Date NOT NULL; is_active bool (record validity, not today's occupancy); created_by/updated_by User SET_NULL; timestamps. end>=start; assigned iff rent nonnull; no overlapping active inclusive ranges for profile, including scheduled/history ranges (service overlap validation on every supported database; extra exclusion constraint only on PostgreSQL, guarded by connection vendor). |
| PayrollRentAllocation | company/run FK; rent FK PROTECT; annual_rent snapshot Decimal(18,2); slot_inputs JSON (N dates for explicit windows, 30 legacy slots, resident profile IDs, exact share ratios, vacancy); resident_allocations JSON including not-in-payroll rows; monthly_rent, vacant_unallocated_raw, not_in_payroll_raw, rounding_difference exact-ratio JSON. `period_rent` is derived in responses as monthly_rent x N/30 (or full monthly rent for legacy rows). Unique(run, rent); freezes historical occupancy/price for the report. |

Phase 2 adds `Backend/payroll/migrations/0012_payrollrunitem_is_active.py` after 0011: `PayrollRunItem.is_active`, Boolean default true. Recalculation marks an item excluded by corrected lifecycle data inactive instead of deleting an item referenced by immutable adjustments/carry evidence. Inactive items/slips are omitted from current item lists, totals and reconciliation; historical item adjustments stay readable through the authorized run. Cancellation retains items and deactivates slips as already specified. No public is_active item field is introduced. The new SQLite forward/backfill/reverse probe includes 0012; older PostgreSQL-only bootstrap migrations remain outside this chain.

All new company-owned models carry company and enforce relationship consistency; query through existing organization helpers with the **actual request argument**, not the stale notes' request.user signature. Stable item/profile links replace employee string matching after backfill.

Approved migration strategy (generated Phase 1 inventory follows):

1. Next payroll migration after **0006** adds tables/nullable links and new nullable snapshot fields. Employee flag uses the next employees migration, selected from disk at implementation time, without colliding with other sessions. No column drops or table replacement.
2. Data migration maps existing run items to profiles using exact unique employee_id **and matching company**, and payslips through exact run/user/profile match. Never infer identity from names/national_id. Emit an unresolved/duplicate linkage report; do not merge or delete records. Add missing accountless legacy slips only where a uniquely linked item supplies exact historical amounts; otherwise report for HR reconciliation.
3. Old payslips get one DEDUCTION line `PREVIOUS_TOTAL_DEDUCTIONS`, amount equal to the **unchanged historic total**, even when 0. Do not reconstruct loan/penalty breakdown from today's records. Map known historic salary components to salary lines without new rounding. Legacy item-only allowance totals remain identified as legacy aggregates until reconciled; do not fabricate an allowance split from current salaries. Preserve historic net/gross/deductions, including old negative net/halalas, and mark legacy_calculation. No retroactive rounding or new provisions.
4. Align legacy payslip status to parent state (DRAFT->DRAFT, COMPLETED->COMPLETED, PAID->PAID, CANCELLED->CANCELLED/inactive), audited as a system migration. Do not mark draft loans/claims applied. Legacy settings_snapshot has schema_version=0, `legacy_unknown: true`; do not pretend current defaults were used historically. Existing completed/paid legacy rows stay immutable.
5. Only after verified linkage/backfill, add uniqueness, non-null links for new/reconciled records and tenant consistency checks. Preserve nullable legacy links for unresolved records or stop the enforcement migration with a diagnostic; no guessed backfill. DRAFT with unresolved data cannot finalize/recalculate destructively. Audit data migrations through audit helper with system actor, entity IDs, old/new and a migration reason. Historical adjustments not previously captured remain unknown.
6. Reverse schema cautiously; preserve source historical columns. Never erase audit rows, debt/collection history or sealed historical money to manufacture rollback. Validate backups and row-lock/index impact before production migrations in a later phase. The run constraint migration explicitly drops unique_payroll_run_period and adds a conditional unique(company,year,month) where status != CANCELLED; preflight existing conflicts, test cancellation/replacement/parallel creation and preserve completed/paid periods. The migrations below were applied only to the local development stack and isolated test databases in Phase 1.

Database portability: settings default to PostgreSQL but support SQLite via DB_ENGINE. All accommodation writes must validate no-overlap through the service on **both databases**, including inclusive boundaries, every status, updates and archived-date endings. In a transaction serialize writes for the same employee; PostgreSQL uses the profile lock, while SQLite's write transaction/busy-retry handling must recheck overlap before commit (select_for_update alone is not a SQLite lock). The exclusion-constraint migration must check `schema_editor.connection.vendor == "postgresql"` before its forward/reverse DDL; do not install an unconditional ExclusionConstraint in model migration state that would execute on SQLite. Guard any required PostgreSQL extension (such as btree_gist) and every other PostgreSQL-only DDL likewise; do not change the SQLite fallback. Ordinary portable check/unique constraints remain on both vendors. Add PostgreSQL and SQLite migration-path checks plus a service-path overlap test; no PostgreSQL-only feature may be proposed without its vendor guard and portable service behavior.

Phase 1 generated migration inventory (eight files):

- `Backend/employees/migrations/0031_payroll_rebuild_foundation.py`: employee GOSI flag/config revision.
- `Backend/loans/migrations/0007_payroll_rebuild_foundation.py`: nullable pre-deduction restoration snapshot.
- `Backend/penalties/migrations/0007_payroll_rebuild_foundation.py`: exact claimed amount.
- `Backend/payroll/migrations/0007_payroll_rebuild_foundation.py`: additive foundation schema, nullable legacy links, DRAFT payslip default and conditional period uniqueness.
- `Backend/payroll/migrations/0008_backfill_legacy_payroll.py`: preserve exact historical money, link only unambiguous matching identities, align status/inactivity, write system audits and unresolved-link report. Item-only legacy allowance aggregates do not supply an exact component split, so they are reported rather than assigned fabricated payslips.
- `Backend/payroll/migrations/0009_accommodation_exclusion.py`: PostgreSQL-only btree_gist/exclusion DDL, guarded forward and reverse.
- `Backend/payroll/migrations/0010_payroll_model_validation.py`: concrete line/source choices and empty allocation-list validation.
- `Backend/payroll/migrations/0011_nullable_assignment_actors.py`: allow nullable SET_NULL assignment audit actors through model validation.

Storage clarification: line/carry `source_period` is persisted as `source_year` and `source_month`; the approved DTO remains the nested `source_period` object. Assignment created_by/updated_by are nullable SET_NULL; no audit actor is invented for missing/deleted accounts. New settings, assignments and configuration history use request-scoped services and the existing audit helper. IsPayrollManager's only role allowlist is `Backend/payroll/permissions.py::PAYROLL_MANAGER_ROLES`; CFO removal is a one-line edit there. Existing views are not switched to that permission in Phase 1.

Portability limitation found in verification: fresh whole-repository SQLite migration fails on pre-existing unguarded PostgreSQL DO/trigger SQL (for example `Backend/employees/migrations/0015_database_tenant_integrity.py`). These older migrations are outside the Phase 1 change. The new payroll migration chain is verified forward/backfill/reverse on a real SQLite schema built from the legacy model state; portable service overlap validation is also tested on SQLite. This is not evidence that a fresh SQLite database can bootstrap all historical repository migrations. PostgreSQL tests run the real historical migration chain and the real exclusion constraint. No new PostgreSQL-only feature executes unguarded on SQLite.

One-time report implemented: `python manage.py report_archived_payroll_dates --output <private-path>`; stdout contains counts only, private CSV lists profile_id, employee_id, company_id, employment_status and issue code for archived_without_date and terminated_without_end_date. It covers every is_archived=true/archived_at-null profile and every non-archived TERMINATED profile lacking an end date. Extend the same report with allowed_overtime in (0, 1) candidates (stored value included) and, for supplied --year/--month, active-mapping coverage counts/lists for included employees (unmapped and partially covered separately, attendance_start_date and uncovered dates). Counts are calculated by the report at execution, not guessed from ID-mapping CSVs. No data guessing, automatic conversion or mutation; fixture tests verify the report in Phase 1. The command was not run against authoritative employee data; the current unmapped/partial employee count remains unverified.

## 4. Transport, authorization and common responses

### 4.1 Permission names and tenant behavior

**P (proposed)** = `[rest_framework.permissions.IsAuthenticated, payroll.permissions.IsPayrollManager]`. Implement IsPayrollManager using existing `core.permissions.get_role`: exactly `SystemAdmin`, `HRManager`, `CFO`. CEO/Manager/Employee/delegated workflow approvers are not admitted to finance data. This explicitly expands current payroll HR/Admin access to CFO; it does not expand existing rent-management APIs.

**E (existing)** = `[IsAuthenticated, payroll.permissions.IsEmployeeOnly]`, plus own-user/profile query and active company, is_active, run COMPLETED/PAID. Preserve existing Employee-only role asymmetry pending product approval; managers' own self-service is an open question, not an accidental permission expansion. Spoofed X-Employee-Id/X-User-Id never selects ownership.

Authorization headers: Bearer access token and `X-Active-Company-Id` (integer company ID). Resolve/validate with organization services. Current run list is strict selected company; existing run object actions/exports use `filter_queryset_by_accessible_companies`, allowing explicitly authorized HR/Admin head-office lookups. Preserve those helpers and their scope rules; allow CFO through `roles_with_access={SystemAdmin,HRManager,CFO}` only for this payroll workflow. New settings and assignment endpoints are strict active-company; nested resources scope through their authorized parent run. No null-company payroll records are exposed. Never accept company_id in a mutation as authority. Inaccessible object => generic 404; inaccessible company header => 403. No organization-scope or manager capability grants payroll access.

### 4.2 Success, pagination, errors and revision checks

GET requests have **no body**. Success: `{"status":"success","data":...}`. Action messages live in data.message where retained for compatibility; new messages include message_key. `Accept-Language: en|ar` selects server text via existing middleware; codes/keys/field names never translate.

All paginated resources use this exact shape (example empty page):

```json
{
  "status": "success",
  "data": {
    "items": [],
    "page": 1,
    "page_size": 25,
    "count": 0,
    "total_pages": 1
  }
}
```

page/page_size positive integers, default 1/25. Current StandardPagination has no maximum page size; retain this for existing lists in v1. New lists explicitly use the same shape/default; any future maximum must be documented. Out-of-range page => 404 through DRF. Settings/enums, details, summaries and action results are not paginated. No async task polling or 202 is proposed.

Common framework error (existing guard shape), example 403:

```json
{
  "status": "error",
  "message": "You do not have permission to perform this action.",
  "detail": "You do not have permission to perform this action."
}
```

Generic hidden employee payslip 404 retains:

```json
{
  "status": "error",
  "message": "Not found",
  "errors": [
    "Not found."
  ]
}
```

Parent-object Http404 may instead be `{"status":"error","message":"Not found"}` via the global handler; preserve this known distinction. Other common outcomes: 400 malformed JSON (`detail` shape), 401 missing/expired/revoked token, 405 unsupported method, 429 throttled (framework envelope; clients honor Retry-After when supplied), 500 masked Server error. Do not emit internal exception strings or SQL in payroll 500s.

New/updated business validation uses existing error/_error_list helper, with object items (not a new envelope). Example 422:

```json
{
  "status": "error",
  "message": "A reason is required.",
  "errors": [
    {
      "field": "reason",
      "code": "reason_required",
      "message": "A reason is required.",
      "message_key": "payroll.validation.reason_required",
      "params": {}
    }
  ]
}
```

field may be absent for a record-level error. employee may be added only on HR endpoints. Nested fields use dotted paths. Existing legacy finalize confirm/duplicate-period/invalid-export errors retain their string-array form; frontend supports strings **or** these objects. No errors/results/field_errors alternative envelope.

Finalize blocked (422) uses the same object-item array, with code/message_key/params/employee matching the validation report. Warning alone does not block finalize. Domain conflicts use 409, e.g.:

```json
{
  "status": "error",
  "message": "Payroll data changed; reload and retry.",
  "errors": [
    {
      "code": "stale_revision",
      "message": "Payroll data changed; reload and retry.",
      "message_key": "payroll.validation.stale_revision",
      "params": {
        "expected_revision": 2,
        "current_revision": 3
      }
    }
  ]
}
```

All new run edits/recalculate/cancel require expected_revision (positive integer) and reason (trimmed nonempty text, max 2000). Existing finalize accepts `{"confirm":true}`; expected_revision and reason are optional additively, with revision enforced when supplied. generate-payslips retains `{}` compatibility. Settings/config edits use their settings_revision (nonnegative; 0 is the unpersisted/default configuration). Stable IDs and frozen statuses are read-only. Reject unknown write fields, totals/lines/status/settings_snapshot edits with 422. Do not silently accept arbitrary formulas or employee ownership fields.

### 4.3 Throttles and binary security

Retain `PayrollFinalizeThrottle` 5/min, `PayrollGeneratePayslipsThrottle` 5/min, `PayrollExportThrottle` 10/min per user. No new throttle/rate is asserted for settings, lists, edits, validation, recalculate, cancel or employee downloads; current defaults have no general throttle. Any later new limit is a contract change.

All payroll PDF/XLSX/CSV downloads: HTTP 200 binary, application/octet-stream; Content-Disposition attachment with filename; X-Content-Type-Options nosniff; Cache-Control private, no-store; employee PDF also Pragma no-cache and Content-Length. Protected binaries remain web-only under the approved mobile master plan: MobileApp consumes structured payslip JSON, not binary download/URLs/WebViews. No signed/public URLs, secrets, provisions in employee notifications or URLs. JSON payroll responses should also be private/no-store in the new implementation.

## 5. Exact enums and translation keys

Every table entry is the exact wire value. Label keys are translated in English/Arabic; employee/rent names and HR-entered reasons are data, not translation keys.

| Enum | Values / label-key rule |
|---|---|
| run_status, payslip_status | DRAFT, COMPLETED, PAID, CANCELLED; `payroll.status.<lowercase>` |
| salary_base | BASIC, BASIC_HOUSING, BASIC_HOUSING_TRANSPORT, GROSS, FIXED_AMOUNT; `payroll.salary_base.<lowercase>` |
| line_category | SALARY, ADDITION, DEDUCTION, PROVISION; `payroll.line_category.<lowercase>` |
| salary line_type | BASIC_SALARY, ACCOMMODATION_ALLOWANCE, TRANSPORTATION_ALLOWANCE, TELEPHONE_ALLOWANCE, PETROL_ALLOWANCE, OTHER_ALLOWANCE |
| addition line_type | OVERTIME_NORMAL, WEEKLY_REST_WORK, OFFICIAL_HOLIDAY_WORK, BONUS, INCENTIVE, OTHER_ADDITION |
| deduction line_type | ABSENCE, GOSI_EMPLOYEE, ATTENDANCE_PENALTY, PENALTY_FINE, PENALTY_WAGE_WITHHOLDING, LOAN, OTHER_DEDUCTION, PREVIOUS_TOTAL_DEDUCTIONS |
| provision line_type (HR only) | MEDICAL, ID_COST, AIR_TICKET, LEAVE_PROVISION, EOS_PROVISION, ACCOMMODATION_COST, GOSI_COMPANY |
| all line labels | `payroll.line.<lowercase line_type>`; PREVIOUS_TOTAL_DEDUCTIONS English label **Previous total deductions**; ACCOMMODATION_ALLOWANCE label **Housing**; ACCOMMODATION_COST label **Company accommodation cost** |
| zero_salary_reason | full_leave, full_absence, unpaid_leave, not_joined, suspended, other; `payroll.zero_salary_reason.<value>` |
| accommodation_status | assigned, none, unknown; `payroll.accommodation_status.<value>`; none label **No company accommodation**, unknown **Accommodation unknown** |
| suspended_pay_decision | FULL_PAY, ZERO_PAY; `payroll.suspended_pay_decision.<lowercase>` |
| provision_proration | FULL_MONTH, PRORATED_BY_DAYS; `payroll.provision_proration.<lowercase>`; default FULL_MONTH |
| validation severity | error, warning, info; `payroll.validation_severity.<value>` |
| finalize_state | finalized, not_finalized; `payroll.finalize_state.<value>`; presentation state only, not run status |
| adjustment_type | ABSENCE_OVERRIDE, ADDITION_ENTRY, OTHER_DEDUCTION_ENTRY, SALARY_ADJUSTMENT, ZERO_SALARY_REASON, OVERTIME_ELIGIBILITY_OVERRIDE, LEAVE_INPUT_CHANGE, EMPLOYMENT_INPUT_CHANGE, MANUAL_ADJUSTMENT, SETTINGS_REFRESH; `payroll.adjustment.<lowercase>` |
| carry status | PENDING, SETTLED; collection state CLAIMED, APPLIED, RELEASED; `payroll.carry_status.<lowercase>`, `payroll.collection_state.<lowercase>` |
| source_kind | employee_salary, attendance_absence, unpaid_leave, manual_adjustment, loan, attendance_penalty, penalty, carry_forward, company_settings, rent_allocation, legacy; machine values, no user label |

Each validation code maps **exactly** to `payroll.validation.<code>`. The following is the complete v1 domain code set (**45 distinct validation codes**); error text is translated with these catalog entries (Arabic values to be implemented in Backend locale catalogs, not frontend files):

| Code | Severity/use | English message / Arabic message |
|---|---|---|
| missing_hire_date | blocking report | Hire date is missing; correct the profile and recalculate. / تاريخ التعيين مفقود؛ صحح ملف الموظف وأعد الحساب. |
| archived_without_date | blocking, excluded profile | Archived employee has no archive date. / الموظف المؤرشف ليس له تاريخ أرشفة. |
| prehire_status_conflict | blocking, excluded profile | Prehire status conflicts with a hire date in or before this month. / تتعارض حالة ما قبل التعيين مع تاريخ تعيين خلال هذا الشهر أو قبله. |
| suspended_pay_decision_required | blocking | Choose full pay or zero pay with suspended reason for this run. / اختر الأجر الكامل أو أجرًا صفريًا بسبب الإيقاف لهذا المسير. |
| terminated_without_end_date | blocking, excluded profile | Terminated employee has no archived end-of-service date. / الموظف المنتهية خدمته ليس له تاريخ نهاية خدمة مؤرشف. |
| overtime_limit_not_set | warning, normal overtime only | No normal-overtime hours limit is configured; entered hours are allowed. / لم يُضبط حد لساعات العمل الإضافي العادي؛ الساعات المدخلة مسموحة. |
| overtime_over_allowed | nonblocking warning, allowed_hours/entered_hours/over_allowed_hours/unpaid_hours/overridden params | Normal overtime exceeds the monthly hours limit; excess requires an audited HR override to be paid. / يتجاوز العمل الإضافي العادي الحد الشهري للساعات؛ يتطلب دفع الزائد تجاوزًا مدققًا من الموارد البشرية. |
| attendance_source_unavailable | one warning per included employee without full employed-date mapping coverage; also blocking error if required manual confirmation is missing | Attendance source does not cover the employed dates; HR must confirm manual absence days when required. / لا يغطي مصدر الحضور أيام التوظيف؛ يجب على الموارد البشرية تأكيد أيام الغياب يدويًا عند اشتراط ذلك. |
| overtime_not_allowed | 422 only for attempting forced normal-hour payment beyond the limit without a valid override; capped entry itself is accepted | Paying normal overtime beyond its limit requires an HR override and reason. / يتطلب دفع العمل الإضافي العادي فوق الحد تجاوزًا من الموارد البشرية وسببًا. |
| absence_capped | warning | Absence deduction was capped at the permitted earned pay. / تم تقييد خصم الغياب بالأجر المستحق المسموح. |
| deductions_capped | warning | Deductions exceeded available pay; unpaid amounts remain pending. / تجاوزت الخصومات الأجر المتاح؛ تبقى المبالغ غير المحصلة معلقة. |
| uncollected_deduction | warning, category/source params | An amount of {amount} remains pending for a later run. / يبقى مبلغ {amount} معلقًا لمسير رواتب لاحق. |
| claim_unaffordable | warning, source_kind/penalty_id/source_id/amount params | The full claim is unaffordable and remains pending. / لا يكفي الأجر لتحصيل المطالبة كاملة وتبقى معلقة. |
| penalty_pending_fine_cap | warning | The penalty remains pending because of the monthly fine cap. / تبقى المخالفة معلقة بسبب الحد الشهري للغرامات. |
| penalty_absence_overlap | informational warning | Previously withheld wage dates were excluded from absence. / تم استبعاد أيام الأجر المحجوز سابقًا من الغياب. |
| penalty_wage_evidence_missing | blocking | Wage withholding dates require reconciliation before finalization. / تتطلب أيام حجز الأجر تسوية قبل اعتماد المسير. |
| accommodation_unknown | warning | Accommodation cost is unknown; company cost is incomplete. / تكلفة السكن غير معروفة؛ تكلفة الشركة غير مكتملة. |
| rent_value_missing | blocking assigned rent | Assigned rent has no annual value. / الإيجار المعين ليس له قيمة سنوية. |
| rent_reconciliation_failed | blocking | Raw rent allocations do not reconcile. / توزيعات الإيجار غير المقربة لا تتطابق. |
| medical_invoice_missing | one run-level nonblocking warning | Medical invoice is missing; company cost is incomplete. / فاتورة التأمين الطبي مفقودة؛ تكلفة الشركة غير مكتملة. |
| zero_salary_reason_required | blocking | A zero-pay reason is required. / يلزم سبب لراتب صفري. |
| zero_salary_detail_required | blocking (finalization) | Provide details for the other zero-pay reason. / أدخل تفاصيل لسبب الراتب الصفري الآخر. |
| salary_total_mismatch | warning | Profile total differs from salary components; components were used. / يختلف إجمالي الملف عن مكونات الراتب؛ تم استخدام المكونات. |
| payroll_reconciliation_failed | blocking | Run, items and payslips do not reconcile. / لا تتطابق إجماليات المسير والبنود وقسائم الرواتب. |
| legacy_link_unresolved | blocking | A legacy payroll employee link needs reconciliation. / يحتاج ربط موظف في الرواتب السابقة إلى تسوية. |
| attendance_calendar_missing | blocking full-month decision | Working-day evidence is required to determine full-month absence. / يلزم دليل أيام العمل لتحديد غياب الشهر الكامل. |
| invalid_decimal | 422 | Enter a finite nonnegative decimal string. / أدخل قيمة عشرية نصية محدودة وغير سالبة. |
| invalid_quantity | 422 | Enter a valid nonnegative day or hour quantity. / أدخل عدد أيام أو ساعات صحيحًا وغير سالب. |
| invalid_choice | 422 | Select a supported value. / اختر قيمة مدعومة. |
| invalid_period | 422 | Select a valid payroll year and month. / اختر سنة وشهر رواتب صحيحين. |
| invalid_calendar_days | 422 | Enter 1 to 30 calendar days without exceeding the selected month. / أدخل من 1 إلى 30 يومًا تقويميًا دون تجاوز عدد أيام الشهر المحدد. |
| reason_required | 422 | A reason is required. / السبب مطلوب. |
| invalid_date_range | 422 | The end date must be on or after the start date. / يجب ألا يسبق تاريخ النهاية تاريخ البداية. |
| assignment_overlap | 409 | An accommodation assignment overlaps these dates. / يتداخل تخصيص سكن مع هذه التواريخ. |
| company_mismatch | 422 same accessible company refs | Referenced records must belong to the same company. / يجب أن تنتمي السجلات المرجعية إلى الشركة نفسها. |
| duplicate_period | 409 | Payroll run already exists for this period. / يوجد مسير رواتب لهذه الفترة بالفعل. |
| stale_revision | 409 | Payroll data changed; reload and retry. / تغيرت بيانات الرواتب؛ أعد التحميل والمحاولة. |
| run_not_draft | 422 | Only a draft payroll run can be changed or cancelled. / لا يمكن تغيير أو إلغاء سوى مسير رواتب مسودة. |
| run_cancelled | 422 finalize | Cancelled runs cannot be finalized. / لا يمكن اعتماد المسيرات الملغاة. |
| run_not_finalized | 422 publish | Finalize the payroll run before generating payslips. / اعتمد مسير الرواتب قبل إنشاء القسائم. |
| confirm_required | 422 legacy finalize | confirm must be true. / يجب أن تكون قيمة confirm صحيحة. |
| invalid_export_format | 422 | file_format must be one of: csv, pdf, xlsx. / يجب أن يكون تنسيق الملف csv أو pdf أو xlsx. |
| field_not_editable | 422 | This field cannot be edited here. / لا يمكن تعديل هذا الحقل هنا. |
| amount_out_of_range | blocking/422 | Amount exceeds the supported payroll range. / يتجاوز المبلغ النطاق المدعوم للرواتب. |
| policy_decision_required | blocking draft proposal edge | This calculation needs an approved payroll policy. / يحتاج هذا الحساب إلى سياسة رواتب معتمدة. |

Messages and labels in addition to enums/validation:

| Key | English / Arabic |
|---|---|
| payroll.message.finalized | Payroll run finalized. / تم اعتماد مسير الرواتب. |
| payroll.message.already_finalized | Payroll run already finalized. / تم اعتماد مسير الرواتب مسبقًا. |
| payroll.message.generated | Payslips generated / تم إنشاء قسائم الرواتب |
| payroll.message.recalculated | Payroll run recalculated. / تمت إعادة حساب مسير الرواتب. |
| payroll.message.cancelled | Payroll run cancelled. / تم إلغاء مسير الرواتب. |
| payroll.message.already_cancelled | Payroll run already cancelled. / تم إلغاء مسير الرواتب مسبقًا. |
| payroll.assumption.overtime_basic | Overtime defaults to Basic salary; HR may configure the base. / يعتمد العمل الإضافي افتراضيًا على الراتب الأساسي؛ يمكن للموارد البشرية ضبط الأساس. |
| payroll.assumption.overtime_calendar_month | Normal overtime limit applies once per payroll window (assumption). / يطبق حد العمل الإضافي العادي مرة واحدة لكل فترة رواتب (افتراض). |
| payroll.provision_proration.full_month | Full month / شهر كامل |
| payroll.provision_proration.prorated_by_days | Prorated by payable days / موزع نسبيًا حسب أيام الأجر |
| payroll.field.require_manual_absence_confirmation | Require manual absence confirmation / اشتراط تأكيد الغياب يدويًا |
| payroll.assumption.missing_hire_date | Full month and under-five-year tier assumed for this draft only. / تم افتراض شهر كامل وفئة أقل من خمس سنوات لهذه المسودة فقط. |
| payroll.rent.not_in_payroll | Not in payroll / غير مدرج في مسير الرواتب |
| payroll.rent.rounding_difference | Rounding difference / فرق التقريب |
| payroll.rent.vacant_unallocated | Vacant, unallocated / شاغر وغير موزع |
| payroll.pdf.payslip | Employee Payslip / قسيمة راتب الموظف |
| payroll.pdf.payroll_report | Payroll Report / تقرير الرواتب |
| payroll.pdf.period | Period / الفترة |
| payroll.pdf.employee | Employee / الموظف |
| payroll.pdf.payment_mode | Payment Mode / طريقة الدفع |
| payroll.pdf.payslip_id | Payslip ID / رقم قسيمة الراتب |
| payroll.pdf.earnings | Earnings Breakdown / تفاصيل المستحقات |
| payroll.pdf.additions | Additions / الإضافات |
| payroll.pdf.deductions | Deductions / الخصومات |
| payroll.pdf.provisions | Company Provisions / مخصصات الشركة |
| payroll.field.gross_salary | Gross Salary / إجمالي الراتب |
| payroll.field.total_additions | Total Additions / إجمالي الإضافات |
| payroll.field.total_deductions | Total Deductions / إجمالي الخصومات |
| payroll.field.net_salary | Net Salary / صافي الراتب |
| payroll.field.total_company_cost | Total Company Cost / إجمالي تكلفة الشركة |
| payroll.field.cost_incomplete | Company cost incomplete / تكلفة الشركة غير مكتملة |
| payroll.field.carry_forward | Uncollected, carried forward / غير محصل ومرحل |
| payroll.payment_mode.bank_transfer | Bank Transfer / تحويل بنكي |

For enum labels not individually bilingual above, Phase 1 must add both locale translations for **every concrete value** generated by the exact key rules. The enum directory returns `{value,label,label_key}`; frontend may use label or its own matching key. Existing global auth/permission/parser/pagination error wording continues through existing `core.error_translations`; payroll logical keys for these are `payroll.error.unauthenticated`, `.forbidden`, `.not_found`, `.malformed_json`, `.method_not_allowed`, `.throttled`, `.server_error`, `.invalid_page`. Do not change global exception shapes merely to add message_key. There are no other backend-authored user strings in the proposed payloads; field identifiers and supplied names/reasons remain data.

## 6. Shared response DTOs and complete examples

Subsequent endpoint tables reference these exact JSON examples by name, to avoid presenting different versions of the same DTO. Referencing a DTO means returning the full defined fields, not a nested object named after the example. Lists wrap that DTO in the page envelope in section 4.2. All optional fields are explicitly nullable where indicated.

### ENUM: complete English enum directory (Arabic uses the same values/keys)

```json
{
  "status": "success",
  "data": {
    "run_status": [
      {
        "value": "DRAFT",
        "label": "Draft",
        "label_key": "payroll.status.draft"
      },
      {
        "value": "COMPLETED",
        "label": "Completed",
        "label_key": "payroll.status.completed"
      },
      {
        "value": "PAID",
        "label": "Paid",
        "label_key": "payroll.status.paid"
      },
      {
        "value": "CANCELLED",
        "label": "Cancelled",
        "label_key": "payroll.status.cancelled"
      }
    ],
    "payslip_status": [
      {
        "value": "DRAFT",
        "label": "Draft",
        "label_key": "payroll.status.draft"
      },
      {
        "value": "COMPLETED",
        "label": "Completed",
        "label_key": "payroll.status.completed"
      },
      {
        "value": "PAID",
        "label": "Paid",
        "label_key": "payroll.status.paid"
      },
      {
        "value": "CANCELLED",
        "label": "Cancelled",
        "label_key": "payroll.status.cancelled"
      }
    ],
    "salary_base": [
      {
        "value": "BASIC",
        "label": "Basic",
        "label_key": "payroll.salary_base.basic"
      },
      {
        "value": "BASIC_HOUSING",
        "label": "Basic + Housing",
        "label_key": "payroll.salary_base.basic_housing"
      },
      {
        "value": "BASIC_HOUSING_TRANSPORT",
        "label": "Basic + Housing + Transportation",
        "label_key": "payroll.salary_base.basic_housing_transport"
      },
      {
        "value": "GROSS",
        "label": "Gross",
        "label_key": "payroll.salary_base.gross"
      },
      {
        "value": "FIXED_AMOUNT",
        "label": "Fixed amount",
        "label_key": "payroll.salary_base.fixed_amount"
      }
    ],
    "line_category": [
      {
        "value": "SALARY",
        "label": "Salary",
        "label_key": "payroll.line_category.salary"
      },
      {
        "value": "ADDITION",
        "label": "Addition",
        "label_key": "payroll.line_category.addition"
      },
      {
        "value": "DEDUCTION",
        "label": "Deduction",
        "label_key": "payroll.line_category.deduction"
      },
      {
        "value": "PROVISION",
        "label": "Provision",
        "label_key": "payroll.line_category.provision"
      }
    ],
    "line_type": [
      {
        "value": "BASIC_SALARY",
        "label": "Basic Salary",
        "label_key": "payroll.line.basic_salary"
      },
      {
        "value": "ACCOMMODATION_ALLOWANCE",
        "label": "Housing",
        "label_key": "payroll.line.accommodation_allowance"
      },
      {
        "value": "TRANSPORTATION_ALLOWANCE",
        "label": "Transportation",
        "label_key": "payroll.line.transportation_allowance"
      },
      {
        "value": "TELEPHONE_ALLOWANCE",
        "label": "Telephone",
        "label_key": "payroll.line.telephone_allowance"
      },
      {
        "value": "PETROL_ALLOWANCE",
        "label": "Petrol",
        "label_key": "payroll.line.petrol_allowance"
      },
      {
        "value": "OTHER_ALLOWANCE",
        "label": "Other Allowance",
        "label_key": "payroll.line.other_allowance"
      },
      {
        "value": "OVERTIME_NORMAL",
        "label": "Normal Overtime",
        "label_key": "payroll.line.overtime_normal"
      },
      {
        "value": "WEEKLY_REST_WORK",
        "label": "Weekly Rest Work",
        "label_key": "payroll.line.weekly_rest_work"
      },
      {
        "value": "OFFICIAL_HOLIDAY_WORK",
        "label": "Official Holiday Work",
        "label_key": "payroll.line.official_holiday_work"
      },
      {
        "value": "BONUS",
        "label": "Bonus",
        "label_key": "payroll.line.bonus"
      },
      {
        "value": "INCENTIVE",
        "label": "Incentive",
        "label_key": "payroll.line.incentive"
      },
      {
        "value": "OTHER_ADDITION",
        "label": "Other Addition",
        "label_key": "payroll.line.other_addition"
      },
      {
        "value": "ABSENCE",
        "label": "Absence",
        "label_key": "payroll.line.absence"
      },
      {
        "value": "GOSI_EMPLOYEE",
        "label": "Employee GOSI",
        "label_key": "payroll.line.gosi_employee"
      },
      {
        "value": "ATTENDANCE_PENALTY",
        "label": "Attendance Penalty",
        "label_key": "payroll.line.attendance_penalty"
      },
      {
        "value": "PENALTY_FINE",
        "label": "Penalty Fine",
        "label_key": "payroll.line.penalty_fine"
      },
      {
        "value": "PENALTY_WAGE_WITHHOLDING",
        "label": "Penalty Wage Withholding",
        "label_key": "payroll.line.penalty_wage_withholding"
      },
      {
        "value": "LOAN",
        "label": "Loan",
        "label_key": "payroll.line.loan"
      },
      {
        "value": "OTHER_DEDUCTION",
        "label": "Other Deduction",
        "label_key": "payroll.line.other_deduction"
      },
      {
        "value": "PREVIOUS_TOTAL_DEDUCTIONS",
        "label": "Previous total deductions",
        "label_key": "payroll.line.previous_total_deductions"
      },
      {
        "value": "MEDICAL",
        "label": "Medical",
        "label_key": "payroll.line.medical"
      },
      {
        "value": "ID_COST",
        "label": "ID Cost",
        "label_key": "payroll.line.id_cost"
      },
      {
        "value": "AIR_TICKET",
        "label": "Air Ticket",
        "label_key": "payroll.line.air_ticket"
      },
      {
        "value": "LEAVE_PROVISION",
        "label": "Leave Provision",
        "label_key": "payroll.line.leave_provision"
      },
      {
        "value": "EOS_PROVISION",
        "label": "EOS Provision",
        "label_key": "payroll.line.eos_provision"
      },
      {
        "value": "ACCOMMODATION_COST",
        "label": "Company accommodation cost",
        "label_key": "payroll.line.accommodation_cost"
      },
      {
        "value": "GOSI_COMPANY",
        "label": "Company GOSI",
        "label_key": "payroll.line.gosi_company"
      }
    ],
    "zero_salary_reason": [
      {
        "value": "full_leave",
        "label": "Full leave",
        "label_key": "payroll.zero_salary_reason.full_leave"
      },
      {
        "value": "full_absence",
        "label": "Full absence",
        "label_key": "payroll.zero_salary_reason.full_absence"
      },
      {
        "value": "unpaid_leave",
        "label": "Unpaid leave",
        "label_key": "payroll.zero_salary_reason.unpaid_leave"
      },
      {
        "value": "not_joined",
        "label": "Not joined",
        "label_key": "payroll.zero_salary_reason.not_joined"
      },
      {
        "value": "suspended",
        "label": "Suspended",
        "label_key": "payroll.zero_salary_reason.suspended"
      },
      {
        "value": "other",
        "label": "Other",
        "label_key": "payroll.zero_salary_reason.other"
      }
    ],
    "accommodation_status": [
      {
        "value": "assigned",
        "label": "Assigned",
        "label_key": "payroll.accommodation_status.assigned"
      },
      {
        "value": "none",
        "label": "No company accommodation",
        "label_key": "payroll.accommodation_status.none"
      },
      {
        "value": "unknown",
        "label": "Accommodation unknown",
        "label_key": "payroll.accommodation_status.unknown"
      }
    ],
    "adjustment_type": [
      {
        "value": "ABSENCE_OVERRIDE",
        "label": "Absence Override",
        "label_key": "payroll.adjustment.absence_override"
      },
      {
        "value": "ADDITION_ENTRY",
        "label": "Addition Entry",
        "label_key": "payroll.adjustment.addition_entry"
      },
      {
        "value": "OTHER_DEDUCTION_ENTRY",
        "label": "Other Deduction Entry",
        "label_key": "payroll.adjustment.other_deduction_entry"
      },
      {
        "value": "SALARY_ADJUSTMENT",
        "label": "Salary Adjustment",
        "label_key": "payroll.adjustment.salary_adjustment"
      },
      {
        "value": "ZERO_SALARY_REASON",
        "label": "Zero Salary Reason",
        "label_key": "payroll.adjustment.zero_salary_reason"
      },
      {
        "value": "OVERTIME_ELIGIBILITY_OVERRIDE",
        "label": "Normal Overtime Hours Limit Override",
        "label_key": "payroll.adjustment.overtime_eligibility_override"
      },
      {
        "value": "LEAVE_INPUT_CHANGE",
        "label": "Leave Input Change",
        "label_key": "payroll.adjustment.leave_input_change"
      },
      {
        "value": "EMPLOYMENT_INPUT_CHANGE",
        "label": "Employment Input Change",
        "label_key": "payroll.adjustment.employment_input_change"
      },
      {
        "value": "MANUAL_ADJUSTMENT",
        "label": "Manual Adjustment",
        "label_key": "payroll.adjustment.manual_adjustment"
      },
      {
        "value": "SETTINGS_REFRESH",
        "label": "Settings Refresh",
        "label_key": "payroll.adjustment.settings_refresh"
      }
    ],
    "validation_severity": [
      {
        "value": "error",
        "label": "Error",
        "label_key": "payroll.validation_severity.error"
      },
      {
        "value": "warning",
        "label": "Warning",
        "label_key": "payroll.validation_severity.warning"
      },
      {
        "value": "info",
        "label": "Information",
        "label_key": "payroll.validation_severity.info"
      }
    ],
    "finalize_state": [
      {
        "value": "finalized",
        "label": "Finalized",
        "label_key": "payroll.finalize_state.finalized"
      },
      {
        "value": "not_finalized",
        "label": "Not finalized",
        "label_key": "payroll.finalize_state.not_finalized"
      }
    ],
    "carry_status": [
      {
        "value": "PENDING",
        "label": "Pending",
        "label_key": "payroll.carry_status.pending"
      },
      {
        "value": "SETTLED",
        "label": "Settled",
        "label_key": "payroll.carry_status.settled"
      }
    ],
    "collection_state": [
      {
        "value": "CLAIMED",
        "label": "Claimed",
        "label_key": "payroll.collection_state.claimed"
      },
      {
        "value": "APPLIED",
        "label": "Applied",
        "label_key": "payroll.collection_state.applied"
      },
      {
        "value": "RELEASED",
        "label": "Released",
        "label_key": "payroll.collection_state.released"
      }
    ],
    "history_type": [
      {
        "value": "SETTINGS_CHANGE",
        "label": "Settings change",
        "label_key": "payroll.history.settings_change"
      },
      {
        "value": "EMPLOYEE_GOSI_CHANGE",
        "label": "Employee GOSI change",
        "label_key": "payroll.history.employee_gosi_change"
      },
      {
        "value": "ASSIGNMENT_CHANGE",
        "label": "Assignment change",
        "label_key": "payroll.history.assignment_change"
      }
    ],
    "validation_codes": [
      {
        "value": "missing_hire_date",
        "label": "Hire date is missing; correct the profile and recalculate.",
        "label_key": "payroll.validation.missing_hire_date",
        "severity": "error"
      },
      {
        "value": "archived_without_date",
        "label": "Archived employee has no archive date.",
        "label_key": "payroll.validation.archived_without_date",
        "severity": "error"
      },
      {
        "value": "prehire_status_conflict",
        "label": "Prehire status conflicts with a hire date in or before this month.",
        "label_key": "payroll.validation.prehire_status_conflict",
        "severity": "error"
      },
      {
        "value": "suspended_pay_decision_required",
        "label": "Choose full pay or zero pay with suspended reason for this run.",
        "label_key": "payroll.validation.suspended_pay_decision_required",
        "severity": "error"
      },
      {
        "value": "terminated_without_end_date",
        "label": "Terminated employee has no archived end-of-service date.",
        "label_key": "payroll.validation.terminated_without_end_date",
        "severity": "error"
      },
      {
        "value": "overtime_limit_not_set",
        "label": "No normal-overtime hours limit is configured; entered hours are allowed.",
        "label_key": "payroll.validation.overtime_limit_not_set",
        "severity": "warning"
      },
      {
        "value": "overtime_not_allowed",
        "label": "Paying normal overtime beyond its limit requires an HR override and reason.",
        "label_key": "payroll.validation.overtime_not_allowed",
        "severity": "error"
      },
      {
        "value": "absence_capped",
        "label": "Absence deduction was capped at the permitted earned pay.",
        "label_key": "payroll.validation.absence_capped",
        "severity": "warning"
      },
      {
        "value": "deductions_capped",
        "label": "Deductions exceeded available pay; unpaid amounts remain pending.",
        "label_key": "payroll.validation.deductions_capped",
        "severity": "warning"
      },
      {
        "value": "uncollected_deduction",
        "label": "An amount of {amount} remains pending for a later run.",
        "label_key": "payroll.validation.uncollected_deduction",
        "severity": "warning"
      },
      {
        "value": "claim_unaffordable",
        "label": "The full claim is unaffordable and remains pending.",
        "label_key": "payroll.validation.claim_unaffordable",
        "severity": "warning"
      },
      {
        "value": "penalty_pending_fine_cap",
        "label": "The penalty remains pending because of the monthly fine cap.",
        "label_key": "payroll.validation.penalty_pending_fine_cap",
        "severity": "warning"
      },
      {
        "value": "penalty_absence_overlap",
        "label": "Previously withheld wage dates were excluded from absence.",
        "label_key": "payroll.validation.penalty_absence_overlap",
        "severity": "warning"
      },
      {
        "value": "penalty_wage_evidence_missing",
        "label": "Wage withholding dates require reconciliation before finalization.",
        "label_key": "payroll.validation.penalty_wage_evidence_missing",
        "severity": "error"
      },
      {
        "value": "accommodation_unknown",
        "label": "Accommodation cost is unknown; company cost is incomplete.",
        "label_key": "payroll.validation.accommodation_unknown",
        "severity": "warning"
      },
      {
        "value": "rent_value_missing",
        "label": "Assigned rent has no annual value.",
        "label_key": "payroll.validation.rent_value_missing",
        "severity": "error"
      },
      {
        "value": "rent_reconciliation_failed",
        "label": "Raw rent allocations do not reconcile.",
        "label_key": "payroll.validation.rent_reconciliation_failed",
        "severity": "error"
      },
      {
        "value": "medical_invoice_missing",
        "label": "Medical invoice is missing; company cost is incomplete.",
        "label_key": "payroll.validation.medical_invoice_missing",
        "severity": "warning"
      },
      {
        "value": "zero_salary_reason_required",
        "label": "A zero-pay reason is required.",
        "label_key": "payroll.validation.zero_salary_reason_required",
        "severity": "error"
      },
      {
        "value": "zero_salary_detail_required",
        "label": "Provide details for the other zero-pay reason.",
        "label_key": "payroll.validation.zero_salary_detail_required",
        "severity": "error"
      },
      {
        "value": "salary_total_mismatch",
        "label": "Profile total differs from salary components; components were used.",
        "label_key": "payroll.validation.salary_total_mismatch",
        "severity": "warning"
      },
      {
        "value": "payroll_reconciliation_failed",
        "label": "Run, items and payslips do not reconcile.",
        "label_key": "payroll.validation.payroll_reconciliation_failed",
        "severity": "error"
      },
      {
        "value": "legacy_link_unresolved",
        "label": "A legacy payroll employee link needs reconciliation.",
        "label_key": "payroll.validation.legacy_link_unresolved",
        "severity": "error"
      },
      {
        "value": "attendance_calendar_missing",
        "label": "Working-day evidence is required to determine full-month absence.",
        "label_key": "payroll.validation.attendance_calendar_missing",
        "severity": "error"
      },
      {
        "value": "invalid_decimal",
        "label": "Enter a finite nonnegative decimal string.",
        "label_key": "payroll.validation.invalid_decimal",
        "severity": "error"
      },
      {
        "value": "invalid_quantity",
        "label": "Enter a valid nonnegative day or hour quantity.",
        "label_key": "payroll.validation.invalid_quantity",
        "severity": "error"
      },
      {
        "value": "invalid_choice",
        "label": "Select a supported value.",
        "label_key": "payroll.validation.invalid_choice",
        "severity": "error"
      },
      {
        "value": "invalid_period",
        "label": "Select a valid payroll year and month.",
        "label_key": "payroll.validation.invalid_period",
        "severity": "error"
      },
      {
        "value": "invalid_calendar_days",
        "label": "Enter 1 to 30 calendar days without exceeding the selected month.",
        "label_key": "payroll.validation.invalid_calendar_days",
        "severity": "error"
      },
      {
        "value": "reason_required",
        "label": "A reason is required.",
        "label_key": "payroll.validation.reason_required",
        "severity": "error"
      },
      {
        "value": "invalid_date_range",
        "label": "The end date must be on or after the start date.",
        "label_key": "payroll.validation.invalid_date_range",
        "severity": "error"
      },
      {
        "value": "assignment_overlap",
        "label": "An accommodation assignment overlaps these dates.",
        "label_key": "payroll.validation.assignment_overlap",
        "severity": "error"
      },
      {
        "value": "company_mismatch",
        "label": "Referenced records must belong to the same company.",
        "label_key": "payroll.validation.company_mismatch",
        "severity": "error"
      },
      {
        "value": "duplicate_period",
        "label": "Payroll run already exists for this period.",
        "label_key": "payroll.validation.duplicate_period",
        "severity": "error"
      },
      {
        "value": "stale_revision",
        "label": "Payroll data changed; reload and retry.",
        "label_key": "payroll.validation.stale_revision",
        "severity": "error"
      },
      {
        "value": "run_not_draft",
        "label": "Only a draft payroll run can be changed or cancelled.",
        "label_key": "payroll.validation.run_not_draft",
        "severity": "error"
      },
      {
        "value": "run_cancelled",
        "label": "Cancelled runs cannot be finalized.",
        "label_key": "payroll.validation.run_cancelled",
        "severity": "error"
      },
      {
        "value": "run_not_finalized",
        "label": "Finalize the payroll run before generating payslips.",
        "label_key": "payroll.validation.run_not_finalized",
        "severity": "error"
      },
      {
        "value": "confirm_required",
        "label": "confirm must be true.",
        "label_key": "payroll.validation.confirm_required",
        "severity": "error"
      },
      {
        "value": "invalid_export_format",
        "label": "file_format must be one of: csv, pdf, xlsx.",
        "label_key": "payroll.validation.invalid_export_format",
        "severity": "error"
      },
      {
        "value": "field_not_editable",
        "label": "This field cannot be edited here.",
        "label_key": "payroll.validation.field_not_editable",
        "severity": "error"
      },
      {
        "value": "amount_out_of_range",
        "label": "Amount exceeds the supported payroll range.",
        "label_key": "payroll.validation.amount_out_of_range",
        "severity": "error"
      },
      {
        "value": "policy_decision_required",
        "label": "This calculation needs an approved payroll policy.",
        "label_key": "payroll.validation.policy_decision_required",
        "severity": "error"
      },
      {
        "value": "overtime_over_allowed",
        "label": "Normal overtime exceeds the monthly hours limit; excess requires an audited HR override to be paid.",
        "label_key": "payroll.validation.overtime_over_allowed",
        "severity": "warning"
      },
      {
        "value": "attendance_source_unavailable",
        "label": "Attendance source does not cover the employed dates; HR must confirm manual absence days when required.",
        "label_key": "payroll.validation.attendance_source_unavailable",
        "severity": "warning"
      }
    ],
    "suspended_pay_decision": [
      {
        "value": "FULL_PAY",
        "label": "Full pay",
        "label_key": "payroll.suspended_pay_decision.full_pay"
      },
      {
        "value": "ZERO_PAY",
        "label": "Zero pay",
        "label_key": "payroll.suspended_pay_decision.zero_pay"
      }
    ],
    "provision_proration": [
      {
        "value": "FULL_MONTH",
        "label": "Full month",
        "label_key": "payroll.provision_proration.full_month"
      },
      {
        "value": "PRORATED_BY_DAYS",
        "label": "Prorated by payable days",
        "label_key": "payroll.provision_proration.prorated_by_days"
      }
    ]
  }
}
```

### S: company settings (GET and successful PATCH)

```json
{
  "status": "success",
  "data": {
    "id": 1,
    "company_id": 1,
    "settings_revision": 2,
    "day_basis": 30,
    "rounding": "ROUND_HALF_UP",
    "provision_proration": "FULL_MONTH",
    "absence_base": {
      "type": "GROSS",
      "fixed_amount": null
    },
    "gosi_base": {
      "type": "BASIC_HOUSING",
      "fixed_amount": null
    },
    "leave_base": {
      "type": "BASIC",
      "fixed_amount": null
    },
    "eos_base": {
      "type": "BASIC",
      "fixed_amount": null
    },
    "overtime_base": {
      "type": "BASIC",
      "fixed_amount": null
    },
    "foreign_gosi_rate": "0.020000",
    "saudi_gosi_rate": "0.097500",
    "annual_medical_invoice": "12000.00",
    "monthly_foreign_id_cost": "862.50",
    "annual_air_ticket": "1500.00",
    "overtime_default_is_assumption": true,
    "assumptions": [
      {
        "key": "payroll.assumption.overtime_basic",
        "message": "Overtime defaults to Basic salary; HR may configure the base."
      },
      {
        "key": "payroll.assumption.overtime_calendar_month",
        "message": "Normal overtime limit applies once per payroll window (assumption)."
      }
    ],
    "updated_at": "2026-10-11T09:00:00Z",
    "no_medical_insurance": false,
    "require_manual_absence_confirmation": false,
    "normal_overtime_limit_period": "PAYROLL_WINDOW"
  }
}
```

GET never creates settings or emits a write audit. For an unconfigured company return effective documented defaults, id null/settings_revision 0, annual_medical_invoice null. First PATCH persists row revision 1 under lock. Snapshot uses those exact resolved values.

The worked S/R/I/summary fixtures below assume fully covered active BioTime mappings and resolvable schedule evidence for all ten included employees, with FULL_MONTH provision mode. Zero absence-source warnings in those examples are conditional on that explicit fixture, not a claim about current employee data.

### R: run (create, list item and detail)

Complete example fixture: 10 included foreign employees each have the A salary/absence example, explicit 12,000 medical invoice, and each is one of 10 full-month residents of a rent with annual value 12,000. No additions or employee GOSI; all dates known. Per employee company cost = 12,035 +100 medical +100 rent =12,235.

```json
{
  "status": "success",
  "data": {
    "id": 7,
    "year": 2026,
    "month": 9,
    "calendar_days": 30,
    "period_basis": "DATE_RANGE",
    "status": "DRAFT",
    "total_net": "102670.00",
    "total_employees": 10,
    "company_id": 1,
    "company_name": "Example Company",
    "period_start": "2026-09-01",
    "period_end": "2026-09-30",
    "revision": 1,
    "total_gross": "110000.00",
    "total_additions": "0.00",
    "total_deductions": "7330.00",
    "total_provisions": "19680.00",
    "total_company_cost": "122350.00",
    "cost_incomplete": false,
    "settings_revision": 2,
    "settings_snapshot": {
      "schema_version": 1,
      "company_id": 1,
      "settings_revision": 2,
      "day_basis": 30,
      "rounding": "ROUND_HALF_UP",
      "provision_proration": "FULL_MONTH",
      "absence_base": {
        "type": "GROSS",
        "fixed_amount": null
      },
      "gosi_base": {
        "type": "BASIC_HOUSING",
        "fixed_amount": null
      },
      "leave_base": {
        "type": "BASIC",
        "fixed_amount": null
      },
      "eos_base": {
        "type": "BASIC",
        "fixed_amount": null
      },
      "overtime_base": {
        "type": "BASIC",
        "fixed_amount": null
      },
      "foreign_gosi_rate": "0.020000",
      "saudi_gosi_rate": "0.097500",
      "annual_medical_invoice": "12000.00",
      "monthly_foreign_id_cost": "862.50",
      "annual_air_ticket": "1500.00",
      "overtime_default_is_assumption": true,
      "payroll_timezone": "Asia/Riyadh",
      "no_medical_insurance": false,
      "require_manual_absence_confirmation": false,
      "normal_overtime_limit_period": "PAYROLL_WINDOW"
    },
    "calculator_version": "1",
    "legacy_calculation": false,
    "calculated_at": "2026-10-11T09:00:00Z",
    "finalized_at": null,
    "paid_at": null,
    "cancelled_at": null,
    "cancel_reason": null,
    "validation_counts": {
      "errors": 0,
      "warnings": 0
    },
    "cancelled_by": null
  }
}
```

`payroll_timezone` in this illustrative snapshot uses the verified source default Asia/Riyadh (APP_TIME_ZONE/TIME_ZONE environment overrides are supported); this is not an instruction to change the application timezone. The implementation freezes the resolved configured value. Authoring/handoff dates use the client Africa/Cairo timezone. Timestamps are ISO 8601 instants with offset or Z. Net/provision/company totals are HR-only at run level.

### I: HR run item (items list/detail and successful item PATCH)

`monthly_salary_components` contains exactly the six full monthly salary inputs used by the run, after any active run-local salary adjustment, as two-decimal strings. These values come from the frozen run item input snapshot, never the current employee profile or a reverse calculation from paid lines. `salary_adjusted` is a boolean indicating that a run-local salary adjustment is active. Existing `basic_salary` and allowance scalars, and the `salary_components` line array, remain the **paid (prorated and independently rounded)** amounts. Prefill PATCH `changes.salary_components` from `monthly_salary_components`, never those paid fields. In the full-month I example below monthly and paid amounts coincide; for a June16 joiner monthly Basic6,000 remains6,000.00 while paid Basic is3,000.00. For legacy records without the original monthly input snapshot, the new object is null (unknown; unsafe to prefill), not guessed from paid values; their existing edit restrictions remain unchanged.

`executive_exempt` is a readonly HR-only boolean frozen from the calculation inputs; it identifies the section2.7 exemption used by this run, rather than recomputing the current profile on read. It is not accepted in PATCH and is absent from employee-facing payslip DTOs.

`manual_inputs` exposes exactly the nine entered run-local input fields shown below, read from the stored overrides rather than rounded/collected lines. Decimal entries retain halalas and serialize with two decimals. `absence_days_override` is null when no override was entered or it was cleared; the seven other numeric fields default to "0.00" when not entered, and `override_overtime_eligibility` defaults to false. Observed attendance/leave does not populate a manual override. An entered bonus "250.50" returns `manual_inputs.bonus: "250.50"` while the existing bonus scalar and posted BONUS line remain "251.00" under HALF_UP. No existing scalar or calculation changes. In the I example, the two absence days are observed, so manual absence remains null.

```json
{
  "status": "success",
  "data": {
    "id": 71,
    "payroll_run_id": 7,
    "run_revision": 1,
    "employee_profile_id": 101,
    "employee_id": "EMP-001",
    "employee_name": "Example Employee",
    "department": "Operations",
    "position": "Engineer",
    "has_user_account": true,
    "payslip_id": 201,
    "monthly_salary_components": {
      "basic_salary": "6000.00",
      "accommodation_allowance": "3000.00",
      "transportation_allowance": "1500.00",
      "telephone_allowance": "0.00",
      "petrol_allowance": "0.00",
      "other_allowance": "500.00"
    },
    "salary_adjusted": false,
    "executive_exempt": false,
    "manual_inputs": {
      "absence_days_override": null,
      "overtime_normal_hours": "0.00",
      "weekly_rest_work_days": "0.00",
      "official_holiday_work_days": "0.00",
      "bonus": "0.00",
      "incentive": "0.00",
      "other_addition": "0.00",
      "other_deduction": "0.00",
      "override_overtime_eligibility": false
    },
    "basic_salary": "6000.00",
    "accommodation_allowance": "3000.00",
    "transportation_allowance": "1500.00",
    "telephone_allowance": "0.00",
    "petrol_allowance": "0.00",
    "other_allowance": "500.00",
    "total_allowances": "5000.00",
    "full_monthly_gross": "11000.00",
    "gross_salary": "11000.00",
    "total_additions": "0.00",
    "total_deductions": "733.00",
    "net_salary": "10267.00",
    "absence_deduction": "733.00",
    "gosi_employee_deduction": "0.00",
    "loan_deduction": "0.00",
    "penalty_deduction": "0.00",
    "other_deduction": "0.00",
    "overtime_normal": "0.00",
    "weekly_rest_work": "0.00",
    "official_holiday_work": "0.00",
    "bonus": "0.00",
    "incentive": "0.00",
    "other_addition": "0.00",
    "medical_provision": "100.00",
    "id_cost_provision": "863.00",
    "air_ticket_provision": "125.00",
    "leave_provision": "350.00",
    "eos_provision": "250.00",
    "accommodation_cost": "100.00",
    "gosi_company_provision": "180.00",
    "total_provisions": "1968.00",
    "total_company_cost": "12235.00",
    "cost_incomplete": false,
    "accommodation_status": "assigned",
    "hire_date": "2023-01-01",
    "archive_date": null,
    "salary_days": "30.00",
    "employed_calendar_days": 30,
    "absence": {
      "attendance_days": "2.00",
      "unpaid_leave_days": "0.00",
      "paid_leave_days": "0.00",
      "penalty_withheld_days": "0.00",
      "override_days": null,
      "effective_days": "2.00",
      "full_month_absence": false,
      "base_type": "GROSS",
      "monthly_base": "11000.00",
      "authorized_amount": "733.00",
      "capped_amount": "0.00",
      "source_available": true,
      "mapping_start_date": null,
      "uncovered_dates": [],
      "manual_confirmed": false,
      "manual_confirmation_required": false
    },
    "overtime": {
      "normal_hours": "0.00",
      "weekly_rest_days": "0.00",
      "official_holiday_days": "0.00",
      "allowed_overtime": 1,
      "override_overtime_eligibility": false,
      "payable_normal_hours": "0.00",
      "over_allowed_hours": "0.00",
      "unpaid_normal_hours": "0.00",
      "limit_period": "PAYROLL_WINDOW"
    },
    "deduct_gosi_from_employee": false,
    "zero_salary_reason": null,
    "zero_salary_reason_detail": null,
    "carry_forward": {
      "carried_in": "0.00",
      "requested": "733.00",
      "collected": "733.00",
      "uncollected": "0.00",
      "by_category": [
        {
          "type": "ABSENCE",
          "carried_in": "0.00",
          "requested": "733.00",
          "collected": "733.00",
          "uncollected": "0.00",
          "manual_reentry_required": false
        }
      ]
    },
    "salary_components": [
      {
        "type": "BASIC_SALARY",
        "label": "Basic Salary",
        "label_key": "payroll.line.basic_salary",
        "amount": "6000.00"
      },
      {
        "type": "ACCOMMODATION_ALLOWANCE",
        "label": "Housing",
        "label_key": "payroll.line.accommodation_allowance",
        "amount": "3000.00"
      },
      {
        "type": "TRANSPORTATION_ALLOWANCE",
        "label": "Transportation",
        "label_key": "payroll.line.transportation_allowance",
        "amount": "1500.00"
      },
      {
        "type": "TELEPHONE_ALLOWANCE",
        "label": "Telephone",
        "label_key": "payroll.line.telephone_allowance",
        "amount": "0.00"
      },
      {
        "type": "PETROL_ALLOWANCE",
        "label": "Petrol",
        "label_key": "payroll.line.petrol_allowance",
        "amount": "0.00"
      },
      {
        "type": "OTHER_ALLOWANCE",
        "label": "Other Allowance",
        "label_key": "payroll.line.other_allowance",
        "amount": "500.00"
      }
    ],
    "additions": [],
    "deductions": [
      {
        "id": 301,
        "type": "ABSENCE",
        "label": "Absence",
        "label_key": "payroll.line.absence",
        "amount": "733.00",
        "quantity": "2.00",
        "source_kind": "attendance_absence",
        "source_id": null,
        "source_period": {
          "year": 2026,
          "month": 9
        },
        "requested_amount": "733.00",
        "collected_amount": "733.00",
        "uncollected_amount": "0.00",
        "carried_in": false
      }
    ],
    "provisions": [
      {
        "type": "MEDICAL",
        "amount": "100.00",
        "label": "Medical",
        "label_key": "payroll.line.medical"
      },
      {
        "type": "ID_COST",
        "amount": "863.00",
        "label": "ID Cost",
        "label_key": "payroll.line.id_cost"
      },
      {
        "type": "AIR_TICKET",
        "amount": "125.00",
        "label": "Air Ticket",
        "label_key": "payroll.line.air_ticket"
      },
      {
        "type": "LEAVE_PROVISION",
        "amount": "350.00",
        "label": "Leave Provision",
        "label_key": "payroll.line.leave_provision"
      },
      {
        "type": "EOS_PROVISION",
        "amount": "250.00",
        "label": "EOS Provision",
        "label_key": "payroll.line.eos_provision"
      },
      {
        "type": "ACCOMMODATION_COST",
        "amount": "100.00",
        "label": "Company accommodation cost",
        "label_key": "payroll.line.accommodation_cost"
      },
      {
        "type": "GOSI_COMPANY",
        "amount": "180.00",
        "label": "Company GOSI",
        "label_key": "payroll.line.gosi_company"
      }
    ],
    "warnings": [],
    "assumptions": [],
    "suspended_pay_decision": null
  }
}
```

All seven provision entries include label and label_key by the enum rules, as salary/deduction entries do; the example enumerates the complete provision values. Empty additions/deductions arrays mean no entries; all six salary lines and seven provision types remain present, with unknown provision amounts null. Item scalar columns aggregate the indicated type, including any carry-in of that type. penalty_deduction aggregates ATTENDANCE_PENALTY, PENALTY_FINE and PENALTY_WAGE_WITHHOLDING. `requested/collected/uncollected` in carry_forward cover all current/carry-in eligible deductions, despite the compatibility-friendly container name.

I.`warnings` contains warnings only (severity warning), using the validation issue DTO (section V). Blocking errors, including suspended_pay_decision_required and zero_salary_detail_required, appear only in the validation report errors array, not in item.warnings. `has_user_account:false` does not suppress item/payslip_id. Source IDs are opaque strings or null, never user-controlled references in employee endpoints. Zero salary reasons do not substitute for absence overrides. `gross_salary` denotes earned salary; `full_monthly_gross` is the base snapshot.

### H: immutable adjustment/settings history entry

```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": 401,
        "audit_log_id": 9001,
        "type": "ABSENCE_OVERRIDE",
        "changed_fields": [
          "absence.override_days"
        ],
        "original_value": {
          "absence.override_days": null,
          "absence.effective_days": "2.00"
        },
        "new_value": {
          "absence.override_days": "1.00",
          "absence.effective_days": "1.00"
        },
        "reason": "Approved attendance correction awaiting source update",
        "actor": {
          "id": 5,
          "name": "Example HR"
        },
        "created_at": "2026-10-11T10:00:00Z",
        "run_revision": 2
      }
    ],
    "page": 1,
    "page_size": 25,
    "count": 1,
    "total_pages": 1
  }
}
```

Settings/config/assignment histories use the same values/audit/actor/time shape, replacing run_revision with settings_revision or assignment_id and type with `SETTINGS_CHANGE`, `EMPLOYEE_GOSI_CHANGE` or `ASSIGNMENT_CHANGE` (history-only values, translation keys `payroll.history.settings_change`, `.employee_gosi_change`, `.assignment_change`). Immutable audit projection; audit-log access is not granted generally to CFO/HR.

### V: validation report

```json
{
  "status": "success",
  "data": {
    "run_id": 7,
    "revision": 3,
    "can_finalize": false,
    "errors": [
      {
        "code": "missing_hire_date",
        "severity": "error",
        "message": "Hire date is missing; correct the profile and recalculate.",
        "message_key": "payroll.validation.missing_hire_date",
        "employee": {
          "employee_profile_id": 101,
          "employee_id": "EMP-001",
          "employee_name": "Example Employee",
          "item_id": 71
        },
        "field": "hire_date",
        "params": {}
      }
    ],
    "warnings": [
      {
        "code": "claim_unaffordable",
        "severity": "warning",
        "message": "The full claim is unaffordable and remains pending.",
        "message_key": "payroll.validation.claim_unaffordable",
        "employee": {
          "employee_profile_id": 102,
          "employee_id": "EMP-002",
          "employee_name": "Example Resident",
          "item_id": 72
        },
        "field": "loan_deduction",
        "params": {
          "source_kind": "loan",
          "source_id": "55",
          "type": "LOAN",
          "requested_amount": "2000.00",
          "collected_amount": "0.00",
          "uncollected_amount": "2000.00"
        }
      }
    ],
    "counts": {
      "errors": 1,
      "warnings": 1
    },
    "employees_checked": 10,
    "excluded_employees_checked": 1,
    "reconciliation": {
      "total_net": "102670.00",
      "items_net": "102670.00",
      "payslips_net": "102670.00",
      "item_count": 10,
      "payslip_count": 10,
      "matches": true
    },
    "finalize_state": "not_finalized",
    "infos": []
  }
}
```

V adds `finalize_state` (`finalized` for COMPLETED/PAID; `not_finalized` otherwise) and `infos` (issue objects with severity `info`, empty when none). For COMPLETED/PAID only, project any blocking issue as info without changing its code, message, params or stored snapshot; return errors [], counts.errors 0 and can_finalize true. Existing warnings/counts.warnings remain unchanged. `can_finalize` here means no outstanding finalization barrier; finalized state is not permission to edit or repeat a transition. Draft blocking issues remain errors. The existing counts object has only errors/warnings; infos do not increment either. Run/summary validation_counts use that same projection. Reconciliation.matches still reports the actual match result, including false on a finalized run; such a failure is informational in V, while publication still enforces reconciliation through its existing guard. CANCELLED and other nonfinalized behavior is unchanged.

The issue `field` property is optional and omitted when no corresponding field is present; it is not a required or null placeholder. Excluded archived/PREHIRE/TERMINATED profiles use employee.item_id null. Run-level errors use employee null. Absence capping, pending fines, claim_unaffordable, unknown overtime and cost incomplete are warnings; missing dates/linkage/reconciliation are errors. This endpoint is nonpaginated to guarantee the entire pre-finalize report. Optional filters select errors/warnings/infos by employee, code and projected severity; they do **not** change global counts, can_finalize, finalize_state, reconciliation or the blocking decision. Counts retain the unfiltered report values (existing behavior).

### A: accommodation assignment

```json
{
  "status": "success",
  "data": {
    "id": 501,
    "company_id": 1,
    "employee_profile_id": 101,
    "employee_id": "EMP-001",
    "employee_name": "Example Employee",
    "status": "assigned",
    "rent_id": 11,
    "rent_name": "Example Residence",
    "start_date": "2026-09-01",
    "end_date": "2026-12-31",
    "is_active": true,
    "created_by": {
      "id": 5,
      "name": "Example HR"
    },
    "updated_by": {
      "id": 5,
      "name": "Example HR"
    },
    "created_at": "2026-09-01T08:00:00Z",
    "updated_at": "2026-09-01T08:00:00Z"
  }
}
```

For none/unknown, rent_id and rent_name null. Assignment presence/occupancy is date-based; is_active represents a valid (not soft-deleted) record. Historical payroll snapshots do not change when a current assignment is edited.

### EP: employee detail (strict whitelist)

```json
{
  "status": "success",
  "data": {
    "id": 201,
    "year": 2026,
    "month": 9,
    "basic_salary": "6000.00",
    "transportation_allowance": "1500.00",
    "accommodation_allowance": "3000.00",
    "telephone_allowance": "0.00",
    "petrol_allowance": "0.00",
    "other_allowance": "500.00",
    "total_salary": "11000.00",
    "total_deductions": "733.00",
    "net_salary": "10267.00",
    "payment_mode": "Bank Transfer",
    "status": "COMPLETED",
    "gross_salary": "11000.00",
    "total_additions": "0.00",
    "salary_components": [
      {
        "type": "BASIC_SALARY",
        "label": "Basic Salary",
        "label_key": "payroll.line.basic_salary",
        "amount": "6000.00"
      },
      {
        "type": "ACCOMMODATION_ALLOWANCE",
        "label": "Housing",
        "label_key": "payroll.line.accommodation_allowance",
        "amount": "3000.00"
      },
      {
        "type": "TRANSPORTATION_ALLOWANCE",
        "label": "Transportation",
        "label_key": "payroll.line.transportation_allowance",
        "amount": "1500.00"
      },
      {
        "type": "TELEPHONE_ALLOWANCE",
        "label": "Telephone",
        "label_key": "payroll.line.telephone_allowance",
        "amount": "0.00"
      },
      {
        "type": "PETROL_ALLOWANCE",
        "label": "Petrol",
        "label_key": "payroll.line.petrol_allowance",
        "amount": "0.00"
      },
      {
        "type": "OTHER_ALLOWANCE",
        "label": "Other Allowance",
        "label_key": "payroll.line.other_allowance",
        "amount": "500.00"
      }
    ],
    "additions": [],
    "deductions": [
      {
        "type": "ABSENCE",
        "label": "Absence",
        "label_key": "payroll.line.absence",
        "amount": "733.00",
        "quantity": "2.00",
        "source_period": {
          "year": 2026,
          "month": 9
        }
      }
    ],
    "legacy_calculation": false
  }
}
```

Employee list entry is exactly `{id,year,month,net_salary,payment_mode,status}` as today (money strings). Detail additions/deductions share `{type,label,label_key,amount,quantity,source_period}`; quantity/source_period may be null. Include only **collected** employee deductions. GOSI_EMPLOYEE appears when flagged and collected; GOSI_COMPANY never appears. No HR carry-forward balances, source models/IDs, provisions, company cost/incompleteness, settings snapshot, nationality, other employees, audits, manual reasons or rent metadata. `total_salary` remains an earned gross alias; it excludes additions, which are separately shown. Old PREVIOUS_TOTAL_DEDUCTIONS carries historical exact money.

The employee PDF uses the same whitelist, snapshot identity/period, salary lines, additions, deductions, net/payment/status and translated labels. Do not pass an HR item serializer to the PDF template. Tests must assert restricted keys/types are absent from list/detail/download and inspect the actual PDF rendering inputs/text, not just mock the builder.

## 7. Endpoint directory: exact methods, paths, requests and responses

Paths below use trailing slash; both forms are retained for existing endpoints and proposed routers. Numeric run_id/item_id/payslip_id/profile_id/assignment_id are PKs, **not employee_id strings**. Every row inherits common guards/errors in section 4; listed domain statuses are additional. Responses labelled S/R/I/A/EP/V/H are the complete examples above; a paginated result wraps that example's data in items. Binary endpoints have no JSON success body. No PATCH/DELETE run endpoint is introduced.

### 7.1 Settings, employee GOSI configuration and enum directory

| Method + exact path | Permission; query | Request JSON example | Response example; domain status |
|---|---|---|---|
| GET `/payroll-settings/` | P; none | No body | S; 200. |
| PATCH `/payroll-settings/` | P; none | `{"expected_revision":2,"absence_base":{"type":"GROSS","fixed_amount":null},"overtime_base":{"type":"BASIC","fixed_amount":null},"annual_medical_invoice":"12000.00","provision_proration":"PRORATED_BY_DAYS","require_manual_absence_confirmation":true,"reason":"Annual invoice and draft policies selected"}` | S with settings_revision 3, the supplied proration/confirmation values and new timestamp; 200; invalid base/amount/reason 422, stale 409. Sparse update; no PUT. |
| GET `/payroll-settings/salary-bases/` | P; none | No body | `{"status":"success","data":{"items":[{"value":"BASIC","label":"Basic","label_key":"payroll.salary_base.basic"},{"value":"BASIC_HOUSING","label":"Basic + Housing","label_key":"payroll.salary_base.basic_housing"},{"value":"BASIC_HOUSING_TRANSPORT","label":"Basic + Housing + Transportation","label_key":"payroll.salary_base.basic_housing_transport"},{"value":"GROSS","label":"Gross","label_key":"payroll.salary_base.gross"},{"value":"FIXED_AMOUNT","label":"Fixed amount","label_key":"payroll.salary_base.fixed_amount"}]}}`; 200, nonpaginated. |
| GET `/payroll-settings/enums/` | P; none | No body | ENUM, the complete exact response in section 6; 200, nonpaginated. Every code includes its default severity; an issue instance may use context-specific severity documented in section 5. |
| GET `/payroll-settings/history/` | P; page/page_size, date_from/date_to YYYY-MM-DD, actor_id integer | No body; e.g. `?page=1&page_size=25` | H settings form, newest audit first; 200; invalid filters 422. |
| GET `/payroll-settings/employees/{employee_profile_id}/` | P; strict active company; none | No body | `{"status":"success","data":{"employee_profile_id":101,"employee_id":"EMP-001","deduct_gosi_from_employee":false,"settings_revision":0}}`; 200/404. Revision is payroll employee-config revision, not company settings. |
| PATCH `/payroll-settings/employees/{employee_profile_id}/` | P; none | `{"expected_revision":0,"deduct_gosi_from_employee":true,"reason":"Employee GOSI bearing arrangement confirmed"}` | `{"status":"success","data":{"employee_profile_id":101,"employee_id":"EMP-001","deduct_gosi_from_employee":true,"settings_revision":1}}`; 200, 422, stale 409. Requires an employee-config revision field on EmployeeProfile or locked payroll config record in Phase 1; proposed EmployeeProfile `payroll_config_revision` integer default 0. Existing runs change only after DRAFT recalculate. |
| GET `/payroll-settings/employees/{employee_profile_id}/history/` | P; page/page_size, date_from/date_to, actor_id | No body | H employee-GOSI form; 200/404/422. |

Writable company fields: absence_base, gosi_base, leave_base, eos_base, overtime_base (whole selector object required when supplied); foreign_gosi_rate, saudi_gosi_rate; annual_medical_invoice (null or money); no_medical_insurance (boolean); provision_proration (FULL_MONTH/PRORATED_BY_DAYS, default FULL_MONTH); require_manual_absence_confirmation (boolean, default false); monthly_foreign_id_cost; annual_air_ticket. Rate strings allow up to six fractional places in [0,1], never percentages 2/9.75. Constants and company/id/revision/timestamps are read-only. A no-op PATCH returns unchanged revision and no fabricated change history.

### 7.2 Run create/list/detail and items

| Method + exact path | Permission; query | Request JSON example | Response example; domain status |
|---|---|---|---|
| POST `/payroll-runs/` | P; none | `{"period_start":"2026-01-20","period_end":"2026-02-18"}` | R, 201. Both ISO dates are required; the inclusive range may cross month/year boundaries and must contain 1..30 days. Mixed legacy year/month/calendar_days input is rejected. Salary and other daily rates keep divisor30. Any overlapping active company range returns409 duplicate_period; cancelled ranges permit replacements. Draft builds even with report errors; only system/integrity errors roll back creation. |
| GET `/payroll-runs/` | P; year 1900..2100, month 1..12, status enum, page/page_size | No body; `?year=2026&month=9&status=DRAFT&page=1&page_size=25` | `{"status":"success","data":{"items":[],"page":1,"page_size":25,"count":0,"total_pages":1}}` for no matching runs; each nonempty entry is R.data; 200. Order -year,-month,-id. Invalid filters 422 (existing invalid year was ignored; documented behavioral correction). |
| GET `/payroll-runs/{run_id}/` | P; none | No body | R; 200/404. |
| GET `/payroll-runs/{run_id}/items/` | P; employee_profile_id integer, search (employee_id/name), has_warnings true/false, page/page_size | No body; `?employee_profile_id=101&page=1&page_size=25` | Page envelope with I.data items; empty page example as above; 200/404/422. Order id. |
| GET `/payroll-runs/{run_id}/items/{item_id}/` | P; none | No body | I; 200/404, require item belongs to authorized run. |

Legacy run fields and item basic/allowances/deductions/net remain read-only and present. `calendar_days` is numeric on every newly created range and may be null only on pre-window historical rows. Canonical dates are persisted on both; `period_basis=LEGACY_FULL_MONTH` preserves historical full-month salary/rent behavior. All filters are opt-in; no ability to supply company/owner bypass. No employee email/national_id is necessary in HR item responses. HR CSV/XLSX exports and payroll/payslip PDFs display the inclusive dates and effective day count.

### 7.3 Summary, validation, recalculation, finalize, publication, cancellation

| Method + exact path | Permission; query | Request JSON example | Response example; domain status |
|---|---|---|---|
| GET `/payroll-runs/{run_id}/summary/` | P; none | No body | Summary JSON below; 200/404, nonpaginated. |
| GET `/payroll-runs/{run_id}/validation-report/` | P; employee_profile_id, severity error/warning/info, code from section 5 | No body; `?severity=warning` | V; 200/404/422. Read-only calculation evidence at current revision; does not mutate claims on GET. |
| POST `/payroll-runs/{run_id}/recalculate/` | P; none | `{"expected_revision":1,"refresh_settings":false,"reason":"Attendance and employee dates corrected"}` | `{"status":"success","data":{"message":"Payroll run recalculated.","message_key":"payroll.message.recalculated","run_id":7,"revision":2,"status":"DRAFT","settings_revision":2,"total_net":"102670.00","total_company_cost":"122350.00","cost_incomplete":false,"changed_items":0,"validation_counts":{"errors":0,"warnings":0}}}`; 200, 422 locked/invalid, 409 stale. Revision may advance for refreshed evidence/audit even if money unchanged; repeated same-input calls must not duplicate collections. |
| POST `/payroll-runs/{run_id}/finalize/` | P; PayrollFinalizeThrottle; none | `{"confirm":true,"expected_revision":2,"reason":"HR reconciliation complete"}`; compatible `{"confirm":true}` also accepted | `{"status":"success","data":{"message":"Payroll run finalized.","message_key":"payroll.message.finalized","run_id":7,"revision":3,"status":"COMPLETED","validation_counts":{"errors":0,"warnings":0}}}`; 200; already COMPLETED/PAID returns legacy message `Payroll run already finalized.` and current state without additional transition; blocking report/confirm/cancelled 422, stale 409. |
| POST `/payroll-runs/{run_id}/generate-payslips/` | P; PayrollGeneratePayslipsThrottle; none | `{}` | `{"status":"success","data":{"message":"Payslips generated","message_key":"payroll.message.generated","generated_count":10,"total_payslips":10,"run_status":"PAID","download_pdf_url":"/payroll-runs/7/export/?file_format=pdf"}}`; 200; not finalized 422. Repeating gives generated_count 0; count includes accountless slips, notifications only linked users. |
| POST `/payroll-runs/{run_id}/cancel/` | P; none | `{"expected_revision":1,"reason":"Wrong payroll month selected"}` | `{"status":"success","data":{"message":"Payroll run cancelled.","message_key":"payroll.message.cancelled","run_id":7,"revision":2,"status":"CANCELLED","restored_loans":1,"released_attendance_claims":2,"released_penalty_claims":1,"released_carry_collections":0,"inactive_payslips":10,"cancelled_at":"2026-10-11T10:00:00Z","cancelled_by":5,"cancel_reason":"Wrong payroll month selected"}}`; 200; already cancelled returns same state, zero changed counts, already_cancelled message; COMPLETED/PAID 422, stale 409. |

Finalize rechecks pending sources under locks immediately before freezing, as today; applies the same calculator once and returns latest warnings. It must not commit a status/claim change if validation fails. Do not mutate completed/paid totals on a repeated finalize.

Summary example (same ten-employee fixture):

```json
{
  "status": "success",
  "data": {
    "run_id": 7,
    "year": 2026,
    "month": 9,
    "total_employees": 10,
    "employees_with_deductions": 10,
    "total_basic_salary": "60000.00",
    "total_allowances": "50000.00",
    "total_gross_salary": "110000.00",
    "total_deductions": "7330.00",
    "total_net_salary": "102670.00",
    "average_net_salary": "10267.00",
    "total_additions": "0.00",
    "total_provisions": "19680.00",
    "total_company_cost": "122350.00",
    "cost_incomplete": false,
    "salary_components": {
      "basic_salary": "60000.00",
      "accommodation_allowance": "30000.00",
      "transportation_allowance": "15000.00",
      "telephone_allowance": "0.00",
      "petrol_allowance": "0.00",
      "other_allowance": "5000.00"
    },
    "additions": {
      "overtime_normal": "0.00",
      "weekly_rest_work": "0.00",
      "official_holiday_work": "0.00",
      "bonus": "0.00",
      "incentive": "0.00",
      "other_addition": "0.00"
    },
    "deductions": {
      "absence": "7330.00",
      "gosi_employee": "0.00",
      "attendance_penalty": "0.00",
      "penalty_fine": "0.00",
      "penalty_wage_withholding": "0.00",
      "loan": "0.00",
      "other_deduction": "0.00",
      "previous_total_deductions": "0.00"
    },
    "provisions": {
      "medical": "1000.00",
      "id_cost": "8630.00",
      "air_ticket": "1250.00",
      "leave": "3500.00",
      "eos": "2500.00",
      "accommodation_cost": "1000.00",
      "gosi_company": "1800.00"
    },
    "carry_forward": {
      "carried_in": "0.00",
      "requested": "7330.00",
      "collected": "7330.00",
      "uncollected": "0.00",
      "by_category": [
        {
          "type": "ABSENCE",
          "carried_in": "0.00",
          "requested": "7330.00",
          "collected": "7330.00",
          "uncollected": "0.00",
          "manual_reentry_required": false
        }
      ]
    },
    "rent_rounding_difference": {
      "numerator": "0.00",
      "denominator": 1,
      "decimal": "0.00"
    },
    "validation_counts": {
      "errors": 0,
      "warnings": 0
    },
    "reconciliation": {
      "items_net": "102670.00",
      "payslips_net": "102670.00",
      "item_count": 10,
      "payslip_count": 10,
      "matches": true
    },
    "unknown_provision_counts": {
      "MEDICAL": 0,
      "ID_COST": 0,
      "AIR_TICKET": 0,
      "LEAVE_PROVISION": 0,
      "EOS_PROVISION": 0,
      "ACCOMMODATION_COST": 0,
      "GOSI_COMPANY": 0
    }
  }
}
```

Average is a diagnostic Decimal displayed to two places; it is not an independently rounded payroll money line. Unknown provision aggregates sum known amounts with cost_incomplete true and an accompanying unknown count (`unknown_provision_counts` map keyed by provision type); do not conflate unknown with configured zero.

### 7.4 Per-employee editing and history

| Method + exact path | Permission; query | Request JSON example | Response example; domain status |
|---|---|---|---|
| PATCH `/payroll-runs/{run_id}/items/{item_id}/` | P; none | `{"expected_revision":1,"changes":{"absence_days_override":"1.00","overtime_normal_hours":"4.00","weekly_rest_work_days":"1.00","official_holiday_work_days":"1.00","bonus":"250.00","incentive":"100.00","other_addition":"0.00","other_deduction":"50.00"},"reason":"Attendance correction and approved extra work"}` | I with current changed quantities/lines/totals, run_revision 2; 200, invalid/locked/missing reason 422, stale 409. Recalculate item and all affected run allocations/totals in same transaction. |
| PATCH same item path (clear absence override) | P; none | `{"expected_revision":2,"changes":{"absence_days_override":null},"reason":"Attendance source is now corrected"}` | I, original absence source reused; 200/422/409. |
| PATCH same item path (salary adjustment) | P; none | `{"expected_revision":2,"changes":{"salary_components":{"basic_salary":"6100.00","accommodation_allowance":"3000.00"}},"reason":"Approved run-only salary correction"}` | I with adjusted monthly inputs and prorated paid lines; 200/422/409. Does not modify employee profile salary or later runs. |
| PATCH same item path (zero reason) | P; none | `{"expected_revision":2,"changes":{"zero_salary_reason":"other","zero_salary_reason_detail":"Employee has not started paid work"},"reason":"HR confirmed zero pay explanation"}` | I with required reason/detail; 200/422/409. Clearing reason is allowed in DRAFT, then validation blocks zero pay. |
| PATCH same item path (OT override) | P; none | `{"expected_revision":2,"changes":{"overtime_normal_hours":"4.00","override_overtime_eligibility":true},"reason":"HR authorizes exceptional overtime"}` | I with normal-hours limit override and audited exception; 200/422/409. |
| GET `/payroll-runs/{run_id}/items/{item_id}/adjustments/` | P; page/page_size, type, date_from/date_to, actor_id | No body | H; 200/404/422; newest first. |
| GET `/payroll-runs/{run_id}/history/` | P; page/page_size, action, date_from/date_to, actor_id | No body | Page of `{"audit_log_id":9002,"action":"payroll_run_recalculated","original_value":{"revision":1},"new_value":{"revision":2},"reason":"Attendance corrected","actor":{"id":5,"name":"Example HR"},"created_at":"2026-10-11T10:00:00Z"}`; 200/404/422. |

Without an explicit normal-hours override, item PATCH retains all entered overtime_normal_hours but calculates only the hours allowed by the monthly cap; it returns 200 plus overtime_over_allowed for excess (cap20, entered24: payable20, excess/unpaid4). Cap0 pays0 normal hours. Null pays entered hours with overtime_limit_not_set. Friday/holiday days bypass this cap. HR manual absence confirmation uses absence_days_override, including an explicit "0.00", with the existing mandatory reason; strict confirmation affects finalize, not draft generation.

`changes` is sparse, at least one effective change, with only: absence_days_override; overtime_normal_hours; weekly_rest_work_days; official_holiday_work_days; bonus; incentive; other_addition; other_deduction; override_overtime_eligibility; salary_components (six existing monthly keys only); zero_salary_reason; zero_salary_reason_detail; suspended_pay_decision FULL_PAY/ZERO_PAY (SUSPENDED profiles only). Monetary adjustment amounts replace the effective run-local amount, rather than repeatedly adding on retry. No direct edit of loan/penalty/GOSI computed amounts, lifecycle dates, total/net/provision lines or employee ownership. Original/new evidence for approved paid/unpaid/full leave and mid-month lifecycle changes is recorded during recalculate with LEAVE_INPUT_CHANGE/EMPLOYMENT_INPUT_CHANGE, without introducing a parallel leave approval workflow. Correct source leave/lifecycle dates via existing authorized APIs.

Sending the unchanged `monthly_salary_components` prefill is a no-op: unchanged monthly keys do not create a salary adjustment or pin automatic values. If there is no other effective change, preserve the existing422 `field_not_editable` response and leave money, snapshots, revision and audit history unchanged. If another field changes, only that change is applied/audited and the prefill alone does not activate `salary_adjusted`. Mandatory reason/revision validation is unchanged.

Addition example D plus bonus/incentive and other deduction gives additions 1,200 and other deduction 50; with unchanged A absence 733, net 11,417. If override changes absence to 1 day, absence becomes 367 and net 11,783. Totals update after independently rounding all final lines.

Additional suspension PATCH example on the same item path (P; no query):

```json
{
  "expected_revision": 2,
  "changes": {
    "suspended_pay_decision": "ZERO_PAY",
    "zero_salary_reason": "suspended"
  },
  "reason": "HR authorizes zero pay for the suspended month"
}
```

HTTP200 returns I with suspended_pay_decision=ZERO_PAY, zero_salary_reason=suspended and recalculated zero earnings; FULL_PAY restores full earned salary under the normal employment-day rules. This choice is run-local, audited as MANUAL_ADJUSTMENT; it never changes the employee's employment status or contractual salary snapshot. Missing choice blocks finalize with suspended_pay_decision_required. Suspended decisions use full-month provision bases as for every included employee. `cancelled_by` on R/cancel response is a nullable numeric User PK; cancel_reason and cancelled_at are null until cancellation.

### 7.5 Accommodation assignment CRUD/history and allocation report

CFO may create, update and soft-delete accommodation assignments through these API routes under P and the same company/reference/reason checks. The v1 UI is read-only for CFO; this is a UI policy and does not remove API write access. No permission-code change is part of this clarification.

| Method + exact path | Permission; query | Request JSON example | Response example; domain status |
|---|---|---|---|
| GET `/payroll-accommodation-assignments/` | P; employee_profile_id, rent_id, status assigned/none/unknown, active_on YYYY-MM-DD, is_active true/false (default true), page/page_size | No body; `?rent_id=11&active_on=2026-09-15` | Page of A.data; 200/422, order -start_date,-id. |
| POST `/payroll-accommodation-assignments/` | P; none | `{"employee_profile_id":101,"status":"assigned","rent_id":11,"start_date":"2026-09-01","end_date":"2026-12-31","reason":"Employee moved into company residence"}` | A; 201; invalid refs/dates/rent 422, overlap 409. |
| POST same collection (explicit none) | P; none | `{"employee_profile_id":102,"status":"none","rent_id":null,"start_date":"2026-09-01","end_date":"2026-12-31","reason":"Employee uses private accommodation"}` | A with status none/rent_id and rent_name null; 201/422/409. |
| GET `/payroll-accommodation-assignments/{assignment_id}/` | P; none | No body | A; 200/404. |
| PATCH `/payroll-accommodation-assignments/{assignment_id}/` | P; none | `{"end_date":"2026-09-15","reason":"Move to another property from September 16"}` | A with new end_date and updated actor/time; 200/422/409. employee_profile_id/company/is_active cannot be reassigned. Lock profile and overlapping assignments; no client revision required for this small service. |
| DELETE `/payroll-accommodation-assignments/{assignment_id}/` | P; none | `{"reason":"Assignment entered against the wrong property"}` | HTTP 204, no body; soft delete with audit; 422 reason, 404 hidden. Historical allocations remain frozen. No physical removal. |
| GET `/payroll-accommodation-assignments/{assignment_id}/history/` | P; page/page_size, date_from/date_to, actor_id | No body | H assignment form; 200/404/422. |
| GET `/payroll-runs/{run_id}/accommodation-report/` | P; rent_id integer, page/page_size | No body | Page of property reports shown below; 200/404/422. Each property includes all its residents, whether included in payroll or not; rent filter does not rewrite frozen totals. |

Rent report example: annual 12,000, monthly 1,000, three full-month residents, one outside payroll, no vacant slots. Rounded resident shares 333 each; **+1 rounding difference**. This example is independent of the ten-resident run fixture.

```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "rent_id": 11,
        "rent_name": "Example Residence",
        "year": 2026,
        "month": 9,
        "period_start": "2026-09-01",
        "period_end": "2026-09-30",
        "monthly_rent": {
          "numerator": "12000.00",
          "denominator": 12,
          "decimal": "1000.00"
        },
        "period_rent": {
          "numerator": "1000.00",
          "denominator": 1,
          "decimal": "1000"
        },
        "residents": [
          {
            "employee": {
              "employee_profile_id": 101,
              "employee_id": "EMP-001",
              "employee_name": "Example Employee"
            },
            "in_payroll": true,
            "payroll_status_label": null,
            "raw_share": {
              "numerator": "1000.00",
              "denominator": 3,
              "decimal": "333.3333333333333333333333333"
            },
            "rounded_share": "333.00"
          },
          {
            "employee": {
              "employee_profile_id": 102,
              "employee_id": "EMP-002",
              "employee_name": "Example Resident"
            },
            "in_payroll": true,
            "payroll_status_label": null,
            "raw_share": {
              "numerator": "1000.00",
              "denominator": 3,
              "decimal": "333.3333333333333333333333333"
            },
            "rounded_share": "333.00"
          },
          {
            "employee": {
              "employee_profile_id": 103,
              "employee_id": "EMP-003",
              "employee_name": "Example Nonpayroll Resident"
            },
            "in_payroll": false,
            "payroll_status_label": {
              "key": "payroll.rent.not_in_payroll",
              "message": "Not in payroll"
            },
            "raw_share": {
              "numerator": "1000.00",
              "denominator": 3,
              "decimal": "333.3333333333333333333333333"
            },
            "rounded_share": "333.00"
          }
        ],
        "vacant_unallocated_raw": {
          "numerator": "0.00",
          "denominator": 1,
          "decimal": "0.00"
        },
        "not_in_payroll_raw": {
          "numerator": "1000.00",
          "denominator": 3,
          "decimal": "333.3333333333333333333333333"
        },
        "rounding_difference": {
          "numerator": "1.00",
          "denominator": 1,
          "decimal": "1.00"
        },
        "rounding_difference_label": {
          "key": "payroll.rent.rounding_difference",
          "message": "Rounding difference"
        },
        "in_payroll_rounded": "666.00",
        "slots": [
          {
            "slot": 1,
            "calendar_date": "2026-09-01",
            "resident_profile_ids": [
              101,
              102,
              103
            ],
            "raw_daily_share": {
              "numerator": "12000.00",
              "denominator": 1080,
              "decimal": "11.11111111111111111111111111"
            }
          }
        ],
        "raw_reconciliation": {
          "matches": true
        }
      }
    ],
    "page": 1,
    "page_size": 25,
    "count": 1,
    "total_pages": 1
  }
}
```

The example expands one slot; actual slots contains **all 30**, including vacant slots with empty residents and null raw_daily_share. Denominator is 12 x30 xresidents. RawShare numerator/denominator may be unreduced; use their exact value, not tuple equality. Property report rounding difference includes **all residents**, not only payroll residents. Summary displays that figure separately beside payroll's rounded costs. Day 31 occupancy remains assignment history but supplies no slot. If a profile is archived, assignment automatic end-date audit is visible here; finalized snapshots remain unchanged.

### 7.6 HR export and employee payslips

| Method + exact path | Permission; query | Request JSON example | Response example; domain status |
|---|---|---|---|
| GET `/payroll-runs/{run_id}/export/` | P; PayrollExportThrottle; file_format pdf/xlsx/csv (default pdf); retained aliases export_format/format, preference file_format > export_format > format | No body; `?file_format=xlsx` or `?file_format=pdf` | 200 binary `payroll_run_7.xlsx` / `payroll_run_7.pdf`; invalid format 422 retained error; hidden run 404. CSV remains compatible. |
| GET `/employee/payslips/` | E; year 1900..2100, page/page_size | No body; `?year=2026&page=1&page_size=25` | `{"status":"success","data":{"items":[{"id":201,"year":2026,"month":9,"period_start":"2026-09-01","period_end":"2026-09-30","net_salary":"10267.00","payment_mode":"Bank Transfer","status":"COMPLETED"}],"page":1,"page_size":25,"count":1,"total_pages":1}}`; 200; invalid year/employee_id selector 422. Order -run.period_end,-run.period_start,-id. |
| GET `/employee/payslips/{payslip_id}/` | E; none | No body | EP; 200; unowned/cross-company/inactive/DRAFT/CANCELLED => same generic 404. |
| GET `/employee/payslips/{payslip_id}/download/` | E; none | No body | 200 binary PDF `payslip_201.pdf` with section 4 headers; same hidden 404. Protected web-only binary policy retained. |

Employee list rejects ownership query attempts (`employee_id`, also proposed employee_profile_id/user_id) rather than returning another employee. No HR inspection through employee routes; HR uses authorized run/item data or HR export. Existing list has no month/status/search filter: none is added silently.

HR XLSX/PDF include the I scalar line columns, totals, cost_incomplete/accommodation status, carry-forward breakdown, run settings revision and validation summary. XLSX first worksheet retains legacy Payroll sheet and first eight columns; append new columns and add Lines, Provisions, Validation, Adjustments, Accommodation sheets. CSV retains first eight legacy columns and appends new line columns. PDF can add detailed pages while retaining current overview. Exact raw rent ratios are exported as strings and separate numerator/denominator cells; PDF indicates approximation for repeating decimal displays. Escape untrusted text and spreadsheet formula prefixes. Exports are pure reads from frozen/current snapshots and never claim deductions.

## 8. Audit and history requirements

Every payroll/settings/manual/assignment/carry/status/source change uses existing `audit.utils.audit(request, action, entity, entity_id, metadata)` from services/views, including auto/system changes with actor null. No new parallel audit logger. Persist original and new inputs/outputs, acting user, timestamp, reason, company/run/item/source IDs and revision. Avoid unnecessary personal identity fields; no credentials/raw tokens. Audit failures abort the mutation; histories are read projections over company-authorized entity IDs, never an unscoped AuditLog query.

| Action (exact planned name) | Use |
|---|---|
| payroll_run_created | Existing create; settings/input version evidence. |
| payroll_run_recalculated | Original/new source/settings/calculation revision and totals; caller reason. |
| payroll_settings_updated | Old/new settings with reason/user; effective snapshot revision. |
| payroll_employee_gosi_updated | Flag and config revision old/new, reason. |
| payroll_item_adjusted | Every run-local changed field; original/new, reason; adjustment projection. |
| payroll_input_refreshed | LEAVE_INPUT_CHANGE/EMPLOYMENT_INPUT_CHANGE and original/new evidence; reason of triggering recalc/finalize. |
| payroll_overtime_override | Explicit normal-hours limit exception; original/new cap and entered/payable/excess/unpaid hours, payroll window, actor/reason. Does not govern day-based rest/holiday work. |
| payroll_run_finalized | Retain currently emitted name; also emit canonical `payroll_finalized` once per actual transition for repository audit convention; both link same transition ID. Repeated finalize emits no transition audit. |
| payroll_cancelled | Cancellation old/new state and reason. |
| payroll_loan_restored | Each loan restoration with prior/new deduction fields and approved status. |
| payroll_carry_reserved, payroll_carry_applied, payroll_carry_released | Amount old/new, source/run references; no duplicate event for no-op. |
| payroll_accommodation_assignment_created, payroll_accommodation_assignment_updated, payroll_accommodation_assignment_deleted | Immutable audit for assignment CRUD and date/status changes. |
| payroll_accommodation_assignment_ended | Automatic archive-date termination; old/new end, actor/system reason. |
| payroll_legacy_backfilled | System data migration linkage/status/legacy line evidence; never rewrite original old money. |
| loan_deducted_in_payroll, attendance_penalty_claimed_by_payroll, attendance_penalty_claim_adjusted, attendance_penalty_released_from_payroll, attendance_penalty_applied_to_payroll | Retain existing source event names/behavior. |
| penalty_claimed_by_payroll, penalty_released_from_payroll, penalty_applied_to_payroll | Retain existing penalty claim events. |
| payslips_generated, payslip_list_viewed, payslip_viewed, payslip_downloaded, payroll_exported_csv, payroll_exported_xlsx, payroll_exported_pdf | Retain sensitive access/publication/export audits. |

Manual history must show both original automatic value and previous effective override, and new override/effective value; it cannot merely show new input. There is no fabricated historic actor/date/reason in backfill. Assignment archive-date changes and loan state restoration use existing domain workflow transition helpers as appropriate, rather than deleting prior workflow trail. Payroll does not add a second approval workflow.

## 9. Backward compatibility and deliberate changes


### Legacy-run read projections (v0.6.1)

When legacy_calculation is true, reconciliation checks **only** the sum of active item net_salary against run.total_net and the active item count against run.total_employees. Active payslip_count, item_count and payslips_net stay in the response as informational coverage; fewer payslips or different payslip net never produce payroll_reconciliation_failed for a legacy run. Historic payroll issued payslips only to employees with a login. Nonlegacy reconciliation remains strict, including payslip coverage, paired item money, lines and rent.

R.total_gross and summary.total_gross_salary are exact Decimal sums of active item.basic_salary + item.total_allowances, preserving historic halalas without rerounding or using current profiles. In both R and summary, total_additions, total_provisions and total_company_cost are null (unknown), and cost_incomplete is true. Existing net/deduction values and category breakdowns are retained; missing legacy line coverage cannot establish complete additions or provisions, even where a breakdown sum is zero. These are read-only projections: do not backfill run columns, recalculate historical payroll, change items/payslips or write snapshots on GET. Modern totals are unchanged.

Complete production-shaped example: 52 active items with basic1000.25 + allowances200.50, each net1100.75, and 33 login-linked payslips. Stored run.total_gross/unknown totals are0, total_net57239 and total_employees52. The combined R/summary/V response data below derives gross62439 while reporting incomplete company cost. No missing-payslip validation issue is emitted.

```json
{
  "run": {
    "id": 8,
    "year": 2026,
    "month": 8,
    "calendar_days": null,
    "period_basis": "LEGACY_FULL_MONTH",
    "status": "COMPLETED",
    "total_net": "57239.00",
    "total_employees": 52,
    "company_id": 1,
    "company_name": "Example Company",
    "period_start": "2026-08-01",
    "period_end": "2026-08-31",
    "revision": 1,
    "total_gross": "62439.00",
    "total_additions": null,
    "total_deductions": "0.00",
    "total_provisions": null,
    "total_company_cost": null,
    "cost_incomplete": true,
    "settings_revision": 0,
    "settings_snapshot": {},
    "calculator_version": "legacy",
    "legacy_calculation": true,
    "calculated_at": null,
    "finalized_at": null,
    "paid_at": null,
    "cancelled_at": null,
    "cancel_reason": null,
    "validation_counts": {
      "errors": 0,
      "warnings": 0
    },
    "cancelled_by": null
  },
  "summary": {
    "run_id": 8,
    "year": 2026,
    "month": 8,
    "total_employees": 52,
    "employees_with_deductions": 52,
    "total_basic_salary": "52013.00",
    "total_allowances": "10426.00",
    "total_gross_salary": "62439.00",
    "total_deductions": "0.00",
    "total_net_salary": "57239.00",
    "average_net_salary": "1100.75",
    "total_additions": null,
    "total_provisions": null,
    "total_company_cost": null,
    "cost_incomplete": true,
    "salary_components": {
      "basic_salary": "0.00",
      "accommodation_allowance": "0.00",
      "transportation_allowance": "0.00",
      "telephone_allowance": "0.00",
      "petrol_allowance": "0.00",
      "other_allowance": "0.00"
    },
    "additions": {
      "overtime_normal": "0.00",
      "weekly_rest_work": "0.00",
      "official_holiday_work": "0.00",
      "bonus": "0.00",
      "incentive": "0.00",
      "other_addition": "0.00"
    },
    "deductions": {
      "absence": "0.00",
      "gosi_employee": "0.00",
      "attendance_penalty": "0.00",
      "penalty_fine": "0.00",
      "penalty_wage_withholding": "0.00",
      "loan": "0.00",
      "other_deduction": "0.00",
      "previous_total_deductions": "0.00"
    },
    "provisions": {
      "medical": "0.00",
      "id_cost": "0.00",
      "air_ticket": "0.00",
      "leave": "0.00",
      "eos": "0.00",
      "accommodation_cost": "0.00",
      "gosi_company": "0.00"
    },
    "carry_forward": {
      "carried_in": "0.00",
      "requested": "0.00",
      "collected": "0.00",
      "uncollected": "0.00",
      "by_category": []
    },
    "rent_rounding_difference": {
      "numerator": "0.00",
      "denominator": 1,
      "decimal": "0"
    },
    "validation_counts": {
      "errors": 0,
      "warnings": 0
    },
    "reconciliation": {
      "items_net": "57239.00",
      "payslips_net": "36324.75",
      "item_count": 52,
      "payslip_count": 33,
      "matches": true
    },
    "unknown_provision_counts": {
      "MEDICAL": 0,
      "ID_COST": 0,
      "AIR_TICKET": 0,
      "LEAVE_PROVISION": 0,
      "EOS_PROVISION": 0,
      "ACCOMMODATION_COST": 0,
      "GOSI_COMPANY": 0
    }
  },
  "validation": {
    "run_id": 8,
    "revision": 1,
    "can_finalize": true,
    "finalize_state": "finalized",
    "errors": [],
    "warnings": [],
    "infos": [],
    "counts": {
      "errors": 0,
      "warnings": 0
    },
    "employees_checked": 52,
    "excluded_employees_checked": 0,
    "reconciliation": {
      "total_net": "57239.00",
      "items_net": "57239.00",
      "payslips_net": "36324.75",
      "item_count": 52,
      "payslip_count": 33,
      "matches": true
    }
  }
}
```


Retain every existing payroll path and optional trailing slash, export compatibility routes (including the root explicit PayrollRunExportView), CSV and format aliases, success/error helper envelope, pagination, run year/month/status values, run total_net/total_employees/company fields, item IDs and existing scalar fields, employee list/detail old salary fields/payment_mode/status, finalize confirm requirement and data.message, generate counts/download_pdf_url, protected download headers, existing audits/source models and original loan selector.

Additive paths are settings/config/enums/history; nested item detail/edit/history; run validation/history/recalculate/cancel/accommodation report; accommodation assignment CRUD/history. Additive fields include salary/addition/deduction lines, full monthly vs earned gross, provision/company totals, settings/input versions, carry-forward, unknown cost flag/status, validation/adjustment histories and accountless linkage. PREVIOUS_TOTAL_DEDUCTIONS preserves old employee money transparently.

Intentional behavior/format changes to tell frontend/verifier:

- CFO gains payroll-only management access through proposed permission; Employee-only payslip gate retained.
- Draft payslips become DRAFT and finalized unpaid slips COMPLETED; status is no longer misleading PAID.
- Line amounts use whole-riyal HALF_UP for new calculations; old history keeps original halalas. Net cannot be negative on new runs; pending debt is explicitly visible to HR.
- Summary currently returns aggregate Decimals that the renderer may serialize as numbers; **proposed summary normalizes all monetary fields to strings**. Item/payslip serializer Decimal strings remain compatible.
- Invalid year on run list becomes 422 rather than silently ignored. New decimal write fields require strings and mandatory reasons/revisions.
- DRAFT cancellation only, source restoration, inactive slips; expose cancelled_at, cancelled_by and cancel_reason; conditional period uniqueness allows a replacement retaining cancelled history; no COMPLETED cancellation and no proposed complete/mark-paid aliases.
- Manual Other uncollected amounts require HR re-entry next month (manual_reentry_required), unlike source-pending whole penalty/loan claims and automatic authorized absence/GOSI carry.
- Article70 comparison uses exact amounts before rounding; the posted fine can exceed the exact cap by a rounding effect of less than one riyal per line. Store exact and rounded audit values; never re-compare rounded fines.
- Suspended run-specific FULL_PAY/ZERO_PAY choice and suspended zero reason are new; excluded lifecycle conflicts still appear in validation. no_medical_insurance distinguishes explicit0 from unknown null invoice.
- New accountless slips mean total_payslips includes records that cannot receive a login notification. Do not use a user count as employee/run reconciliation count.
- Rent raw-only report fields are ExactShare objects; ordinary payroll money remains decimal strings. Round difference is signed and never part of payroll employee/company totals.
- Field cost_incomplete signals a **known subtotal**, not a null Total Company Cost. accommodation_cost null differs from explicit none/0.
- Employee DTO excludes HR settings/carry/provision/raw evidence even when HR item contains them. New employee-detail label/type fields are additive; frontend must use exact whitelisted shape.
- Compatibility error string arrays remain possible; new domain objects add code/key/params. Framework errors may lack errors or message_key.
- Existing head-office run-object workflow remains explicit; strict settings/assignment APIs require active company. Never globally tighten/expand company behavior without corresponding tests.

The verifier correction changes only overtime-hour policy, mapping/manual-absence validation and schedule evidence, vendor-guarded overlap enforcement, and configurable provision proration, with their DTO/enums/i18n/audit/test/handoff consequences. Routes, permissions, envelopes, other calculation rules and historical money policy are unchanged.

This is the approved contract with Phase 1 foundation and Phase 2 delivery notes. The approved root-mounted endpoints are now wired to the transactional writer and explicit DTOs.

Verified test conflicts to handle in implementation, without weakening behavioral assertions:

- `Backend/payroll/test_attendance_deductions.py::AttendancePayrollDeductionTests.setUp` creates the profile without hire_date. Its API-finalize test currently expects200. The approved missing_hire_date blocker will make that fixture invalid; supply a real prior hire date for the existing claim/idempotency scenarios, retain their200/amount assertions, and add independent missing-date422 tests. Do not disable the blocker to preserve an incomplete fixture.
- `Backend/penalties/test_penalties.py` directly creates legacy items/payslips without the proposed profile/item links or settings/input snapshots. Those fixtures require explicit valid linkage/calculator inputs as the new constraints are enforced; retain approved/disputed/claim/release assertions. Do not silently populate salary from a mismatching profile total.
- Existing services mark a loan deducted before finalize and may produce negative net; the approved whole-loan affordability and cancellation restoration necessarily change those edge outcomes. Existing penalty cap code rounds its profile-based budget to halalas; the new approved comparison uses earned gross and an unrounded cap. Add both166.50-collectible and166.67-not-collectible cases for earned gross1,000.
- Existing payslip/security fixture statuses default PAID even for a COMPLETED parent. Preserve access/404/download-header assertions while adding the explicit status-following tests; historical status repair is an intentional migration change, not historical money recomputation.

These are source-observed expected fixture/behavior conflicts, **not test failures observed by running a suite**.

## 10. Required verification and golden tests for later phases

Phase 1: pure calculator/model/settings/migration tests, including every row below. Phase 2: transactional engine, endpoint examples/route resolution, ownership/provision privacy, workflow/source claim and exact money reconciliation tests. Use meaningful integration assertions, not only mocks. Do not weaken existing test assertions to hide regression; explicitly report approved rule conflicts.

| Golden/edge | Expected assertion |
|---|---|
| Original A | Monthly/earned gross 11,000; absence 2 =>733; Net10,267; leave350, EOS250, ticket125, ID863, company GOSI180; known cost12,035 before medical/rent. Unknown rent means incomplete true, not fabricated0. |
| Original B | 31/31 full absence =>11,000 capped; Net0; reason required before finalize. |
| Original C | June16 join =>15 days and5,500; first day of31-day month =>30 and11,000. |
| Original D | Basic6,000 and normal-hours cap>=4 (or explicit audited override); 4 excess hours150, weekly rest1 day300, official holiday1 day400, total850. |
| Original E | After anniversary month leave500/EOS500; anniversary month retains350/250. |
| Original F | Saudi GOSI9,000x0.0975=877.50=>878. Default company provision only; flag true employee deduction878/company0. |
| Original G | Invoice12,000, included10 =>100 each; zero included avoids division. |
| Original H |433.33->433;433.49->433;433.50->434; sum rounded lines, never rounded unrounded subtotal. |
| Unpaid/paid leave |2 approved unpaid days =>733, same as absence; paid leave excluded, same-date union deduplicated. |
| Penalty overlap |Known already-withheld date removed once from absence; fine remains separate; unknown date-level wage evidence blocks reconciliation. No historical refunds invented. |
| Whole claims/manual re-entry |Unaffordable penalty whole claim stays pending with claim_unaffordable; no partial applied claim. Loan remains approved. Other deduction capped, remainder reported and manual_reentry_required true, no auto carry ledger entry. |
| Exact Article70 boundary |Gross1,000, exact fine166.50 passes exact cap166.666..., posted167; no rounded recheck; exact/rounded/audit fields retained. Combined source fines share the exact budget. |
| Full-month paid leave/withholding |Full-month absence100%; one due-work paid-leave day prevents shortcut; full liability11,000 less exact prior withholding300=>10,700. No double charging. |
| Employment status choices |ACTIVE included;future hire excluded without warning;PREHIRE excluded+prehire_status_conflict if hire date due;SUSPENDED included but blocked until FULL_PAY or ZERO_PAY+suspended reason;TERMINATED missing end excluded+terminated_without_end_date and preflight report. |
| Medical unknown/none |Missing invoice means null and every item incomplete, one run-level warning;no_medical_insurance=true gives0/no warning;explicit zero invoice accepted. |
| Cancelled-period replacement |Cancel DRAFT, create same period201;retain cancelled history/metadata;two live runs409;COMPLETED/PAID cannot cancel/replace. |
| Collection priority/debt |Absence then employee GOSI then penalties then full loan then other; no negative Net; requested=collected+uncollected for authorized liabilities. Approved unaffordable loan has0 collected and unchanged approved/deduction fields. Prior balances stay available for next eligible run once committed, no duplicate debt. |
| Cancellation |Cancel DRAFT restores loan fields/status/workflow trail and every draft claim/carry reservation; slips inactive; each release audited; repeat no double release; completed/paid cancel422. |
| Provision proration FULL_MONTH |Configurable default; June16 join/15 salary days, monthly Basic6,000/Housing3,000, foreign under5: leave350, EOS250, ticket125, ID863, GOSI180, medical100 (invoice12,000/included10). Known non-rent provisions1,868. Rent follows occupied slots only. |
| Provision proration PRORATED_BY_DAYS |Same 15-day inputs: multiply raw monthly formulas by15/30 before HALF_UP: leave175, EOS125, ticket63, ID431, GOSI90, medical50; known non-rent provisions934. Full-month factor1 equals FULL_MONTH; mid-month leaver factor uses inclusive payable days; employee-GOSI flag still company0. Missing costs stay null; no second rent proration. |
| Mid-month absence |Monthly gross11,000, paid5,500,2 absent =>733, Net4,767. Authorized absence exceeding earned5,500 capped at5,500. |
| Rent move |Annual12,000, sole resident at property A slots1..15 and property B slots16..30 =>500 each if same annual values; no daily pre-rounding. |
| Rent residents outside payroll |Denominator includes all; outside share labelled not in payroll, never assigned to another item. |
| Missing vs none rent |unknown=>null, known-subtotal company total, cost_incomplete true + warning; none=>0, no accommodation incompleteness. |
| Rent February |Full-month resident gets all30 slots in28/29-day month; leaving Feb10 gets10 slots; arriving Feb20 gets11 slots in28-day month, with last-day occupancy filling slots29/30. Day31 ignored. |
| Rent exact reconciliation |Raw shares + vacant = monthly rent exactly via rational provenance; nonpayroll subset counted once. Monthly1,000/3=>333 each,+1 difference; add vacancy and nonpayroll resident; test negative rounding_difference too. Difference never changes an employee or Company Cost. |
| February absence |28/28=>100%,27/28 with one non-absent due-work date=>9,900 for base11,000; leap-year29/29 full; join/archive interval drives full-month determination. |
| Missing dates |Missing hire_date draft succeeds with flagged full-month/old tier; finalize code missing_hire_date. Archived missing archive date excluded but blocking archived_without_date; one-time report also lists non-archived TERMINATED profiles missing end date. |
| Normal overtime cap20/entered24 |Basic6,000: retain24 excess hours, pay20=>750; excess/unpaid4 flagged overtime_over_allowed. Explicit override with reason pays24=>900; retain excess warning and audit requested/payable/cap. Limit applies once per payroll window. |
| Normal overtime cap0 |Entered4: automatic payable0, unpaid4 + overtime_over_allowed; explicit audited reason/override may pay4=>150; no override never pays normal overtime. |
| Normal overtime cap null |Entered4 paid=>150 with nonblocking overtime_limit_not_set. |
| Friday/holiday work cap0 |Friday1 day=>300 and official holiday1 day=>400, allowed without normal-hours override; neither limited by allowed_overtime nor emits normal-limit warning on its own. |
| Mapped absence source |Active mapping covering employed interval with2 ABSENT dates=>733 at gross11,000; no attendance_source_unavailable. Late mapping start leaves uncovered dates and must warn. |
| Unmapped zero rows |No active mapping and no ABSENT/unpaid rows: draft provisional absence0 + per-employee attendance_source_unavailable; never label as confirmed zero. |
| Unmapped manual absence |HR absence_days_override3 with reason: deduction1,100 from base11,000, retain source warning, manual_confirmed true; no double-add of existing unpaid/attendance dates. |
| Manual absence confirmation setting |Defaultfalse leaves source warning nonblocking; true with unavailable source/missing override blocks finalize with same code error plus warning; explicit0 or3 clears error, retains warning; settings frozen per run. |
| Authoritative schedule |Use is_working_day/get_work_schedule/is_rest_day_for_everyone and supplied holiday/leave evidence; absent individual schedule uses global defaults/weekly rules; unresolved evidence blocks full-month decision; partial mapping/manual count alone cannot prove100%. |
| Pre-go-live data audit |Report includes all allowed_overtime0/1 candidates, missing lifecycle dates and supplied-month unmapped/partial coverage counts. No automatic conversion, no fabricated current count. |
| Portable overlap enforcement |Service create/update rejects inclusive overlapping active employee ranges with assignment_overlap on PostgreSQL and SQLite, including none/unknown statuses; adjacent nonoverlapping ranges succeed. PostgreSQL exclusion/extension DDL only executes when connection vendor is postgresql; forward/reverse SQLite migration skips it cleanly. Exercise service path and both migration vendors. |
| Feb29 anniversary |Feb29,2020->Feb28,2025;new tier March2025. Feb28 and March1 hires switch in following respective months. |
| Salary bases/zero |Every fixed enum incl FIXED_AMOUNT;no formulas/floats;rate finite validation;zero/negative/overflow sources;mandatory zero reason/detail; profile total null/different not used. |
| Legacy run presentation |52 active items/33 payslips with equal item net/run net and stored gross0: matches true, no payroll_reconciliation_failed; R/summary gross equals exact active paid basic+allowances, unknown additions/provisions/company cost null and incomplete true; reads leave stored run/items/slips unchanged. Wrong item net/count still fails reconciliation. Nonlegacy missing/mismatching payslips still fail. |
| Finalized validation presentation |COMPLETED/PAID reports finalize_state finalized and can_finalize true; historic blocking issues remain visible under infos with severity info, errors/counts.errors0, warnings unchanged; DRAFT errors still block. Severity/code filters include infos without changing global counts/state. |
| Snapshots |Settings change does not mutate completed/paid or silently replace draft snapshot; explicit refresh audited. |
| Monthly inputs vs paid lines |June16 joiner: monthly Basic6,000/Housing3,000/Transport1,500/Telephone500, other two0; monthly DTO stays6,000/3,000/1,500/500/0/0 while paid scalars are3,000/1,500/750/250/0/0. Active run-local Basic6,100 gives monthly6,100, paid3,050 and salary_adjusted true; no override gives false. Profile edits after calculation do not change these frozen monthly defaults. |
| Monthly prefill no-op |PATCH the unchanged monthly prefill: existing422 field_not_editable, unchanged paid values/snapshot/revision/audit/adjustments. Repeat with an active salary override. Prefill plus a bonus change updates only the bonus and creates no salary adjustment. Legacy missing monthly snapshot exposes null rather than fabricated input. |
| Entered manual inputs vs rounded lines |Enter bonus250.50: manual_inputs.bonus is250.50, bonus scalar and posted BONUS line are251.00 (HALF_UP). Preserve entered two-decimal quantities, additions/deductions and boolean override; only absent-day override defaults to null. |
| Executive identity/counts |CEO group and exact General Manager/Chief Executive Officer/المدير العام use the shared helper; Assistant General Manager alone is false. With no mapping/assignment, require_manual_absence_confirmation=true and null overtime limit, executive warnings/confirmation errors disappear after recalculation; with equal payable hours, Net and known company-cost subtotal remain unchanged versus ordinary inputs. Validation/run/summary counts and can_finalize agree. |
| Executive absence/overtime/cost |Recorded full-month ABSENT alone deducts0; two approved unpaid-leave days deduct733 at monthly gross11,000; audited manual3 days deduct1,100. Normal cap0 or2 does not restrict entered4 hours (150), no cap/unknown-limit warnings; day-based work is unchanged. No assignment gives accommodation0/status none/no cost flag, but existing assigned/unknown assignments and missing medical costs follow normal rules. |
| Executive claims/errors/privacy |Attendance late fine is not selected; an existing mutable draft claim is released/audited, not forgiven. Eligible issued disciplinary claims collect normally and retain cap/unaffordable warnings. Missing hire date and other blocking/revision/zero-pay errors remain. HR I has the frozen flag, employee DTO/PDF does not; classification alone grants no HR permission and PATCH cannot set the flag. |
| Multi-employee reconciliation |Seed multi-employee incl accountless,zero-net,Saudi/foreign,pending debt; run sum == item sum == payslip sum; counts match included profiles; income/deduction/provision sums match; incomplete flags OR correctly. |
| Privacy/permissions |HR/Admin/CFO per contract;CEO/Manager/Employee denied HR routes;employee sees own active COMPLETED/PAID only;404 on IDOR/company/DRAFT/cancelled;salary-only list/detail/PDF with positive and negative GOSI flag cases; no restricted keys/types/raw ratios/cost flags. |
| Idempotency/concurrency |Repeated claim sync/recalculate/finalize/publish/cancel no duplication; stale edits409;concurrent loans/claims locked; unchanged applied historical totals;notification dedup preserved. |
| Backfill |Exact old values including halalas preserved as previous total deduction;wrong/ambiguous company/profile not guessed;status repair and accountless linkage reported/audited. |

Required suites after Phase 1 and Phase 2: `pytest payroll/ penalties/ loans/` (includes payroll/tests.py, test_attendance_deductions.py, test_employee_payslip_security.py, penalties/test_penalties.py and related tests). Phase 2 also run affected attendance/leave/rent/employee company-scoping/route tests, `python manage.py check`, migration checks and full backend suite according to blast radius. Test route resolver/schema/example serialization against this document. Rebuild affected backend/notification-worker/celery-beat services only after implementation edits using approved local wrapper/profile, then inspect health and migrations/endpoint; never down -v. No such runtime change is authorized in Phase 0.

## 11. Phase 1 evidence and Phase 2 frontend handoff

Phase 1 adds `Backend/payroll/calculator.py`, `configuration.py`, `settings_serializers.py`, `accommodation.py`, `i18n.py`, both locale catalogs, the one-time report and four test modules; modifies payroll models/permissions and only the approved employee/loan/penalty model fields. The eight generated migrations are listed in section 3. The calculator is pure stdlib Decimal/Fraction code with no ORM, notification, audit or auth calls. Service integration covers tenant scope, manager permission, revision/no-op/rollback behavior, immutable history, settings snapshot isolation and portable accommodation overlap. Migration tests preserve historical halalas/zero deductions, inactive cancelled slips, unknown links and ambiguous links without guessing identities.

The manual absence total replaces observed counts, retains paid-day protection and excludes wage-withheld dates. An override that disagrees with observed full-month absence cannot use those conflicting dates as proof of the 100% shortcut. This implements section 2.2; it adds no policy, field or validation code.

Verification commands, exact final test results, initial failures and corrections are recorded in `plans/Payroll Rebuild Phase 1 Handoff.md`. Phase 0 documentation checks remain historical evidence: 16 JSON examples, 121 enum entries and 44 distinct validation codes. Phase 1 adds bilingual catalog parity (149 keys) and runtime calculator/model/migration tests; documentation checks do not substitute for them.

Phase 2 now routes the approved resources through IsPayrollManager and the single transactional writer. Creation, recalculation and compatibility source syncs persist identical calculator output; finalization/reconciliation, DRAFT cancellation/loan restore, claim/carry lifecycle, accountless slips and payslip statuses are implemented. Employee JSON/PDF use strict itemized whitelists; HR exports retain their legacy columns and add detailed sheets/pages. New JSON responses and protected binaries use private/no-store. Runtime evidence and any remaining failures are reported separately in the Phase 2 handoff.

Frontend can use the unchanged approved paths/DTOs; the matrix now marks the implemented endpoints. Money remains decimal strings; null unknown costs differ from explicit0. Employee itemized JSON/PDF exclude company costs/provisions and internal claim/source IDs. Backend integration and security tests exercise those whitelists. No frontend/mobile files were edited by this backend task; unrelated shared-checkout work was preserved.

Phase 2 implementation files: `Backend/payroll/engine.py`, `api.py`, `dto.py`, `exporting.py`; route/serializer/views wiring in `urls.py`, `serializers.py`, `views.py`; compatibility source syncs in `payroll/services.py` and `penalties/payroll.py`; loan restore service in `loans/services.py`; archive-ending hookup in `employees/services/archiving.py` and `payroll/accommodation.py`. Configuration defaults serializer returns settings_revision0 without a GET write. Tests include `payroll/test_phase2.py`, approved response fixtures `payroll/contract_examples.json`, the extended SQLite probe and existing regression suites. Verification results and exact remaining limits are recorded in `plans/Payroll Rebuild Phase 2 Handoff.md`. Frontend consumes sections 5-7 as written; this task makes no FrontEnd/MobileApp edits.


## 12. Phase 2 boundary and remaining limits

The user authorized Phase 2; this task stops at its handoff. FULL_MONTH/PRORATED_BY_DAYS are configurable and snapshotted, default FULL_MONTH and the unchanged scope/factor in section 2.4. CFO keeps access through IsPayrollManager’s single constant. No additional permission was required to implement these authorized defaults.

Existing fresh SQLite bootstrap is still blocked by older unguarded PostgreSQL tenant-trigger migrations. The new payroll chain is vendor-guarded and separately tested on real SQLite. No authoritative employee-data audit, production deployment, commit/push, FrontEnd or MobileApp change is performed by this task. The report command remains available for pre-go-live cleanup; actual unmapped/partially covered counts remain unverified offline.

Contract changes v0.4.0 -> v0.5.0: header and sections **1, 2, 3, 9, 11 and 12** record Phase 2 authorization/delivery and the following two implementation changes. Section 2 states deterministic claim selection within the penalty tier (existing reservations first, then created_at/source_kind/PK) and the company-row lock prefix. This affects competing claims’ selection/status/reservation fields in `Backend/payroll/engine.py`, `Backend/payroll/services.py` and `Backend/penalties/payroll.py`; the two compatibility entrypoints no longer select different monetary outcomes through call order. Section 3 adds internal `PayrollRunItem.is_active` in `Backend/payroll/models.py` and migration `0012_payrollrunitem_is_active.py` for history-preserving exclusions. **Public paths, DTO fields, enums, status codes and error shapes are unchanged.** Exactly **44 validation codes**, **121 enum entries**, and **149 bilingual keys** remain. All 16 JSON examples and the golden table remain unchanged. No other approved business rule changes in this version.

Verifier additive amendment v0.5.2 (2026-10-12): changed DTO **I** only by adding `monthly_salary_components` (six existing monthly salary keys as decimal strings; null only for legacy unknown input) and `salary_adjusted` (boolean). Section6 I definition/example distinguishes monthly input from existing paid/prorated scalars; section7 clarifies the existing no-effective-change behavior for prefilled monthly values; section10 adds the two golden rows. `Backend/payroll/dto.py` exposes the frozen monthly inputs/active override marker; `Backend/payroll/api.py` ignores unchanged monthly prefill keys before applying adjustments; contract fixtures and DTO/enum/no-op checks are updated. No paths, existing fields, enums, status codes, error shapes, calculations, migrations, permissions, settings defaults or other contract rules change. Counts remain44 validation codes,121 enum entries,149 bilingual keys and16 JSON examples (only I has new fields). Header/version and this amendment record are updated. Evidence: `plans/Payroll Rebuild v0.5.2 Handoff.md`.

Verifier required fixes v0.5.3 (2026-10-12): removed the provision-proration pending-confirmation assumption from calculator/settings responses, English/Arabic source and compiled catalogs, and the S company-settings example/fixture. Current Item responses suppress only that retired entry if it exists in an older frozen result; stored evidence/history and money remain unchanged. The retired catalog key is `payroll.assumption.provision_proration_pending`; current bilingual catalog count is **148**, down from149 in the historical version records above. The remaining policy assumptions are BASIC overtime base and the normal-overtime calendar-month limit. Provision proration remains configurable/snapshotted with default FULL_MONTH; CFO keeps access. Pending-confirmation wording is removed from the current rules/defaults. Restored applied migrations `Backend/payroll/migrations/0005_attendancepayrolldeduction.py` and `0006_attendancepayrolldeduction_claim_state.py` verbatim from Git. Public paths, fields, enums, status codes, error shapes, calculations and defaults are otherwise unchanged. All16 JSON examples remain; only S loses that assumption entry. Counts remain121 enum entries and44 validation codes. Verification: `plans/Payroll Rebuild v0.5.3 Handoff.md`.

Same-version verifier addition v0.5.3 (2026-10-13): DTO I adds only `manual_inputs`, with the nine run-local fields defined in section6. Entered decimal values retain halalas/two decimals; absence override alone may be null; numeric/boolean defaults are0.00/false. Section6 I definition/example and the stored item fixture add this object; section10 adds the entered-bonus250.50/posted251.00 golden check. Existing I fields/rounded scalars, paths, enums, statuses, errors and calculations are unchanged. This remains v0.5.3 together with the retired-assumption/catalog cleanup and restored0005/0006 migrations; no new version or migration. Combined v0.5.3 examples changed versus v0.5.2: S loses the retired assumption, I gains manual_inputs; all other example values remain. Counts remain148 bilingual keys,121 enum entries,44 validation codes and16 JSON examples. Evidence is in the updated `plans/Payroll Rebuild v0.5.3 Handoff.md`.

Verifier F4 corrections v0.5.4 (2026-10-13): ExactShare.numerator is a two-decimal string in every response/export, including old rent snapshots and summary.rent_rounding_difference. Denominator, decimal approximation, exact allocation/reconciliation and posted money are unchanged. `Backend/payroll/calculator.py` formats new ExactShares; `Backend/payroll/dto.py` normalizes rent responses/summary and parses both integer/decimal numerator strings exactly. Existing XLSX/PDF exports consume the normalized rent DTO; no export layout change. Sections2.5/6 and the amendment record describe the format. Wording-only corrections: issue.field is optional/omitted when absent (section6 V); zero_salary_detail_required blocks finalization, while otherwise valid item PATCH accepts the change without422 for this condition (sections2.3/5); I.warnings contains only warnings and blocking errors appear only in the validation report (section6 I); CFO retains accommodation API write access although the v1 UI is read-only for CFO (section7.5). No validation/permission/UI behavior or code was changed for these wording corrections. No paths, DTO field names, enum values, implemented status codes/error responses, defaults, migrations, catalog keys or other rules changed; the wording corrections document existing field optionality and validation behavior. All16 JSON examples and10 stored fixtures remain unchanged;121 enum entries,44 validation codes and148 bilingual keys remain. Regression/command evidence: `plans/Payroll Rebuild v0.5.4 Handoff.md`.

Verifier user rule v0.6.0 (2026-10-14): added the executive exemption in section2.7 and the readonly HR I.executive_exempt boolean in section6/example, plus executive golden rows in section10. Engine normalization uses only core.executives.is_executive_profile; private input_snapshot.source flags executive_exempt/accommodation_assignment_present preserve calculation evidence. Exemption changes only attendance absence/source-confirmation requirements, normal overtime caps/warnings, unassigned accommodation applicability and AttendancePayrollDeduction late-fine selection; all other financial rules/errors remain. Existing draft attendance claims release through the audited service on reclassification. No info validation channel/code was added: executive_attendance_exempt is not emitted; visibility relies on the permitted DTO fallback. Paths, settings, roles, enum values, status codes and error shapes are unchanged. Exactly44 validation codes,121 enum entries,148 bilingual keys and16 JSON examples remain; only I gains executive_exempt and its stored fixture is updated. Existing upstream executive request/penalty creation restrictions are outside this payroll change; eligible approved leave/issued disciplinary claims remain payroll inputs. Evidence: plans/Payroll Rebuild v0.6.0 Handoff.md.

Verifier legacy presentation v0.6.1 (2026-10-15): sections2.7/5/6/7.3/9/10/12 and the version header changed. Section2.7 only clarifies that the newer finalized-report schema applies independently of executive classification; no exemption rule changed. R.total_gross and summary.total_gross_salary derive from active legacy paid basic+allowances; R/summary total_additions, total_provisions and total_company_cost are nullable/unknown and cost_incomplete true for legacy runs only. No database writes, money recalculation or migration. Legacy reconciliation compares item net/count only; payslip coverage/net remains informational. Nonlegacy checks are unchanged. V adds finalize_state and infos; finalized blockers project severity info, leave the immutable source untouched, and do not contribute to blocking counts. can_finalize remains boolean and is true for finalized runs; action/status guards and HTTP error envelopes/codes are unchanged. The validation-report severity filter accepts info. Enums add finalize_state(finalized,not_finalized) and validation_severity.info, with the three matching bilingual catalog keys; exactly44 validation codes,124 enum entries and151 bilingual keys. Examples: enum and V updated; one combined legacy R/summary/V example added (17 JSON blocks,11 stored fixtures). All other settings, roles, executive rules, endpoints and DTO fields are unchanged. Evidence: plans/Payroll Rebuild v0.6.1 Handoff.md.

Payroll date-window extension v0.7.0 (2026-10-21): new run creation requires `calendar_days`, an integer from1 through30 that cannot exceed the actual selected month length. The inclusive calculation window is day1 through day N. Attendance, leave, penalty occurrence/wage evidence, employment eligibility, accommodation coverage and rent allocation are clipped to that window while all established salary and daily rates keep the divisor30. An indivisible penalty claim whose wage evidence extends past the cutoff remains wholly pending with the existing wage-evidence blocker; a later replacement/full window can collect the complete claim without losing the excluded remainder. Explicit February N=28 therefore earns 28/30 for a fully employed employee. Existing rows migrate with `calendar_days=null`, which retains their historical full-calendar-month inputs and 30 salary/rent slots. R adds `calendar_days`; CSV/XLSX exports and payroll/payslip PDFs display the inclusive range and effective day count. Rent allocation responses expose the full `monthly_rent` and the window-adjusted `period_rent`; PDF/XLSX allocation tables use or separately identify `period_rent`. `invalid_calendar_days` is the new translated 422 code. Current totals are45 validation codes,125 enum entries and153 bilingual enum/presentation keys; historical amendment counts above remain historical.

Inclusive range extension v0.8.0 (2026-10-21): run creation replaces year/month/calendar_days input with required inclusive ISO `period_start`/`period_end`, allowing cross-month/year ranges of at most30 days. Canonical dates and `period_basis` are persisted; compatibility year/month use period_end and calendar_days is the inclusive length. Migration0014 converts prior explicit N rows to their existing day1..N dates and full-month historical rows to actual month bounds plus LEGACY_FULL_MONTH, preserving 30 salary/rent slots. Active company ranges cannot overlap; create locks the company before checking. Loan, penalty and carry monthly obligations are eligible through the period-end month. New rent slots use real dates and monthly rent/30; one current annual rent snapshot applies across the range because rent values are not effective-dated. Aggregate normal-overtime inputs receive one cap per payroll window and expose PAYROLL_WINDOW. Paths, money rounding/divisors, roles and lifecycle states are otherwise unchanged.
