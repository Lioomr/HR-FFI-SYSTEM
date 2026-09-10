import { describe, expect, it } from "vitest";

import { collectApiErrorMessages } from "./formErrors";

/**
 * The backend emits validation errors in two shapes and both are contractual:
 * a plain string array from `error("...", errors=[str(exc)])`, and the
 * serializer form `[{field, message}]`. Losing either would blank the dialog.
 */

const axiosError = (data: unknown) => ({
  message: "Request failed with status code 422",
  response: { status: 422, data },
  apiData: data,
});

describe("collectApiErrorMessages", () => {
  it("returns every entry of a plain string array", () => {
    const error = axiosError({
      status: "error",
      message: "Validation error",
      errors: [
        "total_salary must equal the sum of the salary components.",
        "basic_salary must be a finite decimal.",
      ],
    });

    expect(collectApiErrorMessages(error)).toEqual([
      "total_salary must equal the sum of the salary components.",
      "basic_salary must be a finite decimal.",
    ]);
  });

  it("prefixes field/message objects with their field", () => {
    const error = axiosError({
      status: "error",
      message: "Validation error",
      errors: [
        { field: "basic_salary", message: "Enter a valid number." },
        { field: "petrol_allowance", message: "Too many decimal places." },
      ],
    });

    expect(collectApiErrorMessages(error)).toEqual([
      "basic_salary: Enter a valid number.",
      "petrol_allowance: Too many decimal places.",
    ]);
  });

  it("keeps an object entry that carries no field unprefixed", () => {
    const error = axiosError({
      status: "error",
      message: "Validation error",
      errors: [{ message: "The contract has already been finalized." }],
    });

    expect(collectApiErrorMessages(error)).toEqual([
      "The contract has already been finalized.",
    ]);
  });

  it("handles a mixed array without dropping either shape", () => {
    const error = axiosError({
      status: "error",
      message: "Validation error",
      errors: [
        "Employee does not have a contract expiry date.",
        { field: "decision_type", message: "This field is required." },
      ],
    });

    expect(collectApiErrorMessages(error)).toEqual([
      "Employee does not have a contract expiry date.",
      "decision_type: This field is required.",
    ]);
  });

  it("normalises the legacy object map", () => {
    const error = axiosError({
      status: "error",
      message: "Validation error",
      errors: { basic_salary: ["Enter a valid number."] },
    });

    expect(collectApiErrorMessages(error)).toEqual([
      "basic_salary: Enter a valid number.",
    ]);
  });

  it("falls back to the envelope message when no errors array is present", () => {
    const error = axiosError({
      status: "error",
      message: "You cannot act on this contract decision.",
    });

    expect(collectApiErrorMessages(error)).toEqual([
      "You cannot act on this contract decision.",
    ]);
  });

  it("returns nothing for a non-object error", () => {
    expect(collectApiErrorMessages(undefined)).toEqual([]);
    expect(collectApiErrorMessages("boom")).toEqual([]);
  });

  it("ignores blank entries rather than rendering empty bullets", () => {
    const error = axiosError({
      status: "error",
      message: "Validation error",
      errors: ["   ", { field: "basic_salary", message: "  " }],
    });

    expect(collectApiErrorMessages(error)).toEqual(["Validation error"]);
  });
});
