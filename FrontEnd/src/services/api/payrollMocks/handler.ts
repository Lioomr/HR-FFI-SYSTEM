import type { PayrollRequest } from "../payrollTransport";
import type {
  AccommodationAssignment,
  AccommodationReportProperty,
  EmployeePayrollConfig,
  EmployeePayslipDetail,
  EmployeePayslipListEntry,
  PayrollEnums,
  PayrollErrorItem,
  PayrollHistoryEntry,
  PayrollRunDto,
  PayrollRunItemDto,
  PayrollRunSummaryDto,
  PayrollSettings,
  SalaryBaseSelector,
  ValidationReport,
} from "../payrollTypes";
import * as examples from "./contractExamples";

/**
 * In-memory payroll API used when payroll mocks are enabled (see
 * payrollTransport). Responses start from the verbatim contract examples
 * (contractExamples.ts) and the handler enforces the contract's request rules:
 * mandatory reason, expected_revision (409 stale_revision), DRAFT-only edits,
 * duplicate period, assignment overlap and the error envelopes of section 4.2.
 *
 * It deliberately does NOT calculate payroll money: edits are recorded and the
 * revision advances, but amounts stay as in the fixtures. Totals are the
 * backend's job, never the frontend's or its mocks'.
 */

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = () => new Date().toISOString();

const MOCK_ACTOR = { id: 5, name: "Example HR" };

interface MockState {
  settings: PayrollSettings;
  settingsHistory: PayrollHistoryEntry[];
  employeeConfigs: Map<number, EmployeePayrollConfig>;
  employeeConfigHistory: Map<number, PayrollHistoryEntry[]>;
  runs: PayrollRunDto[];
  items: Map<number, PayrollRunItemDto[]>;
  validation: Map<number, ValidationReport>;
  summaries: Map<number, PayrollRunSummaryDto>;
  assignments: AccommodationAssignment[];
  accommodationReport: AccommodationReportProperty[];
  payslips: EmployeePayslipListEntry[];
  payslipDetails: Map<number, EmployeePayslipDetail>;
  nextId: number;
}

function initialState(): MockState {
  const run = clone(examples.run.data) as unknown as PayrollRunDto;
  const item = clone(examples.item.data) as unknown as PayrollRunItemDto;
  const config = clone(
    examples.employeeConfig.data,
  ) as unknown as EmployeePayrollConfig;
  return {
    settings: clone(examples.settings.data) as unknown as PayrollSettings,
    settingsHistory: [],
    employeeConfigs: new Map([[config.employee_profile_id, config]]),
    employeeConfigHistory: new Map(),
    runs: [run],
    items: new Map([[run.id, [item]]]),
    validation: new Map([
      [
        run.id,
        clone(examples.validationReport.data) as unknown as ValidationReport,
      ],
    ]),
    summaries: new Map([
      [run.id, clone(examples.summary.data) as unknown as PayrollRunSummaryDto],
    ]),
    assignments: [
      clone(examples.assignment.data) as unknown as AccommodationAssignment,
    ],
    accommodationReport: clone(
      examples.accommodationReportPage.data.items,
    ) as unknown as AccommodationReportProperty[],
    payslips: clone(
      examples.employeePayslipList.data.items,
    ) as unknown as EmployeePayslipListEntry[],
    payslipDetails: new Map([
      [
        examples.employeePayslip.data.id,
        clone(
          examples.employeePayslip.data,
        ) as unknown as EmployeePayslipDetail,
      ],
    ]),
    nextId: 1000,
  };
}

let state = initialState();

/** Test hook: direct access to the mock state, e.g. to seed a scenario. */
export function payrollMockState(): MockState {
  return state;
}

/** Test hook: back to the contract examples. */
export function resetPayrollMockState(): void {
  state = initialState();
}

// ─── Errors in the contract's shapes ────────────────────────────────────────

class MockHttpError extends Error {
  response: { status: number; data: Json };
  apiData: Json;
  constructor(status: number, data: Json) {
    super(String(data.message ?? "Request failed"));
    this.response = { status, data };
    this.apiData = data;
  }
}

function fail(status: number, message: string, errors?: unknown[]): never {
  throw new MockHttpError(status, {
    status: "error",
    message,
    ...(errors ? { errors } : {}),
  });
}

