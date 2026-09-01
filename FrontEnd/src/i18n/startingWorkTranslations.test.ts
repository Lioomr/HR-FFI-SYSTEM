import { describe, expect, it } from "vitest";

import { translations } from "./translations";

/**
 * The BioTime verification screens carry the sentences that tell HR what a
 * pending or rejected acknowledgement does to payroll. A key present in one
 * language and missing in the other would render as a raw dotted key exactly
 * where that explanation belongs, so parity is asserted rather than assumed.
 */

const en = translations.en;
const ar = translations.ar;

const PREFIX = "startingWork.";

function namespaceKeys(dictionary: Record<string, string>) {
  return Object.keys(dictionary).filter((key) => key.startsWith(PREFIX));
}

describe("starting work acknowledgement translations", () => {
  it("has an Arabic string for every English key", () => {
    expect(namespaceKeys(en).filter((key) => !ar[key])).toEqual([]);
  });

  it("has an English string for every Arabic key", () => {
    expect(namespaceKeys(ar).filter((key) => !en[key])).toEqual([]);
  });

  it("keeps interpolation tokens in both languages", () => {
    const tokenKeys = namespaceKeys(en).filter((key) =>
      /\{\w+\}/.test(en[key]),
    );
    expect(tokenKeys.length).toBeGreaterThan(0);
    tokenKeys.forEach((key) => {
      const tokens = en[key].match(/\{\w+\}/g) || [];
      tokens.forEach((token) => {
        expect(ar[key], `${key} lost ${token} in Arabic`).toContain(token);
      });
    });
  });

  it("translates the navigation entry in both languages", () => {
    expect(en["layout.startingWorkAcknowledgments"]).toBe(
      "BioTime Verifications",
    );
    expect(ar["layout.startingWorkAcknowledgments"]).toBeTruthy();
    expect(ar["layout.startingWorkAcknowledgments"]).not.toBe(
      en["layout.startingWorkAcknowledgments"],
    );
  });

  it("carries the exact decision wording the workflow requires", () => {
    expect(en["startingWork.action.approve"]).toBe(
      "Approve BioTime Verification",
    );
    expect(en["startingWork.action.reject"]).toBe("Reject Verification");
    expect(en["startingWork.pendingExplanation"]).toBe(
      "This employee's BioTime attendance will not count as worked time for payroll until HR approves it.",
    );
    expect(en["startingWork.rejectedExplanation"]).toBe(
      "The affected BioTime attendance records are marked absent until HR approves a corrected verification.",
    );
    expect(en["startingWork.approvalAfterRejectionExplanation"]).toBe(
      "Approval restores eligible system attendance records to present. HR corrections are preserved.",
    );
    expect(en["startingWork.pendingRowNote"]).toBe(
      "Attendance is held from payroll until HR approval.",
    );
  });

  it("covers every status, column and decision key the screens read", () => {
    const required = [
      "startingWork.title",
      "startingWork.subtitle",
      "startingWork.countTag",
      "startingWork.status.pending_hr",
      "startingWork.status.approved",
      "startingWork.status.rejected",
      "startingWork.col.employee",
      "startingWork.col.employeeId",
      "startingWork.col.firstBiotimeDate",
      "startingWork.col.status",
      "startingWork.col.affectedAttendance",
      "startingWork.col.generatedAt",
      "startingWork.col.actions",
      "startingWork.action.view",
      "startingWork.action.download",
      "startingWork.action.approve",
      "startingWork.action.reject",
      "startingWork.field.rejectionReason",
      "startingWork.reject.reasonRequired",
      "startingWork.approve.success",
      "startingWork.reject.success",
      "startingWork.pdf.success",
      "startingWork.pdf.approvedNote",
      "startingWork.detail.notFound",
      "startingWork.workflow.empty",
    ];
    required.forEach((key) => {
      expect(en[key], `${key} missing in English`).toBeTruthy();
      expect(ar[key], `${key} missing in Arabic`).toBeTruthy();
    });
  });
});
