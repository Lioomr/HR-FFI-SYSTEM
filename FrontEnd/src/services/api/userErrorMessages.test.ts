import { describe, expect, it } from "vitest";

import { getDetailedHttpErrorMessage } from "./userErrorMessages";

const t = (key: string) => key;

describe("getDetailedHttpErrorMessage", () => {
  it("shows an actionable conflict message returned while unlinking", () => {
    const error = {
      response: {
        status: 409,
        data: {
          status: "error",
          message:
            "This account cannot be unlinked because annual leave payment records reference it.",
        },
      },
    };

    expect(getDetailedHttpErrorMessage(t, error, "hr.employees.unlinkFailed")).toBe(
      "This account cannot be unlinked because annual leave payment records reference it.",
    );
  });
});