function issue(
  code: string,
  message: string,
  field?: string,
  params: Json = {},
): PayrollErrorItem {
  return {
    ...(field ? { field } : {}),
    code,
    message,
    message_key: `payroll.validation.${code}`,
    params,
  };
}

const notFound = (): never => fail(404, "Not found", ["Not found."]);

function requireReason(body: Json) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    fail(422, "A reason is required.", [
      issue("reason_required", "A reason is required.", "reason"),
    ]);
  }
  if (reason.length > 2000) {
    fail(422, "Ensure this field has no more than 2000 characters.", [
      issue(
        "invalid_choice",
        "Ensure this field has no more than 2000 characters.",
        "reason",
      ),
    ]);
  }
  return reason;
}

function requireRevision(body: Json, current: number) {
  const expected = body.expected_revision;
  if (typeof expected !== "number" || !Number.isInteger(expected)) {
    fail(422, "expected_revision is required.", [
      issue(
        "invalid_choice",
        "expected_revision is required.",
        "expected_revision",
      ),
    ]);
  }
  if (expected !== current) {
    fail(409, "Payroll data changed; reload and retry.", [
      issue(
        "stale_revision",
        "Payroll data changed; reload and retry.",
        undefined,
        {
          expected_revision: expected,
          current_revision: current,
        },
      ),
    ]);
  }
}

const DECIMAL_2 = /^\d+(\.\d{1,2})?$/;
const RATE = /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/;

function requireMoney(value: unknown, field: string, nullable = false) {
  if (value === null && nullable) return;
  if (typeof value !== "string" || !DECIMAL_2.test(value)) {
    fail(422, "Enter a finite nonnegative decimal string.", [
      issue(
        "invalid_decimal",
        "Enter a finite nonnegative decimal string.",
        field,
      ),
    ]);
  }
}

function page<T>(items: T[], params: Json = {}) {
  const pageNumber = Number(params.page ?? 1) || 1;
  const pageSize = Number(params.page_size ?? 25) || 25;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  if (pageNumber > totalPages) fail(404, "Invalid page.");
  return {
    status: "success",
    data: {
      items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      page_size: pageSize,
      count: items.length,
      total_pages: totalPages,
    },
  };
}

const ok = (data: unknown) => ({ status: "success", data });

function historyEntry(
  type: PayrollHistoryEntry["type"],
  changed: string[],
  original: Json,
  next: Json,
  reason: string,
  extra: Partial<PayrollHistoryEntry>,
): PayrollHistoryEntry {
  const id = state.nextId++;
  return {
    id,
    audit_log_id: 9000 + id,
    type,
    changed_fields: changed,
    original_value: original,
    new_value: next,
    reason,
    actor: MOCK_ACTOR,
    created_at: now(),
    ...extra,
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

const BASE_FIELDS = [
  "absence_base",
  "gosi_base",
  "leave_base",
  "eos_base",
  "overtime_base",
] as const;
const SALARY_BASES = [
  "BASIC",
  "BASIC_HOUSING",
  "BASIC_HOUSING_TRANSPORT",
  "GROSS",
  "FIXED_AMOUNT",
];
const SETTINGS_WRITABLE = new Set<string>([
  ...BASE_FIELDS,
  "foreign_gosi_rate",
  "saudi_gosi_rate",
  "annual_medical_invoice",
  "no_medical_insurance",
  "monthly_foreign_id_cost",
  "annual_air_ticket",
  "provision_proration",
  "require_manual_absence_confirmation",
]);

function patchSettings(body: Json) {
  requireRevision(body, state.settings.settings_revision);
  const reason = requireReason(body);
  const changes: Json = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "reason" || key === "expected_revision") continue;
    if (!SETTINGS_WRITABLE.has(key)) {
      fail(422, "This field cannot be edited here.", [
        issue("field_not_editable", "This field cannot be edited here.", key),
      ]);
    }
    changes[key] = value;
  }
  for (const field of BASE_FIELDS) {
    if (!(field in changes)) continue;
    const selector = changes[field] as SalaryBaseSelector;
    if (!selector || !SALARY_BASES.includes(selector.type)) {
      fail(422, "Select a supported value.", [
        issue("invalid_choice", "Select a supported value.", `${field}.type`),
      ]);
    }
    if (selector.type === "FIXED_AMOUNT") {
      requireMoney(selector.fixed_amount, `${field}.fixed_amount`);
    } else if (selector.fixed_amount !== null) {
      fail(422, "Select a supported value.", [
        issue(
          "invalid_choice",
          "Select a supported value.",
          `${field}.fixed_amount`,
        ),
      ]);
    }
  }
  for (const field of ["foreign_gosi_rate", "saudi_gosi_rate"]) {
    if (field in changes && !RATE.test(String(changes[field]))) {
      fail(422, "Enter a finite nonnegative decimal string.", [
        issue(
          "invalid_decimal",
          "Enter a finite nonnegative decimal string.",
          field,
        ),
      ]);
    }
  }
  if ("annual_medical_invoice" in changes) {
    requireMoney(
      changes.annual_medical_invoice,
      "annual_medical_invoice",
      true,
    );
  }
  for (const field of ["monthly_foreign_id_cost", "annual_air_ticket"]) {
    if (field in changes) requireMoney(changes[field], field);
  }

  const current = state.settings as unknown as Json;
  const changed = Object.keys(changes).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(changes[key]),
  );
  if (!changed.length) return ok(clone(state.settings)); // no-op PATCH
  const original = Object.fromEntries(changed.map((k) => [k, current[k]]));
  const next = Object.fromEntries(changed.map((k) => [k, changes[k]]));
  state.settings = {
    ...state.settings,
    ...(next as Partial<PayrollSettings>),
    id: state.settings.id ?? 1,
    settings_revision: state.settings.settings_revision + 1,
    updated_at: now(),
  };
  state.settingsHistory.unshift(
    historyEntry("SETTINGS_CHANGE", changed, original, next, reason, {
      settings_revision: state.settings.settings_revision,
    }),
  );
  return ok(clone(state.settings));
}

