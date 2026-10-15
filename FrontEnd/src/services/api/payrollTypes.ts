/**
 * Payroll rebuild DTOs, written by hand from plans/Payroll Rebuild API Contract.md
 * (v0.3.0, section 6). Names follow the contract: S = PayrollSettings,
 * R = PayrollRun, I = PayrollRunItem, V = ValidationReport, A =
 * AccommodationAssignment, EP = EmployeePayslipDetail, H = PayrollHistoryEntry.
 *
 * Money is ALWAYS a decimal string ("733.00"). Never parse it to calculate:
 * the backend owns every payroll number and the frontend only formats it.
 * A null money value means unknown/incomplete, never zero.
 */

/** Decimal money string with two fractional digits, e.g. "733.00". */
export type Money = string;
/** Day/hour quantity string with up to two fractional digits, e.g. "2.00". */
export type Quantity = string;
/** Rate string with up to six fractional digits in [0, 1], e.g. "0.020000". */
export type RateString = string;

/**
 * Exact rational value used only by raw rent fields. `decimal` is a display
 * approximation; numerator/denominator are the source of truth.
 */
export interface ExactShare {
  numerator: Money;
  denominator: number;
  decimal: string;
}

/** Standard page envelope payload (`data` of a paginated response). */
export interface PayrollPage<T> {
  items: T[];
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export interface PageParams {
  page?: number;
  page_size?: number;
}

// ─── Enums (section 5) ──────────────────────────────────────────────────────

export type PayrollStatus = "DRAFT" | "COMPLETED" | "PAID" | "CANCELLED";
export type SalaryBaseType =
  | "BASIC"
  | "BASIC_HOUSING"
  | "BASIC_HOUSING_TRANSPORT"
  | "GROSS"
  | "FIXED_AMOUNT";
export type LineCategory = "SALARY" | "ADDITION" | "DEDUCTION" | "PROVISION";
export type SalaryLineType =
  | "BASIC_SALARY"
  | "ACCOMMODATION_ALLOWANCE"
  | "TRANSPORTATION_ALLOWANCE"
  | "TELEPHONE_ALLOWANCE"
  | "PETROL_ALLOWANCE"
  | "OTHER_ALLOWANCE";
export type AdditionLineType =
  | "OVERTIME_NORMAL"
  | "WEEKLY_REST_WORK"
  | "OFFICIAL_HOLIDAY_WORK"
  | "BONUS"
  | "INCENTIVE"
  | "OTHER_ADDITION";
export type DeductionLineType =
  | "ABSENCE"
  | "GOSI_EMPLOYEE"
  | "ATTENDANCE_PENALTY"
  | "PENALTY_FINE"
  | "PENALTY_WAGE_WITHHOLDING"
  | "LOAN"
  | "OTHER_DEDUCTION"
  | "PREVIOUS_TOTAL_DEDUCTIONS";
export type ProvisionLineType =
  | "MEDICAL"
  | "ID_COST"
  | "AIR_TICKET"
  | "LEAVE_PROVISION"
  | "EOS_PROVISION"
  | "ACCOMMODATION_COST"
  | "GOSI_COMPANY";
export type LineType =
  | SalaryLineType
  | AdditionLineType
  | DeductionLineType
  | ProvisionLineType;
export type ZeroSalaryReason =
  | "full_leave"
  | "full_absence"
  | "unpaid_leave"
  | "not_joined"
  | "suspended"
  | "other";
export type AccommodationStatus = "assigned" | "none" | "unknown";
export type SuspendedPayDecision = "FULL_PAY" | "ZERO_PAY";
export type ProvisionProration = "FULL_MONTH" | "PRORATED_BY_DAYS";
export type ValidationSeverity = "error" | "warning";
export type AdjustmentType =
  | "ABSENCE_OVERRIDE"
  | "ADDITION_ENTRY"
  | "OTHER_DEDUCTION_ENTRY"
  | "SALARY_ADJUSTMENT"
  | "ZERO_SALARY_REASON"
  | "OVERTIME_ELIGIBILITY_OVERRIDE"
  | "LEAVE_INPUT_CHANGE"
  | "EMPLOYMENT_INPUT_CHANGE"
  | "MANUAL_ADJUSTMENT"
  | "SETTINGS_REFRESH";
export type HistoryType =
  | AdjustmentType
  | "SETTINGS_CHANGE"
  | "EMPLOYEE_GOSI_CHANGE"
  | "ASSIGNMENT_CHANGE";
export type SourceKind =
  | "employee_salary"
  | "attendance_absence"
  | "unpaid_leave"
  | "manual_adjustment"
  | "loan"
  | "attendance_penalty"
  | "penalty"
  | "carry_forward"
  | "company_settings"
  | "rent_allocation"
  | "legacy";
/** The 44 validation codes; kept open so a new backend code still renders. */
export type ValidationCode =
  | "missing_hire_date"
  | "archived_without_date"
  | "prehire_status_conflict"
  | "suspended_pay_decision_required"
  | "terminated_without_end_date"
  | "overtime_limit_not_set"
  | "overtime_over_allowed"
  | "attendance_source_unavailable"
  | "overtime_not_allowed"
  | "absence_capped"
  | "deductions_capped"
  | "uncollected_deduction"
  | "claim_unaffordable"
  | "penalty_pending_fine_cap"
  | "penalty_absence_overlap"
  | "penalty_wage_evidence_missing"
  | "accommodation_unknown"
  | "rent_value_missing"
  | "rent_reconciliation_failed"
  | "medical_invoice_missing"
  | "zero_salary_reason_required"
  | "zero_salary_detail_required"
  | "salary_total_mismatch"
  | "payroll_reconciliation_failed"
  | "legacy_link_unresolved"
  | "attendance_calendar_missing"
  | "invalid_decimal"
  | "invalid_quantity"
  | "invalid_choice"
  | "invalid_period"
  | "reason_required"
  | "invalid_date_range"
  | "assignment_overlap"
  | "company_mismatch"
  | "duplicate_period"
  | "stale_revision"
  | "run_not_draft"
  | "run_cancelled"
  | "run_not_finalized"
  | "confirm_required"
  | "invalid_export_format"
  | "field_not_editable"
  | "amount_out_of_range"
  | "policy_decision_required"
  | (string & {});

export interface EnumOption<V extends string = string> {
  value: V;
  label: string;
  label_key: string;
}

export interface ValidationCodeOption extends EnumOption<ValidationCode> {
  severity: ValidationSeverity;
}

/** GET /payroll-settings/enums/ */
export interface PayrollEnums {
  run_status: EnumOption<PayrollStatus>[];
  payslip_status: EnumOption<PayrollStatus>[];
  salary_base: EnumOption<SalaryBaseType>[];
  line_category: EnumOption<LineCategory>[];
  line_type: EnumOption<LineType>[];
  zero_salary_reason: EnumOption<ZeroSalaryReason>[];
  accommodation_status: EnumOption<AccommodationStatus>[];
  adjustment_type: EnumOption<AdjustmentType>[];
  validation_severity: EnumOption<ValidationSeverity>[];
  carry_status: EnumOption[];
  collection_state: EnumOption[];
  history_type: EnumOption[];
  validation_codes: ValidationCodeOption[];
  suspended_pay_decision: EnumOption<SuspendedPayDecision>[];
  provision_proration: EnumOption<ProvisionProration>[];
}

/** Backend-authored text with its translation key (assumptions, rent labels). */
export interface KeyedMessage {
  key: string;
  message: string;
}

export interface ActorRef {
  id: number;
  name: string;
}

// ─── S: company settings ────────────────────────────────────────────────────

export interface SalaryBaseSelector {
  type: SalaryBaseType;
  /** Required (nonnegative) for FIXED_AMOUNT, null for every other type. */
  fixed_amount: Money | null;
}

export type SalaryBaseField =
  | "absence_base"
  | "gosi_base"
  | "leave_base"
  | "eos_base"
  | "overtime_base";

export interface PayrollSettings {
  /** null while the company still uses the documented defaults. */
  id: number | null;
  company_id: number;
  /** 0 = defaults, never persisted. */
  settings_revision: number;
  day_basis: number;
  rounding: string;
  provision_proration: ProvisionProration;
  absence_base: SalaryBaseSelector;
  gosi_base: SalaryBaseSelector;
  leave_base: SalaryBaseSelector;
  eos_base: SalaryBaseSelector;
  overtime_base: SalaryBaseSelector;
  foreign_gosi_rate: RateString;
  saudi_gosi_rate: RateString;
  /** null = unknown invoice (cost incomplete); distinct from no_medical_insurance. */
  annual_medical_invoice: Money | null;
  monthly_foreign_id_cost: Money;
  annual_air_ticket: Money;
  overtime_default_is_assumption: boolean;
  assumptions: KeyedMessage[];
  updated_at: string | null;
  no_medical_insurance: boolean;
  require_manual_absence_confirmation: boolean;
  normal_overtime_limit_period: string;
}

/** PATCH /payroll-settings/ (sparse; reason and expected_revision mandatory). */
export interface PayrollSettingsPatch {
  expected_revision: number;
  reason: string;
  absence_base?: SalaryBaseSelector;
  gosi_base?: SalaryBaseSelector;
  leave_base?: SalaryBaseSelector;
  eos_base?: SalaryBaseSelector;
  overtime_base?: SalaryBaseSelector;
  foreign_gosi_rate?: RateString;
  saudi_gosi_rate?: RateString;
  annual_medical_invoice?: Money | null;
  no_medical_insurance?: boolean;
  monthly_foreign_id_cost?: Money;
  annual_air_ticket?: Money;
  provision_proration?: ProvisionProration;
  require_manual_absence_confirmation?: boolean;
}

/** GET/PATCH /payroll-settings/employees/{employee_profile_id}/ */
export interface EmployeePayrollConfig {
  employee_profile_id: number;
  employee_id: string;
  deduct_gosi_from_employee: boolean;
  /** Employee payroll-config revision, not the company settings revision. */
  settings_revision: number;
}

export interface EmployeePayrollConfigPatch {
  expected_revision: number;
  deduct_gosi_from_employee: boolean;
  reason: string;
}

// ─── H: history ─────────────────────────────────────────────────────────────

export interface PayrollHistoryEntry {
  id: number;
  audit_log_id: number;
  type: HistoryType;
  changed_fields: string[];
  original_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  reason: string;
  actor: ActorRef | null;
  created_at: string;
  /** One of these replaces the other depending on the history kind. */
  run_revision?: number;
  settings_revision?: number;
  assignment_id?: number;
}

export interface HistoryParams extends PageParams {
  date_from?: string;
  date_to?: string;
  actor_id?: number;
}

/** GET /payroll-runs/{run_id}/history/ entry. */
export interface PayrollRunHistoryEntry {
  audit_log_id: number;
  action: string;
  original_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  reason: string;
  actor: ActorRef | null;
  created_at: string;
}

// ─── R: run ─────────────────────────────────────────────────────────────────

export interface ValidationCounts {
  errors: number;
  warnings: number;
}

export interface SettingsSnapshot extends Omit<
  PayrollSettings,
  "id" | "assumptions" | "updated_at" | "company_id" | "settings_revision"
> {
  schema_version: number;
  company_id: number;
  settings_revision: number;
  payroll_timezone?: string;
  legacy_unknown?: boolean;
}

export interface PayrollRunDto {
  id: number;
  year: number;
  month: number;
  status: PayrollStatus;
  total_net: Money;
  total_employees: number;
  company_id: number;
  company_name: string;
  period_start: string;
  period_end: string;
  revision: number;
  total_gross: Money;
  total_additions: Money;
  total_deductions: Money;
  total_provisions: Money;
  total_company_cost: Money;
  cost_incomplete: boolean;
  settings_revision: number;
  settings_snapshot: SettingsSnapshot;
  calculator_version: string;
  legacy_calculation: boolean;
  calculated_at: string | null;
  finalized_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  validation_counts: ValidationCounts;
  /** Nullable numeric User PK (see CONTRACT QUESTIONS: no name supplied). */
  cancelled_by: number | null;
}

export interface ListPayrollRunsQuery extends PageParams {
  year?: number;
  month?: number;
  status?: PayrollStatus;
}

// ─── I: run item ────────────────────────────────────────────────────────────

export interface PayrollLineBase<T extends string = LineType> {
  type: T;
  label: string;
  label_key: string;
  /** null only for unknown provisions. */
  amount: Money | null;
}

export type SalaryComponentLine = PayrollLineBase<SalaryLineType>;
export type ProvisionLine = PayrollLineBase<ProvisionLineType>;

export interface SourcePeriod {
  year: number;
  month: number;
}

/** HR addition/deduction line with collection evidence. */
export interface PayrollMoneyLine extends PayrollLineBase<
  AdditionLineType | DeductionLineType
> {
  id: number;
  quantity: Quantity | null;
  source_kind: SourceKind;
  source_id: string | null;
  source_period: SourcePeriod | null;
  requested_amount: Money | null;
  collected_amount: Money | null;
  uncollected_amount: Money | null;
  carried_in: boolean;
}

export interface ItemAbsence {
  attendance_days: Quantity;
  unpaid_leave_days: Quantity;
  paid_leave_days: Quantity;
  penalty_withheld_days: Quantity;
  override_days: Quantity | null;
  effective_days: Quantity;
  full_month_absence: boolean;
  base_type: SalaryBaseType;
  monthly_base: Money;
  authorized_amount: Money;
  capped_amount: Money;
  source_available: boolean;
  mapping_start_date: string | null;
  uncovered_dates: string[];
  manual_confirmed: boolean;
  manual_confirmation_required: boolean;
}

export interface ItemOvertime {
  normal_hours: Quantity;
  weekly_rest_days: Quantity;
  official_holiday_days: Quantity;
  /** Normal-overtime HOURS limit per calendar month (integer); null = no limit set. */
  allowed_overtime: number | null;
  override_overtime_eligibility: boolean;
  payable_normal_hours: Quantity;
  over_allowed_hours: Quantity;
  unpaid_normal_hours: Quantity;
  limit_period: string;
}

export interface CarryForwardCategory {
  type: DeductionLineType;
  carried_in: Money;
  requested: Money;
  collected: Money;
  uncollected: Money;
  manual_reentry_required: boolean;
}

export interface CarryForward {
  carried_in: Money;
  requested: Money;
  collected: Money;
  uncollected: Money;
  by_category: CarryForwardCategory[];
}

export interface PayrollRunItemDto {
  /** HR-only calculation snapshot; never accepted in item PATCH. */
  readonly executive_exempt: boolean;
  id: number;
  payroll_run_id: number;
  run_revision: number;
  employee_profile_id: number;
  employee_id: string;
  employee_name: string;
  department: string | null;
  position: string | null;
  has_user_account: boolean;
  payslip_id: number | null;
  basic_salary: Money;
  accommodation_allowance: Money;
  transportation_allowance: Money;
  telephone_allowance: Money;
  petrol_allowance: Money;
  other_allowance: Money;
  total_allowances: Money;
  full_monthly_gross: Money;
  gross_salary: Money;
  total_additions: Money;
  total_deductions: Money;
  net_salary: Money;
  absence_deduction: Money;
  gosi_employee_deduction: Money;
  loan_deduction: Money;
  penalty_deduction: Money;
  other_deduction: Money;
  overtime_normal: Money;
  weekly_rest_work: Money;
  official_holiday_work: Money;
  bonus: Money;
  incentive: Money;
  other_addition: Money;
  medical_provision: Money | null;
  id_cost_provision: Money | null;
  air_ticket_provision: Money | null;
  leave_provision: Money | null;
  eos_provision: Money | null;
  accommodation_cost: Money | null;
  gosi_company_provision: Money | null;
  total_provisions: Money;
  total_company_cost: Money;
  cost_incomplete: boolean;
  accommodation_status: AccommodationStatus;
  hire_date: string | null;
  archive_date: string | null;
  salary_days: Quantity;
  employed_calendar_days: number;
  absence: ItemAbsence;
  overtime: ItemOvertime;
  deduct_gosi_from_employee: boolean;
  zero_salary_reason: ZeroSalaryReason | null;
  zero_salary_reason_detail: string | null;
  carry_forward: CarryForward;
  salary_components: SalaryComponentLine[];
  additions: PayrollMoneyLine[];
  deductions: PayrollMoneyLine[];
  provisions: ProvisionLine[];
  warnings: ValidationIssue[];
  assumptions: KeyedMessage[];
  suspended_pay_decision: SuspendedPayDecision | null;
  /**
   * v0.5.2: the six FULL MONTHLY salary inputs used by the run (after any
   * run-local adjustment). Prefill the salary editor from these, never from
   * the paid (prorated) scalars above. null only for legacy unknown input.
   */
  monthly_salary_components: MonthlySalaryComponents | null;
  /** v0.5.2: a run-local salary adjustment is active. */
  salary_adjusted: boolean;
  /**
   * v0.5.3: the nine run-local values HR actually ENTERED (stored overrides),
   * not the rounded/collected lines. Decimals keep halalas ("250.50" while the
   * posted BONUS line is "251.00"). Prefill the edit form from these.
   */
  manual_inputs: ManualInputs;
}

export interface ManualInputs {
  /** null = no override entered (or cleared). */
  absence_days_override: Quantity | null;
  overtime_normal_hours: Quantity;
  weekly_rest_work_days: Quantity;
  official_holiday_work_days: Quantity;
  bonus: Money;
  incentive: Money;
  other_addition: Money;
  other_deduction: Money;
  override_overtime_eligibility: boolean;
}

export type MonthlySalaryKey =
  | "basic_salary"
  | "accommodation_allowance"
  | "transportation_allowance"
  | "telephone_allowance"
  | "petrol_allowance"
  | "other_allowance";

export type MonthlySalaryComponents = Record<MonthlySalaryKey, Money>;

export interface ListPayrollRunItemsQuery extends PageParams {
  employee_profile_id?: number;
  search?: string;
  has_warnings?: boolean;
}

/** Monthly contractual components editable run-locally (six keys only). */
export interface SalaryComponentChanges {
  basic_salary?: Money;
  accommodation_allowance?: Money;
  transportation_allowance?: Money;
  telephone_allowance?: Money;
  petrol_allowance?: Money;
  other_allowance?: Money;
}

/** Sparse `changes` object of PATCH /payroll-runs/{run_id}/items/{item_id}/. */
export interface PayrollItemChanges {
  absence_days_override?: Quantity | null;
  overtime_normal_hours?: Quantity;
  weekly_rest_work_days?: Quantity;
  official_holiday_work_days?: Quantity;
  bonus?: Money;
  incentive?: Money;
  other_addition?: Money;
  other_deduction?: Money;
  override_overtime_eligibility?: boolean;
  salary_components?: SalaryComponentChanges;
  zero_salary_reason?: ZeroSalaryReason | null;
  zero_salary_reason_detail?: string | null;
  suspended_pay_decision?: SuspendedPayDecision;
}

export interface PayrollItemPatch {
  expected_revision: number;
  changes: PayrollItemChanges;
  reason: string;
}

export interface ItemAdjustmentsParams extends HistoryParams {
  type?: AdjustmentType;
}

// ─── Summary ────────────────────────────────────────────────────────────────

export interface PayrollRunSummaryDto {
  run_id: number;
  year: number;
  month: number;
  total_employees: number;
  employees_with_deductions: number;
  total_basic_salary: Money;
  total_allowances: Money;
  total_gross_salary: Money;
  total_deductions: Money;
  total_net_salary: Money;
  /** Diagnostic value, not a payroll line. */
  average_net_salary: Money;
  total_additions: Money;
  total_provisions: Money;
  total_company_cost: Money;
  cost_incomplete: boolean;
  salary_components: Record<
    | "basic_salary"
    | "accommodation_allowance"
    | "transportation_allowance"
    | "telephone_allowance"
    | "petrol_allowance"
    | "other_allowance",
    Money
  >;
  additions: Record<
    | "overtime_normal"
    | "weekly_rest_work"
    | "official_holiday_work"
    | "bonus"
    | "incentive"
    | "other_addition",
    Money
  >;
  deductions: Record<
    | "absence"
    | "gosi_employee"
    | "attendance_penalty"
    | "penalty_fine"
    | "penalty_wage_withholding"
    | "loan"
    | "other_deduction"
    | "previous_total_deductions",
    Money
  >;
  provisions: Record<
    | "medical"
    | "id_cost"
    | "air_ticket"
    | "leave"
    | "eos"
    | "accommodation_cost"
    | "gosi_company",
    Money
  >;
  carry_forward: CarryForward;
  rent_rounding_difference: ExactShare;
  validation_counts: ValidationCounts;
  reconciliation: {
    items_net: Money;
    payslips_net: Money;
    item_count: number;
    payslip_count: number;
    matches: boolean;
  };
  unknown_provision_counts: Record<ProvisionLineType, number>;
}

// ─── V: validation ──────────────────────────────────────────────────────────

export interface ValidationEmployeeRef {
  employee_profile_id: number;
  employee_id: string;
  employee_name: string;
  /** null for excluded (archived/PREHIRE/TERMINATED) profiles. */
  item_id: number | null;
}

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  message_key: string;
  /** null for run-level issues. */
  employee: ValidationEmployeeRef | null;
  field?: string | null;
  params: Record<string, unknown>;
}

