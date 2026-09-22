import { useEffect, useState } from "react";
import { CalendarOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import { formatHeaderDate, formatHijriDate } from "../../utils/headerDate";

function msUntilNextMidnight(now: Date) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * Today's date (no time) from the device clock — Gregorian, plus Hijri in
 * the Arabic view. Re-renders just after midnight so a tab left open
 * overnight never shows yesterday.
 */
export default function HeaderDate({ color }: { color?: string }) {
  const { t, language } = useI18n();
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setTimeout(
      () => setToday(new Date()),
      msUntilNextMidnight(today) + 1000,
    );
    return () => window.clearTimeout(timer);
  }, [today]);

  const label = formatHeaderDate(today, language);
  // The Arabic view also shows the Hijri date, as is customary in Saudi HR.
  const hijri = language === "ar" ? formatHijriDate(today) : null;

  return (
    <time
      dateTime={`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`}
      aria-label={`${t("header.today")}: ${label}${hijri ? ` — ${hijri}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 10,
        background: "rgba(255, 255, 255, 0.7)",
        border: "1px solid #e2e8f0",
        fontSize: 13,
        fontWeight: 600,
        // The antd header sets a 64px line height; keep the pill compact.
        lineHeight: 1.4,
        color: color ?? "#334155",
        whiteSpace: "nowrap",
      }}
    >
      <CalendarOutlined aria-hidden style={{ color: "#f97316" }} />
      {label}
      {hijri && (
        <>
          <span
            aria-hidden
            style={{ width: 1, height: 14, background: "#cbd5e1" }}
          />
          <span style={{ fontWeight: 500, color: "#64748b" }}>{hijri}</span>
        </>
      )}
    </time>
  );
}