function employeeConfig(profileId: number): EmployeePayrollConfig {
  let config = state.employeeConfigs.get(profileId);
  if (!config) {
    config = {
      employee_profile_id: profileId,
      employee_id: `EMP-${String(profileId).padStart(3, "0")}`,
      deduct_gosi_from_employee: false,
      settings_revision: 0,
    };
    state.employeeConfigs.set(profileId, config);
  }
  return config;
}

function patchEmployeeConfig(profileId: number, body: Json) {
  const config = employeeConfig(profileId);
  requireRevision(body, config.settings_revision);
  const reason = requireReason(body);
  if (typeof body.deduct_gosi_from_employee !== "boolean") {
    fail(422, "Select a supported value.", [
      issue(
        "invalid_choice",
        "Select a supported value.",
        "deduct_gosi_from_employee",
      ),
    ]);
  }
  if (body.deduct_gosi_from_employee === config.deduct_gosi_from_employee) {
    return ok(clone(config));
  }
  const next: EmployeePayrollConfig = {
    ...config,
    deduct_gosi_from_employee: body.deduct_gosi_from_employee as boolean,
    settings_revision: config.settings_revision + 1,
  };
  state.employeeConfigs.set(profileId, next);
  const history = state.employeeConfigHistory.get(profileId) ?? [];
  history.unshift(
    historyEntry(
      "EMPLOYEE_GOSI_CHANGE",
      ["deduct_gosi_from_employee"],
      { deduct_gosi_from_employee: config.deduct_gosi_from_employee },
      { deduct_gosi_from_employee: next.deduct_gosi_from_employee },
      reason,
      { settings_revision: next.settings_revision },
    ),
  );
  state.employeeConfigHistory.set(profileId, history);
  return ok(clone(next));
}

// ─── Runs ───────────────────────────────────────────────────────────────────

function findRun(id: number): PayrollRunDto {
  return state.runs.find((run) => run.id === id) ?? notFound();
}

function requireDraft(run: PayrollRunDto) {
  if (run.status !== "DRAFT") {
    fail(422, "Only a draft payroll run can be changed or cancelled.", [
      issue(
        "run_not_draft",
        "Only a draft payroll run can be changed or cancelled.",
      ),
    ]);
  }
}

