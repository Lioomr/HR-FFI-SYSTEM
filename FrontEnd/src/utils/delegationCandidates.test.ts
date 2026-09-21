import { describe, expect, it } from "vitest";

import { formatDelegationCandidateLabel } from "./delegationCandidates";

describe("formatDelegationCandidateLabel", () => {
  it("includes company names for cross-company leave delegates", () => {
    expect(
      formatDelegationCandidateLabel({
        id: 12,
        employee_profile_id: 34,
        employee_id: "ATH-012",
        full_name: "Amina Saleh",
        company_name: "Athroya",
        can_delegate: true,
      }),
    ).toBe("Amina Saleh (ATH-012 - Athroya)");
  });

  it("keeps disabled reasons visible", () => {
    expect(
      formatDelegationCandidateLabel({
        id: null,
        employee_profile_id: 35,
        employee_id: "ATH-013",
        full_name: "No Login",
        company_name: "Athroya",
        can_delegate: false,
        disabled_reason: "No login account",
      }),
    ).toBe("No Login (ATH-013 - Athroya) - No login account");
  });
});
