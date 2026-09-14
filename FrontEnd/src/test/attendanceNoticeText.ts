import type {
  AttendanceLateNotice,
  NoticeDeliveryStatus,
  NoticeLevel,
} from "../types/attendancePolicy";

/** The canonical v2 notice styles, exactly as the UI must show them. */
export const NOTICE_STYLE_TEXT: Record<
  NoticeLevel,
  { en: string; ar: string; policyEn: string; policyAr: string }
> = {
  1: {
    en: "Informational warning",
    ar: "إنذار توعوي",
    policyEn: "Warning only - no payroll deduction.",
    policyAr: "تحذير فقط - لا يوجد خصم من الراتب.",
  },
  2: {
    en: "Formal caution",
    ar: "تنبيه رسمي",
    policyEn: "Formal caution - 5% daily-rate deduction.",
    policyAr: "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي.",
  },
  3: {
    en: "Serious warning",
    ar: "تحذير جاد",
    policyEn: "Serious warning - 10% daily-rate deduction.",
    policyAr: "تحذير جاد - خصم بنسبة ١٠٪ من الأجر اليومي.",
  },
  4: {
    en: "Critical final warning",
    ar: "إنذار نهائي حرج",
    policyEn: "Critical final warning - 50% daily-rate deduction.",
    policyAr: "إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي.",
  },
};

/**
 * Localized delivery wording per state, plus the English-only message the
 * backend sends for it, which the UI must never display.
 */
export const NOTICE_DELIVERY_TEXT: Record<
  NoticeDeliveryStatus,
  {
    en: string;
    ar: string;
    hintEn: string;
    hintAr: string;
    serverMessage: string;
  }
> = {
  scheduled: {
    en: "Delivery scheduled",
    ar: "الإرسال مجدول",
    hintEn: "In-app notice created; WhatsApp or email delivery is scheduled.",
    hintAr:
      "تم إنشاء الإشعار داخل النظام، والإرسال عبر واتساب أو البريد الإلكتروني مجدول.",
    serverMessage:
      "In-app notification created; external delivery is scheduled.",
  },
  sent: {
    en: "Sent",
    ar: "أُرسل",
    hintEn: "Delivered through WhatsApp or email.",
    hintAr: "تم التسليم عبر واتساب أو البريد الإلكتروني.",
    serverMessage:
      "Delivered in-app and through a configured external channel.",
  },
  failed: {
    en: "Delivery failed",
    ar: "تعذر الإرسال",
    hintEn: "Delivery could not be completed.",
    hintAr: "تعذر إكمال إرسال الإشعار.",
    serverMessage: "In-app notification created; external delivery failed.",
  },
  skipped: {
    en: "Not sent",
    ar: "لم يُرسل",
    hintEn: "Not sent: no active account or no configured delivery channel.",
    hintAr: "لم يُرسل: لا يوجد حساب نشط أو قناة إرسال مهيأة.",
    serverMessage:
      "In-app notification created; no configured external channel was available.",
  },
};

export const styleOf = (notice: AttendanceLateNotice) =>
  NOTICE_STYLE_TEXT[notice.notice_level as NoticeLevel];

export const deliveryOf = (notice: AttendanceLateNotice) =>
  NOTICE_DELIVERY_TEXT[notice.delivery_status as NoticeDeliveryStatus];
