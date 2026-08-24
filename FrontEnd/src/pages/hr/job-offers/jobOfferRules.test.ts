import { describe, expect, it } from "vitest";

import { canCancel, canEdit, canSend } from "./jobOfferRules";

describe("job offer action rules", () => {
  it("allows sending drafts exactly once", () => {
    expect(canSend({ status: "draft" })).toBe(true);
    expect(canSend({ status: "sent" })).toBe(false);
    expect(canSend({ status: "accepted" })).toBe(false);
  });

  it("keeps cancellation available while an offer is open", () => {
    expect(canCancel({ status: "draft" })).toBe(true);
    expect(canCancel({ status: "sent" })).toBe(true);
    expect(canCancel({ status: "cancelled" })).toBe(false);
  });

  it("allows editing drafts only", () => {
    expect(canEdit({ status: "draft" })).toBe(true);
    expect(canEdit({ status: "sent" })).toBe(false);
  });
});
