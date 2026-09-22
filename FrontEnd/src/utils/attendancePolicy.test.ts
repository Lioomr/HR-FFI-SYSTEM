import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import { resolveTranslation } from "../i18n/translate";
import type { TranslateParams } from "../i18n/translate";
import {
  ATTENDANCE_DEDUCTION_STATUSES,
  GRACE_REASONS,
  NOTICE_DELIVERY_STATUSES,
  NOTICE_LEVELS,
  VIOLATION_LIFECYCLES,
} from "../types/attendancePolicy";
import {
  classifyAttendanceAccessError,
  fieldErrorsFromResponse,
  formatDecimalString,
  formatFractionAsPercent,
  formatMinutes,
  graceReasonLabel,
  hasNoticeDocument,
  isWarningOnlyViolation,
  isZeroDecimal,
  lifecycleHint,
  lifecycleLabel,
  noticeDeliveryHint,
  noticeDeliveryLabel,
  noticeDownloadErrorKey,
  noticeFilename,
  noticeLevelLabel,
  noticeLevelMeaning,
  noticeListProblem,
  violationLifecycleHint,
  payrollStatusLabel,
  readNoticeFilters,
  readViolationFilters,
  recalculationRangeError,
  violationEmployeeName,
} from "./attendancePolicy";

const en = (key: string, params?: TranslateParams, fallback?: string) =>
  resolveTranslation("en", key, params, fallback);
const ar = (key: string, params?: TranslateParams, fallback?: string) =>
  resolveTranslation("ar", key, params, fallback);

const UNMAPPED =
  "Attendance is unavailable until your BioTime mapping is completed. Contact HR to be registered on a BioTime device.";

describe("lifecycle and payroll-status labels", () => {
  it("names every lifecycle with its meaning in English", () => {
    expect(
      VIOLATION_LIFECYCLES.map((value) => lifecycleLabel(en, value)),
    ).toEqual(["Active", "Void", "Applied", "Manual review"]);
    expect(
      VIOLATION_LIFECYCLES.map((value) => lifecycleHint(en, value)),
    ).toEqual([
      "Recorded, awaiting payroll",
      "Excused or corrected, not charged",
      "Deducted in payroll",
      "Under HR review, no automatic refund",
    ]);
  });

  it("labels every payroll status, including a missing deduction", () => {
    expect(
      ATTENDANCE_DEDUCTION_STATUSES.map((value) =>
        payrollStatusLabel(en, value),
      ),
    ).toEqual([
      "Pending",
      "In draft payroll",
      "Applied in payroll",
      "Manual review",
      "Void",
    ]);
    expect(payrollStatusLabel(en, null)).toBe("No payroll deduction");
    expect(payrollStatusLabel(ar, null)).toBe("بدون خصم من الرواتب");
  });

  it("gives an active first-occurrence warning its own meaning", () => {
    const warning = {
      lifecycle: "active",
      payroll_status: null,
      occurrence_number: 1,
      penalty_amount: "0.00",
    };
    expect(violationLifecycleHint(en, warning)).toBe(
      "Warning only — no payroll deduction",
    );
    expect(violationLifecycleHint(ar, warning)).toBe(
      "إنذار فقط — دون خصم من الرواتب",
    );
  });

  it("keeps the lifecycle meaning for monetary and non-active violations", () => {
    const monetary = {
      lifecycle: "active",
      payroll_status: "pending",
      occurrence_number: 2,
      penalty_amount: "5.00",
    };
    expect(violationLifecycleHint(en, monetary)).toBe(
      "Recorded, awaiting payroll",
    );
    expect(
      violationLifecycleHint(en, { ...monetary, payroll_status: "claimed" }),
    ).toBe("Recorded, awaiting payroll");
    expect(
      violationLifecycleHint(en, {
        ...monetary,
        lifecycle: "applied",
        payroll_status: "applied",
      }),
    ).toBe("Deducted in payroll");
    expect(
      violationLifecycleHint(en, {
        ...monetary,
        lifecycle: "manual_review",
        payroll_status: "manual_review",
      }),
    ).toBe("Under HR review, no automatic refund");
    expect(
      violationLifecycleHint(en, {
        lifecycle: "void",
        payroll_status: null,
        occurrence_number: 1,
        penalty_amount: "0.00",
      }),
    ).toBe("Excused or corrected, not charged");
  });

  it("has Arabic text for every lifecycle, payroll status and grace reason", () => {
    const labels = [
      ...VIOLATION_LIFECYCLES.map((value) => lifecycleLabel(ar, value)),
      ...VIOLATION_LIFECYCLES.map((value) => lifecycleHint(ar, value)),
      ...ATTENDANCE_DEDUCTION_STATUSES.map((value) =>
        payrollStatusLabel(ar, value),
      ),
      ...GRACE_REASONS.map((value) => graceReasonLabel(ar, value)),
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/^attendancePolicy\./);
      expect(label).toMatch(/[؀-ۿ]/);
    }
    expect(lifecycleLabel(ar, "manual_review")).toBe("مراجعة يدوية");
  });

  it("gives each grace reason a human label and passes unknown values through", () => {
    for (const reason of GRACE_REASONS) {
      expect(graceReasonLabel(en, reason)).not.toMatch(/attendancePolicy/);
    }
    expect(graceReasonLabel(en, "post_grace_late")).toBe(
      "Late: the grace window is withdrawn for the rest of this month",
    );
    expect(graceReasonLabel(en, "non_working_day")).toBe(
      "Day off: recorded but not counted",
    );
    expect(graceReasonLabel(en, null)).toBe("Not evaluated yet");
    expect(graceReasonLabel(en, "future_reason")).toBe("future_reason");
  });
});

