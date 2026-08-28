import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  MinusOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import AmountWithSAR from "../../ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import type { HRSummary } from "../../../services/api/hrSummaryApi";

interface WorkforcePayrollPanelProps {
  totalEmployees: number;
  activeEmployees: number;
  payroll: HRSummary["latest_payroll"] | undefined;
}

const ACTIVE_COLOR = "#f97316";
const INACTIVE_COLOR = "#cbd5e1";

/** Backend sends "M/YYYY"; render it as a readable month when parseable. */
function formatPeriod(period: string | null | undefined) {
  if (!period) return null;
  const match = period.match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) return period;
  const parsed = dayjs(`${match[2]}-${match[1].padStart(2, "0")}-01`);
  return parsed.isValid() ? parsed.format("MMMM YYYY") : period;
}

function Legend({
  color,
  label,
  count,
  percent,
}: {
  color: string;
  label: string;
  count: number;
  percent: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12.5, color: "#64748b" }}>{label}</span>
      <span
        className="tabular-nums"
        style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}
      >
        {count.toLocaleString()}
      </span>
      <span className="tabular-nums" style={{ fontSize: 12, color: "#94a3b8" }}>
        ({percent}%)
      </span>
    </div>
  );
}

/**
 * The two figures on this page that carry a real comparison: payroll versus the
 * previous run, and the active/inactive split of the workforce.
 */
export default function WorkforcePayrollPanel({
  totalEmployees,
  activeEmployees,
  payroll,
}: WorkforcePayrollPanelProps) {
  const { t } = useI18n();

  const inactiveEmployees = Math.max(totalEmployees - activeEmployees, 0);
  const activePercent =
    totalEmployees > 0
      ? Math.round((activeEmployees / totalEmployees) * 100)
      : 0;
  const inactivePercent = totalEmployees > 0 ? 100 - activePercent : 0;

  const period = formatPeriod(payroll?.latest_period);
  const netTotal = payroll?.latest_total_net ?? null;
  const trend = payroll?.trend_percentage ?? null;
  const trendUp = typeof trend === "number" && trend > 0;
  const trendFlat = typeof trend === "number" && trend === 0;
  const trendColor = trendFlat ? "#475569" : trendUp ? "#047857" : "#b91c1c";
  const trendBackground = trendFlat
    ? "#f1f5f9"
    : trendUp
      ? "#d1fae5"
      : "#fee2e2";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Latest payroll run ── */}
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#64748b",
          }}
        >
          {t("hr.dashboard.latestPayrollRun")}
        </h3>

        {netTotal === null ? (
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#94a3b8" }}>
            {t("hr.dashboard.payrollNoRun")}
          </p>
        ) : (
          <>
            <div
              className="tabular-nums"
              style={{
                marginTop: 8,
                fontSize: 24,
                fontWeight: 800,
                color: "#0f172a",
                letterSpacing: "-0.02em",
              }}
            >
              <AmountWithSAR amount={netTotal} size={18} color="#334155" />
            </div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: "#64748b" }}>
              {t("hr.dashboard.netTotal")}
              {period ? ` · ${period}` : ""}
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {trend === null ? (
                <span style={{ fontSize: 12.5, color: "#94a3b8" }}>
                  {t("hr.dashboard.noComparison")}
                </span>
              ) : (
                <>
                  <span
                    className="tabular-nums"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 700,
                      color: trendColor,
                      background: trendBackground,
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {trendFlat ? (
                      <MinusOutlined aria-hidden />
                    ) : trendUp ? (
                      <ArrowUpOutlined aria-hidden />
                    ) : (
                      <ArrowDownOutlined aria-hidden />
                    )}
                    {trendUp ? "+" : ""}
                    {trend}%
                  </span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    {t("hr.dashboard.vsPreviousMonth")}
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ height: 1, background: "#f1f5f9" }} />

      {/* ── Employment status split ── */}
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#64748b",
          }}
        >
          {t("hr.dashboard.employmentStatus")}
        </h3>

        {totalEmployees === 0 ? (
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#94a3b8" }}>
            {t("hr.dashboard.noEmployees")}
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`${t("hr.dashboard.active")} ${activeEmployees} (${activePercent}%), ${t(
                "hr.dashboard.inactive",
              )} ${inactiveEmployees} (${inactivePercent}%)`}
              style={{
                display: "flex",
                height: 10,
                borderRadius: 999,
                overflow: "hidden",
                background: INACTIVE_COLOR,
                marginTop: 10,
              }}
            >
              <div
                style={{ width: `${activePercent}%`, background: ACTIVE_COLOR }}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px 18px",
                marginTop: 10,
              }}
            >
              <Legend
                color={ACTIVE_COLOR}
                label={t("hr.dashboard.active")}
                count={activeEmployees}
                percent={activePercent}
              />
              <Legend
                color={INACTIVE_COLOR}
                label={t("hr.dashboard.inactive")}
                count={inactiveEmployees}
                percent={inactivePercent}
              />
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>
              {t("hr.dashboard.employmentStatusUnit", {
                total: totalEmployees.toLocaleString(),
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