export interface ValidationReport {
  run_id: number;
  revision: number;
  can_finalize: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  counts: ValidationCounts;
  employees_checked: number;
  excluded_employees_checked: number;
  reconciliation: {
    total_net: Money;
    items_net: Money;
    payslips_net: Money;
    item_count: number;
    payslip_count: number;
    matches: boolean;
  };
}

export interface ValidationReportQuery {
  employee_profile_id?: number;
  severity?: ValidationSeverity;
  code?: ValidationCode;
}

// ─── Run actions ────────────────────────────────────────────────────────────

export interface RecalculateRequest {
  expected_revision: number;
  refresh_settings: boolean;
  reason: string;
}

export interface RecalculateResult {
  message: string;
  message_key: string;
  run_id: number;
  revision: number;
  status: PayrollStatus;
  settings_revision: number;
  total_net: Money;
  total_company_cost: Money;
  cost_incomplete: boolean;
  changed_items: number;
  validation_counts: ValidationCounts;
}

export interface FinalizeRequest {
  confirm: true;
  expected_revision?: number;
  reason?: string;
}

export interface FinalizeResult {
  message: string;
  message_key?: string;
  run_id: number;
  revision: number;
  status: PayrollStatus;
  validation_counts: ValidationCounts;
}

export interface GeneratePayslipsResult {
  message: string;
  message_key?: string;
  generated_count?: number;
  total_payslips?: number;
  run_status?: PayrollStatus | string;
  download_pdf_url?: string;
}