describe("localized employee name", () => {
  const violation = { employee_name: "Jane Doe", employee_name_ar: "جين دو" };

  it("uses the Arabic name in Arabic when present", () => {
    expect(violationEmployeeName(violation, "ar")).toBe("جين دو");
  });

  it("falls back to employee_name when there is no Arabic name", () => {
    expect(
      violationEmployeeName({ ...violation, employee_name_ar: null }, "ar"),
    ).toBe("Jane Doe");
    expect(
      violationEmployeeName({ ...violation, employee_name_ar: "  " }, "ar"),
    ).toBe("Jane Doe");
  });

  it("uses employee_name in English even when an Arabic name exists", () => {
    expect(violationEmployeeName(violation, "en")).toBe("Jane Doe");
  });
});

describe("decimal display", () => {
  it.each([
    ["0.0500", "5%"],
    ["0.1000", "10%"],
    ["0.5000", "50%"],
    ["0.0000", "0%"],
    ["0.0525", "5.25%"],
    ["1.0000", "100%"],
  ])("formats the fraction %s as %s", (value, expected) => {
    expect(formatFractionAsPercent(value)).toBe(expected);
  });

  it("recognises zero amounts without parsing floats", () => {
    expect(isZeroDecimal("0.00")).toBe(true);
    expect(isZeroDecimal("5.00")).toBe(false);
    expect(isZeroDecimal("0.01")).toBe(false);
  });

  it.each([
    ["7.50", "7.50"],
    ["1234.50", "1,234.50"],
    ["1000000.00", "1,000,000.00"],
    ["0.00", "0.00"],
    ["-16.67", "-16.67"],
  ])("keeps the server decimals of %s as %s", (value, expected) => {
    expect(formatDecimalString(value)).toBe(expected);
  });

  it("treats occurrence 1 as a warning only", () => {
    expect(
      isWarningOnlyViolation({ occurrence_number: 1, penalty_amount: "0.00" }),
    ).toBe(true);
    expect(
      isWarningOnlyViolation({ occurrence_number: 2, penalty_amount: "5.00" }),
    ).toBe(false);
  });

  it("formats minutes as hours and minutes", () => {
    expect(formatMinutes(en, 45)).toBe("45 min");
    expect(formatMinutes(en, 510)).toBe("8 h 30 min");
    expect(formatMinutes(ar, 510)).toBe("8 س 30 د");
  });
});

