import { describe, expect, it } from "vitest";

import {
  calculateTotalPackage,
  canApprove,
  canCancel,
  canEdit,
  canReject,
  canRequestChanges,
  canSend,
  canSubmit,
  isAllowedCvFile,
} from "./jobOfferRules";
import { makeJobOffer, makeWorkflow } from "./testFixtures";

describe("job offer action rules", () => {
  it("reads every action off the backend workflow flags", () => {
    const offer = makeJobOffer({
      workflow: makeWorkflow({
        can_send: true,
        can_cancel: true,
        can_edit: true,
        can_submit: true,
        can_approve: true,
        can_reject: true,
        can_request_changes: true,
      }),
    });
    expect(canSend(offer)).toBe(true);
    expect(canCancel(offer)).toBe(true);
    expect(canEdit(offer)).toBe(true);
    expect(canSubmit(offer)).toBe(true);
    expect(canApprove(offer)).toBe(true);
    expect(canReject(offer)).toBe(true);
    expect(canRequestChanges(offer)).toBe(true);
  });

  it("never infers an action from the status when the flag says no", () => {
    // An approved offer still sitting in draft delivery status: the status
    // alone would look sendable, but the backend flag is the authority.
    const offer = makeJobOffer({
      status: "draft",
      approval_status: "approved",
      workflow: makeWorkflow(),
    });
    expect(canSend(offer)).toBe(false);
    expect(canEdit(offer)).toBe(false);
    expect(canSubmit(offer)).toBe(false);
    expect(canCancel(offer)).toBe(false);
  });

  it("treats a response without a workflow snapshot as no permissions", () => {
    const offer = makeJobOffer();
    // Simulates an older cached payload that predates the workflow block.
    delete (offer as { workflow?: unknown }).workflow;
    expect(canSend(offer)).toBe(false);
    expect(canApprove(offer)).toBe(false);
  });
});

describe("total package", () => {
  it("sums the salary components", () => {
    expect(
      calculateTotalPackage({
        basic_salary: 10000,
        housing_allowance: "2500",
        transportation_allowance: 1000,
        other_allowance: null,
      }),
    ).toBe(13500);
  });
});

describe("CV validation", () => {
  it("accepts the file types the backend allows", () => {
    expect(isAllowedCvFile({ name: "cv.pdf", size: 1024 }).ok).toBe(true);
    expect(isAllowedCvFile({ name: "CV.DOCX", size: 1024 }).ok).toBe(true);
  });

  it("rejects an unsupported type before it is uploaded", () => {
    expect(isAllowedCvFile({ name: "cv.exe", size: 10 })).toEqual({
      ok: false,
      reason: "type",
    });
  });

  it("rejects a file over the 5 MB cap", () => {
    expect(
      isAllowedCvFile({ name: "cv.pdf", size: 5 * 1024 * 1024 + 1 }),
    ).toEqual({ ok: false, reason: "size" });
  });
});