function bumpRun(run: PayrollRunDto) {
  run.revision += 1;
  for (const item of state.items.get(run.id) ?? []) {
    item.run_revision = run.revision;
  }
  const report = state.validation.get(run.id);
  if (report) report.revision = run.revision;
}

function createRun(body: Json) {
  const parseIsoDate = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
      ? parsed
      : null;
  };
  const periodStart = parseIsoDate(body.period_start);
  const periodEnd = parseIsoDate(body.period_end);
  const calendarDays =
    periodStart && periodEnd
      ? Math.floor((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) +
        1
      : 0;
  const yearsInRange =
    periodStart &&
    periodEnd &&
    periodStart.getUTCFullYear() >= 1900 &&
    periodStart.getUTCFullYear() <= 2100 &&
    periodEnd.getUTCFullYear() >= 1900 &&
    periodEnd.getUTCFullYear() <= 2100;
  if (
    !periodStart ||
    !periodEnd ||
    !yearsInRange ||
    calendarDays < 1 ||
    calendarDays > 30
  ) {
    fail(422, "Select an inclusive date range of 30 days or fewer.", [
      issue(
        "invalid_date_range",
        "Select an inclusive date range of 30 days or fewer.",
        "period_end",
      ),
    ]);
  }
  const year = periodEnd.getUTCFullYear();
  const month = periodEnd.getUTCMonth() + 1;
  const periodStartIso = body.period_start as string;
  const periodEndIso = body.period_end as string;
  const duplicate = state.runs.find(
    (run) =>
      run.status !== "CANCELLED" &&
      !!run.period_start &&
      !!run.period_end &&
      run.period_start <= periodEndIso &&
      run.period_end >= periodStartIso,
  );
  if (duplicate) {
    // Legacy string-array form, retained by the contract.
    fail(409, "Payroll run already exists for this period.", [
      "Payroll run already exists for this period.",
    ]);
  }
  const template = clone(examples.run.data) as unknown as PayrollRunDto;
  const run: PayrollRunDto = {
    ...template,
    id: state.nextId++,
    period_basis: "DATE_RANGE",
    year,
    month,
    calendar_days: calendarDays,
    revision: 1,
    period_start: periodStartIso,
    period_end: periodEndIso,
    calculated_at: now(),
  };
  state.runs.unshift(run);
  const items = (
    clone([examples.item.data]) as unknown as PayrollRunItemDto[]
  ).map((item) => ({ ...item, payroll_run_id: run.id, run_revision: 1 }));
  state.items.set(run.id, items);
  state.validation.set(run.id, {
    ...(clone(examples.validationReport.data) as unknown as ValidationReport),
    run_id: run.id,
    revision: 1,
  });
  state.summaries.set(run.id, {
    ...(clone(examples.summary.data) as unknown as PayrollRunSummaryDto),
    run_id: run.id,
    year,
    month,
  });
  return { status: "success", data: clone(run) };
}

function listRuns(params: Json) {
  const runs = state.runs
    .filter((run) => !params.year || run.year === Number(params.year))
    .filter((run) => !params.month || run.month === Number(params.month))
    .filter((run) => !params.status || run.status === params.status)
    .sort((a, b) => b.year - a.year || b.month - a.month || b.id - a.id);
  return page(clone(runs), params);
}

const ITEM_CHANGE_KEYS = new Set([
  "absence_days_override",
  "overtime_normal_hours",
  "weekly_rest_work_days",
  "official_holiday_work_days",
  "bonus",
  "incentive",
  "other_addition",
  "other_deduction",
  "override_overtime_eligibility",
  "salary_components",
  "zero_salary_reason",
  "zero_salary_reason_detail",
  "suspended_pay_decision",
]);