export interface CancelRunRequest {
  expected_revision: number;
  reason: string;
}

export interface CancelRunResult {
  message: string;
  message_key: string;
  run_id: number;
  revision: number;
  status: PayrollStatus;
  restored_loans: number;
  released_attendance_claims: number;
  released_penalty_claims: number;
  released_carry_collections: number;
  inactive_payslips: number;
  cancelled_at: string | null;
  cancelled_by: number | null;
  cancel_reason: string | null;
}

export type PayrollExportFormat = "pdf" | "xlsx" | "csv";

// ─── A: accommodation ───────────────────────────────────────────────────────

export interface AccommodationAssignment {
  id: number;
  company_id: number;
  employee_profile_id: number;
  employee_id: string;
  employee_name: string;
  status: AccommodationStatus;
  rent_id: number | null;
  rent_name: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_by: ActorRef | null;
  updated_by: ActorRef | null;
  created_at: string;
  updated_at: string;
}

export interface ListAssignmentsQuery extends PageParams {
  employee_profile_id?: number;
  rent_id?: number;
  status?: AccommodationStatus;
  active_on?: string;
  is_active?: boolean;
}

export interface CreateAssignmentRequest {
  employee_profile_id: number;
  status: AccommodationStatus;
  rent_id: number | null;
  start_date: string;
  end_date: string;
  reason: string;
}

