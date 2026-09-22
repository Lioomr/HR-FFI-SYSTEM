import { useState } from "react";
import { useI18n } from "../../../i18n/useI18n";
import type { WorkforceStatus } from "../../../services/api/hrSummaryApi";

interface WorkforceStatusChartProps {
  status: WorkforceStatus;
}

type StatusKey = keyof WorkforceStatus;

// Fixed categorical order — a status keeps its colour whatever the counts are.
// "Currently employed" shares its blue with the nationality chart's bars;
// archived is a recessive grey because it is no longer part of the workforce.
const STATUSES: Array<{ key: StatusKey; labelKey: string; color: string }> = [
  {
    key: "currently_employed",
    labelKey: "hr.dashboard.status.currentlyEmployed",
    color: "#2a78d6",
  },
  {
    key: "on_leave_outside",
    labelKey: "hr.dashboard.status.onLeaveOutside",
    color: "#eb6834",
  },
  {
    key: "on_leave_inside",
    labelKey: "hr.dashboard.status.onLeaveInside",
    color: "#1baf7a",
  },
  {
    key: "archived",
    labelKey: "hr.dashboard.status.archived",
    color: "#94a3b8",
  },
];

const SIZE = 168;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2 - 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Surface-coloured gap between adjacent segments.
const GAP = 2;

function percentOf(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/**
 * Donut of where the workforce is today. Hovering or focusing a segment /
 * legend row swaps the centre figure to that status.
 */
export default function WorkforceStatusChart({
  status: breakdown,
}: WorkforceStatusChartProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<StatusKey | null>(null);

  const total = STATUSES.reduce((sum, s) => sum + (breakdown[s.key] ?? 0), 0);

  if (total === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13.5, color: "#94a3b8" }}>
        {t("hr.dashboard.noEmployees")}
      </p>
    );
  }

  const visible = STATUSES.filter((s) => (breakdown[s.key] ?? 0) > 0);
  const showGaps = visible.length > 1;
  const lengths = visible.map(
    (status) => (breakdown[status.key] / total) * CIRCUMFERENCE,
  );
  const segments = visible.map((status, index) => ({
    ...status,
    dash: Math.max(lengths[index] - (showGaps ? GAP : 0), 0.5),
    offset: lengths.slice(0, index).reduce((sum, len) => sum + len, 0),
  }));

  const focus = hovered ? STATUSES.find((s) => s.key === hovered) : null;
  const centreValue = focus ? breakdown[focus.key] : total;
  const centreLabel = focus
    ? `${t(focus.labelKey)} · ${percentOf(centreValue, total)}%`
    : t("hr.dashboard.employeesTotal");

  const ariaSummary = STATUSES.map(
    (s) =>
      `${t(s.labelKey)} ${breakdown[s.key] ?? 0} (${percentOf(breakdown[s.key] ?? 0, total)}%)`,
  ).join(", ");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        flexWrap: "wrap",
        justifyContent: "center",
        alignContent: "center",
        height: "100%",
      }}
    >
      <div style={{ position: "relative", width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={ariaSummary}
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {segments.map((segment) => {
              const dimmed = hovered !== null && hovered !== segment.key;
              return (
                <circle
                  key={segment.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={hovered === segment.key ? STROKE + 6 : STROKE}
                  strokeDasharray={`${segment.dash} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-segment.offset}
                  opacity={dimmed ? 0.35 : 1}
                  style={{
                    transition: "stroke-width 150ms ease, opacity 150ms ease",
                    cursor: "default",
                  }}
                  onMouseEnter={() => setHovered(segment.key)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </g>
        </svg>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            textAlign: "center",
            padding: STROKE + 8,
          }}
        >
          <span
            className="tabular-nums"
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: "#0f172a",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            {centreValue.toLocaleString()}
          </span>
          <span style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
            {centreLabel}
          </span>
        </div>
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minWidth: 220,
          flex: "1 1 220px",
        }}
      >
        {STATUSES.map((status) => {
          const count = breakdown[status.key] ?? 0;
          const active = hovered === status.key;
          return (
            <li
              key={status.key}
              tabIndex={0}
              onMouseEnter={() => setHovered(status.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(status.key)}
              onBlur={() => setHovered(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                background: active ? "#f8fafc" : "transparent",
                outlineOffset: 2,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: status.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13, color: "#475569", flex: 1 }}>
                {t(status.labelKey)}
              </span>
              <span
                className="tabular-nums"
                style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}
              >
                {count.toLocaleString()}
              </span>
              <span
                className="tabular-nums"
                style={{
                  fontSize: 12,
                  color: "#94a3b8",
                  minWidth: 38,
                  textAlign: "end",
                }}
              >
                {percentOf(count, total)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
