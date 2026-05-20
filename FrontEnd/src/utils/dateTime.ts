import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const APP_TIME_ZONE = import.meta.env.VITE_APP_TIME_ZONE || "Asia/Riyadh";

const parseDateTime = (value?: string | Date | null) => {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
};

export function formatDateTime(value?: string | Date | null, fallback = "-") {
  const parsed = parseDateTime(value);
  return parsed ? parsed.tz(APP_TIME_ZONE).format("YYYY-MM-DD HH:mm") : fallback;
}

export function formatDateTimeShort(value?: string | Date | null, fallback = "-") {
  const parsed = parseDateTime(value);
  return parsed ? parsed.tz(APP_TIME_ZONE).format("MMM DD, YYYY HH:mm") : fallback;
}

export function formatDateOnly(value?: string | Date | null, fallback = "-") {
  const parsed = parseDateTime(value);
  return parsed ? parsed.format("YYYY-MM-DD") : fallback;
}

export function formatTimeOnly(value?: string | Date | null, fallback = "-") {
  const parsed = parseDateTime(value);
  return parsed ? parsed.tz(APP_TIME_ZONE).format("HH:mm") : fallback;
}

export function formatTimeOnly12(value?: string | Date | null, fallback = "-") {
  const parsed = parseDateTime(value);
  return parsed ? parsed.tz(APP_TIME_ZONE).format("hh:mm A") : fallback;
}