function patchItem(run: PayrollRunDto, item: PayrollRunItemDto, body: Json) {
  requireDraft(run);
  requireRevision(body, run.revision);
  requireReason(body);
  const changes = (body.changes ?? {}) as Json;
  const keys = Object.keys(changes);
  if (!keys.length) {
    fail(422, "Provide at least one change.", [
      issue("field_not_editable", "Provide at least one change.", "changes"),
    ]);
  }
  for (const key of keys) {
    if (!ITEM_CHANGE_KEYS.has(key)) {
      fail(422, "This field cannot be edited here.", [
        issue(
          "field_not_editable",
          "This field cannot be edited here.",
          `changes.${key}`,
        ),
      ]);
    }
  }
  if (
    changes.zero_salary_reason === "other" &&
    !changes.zero_salary_reason_detail
  ) {
    fail(422, "Provide details for the other zero-pay reason.", [
      issue(
        "zero_salary_detail_required",
        "Provide details for the other zero-pay reason.",
        "changes.zero_salary_reason_detail",
      ),
    ]);
  }
  // Record inputs only; amounts are the backend calculator's job.
  const inputs = item.manual_inputs as unknown as Record<string, unknown>;
  for (const key of [
    "absence_days_override",
    "overtime_normal_hours",
    "weekly_rest_work_days",
    "official_holiday_work_days",
    "bonus",
    "incentive",
    "other_addition",
    "other_deduction",
    "override_overtime_eligibility",
  ]) {
    if (key in changes) inputs[key] = changes[key];
  }
  if ("absence_days_override" in changes) {
    item.absence.override_days = changes.absence_days_override as string | null;
  }
  if ("overtime_normal_hours" in changes) {
    item.overtime.normal_hours = String(changes.overtime_normal_hours);
  }
  if ("weekly_rest_work_days" in changes) {
    item.overtime.weekly_rest_days = String(changes.weekly_rest_work_days);
  }
  if ("official_holiday_work_days" in changes) {
    item.overtime.official_holiday_days = String(
      changes.official_holiday_work_days,
    );
  }
  if ("override_overtime_eligibility" in changes) {
    item.overtime.override_overtime_eligibility = Boolean(
      changes.override_overtime_eligibility,
    );
  }
  if ("zero_salary_reason" in changes) {
    item.zero_salary_reason = changes.zero_salary_reason as never;
  }
  if ("zero_salary_reason_detail" in changes) {
    item.zero_salary_reason_detail = changes.zero_salary_reason_detail as
      | string
      | null;
  }
  if ("salary_components" in changes && item.monthly_salary_components) {
    const salary = (changes.salary_components ?? {}) as Record<string, string>;
    const current = item.monthly_salary_components as Record<string, string>;
    for (const [key, value] of Object.entries(salary)) {
      if (!(key in current)) {
        fail(422, "This field cannot be edited here.", [
          issue(
            "field_not_editable",
            "This field cannot be edited here.",
            `changes.salary_components.${key}`,
          ),
        ]);
      }
      requireMoney(value, `changes.salary_components.${key}`);
      if (current[key] !== value) {
        current[key] = value;
        item.salary_adjusted = true;
      }
    }
  }
  if ("suspended_pay_decision" in changes) {
    item.suspended_pay_decision = changes.suspended_pay_decision as never;
  }
  bumpRun(run);
  return ok(clone(item));
}