describe("attendance error classification", () => {
  const failure = (status: number, message = "") => ({
    response: { status, data: { status: "error", message } },
  });

  it("branches on status and splits the two 403 cases", () => {
    expect(classifyAttendanceAccessError(failure(403, UNMAPPED))).toBe(
      "unmapped",
    );
    expect(
      classifyAttendanceAccessError(
        failure(403, "Select an active company for this request."),
      ),
    ).toBe("company");
    expect(classifyAttendanceAccessError(failure(404, "Not found."))).toBe(
      "notFound",
    );
    expect(classifyAttendanceAccessError(failure(500))).toBe("other");
  });

  it("reads the first 422 message per field", () => {
    expect(
      fieldErrorsFromResponse({
        response: {
          data: {
            errors: [
              { field: "date_to", message: "first" },
              { field: "date_to", message: "second" },
              { field: "lifecycle", message: "bad lifecycle" },
              "not a field error",
            ],
          },
        },
      }),
    ).toEqual({ date_to: "first", lifecycle: "bad lifecycle" });
  });
});

describe("recalculation range", () => {
  const day = (value: string) => dayjs(value);

  it("accepts a single day and up to 31 days between the dates", () => {
    expect(recalculationRangeError(day("2026-09-13"), day("2026-09-13"))).toBe(
      null,
    );
    expect(recalculationRangeError(day("2026-08-01"), day("2026-09-01"))).toBe(
      null,
    );
  });

  it("rejects a 32-day gap, a reversed range and missing dates", () => {
    expect(recalculationRangeError(day("2026-08-01"), day("2026-09-02"))).toBe(
      "attendancePolicy.recalc.rangeTooLong",
    );
    expect(recalculationRangeError(day("2026-09-13"), day("2026-09-12"))).toBe(
      "attendancePolicy.recalc.rangeReversed",
    );
    expect(recalculationRangeError(day("2026-09-13"), null)).toBe(
      "attendancePolicy.recalc.rangeRequired",
    );
  });
});

describe("violation filters from the URL", () => {
  it("reads comma lists and defaults the page", () => {
    expect(
      readViolationFilters(
        new URLSearchParams(
          "lifecycle=active,manual_review&payroll_status=pending&employee_profile_id=7&search=jane",
        ),
      ),
    ).toEqual({
      page: 1,
      page_size: 25,
      lifecycle: ["active", "manual_review"],
      payroll_status: ["pending"],
      employee_profile_id: "7",
      date_from: undefined,
      date_to: undefined,
      search: "jane",
    });
  });
});

