/**
 * Formats a date for the header. Arabic keeps the Gregorian calendar and
 * Latin digits used everywhere else in the app (plain "ar-SA" would switch to
 * the Hijri calendar).
 */
export function formatHeaderDate(date: Date, language: string) {
  const locale = language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Hijri date for the Arabic header, using Umm al-Qura — the official Saudi
 * calendar — with Latin digits, e.g. "10 ربيع الآخر 1448 هـ".
 */
export function formatHijriDate(date: Date) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