function runAction(run: PayrollRunDto, action: string, body: Json) {
  switch (action) {
    case "recalculate": {
      requireDraft(run);
      requireRevision(body, run.revision);
      requireReason(body);
      bumpRun(run);
      return ok({
        ...clone(examples.recalculateResult.data),
        run_id: run.id,
        revision: run.revision,
        status: run.status,
        settings_revision: body.refresh_settings
          ? state.settings.settings_revision
          : run.settings_revision,
        total_net: run.total_net,
        total_company_cost: run.total_company_cost,
        cost_incomplete: run.cost_incomplete,
        validation_counts: run.validation_counts,
      });
    }
    case "finalize": {
      if (body.confirm !== true) {
        fail(422, "confirm must be true.", ["confirm must be true."]);
      }
      if (run.status === "CANCELLED") {
        fail(422, "Cancelled runs cannot be finalized.", [
          issue("run_cancelled", "Cancelled runs cannot be finalized."),
        ]);
      }
      if (run.status === "COMPLETED" || run.status === "PAID") {
        return ok({
          message: "Payroll run already finalized.",
          message_key: "payroll.message.already_finalized",
          run_id: run.id,
          revision: run.revision,
          status: run.status,
          validation_counts: run.validation_counts,
        });
      }
      if (body.expected_revision !== undefined) {
        requireRevision(body, run.revision);
      }
      const report = state.validation.get(run.id);
      if (report && !report.can_finalize) {
        fail(
          422,
          report.errors[0]?.message ?? "Payroll run cannot be finalized.",
          report.errors.map((error) => ({
            field: error.field,
            code: error.code,
            message: error.message,
            message_key: error.message_key,
            params: error.params,
            employee: error.employee,
          })),
        );
      }
      run.status = "COMPLETED";
      run.finalized_at = now();
      bumpRun(run);
      return ok({
        ...clone(examples.finalizeResult.data),
        run_id: run.id,
        revision: run.revision,
        validation_counts: run.validation_counts,
      });
    }
    case "generate-payslips": {
      if (run.status !== "COMPLETED" && run.status !== "PAID") {
        fail(422, "Finalize the payroll run before generating payslips.", [
          issue(
            "run_not_finalized",
            "Finalize the payroll run before generating payslips.",
          ),
        ]);
      }
      const firstTime = run.status === "COMPLETED";
      run.status = "PAID";
      run.paid_at = run.paid_at ?? now();
      return ok({
        ...clone(examples.generatePayslipsResult.data),
        generated_count: firstTime ? run.total_employees : 0,
        total_payslips: run.total_employees,
        download_pdf_url: `/payroll-runs/${run.id}/export/?file_format=pdf`,
      });
    }
    case "cancel": {
      if (run.status === "CANCELLED") {
        return ok({
          message: "Payroll run already cancelled.",
          message_key: "payroll.message.already_cancelled",
          run_id: run.id,
          revision: run.revision,
          status: run.status,
          restored_loans: 0,
          released_attendance_claims: 0,
          released_penalty_claims: 0,
          released_carry_collections: 0,
          inactive_payslips: 0,
          cancelled_at: run.cancelled_at,
          cancelled_by: run.cancelled_by,
          cancel_reason: run.cancel_reason,
        });
      }
      requireDraft(run);
      requireRevision(body, run.revision);
      const reason = requireReason(body);
      run.status = "CANCELLED";
      run.cancelled_at = now();
      run.cancelled_by = MOCK_ACTOR.id;
      run.cancel_reason = reason;
      bumpRun(run);
      return ok({
        ...clone(examples.cancelResult.data),
        run_id: run.id,
        revision: run.revision,
        cancelled_at: run.cancelled_at,
        cancel_reason: reason,
      });
    }
    default:
      return notFound();
  }
}

function exportBlob(run: PayrollRunDto, params: Json) {
  const format = String(params.file_format ?? "pdf");
  if (!["pdf", "xlsx", "csv"].includes(format)) {
    fail(422, "file_format must be one of: csv, pdf, xlsx.", [
      "file_format must be one of: csv, pdf, xlsx.",
    ]);
  }
  return new Blob([`mock payroll_run_${run.id}.${format}`], {
    type: "application/octet-stream",
  });
}

// ─── Accommodation ──────────────────────────────────────────────────────────

function validateAssignment(
  draft: Pick<
    AccommodationAssignment,
    "employee_profile_id" | "status" | "rent_id" | "start_date" | "end_date"
  >,
  ignoreId?: number,
) {
  if (!["assigned", "none", "unknown"].includes(draft.status)) {
    fail(422, "Select a supported value.", [
      issue("invalid_choice", "Select a supported value.", "status"),
    ]);
  }
  if (!draft.start_date || !draft.end_date) {
    fail(422, "This field is required.", [
      issue(
        "invalid_date_range",
        "The end date must be on or after the start date.",
        draft.start_date ? "end_date" : "start_date",
      ),
    ]);
  }
  if (draft.end_date < draft.start_date) {
    fail(422, "The end date must be on or after the start date.", [
      issue(
        "invalid_date_range",
        "The end date must be on or after the start date.",
        "end_date",
      ),
    ]);
  }
  if ((draft.status === "assigned") !== (draft.rent_id !== null)) {
    fail(422, "Select a supported value.", [
      issue("invalid_choice", "Select a supported value.", "rent_id"),
    ]);
  }
  const overlap = state.assignments.some(
    (other) =>
      other.is_active &&
      other.id !== ignoreId &&
      other.employee_profile_id === draft.employee_profile_id &&
      other.start_date <= draft.end_date &&
      draft.start_date <= other.end_date,
  );
  if (overlap) {
    fail(409, "An accommodation assignment overlaps these dates.", [
      issue(
        "assignment_overlap",
        "An accommodation assignment overlaps these dates.",
      ),
    ]);
  }
}

