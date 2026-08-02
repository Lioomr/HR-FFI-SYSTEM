import type { ReactNode } from "react";
import {
  BellOutlined,
  CalendarOutlined,
  DollarOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  SoundOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  HomeOutlined,
  UserSwitchOutlined,
  SettingOutlined,
} from "@ant-design/icons";

/**
 * Visual + semantic metadata for a notification category. Categories are
 * open-ended on the backend, so anything unmapped falls back to a neutral
 * "general" treatment rather than breaking.
 */
interface CategoryMeta {
  icon: ReactNode;
  color: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  leave: { icon: <CalendarOutlined />, color: "#3b82f6" },
  loan: { icon: <DollarOutlined />, color: "#10b981" },
  assets: { icon: <AppstoreOutlined />, color: "#8b5cf6" },
  asset: { icon: <AppstoreOutlined />, color: "#8b5cf6" },
  attendance: { icon: <ClockCircleOutlined />, color: "#0ea5e9" },
  payroll: { icon: <DollarOutlined />, color: "#f59e0b" },
  payslip: { icon: <FileTextOutlined />, color: "#f59e0b" },
  announcement: { icon: <SoundOutlined />, color: "#ec4899" },
  meeting: { icon: <TeamOutlined />, color: "#6366f1" },
  document: { icon: <FileTextOutlined />, color: "#ef4444" },
  invite: { icon: <UserSwitchOutlined />, color: "#14b8a6" },
  rent: { icon: <HomeOutlined />, color: "#a16207" },
  workflow: { icon: <UserSwitchOutlined />, color: "#f97316" },
  approval: { icon: <CheckCircleOutlined />, color: "#22c55e" },
  employee: { icon: <TeamOutlined />, color: "#64748b" },
  system: { icon: <SettingOutlined />, color: "#64748b" },
  general: { icon: <BellOutlined />, color: "#94a3b8" },
};

export function getCategoryIcon(category: string): ReactNode {
  return (CATEGORY_META[category] ?? CATEGORY_META.general).icon;
}

export function getCategoryColor(category: string): string {
  return (CATEGORY_META[category] ?? CATEGORY_META.general).color;
}

/** i18n key for a category label; components pass a fallback to `t()`. */
export function categoryLabelKey(category: string): string {
  return `notifications.category.${category || "general"}`;
}

/**
 * Locale-aware relative time ("3 minutes ago") using the built-in
 * `Intl.RelativeTimeFormat` — no extra dependency, full en/ar support.
 */
export function formatRelativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto" });

  if (abs < 45) return rtf.format(Math.round(diffSec), "second");
  if (abs < 2700) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 2629800) return rtf.format(Math.round(diffSec / 604800), "week");
  if (abs < 31557600) return rtf.format(Math.round(diffSec / 2629800), "month");
  return rtf.format(Math.round(diffSec / 31557600), "year");
}

/** Full, accessible absolute timestamp for tooltips / `title` / `aria-label`. */
export function formatAbsoluteTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale || "en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