describe("late attendance notice labels", () => {
  it("names all four v2 styles in English and Arabic", () => {
    expect(NOTICE_LEVELS.map((level) => noticeLevelLabel(en, level))).toEqual([
      "Informational warning",
      "Formal caution",
      "Serious warning",
      "Critical final warning",
    ]);
    expect(NOTICE_LEVELS.map((level) => noticeLevelLabel(ar, level))).toEqual([
      "إنذار توعوي",
      "تنبيه رسمي",
      "تحذير جاد",
      "إنذار نهائي حرج",
    ]);
    expect(noticeLevelLabel(en, 7)).toBe("Level 7");
    expect(noticeLevelLabel(ar, 7)).toBe("المستوى 7");
  });

  it("gives each style its v2 policy result in English and Arabic", () => {
    expect(NOTICE_LEVELS.map((level) => noticeLevelMeaning(en, level))).toEqual(
      [
        "Warning only - no payroll deduction.",
        "Formal caution - 5% daily-rate deduction.",
        "Serious warning - 10% daily-rate deduction.",
        "Critical final warning - 50% daily-rate deduction.",
      ],
    );
    expect(NOTICE_LEVELS.map((level) => noticeLevelMeaning(ar, level))).toEqual(
      [
        "تحذير فقط - لا يوجد خصم من الراتب.",
        "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي.",
        "تحذير جاد - خصم بنسبة ١٠٪ من الأجر اليومي.",
        "إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي.",
      ],
    );
    expect(noticeLevelMeaning(en, 7)).toBe("");
  });

  it("keeps level 1 a warning with no deduction and nothing pending", () => {
    for (const translate of [en, ar]) {
      expect(noticeLevelMeaning(translate, 1)).not.toMatch(
        /pending|awaiting|%|٪|بانتظار|معلّقة/i,
      );
    }
  });

  it("derives localized delivery wording from the four delivery states", () => {
    expect(
      NOTICE_DELIVERY_STATUSES.map((status) => noticeDeliveryLabel(en, status)),
    ).toEqual(["Delivery scheduled", "Sent", "Delivery failed", "Not sent"]);
    expect(
      NOTICE_DELIVERY_STATUSES.map((status) => noticeDeliveryLabel(ar, status)),
    ).toEqual(["الإرسال مجدول", "أُرسل", "تعذر الإرسال", "لم يُرسل"]);
    expect(
      NOTICE_DELIVERY_STATUSES.map((status) => noticeDeliveryHint(en, status)),
    ).toEqual([
      "In-app notice created; WhatsApp or email delivery is scheduled.",
      "Delivered through WhatsApp or email.",
      "Delivery could not be completed.",
      "Not sent: no active account or no configured delivery channel.",
    ]);
    expect(
      NOTICE_DELIVERY_STATUSES.map((status) => noticeDeliveryHint(ar, status)),
    ).toEqual([
      "تم إنشاء الإشعار داخل النظام، والإرسال عبر واتساب أو البريد الإلكتروني مجدول.",
      "تم التسليم عبر واتساب أو البريد الإلكتروني.",
      "تعذر إكمال إرسال الإشعار.",
      "لم يُرسل: لا يوجد حساب نشط أو قناة إرسال مهيأة.",
    ]);
    for (const status of NOTICE_DELIVERY_STATUSES) {
      expect(noticeDeliveryHint(en, status)).not.toMatch(/pending|payroll/i);
    }
    expect(noticeDeliveryLabel(en, null)).toBe("Not recorded");
    expect(noticeDeliveryLabel(ar, null)).toBe("غير مسجلة");
    expect(noticeDeliveryHint(en, null)).toBe("");
    expect(noticeDeliveryLabel(en, "bounced")).toBe("Unknown delivery status");
    expect(noticeDeliveryLabel(ar, "bounced")).toBe("حالة إرسال غير معروفة");
    expect(noticeDeliveryHint(en, "bounced")).toBe("");
  });

  it("offers the PDF only when a filename is present", () => {
    expect(
      hasNoticeDocument({
        filename: "late_attendance_notice_LAN-FFI-000058.pdf",
      }),
    ).toBe(true);
    expect(hasNoticeDocument({ filename: null })).toBe(false);
    expect(hasNoticeDocument({ filename: "  " })).toBe(false);
  });
});

describe("late attendance notice helpers", () => {
  const base = { id: 31, reference_number: "LAN-FFI-000058" };

  it("saves the server filename without any path", () => {
    expect(noticeFilename({ ...base, filename: "notice.pdf" })).toBe(
      "notice.pdf",
    );
    expect(
      noticeFilename({ ...base, filename: "../private/attendance/x.pdf" }),
    ).toBe("x.pdf");
    expect(noticeFilename({ ...base, filename: null })).toBe(
      "late_attendance_notice_LAN-FFI-000058.pdf",
    );
    expect(noticeFilename({ id: 31, reference_number: "", filename: "" })).toBe(
      "late_attendance_notice_31.pdf",
    );
  });

  it("classifies list and download failures by status", () => {
    const failure = (status: number) => ({
      response: { status, data: { status: "error", message: "Nope." } },
    });
    expect(noticeListProblem(failure(403))).toEqual({ kind: "forbidden" });
    expect(noticeListProblem(failure(404))).toEqual({ kind: "notFound" });
    expect(noticeListProblem(failure(500)).kind).toBe("error");

    expect(noticeDownloadErrorKey(failure(404))).toBe(
      "attendancePolicy.notices.downloadNotFound",
    );
    expect(noticeDownloadErrorKey(failure(403))).toBe(
      "attendancePolicy.notices.downloadForbidden",
    );
    expect(noticeDownloadErrorKey(new Error("Network Error"))).toBe(
      "attendancePolicy.notices.downloadFailed",
    );
  });

  it("reads HR notice filters from the URL", () => {
    expect(
      readNoticeFilters(
        new URLSearchParams(
          "notice_level=1,4&employee_profile_id=7&date_from=2026-09-01&search=jane&page=2",
        ),
      ),
    ).toEqual({
      page: 2,
      page_size: 25,
      notice_level: ["1", "4"],
      employee_profile_id: "7",
      date_from: "2026-09-01",
      date_to: undefined,
      search: "jane",
    });
  });
});
