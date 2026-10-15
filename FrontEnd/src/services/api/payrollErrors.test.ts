import { describe, expect, it } from "vitest";
import { parsePayrollError, payrollErrorSummary } from "./payrollErrors";
import {
  error409Stale,
  error422Reason,
  error403,
} from "./payrollMocks/contractExamples";

const axiosError = (status: number, data: unknown) => ({
  isAxiosError: true,
  message: "Request failed",
  response: { status, data },
});

describe("parsePayrollError", () => {
  it("maps object items to form fields and keeps the API message", () => {
    const parsed = parsePayrollError(axiosError(422, error422Reason));
    expect(parsed.fieldErrors).toEqual([
      { name: ["reason"], errors: ["A reason is required."] },
    ]);
    expect(parsed.codes).toEqual(["reason_required"]);
    expect(parsed.items[0].message_key).toBe(
      "payroll.validation.reason_required",
    );
    expect(parsed.isStaleRevision).toBe(false);
  });

  it("handles legacy string-array errors as record-level messages", () => {
    const parsed = parsePayrollError(
      axiosError(409, {
        status: "error",
        message: "Payroll run already exists for this period.",
        errors: ["Payroll run already exists for this period."],
      }),
    );
    expect(parsed.fieldErrors).toEqual([]);
    expect(parsed.formMessages).toEqual([
      "Payroll run already exists for this period.",
    ]);
    expect(parsed.isStaleRevision).toBe(false);
  });

  it("supports mixed string and object items in one array", () => {
    const parsed = parsePayrollError(
      axiosError(422, {
        status: "error",
        message: "Invalid",
        errors: [
          "confirm must be true.",
          {
            field: "absence_base.fixed_amount",
            code: "invalid_decimal",
            message: "Enter a finite nonnegative decimal string.",
          },
        ],
      }),
    );
    expect(parsed.formMessages).toEqual(["confirm must be true."]);
    expect(parsed.fieldErrors[0].name).toEqual([
      "absence_base",
      "fixed_amount",
    ]);
  });

  it("detects 409 stale_revision", () => {
    const parsed = parsePayrollError(axiosError(409, error409Stale));
    expect(parsed.isStaleRevision).toBe(true);
    expect(parsed.items[0].params).toEqual({
      expected_revision: 2,
      current_revision: 3,
    });
  });

  it("does not treat a 409 without the stale code as stale", () => {
    const parsed = parsePayrollError(
      axiosError(409, {
        status: "error",
        message: "Overlap",
        errors: [{ code: "assignment_overlap", message: "Overlap" }],
      }),
    );
    expect(parsed.isStaleRevision).toBe(false);
  });

  it("renames server fields through a field map", () => {
    const parsed = parsePayrollError(
      axiosError(422, {
        status: "error",
        message: "bad",
        errors: [{ field: "foreign_gosi_rate", message: "bad rate" }],
      }),
      { foreign_gosi_rate: "foreign_gosi_percent" },
    );
    expect(parsed.fieldErrors[0].name).toEqual(["foreign_gosi_percent"]);
  });

  it("falls back to the framework message/detail shape", () => {
    const parsed = parsePayrollError(axiosError(403, error403));
    expect(parsed.items).toEqual([]);
    expect(payrollErrorSummary(parsed, "fallback")).toBe(
      "You do not have permission to perform this action.",
    );
    expect(
      payrollErrorSummary(parsePayrollError(new Error("x")), "fallback"),
    ).toBe("fallback");
  });
});