export interface UpdateAssignmentRequest {
  status?: AccommodationStatus;
  rent_id?: number | null;
  start_date?: string;
  end_date?: string;
  reason: string;
}

export interface RentResidentShare {
  employee: {
    employee_profile_id: number;
    employee_id: string;
    employee_name: string;
  };
  in_payroll: boolean;
  payroll_status_label: KeyedMessage | null;
  raw_share: ExactShare;
  rounded_share: Money;
}

export interface RentAllocationSlot {
  slot: number;
  calendar_date: string;
  resident_profile_ids: number[];
  /** null for a vacant slot. */
  raw_daily_share: ExactShare | null;
}

export interface AccommodationReportProperty {
  rent_id: number;
  rent_name: string;
  year: number;
  month: number;
  monthly_rent: ExactShare;
  residents: RentResidentShare[];
  vacant_unallocated_raw: ExactShare;
  not_in_payroll_raw: ExactShare;
  rounding_difference: ExactShare;
  rounding_difference_label: KeyedMessage;
  in_payroll_rounded: Money;
  slots: RentAllocationSlot[];
  raw_reconciliation: { matches: boolean };
}

// ─── EP: employee payslip (strict whitelist) ────────────────────────────────

/** Statuses an employee can actually receive. */
export type EmployeePayslipStatus = "COMPLETED" | "PAID";

