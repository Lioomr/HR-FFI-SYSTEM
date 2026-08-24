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

const PREFIXES = ["jobOffers.", "publicJobOffer.", "hiringRequests."];

function namespaceKeys(dictionary: Record<string, string>) {
  return Object.keys(dictionary).filter((key) => PREFIXES.some((prefix) => key.startsWith(prefix)));
}

describe("job offer and hiring request translations", () => {
  it("has an Arabic string for every English job-offer key", () => {
    expect(namespaceKeys(en).filter((key) => !ar[key])).toEqual([]);
  });

  it("has an English string for every Arabic job-offer key", () => {
    expect(namespaceKeys(ar).filter((key) => !en[key])).toEqual([]);
  });

  it("keeps interpolation tokens in both languages", () => {
    const tokenKeys = namespaceKeys(en).filter((key) => /\{\w+\}/.test(en[key]));
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
      "layout.hiringRequests",
      "hiringRequests.title",
      "hiringRequests.subtitle",
      "hiringRequests.status.draft",
      "hiringRequests.status.submitted",
      "hiringRequests.status.approved",
      "hiringRequests.status.rejected",
      "hiringRequests.status.cancelled",
      "hiringRequests.status.converted",
      "hiringRequests.form.section.candidate",
      "hiringRequests.form.section.cv",
      "hiringRequests.form.cvTooLarge",
      "hiringRequests.form.cvWrongType",
      "hiringRequests.form.cvRequiredForSubmit",
      "hiringRequests.field.joiningCompany",
      "hiringRequests.field.proposedSalary",
      "hiringRequests.field.dateOfBirth",
      "hiringRequests.action.createJobOffer",
      "hiringRequests.action.openJobOffer",
      "hiringRequests.action.downloadCv",
      "hiringRequests.submit.success",
      "hiringRequests.decision.rejectTitle",
      "hiringRequests.ceo.title",
      "hiringRequests.ceo.decisionHint",
      "jobOffers.createFromRequest",
      "jobOffers.source.title",
      "jobOffers.source.requiredTitle",
      "jobOffers.source.notApproved",
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

  it("never names a delivery provider in candidate- or HR-facing copy", () => {
    namespaceKeys(en).forEach((key) => {
      expect(en[key].toLowerCase(), `${key} names a provider`).not.toMatch(/bird|evolution/);
    });
  });
});
