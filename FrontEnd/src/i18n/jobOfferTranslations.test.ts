import { describe, expect, it } from "vitest";

import { translations } from "./translations";

/**
 * Job offers reach candidates as well as HR staff, and the candidate page is
 * the one screen a recruit may only ever see once. A key that exists in one
 * language and not the other would show a raw dotted key there, so parity is
 * asserted rather than assumed.
 */

const en = translations.en;
const ar = translations.ar;

const PREFIXES = ["jobOffers.", "publicJobOffer."];

function namespaceKeys(dictionary: Record<string, string>) {
  return Object.keys(dictionary).filter((key) =>
    PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

describe("job offer translations", () => {
  it("has an Arabic string for every English job-offer key", () => {
    expect(namespaceKeys(en).filter((key) => !ar[key])).toEqual([]);
  });

  it("has an English string for every Arabic job-offer key", () => {
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

  it("covers the navigation label, statuses and every form section", () => {
    const required = [
      "layout.jobOffers",
      "jobOffers.title",
      "jobOffers.subtitle",
      "jobOffers.searchPlaceholder",
      "jobOffers.status.all",
      "jobOffers.status.draft",
      "jobOffers.status.sent",
      "jobOffers.status.accepted",
      "jobOffers.status.rejected",
      "jobOffers.status.expired",
      "jobOffers.status.cancelled",
      "jobOffers.form.section.candidate",
      "jobOffers.form.section.job",
      "jobOffers.form.section.compensation",
      "jobOffers.form.section.benefits",
      "jobOffers.form.section.metadata",
      "jobOffers.field.totalPackage",
      "jobOffers.delivery.warningsTitle",
      "jobOffers.delivery.warning.whatsappFailed",
      "jobOffers.delivery.warning.emailFailed",
      "jobOffers.delivery.warning.attachmentFailed",
      "jobOffers.delivery.warning.generic",
      "jobOffers.send.confirmTitle",
      "jobOffers.cancel.confirmTitle",
      "jobOffers.pdf.success",
      "jobOffers.onboarding.invitationSent",
      "publicJobOffer.title",
      "publicJobOffer.accept",
      "publicJobOffer.reject",
      "publicJobOffer.reasonRequired",
      "publicJobOffer.acceptedTitle",
      "publicJobOffer.rejectedTitle",
      "publicJobOffer.alreadyRespondedTitle",
      "publicJobOffer.invalidTitle",
      "jobOffers.newOffer",
      "jobOffers.form.section.cv",
      "jobOffers.form.submitToCeo",
      "jobOffers.form.cvTooLarge",
      "jobOffers.form.cvWrongType",
      "jobOffers.form.cvRequired",
      "jobOffers.form.cvRequiredForSubmit",
      "jobOffers.field.dateOfBirth",
      "jobOffers.action.downloadCv",
      "jobOffers.action.resubmitToCeo",
      "jobOffers.action.review",
      "jobOffers.submit.confirmTitle",
      "jobOffers.submit.success",
      "jobOffers.submit.failed",
      "jobOffers.cv.downloaded",
      "jobOffers.cv.failed",
      "jobOffers.col.approvalStatus",
      "jobOffers.detail.section.ceoReview",
      "jobOffers.detail.section.workflow",
      "jobOffers.detail.noCv",
      // The CEO approval gate in front of every candidate delivery
      "jobOffers.approval.status.draft",
      "jobOffers.approval.status.pending_ceo",
      "jobOffers.approval.status.approved",
      "jobOffers.approval.status.changes_requested",
      "jobOffers.approval.status.rejected",
      "jobOffers.approval.approvedBy",
      "jobOffers.approval.changesRequestedBy",
      "jobOffers.approval.rejectedBy",
      "jobOffers.approval.reason",
      "jobOffers.approval.reasonRequired",
      "jobOffers.approval.recommendation",
      "jobOffers.approval.sendBlocked",
      "jobOffers.approval.requestChanges",
      "jobOffers.approval.rejectTitle",
      "jobOffers.approval.approveSuccess",
      "jobOffers.approval.rejectSuccess",
      "jobOffers.approval.requestChangesSuccess",
      "jobOffers.workflow.empty",
      "jobOffers.workflow.action.submit",
      "jobOffers.workflow.action.approve",
      "jobOffers.workflow.action.request_changes",
      "jobOffers.workflow.action.reject",
      "jobOffers.ceo.title",
      "jobOffers.ceo.subtitle",
      "jobOffers.ceo.decisionHint",
      "jobOffers.ceo.noActionAvailable",
      "jobOffers.ceo.editTerms",
      "jobOffers.ceo.editTermsHint",
      "jobOffers.ceo.saveTerms",
      "jobOffers.ceo.section.commercialTerms",
      "jobOffers.delivery.candidateText",
      "jobOffers.delivery.candidateWhatsappPdf",
      "jobOffers.delivery.candidateEmailPdf",
      "jobOffers.delivery.ceoWhatsappPdf",
      "jobOffers.delivery.ceoEmailPdf",
      "jobOffers.delivery.skipped",
      "jobOffers.onboarding.acknowledgmentGenerated",
      "jobOffers.onboarding.acknowledgmentPending",
      "jobOffers.onboarding.acknowledgmentHint",
      "jobOffers.onboarding.acknowledgmentTitle",
      "jobOffers.onboarding.downloadAcknowledgment",
      "jobOffers.onboarding.openDocumentArchive",
      "jobOffers.onboarding.acknowledgmentDownloadFailed",
      "archive.systemGenerated",
      "archive.startingWorkAcknowledgment",
      // Department/position now come from HR reference data, and onboarding
      // reports the pre-hire profile and the BioTime mapping.
      "jobOffers.field.departmentRef",
      "jobOffers.field.position",
      "jobOffers.form.departmentPlaceholder",
      "jobOffers.form.positionPlaceholder",
      "jobOffers.form.referenceHint",
      "jobOffers.form.profileAutomatic",
      "jobOffers.form.profileAutomaticHint",
      "jobOffers.validation.departmentRequired",
      "jobOffers.validation.positionRequired",
      "jobOffers.reference.emptyTitle",
      "jobOffers.reference.emptyBoth",
      "jobOffers.reference.emptyDepartments",
      "jobOffers.reference.emptyPositions",
      "jobOffers.reference.goToDepartments",
      "jobOffers.reference.goToPositions",
      "jobOffers.onboarding.prehireProfileCreated",
      "jobOffers.onboarding.profileId",
      "jobOffers.onboarding.openEmployeeProfile",
      "jobOffers.biotime.connected",
      "jobOffers.biotime.employeeCode",
      "jobOffers.biotime.notConnected",
      "jobOffers.biotime.notConnectedHint",
      "publicJobOffer.onboardingReady",
      "publicJobOffer.attendanceSetupPending",
    ];

    required.forEach((key) => {
      expect(en[key], `missing English string for ${key}`).toBeTruthy();
      expect(ar[key], `missing Arabic string for ${key}`).toBeTruthy();
    });
  });

  it("keeps no hiring-request copy in either dictionary", () => {
    expect(
      Object.keys(en).filter((key) => key.startsWith("hiringRequests.")),
    ).toEqual([]);
    expect(
      Object.keys(ar).filter((key) => key.startsWith("hiringRequests.")),
    ).toEqual([]);
    expect(en["layout.hiringRequests"]).toBeUndefined();
    expect(ar["layout.hiringRequests"]).toBeUndefined();
  });

  it("never names a delivery provider in candidate- or HR-facing copy", () => {
    namespaceKeys(en).forEach((key) => {
      expect(en[key].toLowerCase(), `${key} names a provider`).not.toMatch(
        /bird|evolution/,
      );
    });
  });
});
