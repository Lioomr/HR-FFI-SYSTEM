import { Tooltip } from "antd";
import { useI18n } from "../../../i18n/useI18n";
import type { NationalityBreakdown } from "../../../services/api/hrSummaryApi";
import { getCountryCode } from "../../../utils/countries";

interface NationalityChartProps {
  breakdown: NationalityBreakdown;
}

interface Row {
  key: string;
  label: string;
  code: string | null;
  total: number;
  active: number;
}

const BAR_COLOR = "#2a78d6";
// Beyond this many bars the tail folds into one "Other nationalities" row.
const MAX_ROWS = 8;

function percentOf(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function countryName(code: string, language: string) {
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(code);
  } catch {
    return undefined;
  }
}

/**
 * Headcount per nationality as horizontal bars, largest first, headed by the
 * Saudization rate of the active workforce — the figure HR is measured on.
 */
export default function NationalityChart({ breakdown }: NationalityChartProps) {
  const { t, language } = useI18n();

  // Nationality is free text; recorded variants of one country ("Bengali",
  // "Bangladesh") resolve to the same ISO code and are merged here.
  const merged = new Map<string, Row>();
  for (const item of breakdown.nationalities ?? []) {
    const code = item.nationality ? getCountryCode(item.nationality) : null;
    const key = code ?? item.nationality ?? "__unknown__";
    const label = code
      ? (countryName(code, language) ?? item.nationality!)
      : (item.nationality ?? t("hr.dashboard.nationalityUnknown"));
    const row = merged.get(key) ?? { key, label, code, total: 0, active: 0 };
    row.total += item.total;
    row.active += item.active;
    merged.set(key, row);
  }
  const sorted = [...merged.values()].sort(
    (a, b) =>
      Number(a.key === "__unknown__") - Number(b.key === "__unknown__") ||
      b.total - a.total ||
      a.label.localeCompare(b.label),
  );

  let rows = sorted;
  if (sorted.length > MAX_ROWS) {
    const tail = sorted.slice(MAX_ROWS - 1);
    rows = [
      ...sorted.slice(0, MAX_ROWS - 1),
      {
        key: "__other__",
        label: t("hr.dashboard.otherNationalities", {
          count: tail.length.toString(),
        }),
        code: null,
        total: tail.reduce((sum, row) => sum + row.total, 0),
        active: tail.reduce((sum, row) => sum + row.active, 0),
      },
    ];
  }

  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  if (grandTotal === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13.5, color: "#94a3b8" }}>
        {t("hr.dashboard.noEmployees")}
      </p>
    );
  }

  const saudizationRate = percentOf(
    breakdown.saudi_active,
    breakdown.active_total,
  );
  const maxTotal = Math.max(...rows.map((row) => row.total), 1);
  const activeLabel = t("employees.status.active");
  const otherLabel = t("hr.dashboard.otherStatuses");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div
          className="tabular-nums"
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          {saudizationRate}%
        </div>
        <div style={{ marginTop: 2, fontSize: 12.5, color: "#64748b" }}>
          {t("hr.dashboard.saudizationCaption")}
        </div>
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {rows.map((row) => {
          const other = Math.max(row.total - row.active, 0);
          const percent = percentOf(row.total, grandTotal);
          return (
            <Tooltip
              key={row.key}
              placement="top"
              title={
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    {row.label} · {row.total.toLocaleString()} ({percent}%)
                  </div>
                  <div>
                    {activeLabel}: {row.active.toLocaleString()}
                  </div>
                  <div>
                    {otherLabel}: {other.toLocaleString()}
                  </div>
                </div>
              }
            >
              <li
                tabIndex={0}
                aria-label={`${row.label}: ${row.total} (${percent}%)`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(96px, 34%) 1fr auto",
                  alignItems: "center",
                  gap: 10,
                  cursor: "default",
                  outlineOffset: 2,
                  borderRadius: 6,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                    fontSize: 13,
                    color: "#475569",
                  }}
                >
                  {row.code ? (
                    <span
                      aria-hidden
                      className={`fi fi-${row.code.toLowerCase()}`}
                      style={{ flexShrink: 0, borderRadius: 2 }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{
                        width: "1.333em",
                        height: "1em",
                        flexShrink: 0,
                        borderRadius: 2,
                        background: "#e2e8f0",
                      }}
                    />
                  )}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.label}
                  </span>
                </span>
                <span
                  style={{
                    height: 12,
                    background: "#f1f5f9",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${Math.max((row.total / maxTotal) * 100, 2)}%`,
                      background: BAR_COLOR,
                      borderRadius: 4,
                    }}
                  />
                </span>
                <span
                  className="tabular-nums"
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "baseline",
                    justifyContent: "flex-end",
                    minWidth: 64,
                  }}
                >
                  <span
                    style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}
                  >
                    {row.total.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    {percent}%
                  </span>
                </span>
              </li>
            </Tooltip>
          );
        })}
      </ul>
    </div>
  );
}