function findAssignment(id: number): AccommodationAssignment {
  return (
    state.assignments.find((entry) => entry.id === id && entry.is_active) ??
    notFound()
  );
}

// ─── Router ─────────────────────────────────────────────────────────────────

const route = (url: string) =>
  url.replace(/^\/+/, "").replace(/\/+$/, "").split("/");

function dispatch(request: PayrollRequest): unknown {
  const { method } = request;
  const params = (request.params ?? {}) as Json;
  const body = (request.data ?? {}) as Json;
  const parts = route(request.url);
  const id = (index: number) => Number(parts[index]);

  if (parts[0] === "payroll-settings") {
    if (parts.length === 1) {
      if (method === "GET") return ok(clone(state.settings));
      if (method === "PATCH") return patchSettings(body);
    }
    if (parts[1] === "salary-bases" && method === "GET") {
      return clone(examples.salaryBases);
    }
    if (parts[1] === "enums" && method === "GET") {
      return ok(clone(examples.enums.data) as unknown as PayrollEnums);
    }
    if (parts[1] === "history" && method === "GET") {
      return page(clone(state.settingsHistory), params);
    }
    if (parts[1] === "employees" && parts.length >= 3) {
      const profileId = id(2);
      if (!Number.isInteger(profileId)) return notFound();
      if (parts[3] === "history" && method === "GET") {
        return page(
          clone(state.employeeConfigHistory.get(profileId) ?? []),
          params,
        );
      }
      if (parts.length === 3 && method === "GET") {
        return ok(clone(employeeConfig(profileId)));
      }
      if (parts.length === 3 && method === "PATCH") {
        return patchEmployeeConfig(profileId, body);
      }
    }
    return notFound();
  }

  if (parts[0] === "payroll-runs") {
    if (parts.length === 1) {
      if (method === "GET") return listRuns(params);
      if (method === "POST") return createRun(body);
      return notFound();
    }
    const run = findRun(id(1));
    const sub = parts[2];
    if (parts.length === 2 && method === "GET") return ok(clone(run));
    if (sub === "items") {
      const items = state.items.get(run.id) ?? [];
      if (parts.length === 3 && method === "GET") {
        const search = String(params.search ?? "").toLowerCase();
        const filtered = items
          .filter(
            (item) =>
              !params.employee_profile_id ||
              item.employee_profile_id === Number(params.employee_profile_id),
          )
          .filter(
            (item) =>
              !search ||
              item.employee_id.toLowerCase().includes(search) ||
              item.employee_name.toLowerCase().includes(search),
          )
          .filter((item) =>
            params.has_warnings === undefined
              ? true
              : String(params.has_warnings) === "true"
                ? item.warnings.length > 0
                : item.warnings.length === 0,
          );
        return page(clone(filtered), params);
      }
      const item = items.find((entry) => entry.id === id(3)) ?? notFound();
      if (parts.length === 4 && method === "GET") return ok(clone(item));
      if (parts.length === 4 && method === "PATCH") {
        return patchItem(run, item, body);
      }
      if (parts[4] === "adjustments" && method === "GET") {
        return page(clone(examples.itemAdjustmentsPage.data.items), params);
      }
      return notFound();
    }
    if (sub === "summary" && method === "GET") {
      return ok(clone(state.summaries.get(run.id)));
    }
    if (sub === "validation-report" && method === "GET") {
      const report = clone(state.validation.get(run.id)) ?? notFound();
      const keep = (entry: ValidationReport["errors"][number]) =>
        (!params.severity || entry.severity === params.severity) &&
        (!params.code || entry.code === params.code) &&
        (!params.employee_profile_id ||
          entry.employee?.employee_profile_id ===
            Number(params.employee_profile_id));
      const errors = report.errors.filter(keep);
      const warnings = report.warnings.filter(keep);
      return ok({
        ...report,
        errors,
        warnings,
        counts: { errors: errors.length, warnings: warnings.length },
      });
    }
    if (sub === "history" && method === "GET") {
      return page([clone(examples.runHistoryEntry)], params);
    }
    if (sub === "accommodation-report" && method === "GET") {
      const rentId = params.rent_id ? Number(params.rent_id) : null;
      return page(
        clone(state.accommodationReport).filter(
          (entry) => rentId === null || entry.rent_id === rentId,
        ),
        params,
      );
    }
    if (sub === "export" && method === "GET") return exportBlob(run, params);
    if (method === "POST" && parts.length === 3) {
      return runAction(run, sub, body);
    }
    return notFound();
  }

  if (parts[0] === "payroll-accommodation-assignments") {
    if (parts.length === 1) {
      if (method === "GET") {
        const activeOnly =
          params.is_active === undefined
            ? true
            : String(params.is_active) === "true";
        const rows = state.assignments
          .filter((entry) => entry.is_active === activeOnly)
          .filter(
            (entry) =>
              !params.employee_profile_id ||
              entry.employee_profile_id === Number(params.employee_profile_id),
          )
          .filter(
            (entry) =>
              !params.rent_id || entry.rent_id === Number(params.rent_id),
          )
          .filter((entry) => !params.status || entry.status === params.status)
          .filter(
            (entry) =>
              !params.active_on ||
              (entry.start_date <= String(params.active_on) &&
                String(params.active_on) <= entry.end_date),
          )
          .sort(
            (a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id,
          );
        return page(clone(rows), params);
      }
      if (method === "POST") {
        requireReason(body);
        const draft = {
          employee_profile_id: Number(body.employee_profile_id),
          status: body.status as AccommodationAssignment["status"],
          rent_id: (body.rent_id ?? null) as number | null,
          start_date: String(body.start_date ?? ""),
          end_date: String(body.end_date ?? ""),
        };
        validateAssignment(draft);
        const created: AccommodationAssignment = {
          ...(clone(
            examples.assignment.data,
          ) as unknown as AccommodationAssignment),
          ...draft,
          id: state.nextId++,
          employee_id: `EMP-${String(draft.employee_profile_id).padStart(3, "0")}`,
          employee_name: `Employee ${draft.employee_profile_id}`,
          rent_name: draft.rent_id ? `Rent ${draft.rent_id}` : null,
          created_at: now(),
          updated_at: now(),
        };
        state.assignments.unshift(created);
        return ok(clone(created));
      }
      return notFound();
    }
    const assignment = findAssignment(id(1));
    if (parts[2] === "history" && method === "GET") {
      return page([], params);
    }
    if (parts.length === 2 && method === "GET") return ok(clone(assignment));
    if (parts.length === 2 && method === "PATCH") {
      requireReason(body);
      const draft = {
        employee_profile_id: assignment.employee_profile_id,
        status: (body.status ??
          assignment.status) as AccommodationAssignment["status"],
        rent_id: ("rent_id" in body ? body.rent_id : assignment.rent_id) as
          | number
          | null,
        start_date: String(body.start_date ?? assignment.start_date),
        end_date: String(body.end_date ?? assignment.end_date),
      };
      validateAssignment(draft, assignment.id);
      Object.assign(assignment, draft, {
        rent_name: draft.rent_id
          ? assignment.rent_id === draft.rent_id
            ? assignment.rent_name
            : `Rent ${draft.rent_id}`
          : null,
        updated_at: now(),
        updated_by: MOCK_ACTOR,
      });
      return ok(clone(assignment));
    }
    if (parts.length === 2 && method === "DELETE") {
      requireReason(body);
      assignment.is_active = false;
      return undefined; // 204
    }
    return notFound();
  }

  if (parts[0] === "employee" && parts[1] === "payslips") {
    if (parts.length === 2 && method === "GET") {
      const rows = state.payslips.filter(
        (entry) => !params.year || entry.year === Number(params.year),
      );
      return page(clone(rows), params);
    }
    const detail = state.payslipDetails.get(id(2)) ?? notFound();
    if (parts.length === 3 && method === "GET") return ok(clone(detail));
    if (parts[3] === "download" && method === "GET") {
      return new Blob([`mock payslip_${detail.id}.pdf`], {
        type: "application/octet-stream",
      });
    }
    return notFound();
  }

  return notFound();
}

export async function handlePayrollMockRequest(
  request: PayrollRequest,
): Promise<unknown> {
  // Resolve asynchronously, like a real request.
  await Promise.resolve();
  return dispatch(request);
}
