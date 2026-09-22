import {
  FileProtectOutlined,
  IdcardOutlined,
  MedicineBoxOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Grid } from "antd";
import type { ReactNode } from "react";
import { useI18n } from "../../../i18n/useI18n";
import type {
  ExpiringDocumentGroup,
  ExpiringDocumentsSummary,
} from "../../../services/api/hrSummaryApi";

interface ExpiringDocumentsPanelProps {
  summary: ExpiringDocumentsSummary;
  /** Opens the full expiring-documents page */
  onOpen: () => void;
}

const GROUPS: Array<{ key: ExpiringDocumentGroup; icon: ReactNode }> = [
  { key: "national_id", icon: <IdcardOutlined /> },
  { key: "iqama", icon: <IdcardOutlined /> },
  { key: "passport", icon: <SolutionOutlined /> },
  { key: "work_license", icon: <SafetyCertificateOutlined /> },
  { key: "contract", icon: <FileProtectOutlined /> },
  { key: "health_insurance", icon: <MedicineBoxOutlined /> },
];

// Within a week is urgent; the rest of the window is a warning.
const URGENT_DAYS = 7;

const { useBreakpoint } = Grid;

/**
 * Expiring documents grouped the way HR tracks them (National ID, Iqama,
 * passport, work licence, contract, health insurance) plus the few expiring
 * soonest. Every part opens the full expiring-documents page.
 */
export default function ExpiringDocumentsPanel({
  summary,
  onOpen,
}: ExpiringDocumentsPanelProps) {
  const { t } = useI18n();
  const screens = useBreakpoint();
  // Six boxes: one row when wide, two rows of three, three rows of two.
  const columns = screens.xl ? 6 : screens.sm ? 3 : 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 10,
        }}
      >
        {GROUPS.map((group) => {
          const count = summary.by_type[group.key] ?? 0;
          const label = t(`hr.dashboard.docGroup.${group.key}`);
          const hot = count > 0;
          return (
            <button
              key={group.key}
              type="button"
              onClick={onOpen}
              aria-label={`${label}: ${count}`}
              className="press-scale"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 6,
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${hot ? "#fcd34d" : "#eef2f7"}`,
                background: hot ? "#fffbeb" : "#f8fafc",
                cursor: "pointer",
                textAlign: "start",
                font: "inherit",
                minHeight: 40,
              }}
            >
              <span
                aria-hidden
                style={{ fontSize: 16, color: hot ? "#b45309" : "#94a3b8" }}
              >
                {group.icon}
              </span>
              <span
                className="tabular-nums"
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: hot ? "#0f172a" : "#94a3b8",
                }}
              >
                {count.toLocaleString()}
              </span>
              <span style={{ fontSize: 12.5, color: "#475569" }}>{label}</span>
            </button>
          );
        })}
      </div>

      <div>
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#64748b",
          }}
        >
          {t("hr.dashboard.soonestToExpire")}
        </h3>

        {summary.soonest.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "#94a3b8" }}>
            {t("hr.dashboard.noExpiringDocs", {
              days: summary.window_days.toString(),
            })}
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {summary.soonest.map((item) => {
              const urgent = item.days_left <= URGENT_DAYS;
              const daysText =
                item.days_left === 0
                  ? t("hr.dashboard.expiresToday")
                  : t("hr.dashboard.daysLeft", {
                      days: item.days_left.toString(),
                    });
              return (
                <li key={`${item.employee_id}-${item.doc_type}`}>
                  <button
                    type="button"
                    onClick={onOpen}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #f1f5f9",
                      background: "white",
                      cursor: "pointer",
                      textAlign: "start",
                      font: "inherit",
                      minHeight: 40,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "#0f172a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.full_name}
                      </span>
                      <span style={{ fontSize: 12, color: "#64748b" }}>
                        {t(`hr.dashboard.docGroup.${item.doc_type}`)} ·{" "}
                        {item.expiry_date}
                      </span>
                    </span>
                    <span
                      className="tabular-nums"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 20,
                        color: urgent ? "#b91c1c" : "#92400e",
                        background: urgent ? "#fee2e2" : "#fef3c7",
                      }}
                    >
                      {urgent && <WarningOutlined aria-hidden />}
                      {daysText}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