export interface EmployeePayslipListEntry {
  id: number;
  year: number;
  month: number;
  net_salary: Money;
  payment_mode: string;
  status: EmployeePayslipStatus | string;
}

export interface EmployeePayslipLine {
  type: AdditionLineType | DeductionLineType;
  label: string;
  label_key: string;
  amount: Money;
  quantity: Quantity | null;
  source_period: SourcePeriod | null;
}

export interface EmployeePayslipDetail {
  id: number;
  year: number;
  month: number;
  basic_salary: Money;
  transportation_allowance: Money;
  accommodation_allowance: Money;
  telephone_allowance: Money;
  petrol_allowance: Money;
  other_allowance: Money;
  /** Earned gross alias; excludes additions. */
  total_salary: Money;
  total_deductions: Money;
  net_salary: Money;
  payment_mode: string;
  status: EmployeePayslipStatus | string;
  gross_salary: Money;
  total_additions: Money;
  salary_components: SalaryComponentLine[];
  additions: EmployeePayslipLine[];
  deductions: EmployeePayslipLine[];
  legacy_calculation: boolean;
}

// ─── Errors (section 4.2) ───────────────────────────────────────────────────

/** Object error item. Legacy endpoints may send plain strings instead. */
export interface PayrollErrorItem {
  field?: string | null;
  code?: ValidationCode;
  message: string;
  message_key?: string;
  params?: Record<string, unknown>;
  employee?: ValidationEmployeeRef | null;
}

export interface PayrollErrorEnvelope {
  status: "error";
  message?: string;
  detail?: string;
  errors?: Array<PayrollErrorItem | string>;
}
