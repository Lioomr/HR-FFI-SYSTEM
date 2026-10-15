import { useId, useState } from "react";
import { Button, Typography } from "antd";
import { useI18n } from "../../i18n/useI18n";
import MoneyText, { ExactShareText } from "./MoneyText";
import type {
  Money,
  PayrollRunDto,
  PayrollRunSummaryDto,
  ProvisionLineType,
} from "../../services/api/payrollTypes";

const PROVISIONS: [
  keyof PayrollRunSummaryDto["provisions"],
  ProvisionLineType,
  string,
][] = [
  ["medical", "MEDICAL", "medical"],
  ["id_cost", "ID_COST", "id_cost"],
  ["air_ticket", "AIR_TICKET", "air_ticket"],
  ["leave", "LEAVE_PROVISION", "leave_provision"],
  ["eos", "EOS_PROVISION", "eos_provision"],
  ["accommodation_cost", "ACCOMMODATION_COST", "accommodation_cost"],
  ["gosi_company", "GOSI_COMPANY", "gosi_company"],
];

export default function RunHeadlineTotals({
  run,
  summary,
  costIncompleteReasons,
  onValidation,
}: {
  run: PayrollRunDto;
  summary: PayrollRunSummaryDto | null;
  costIncompleteReasons: string[];
  onValidation?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const incomplete = summary?.cost_incomplete ?? run.cost_incomplete;
  const displayMoney = (amount: Money | null, headline = false) =>
    run.legacy_calculation && amount === null ? (
      <Typography.Text type="secondary">
        {t("payroll.ux.legacyUnavailable")}
      </Typography.Text>
    ) : (
      <MoneyText
        amount={amount}
        strong={headline}
        size={headline ? 20 : undefined}
      />
    );
  const line = (key: string, amount: Money | null, unknown = 0) => (
    <li
      key={key}
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        paddingBlock: 4,
      }}
    >
      <span>
        {t(key)}
        {unknown > 0 && (
          <Typography.Text type="secondary">
            {" "}
            · {t("payroll.ui.unknownCount", { count: unknown })}
          </Typography.Text>
        )}
      </span>
      {displayMoney(amount)}
    </li>
  );
  return (
    <section
      aria-label={t("payroll.ux.headlineTotals")}
      data-testid="payroll-kpi-strip"
      style={{
        border: "1px solid var(--payroll-border)",
        borderRadius: "var(--payroll-radius)",
        background: "var(--payroll-surface)",
        marginBottom: 16,
      }}
    >
      <div className="payroll-kpis">
        {[
          [
            "payroll.field.gross_salary",
            summary?.total_gross_salary ?? run.total_gross,
            t("payroll.ui.employeesInRun", {
              count: summary?.total_employees ?? run.total_employees,
            }),
          ],
          [
            "payroll.field.net_salary",
            summary?.total_net_salary ?? run.total_net,
            t("payroll.ux.employeesReceive"),
          ],
          [
            "payroll.field.total_company_cost",
            summary ? summary.total_company_cost : run.total_company_cost,
            t(
              incomplete
                ? "payroll.ux.knownSubtotal"
                : "payroll.ux.includesProvisions",
            ),
          ],
        ].map(([label, amount, hint]) => (
          <div key={label} className="payroll-kpi">
            <Typography.Text type="secondary">{t(label!)}</Typography.Text>
            <div className="payroll-kpi-number">
              {displayMoney(amount ?? null, true)}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {hint}
            </Typography.Text>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          padding: "8px 24px",
          flexWrap: "wrap",
        }}
      >
        <Typography.Text type="secondary">
          {incomplete && (
            <>
              {t("payroll.field.cost_incomplete")}
              {costIncompleteReasons.length
                ? `: ${costIncompleteReasons.join("; ")}`
                : ""}
              .{" "}
              <Button type="link" size="small" onClick={onValidation}>
                {t("payroll.ux.reviewValidation")}
              </Button>
            </>
          )}
        </Typography.Text>
        <Button
          size="small"
          type="text"
          disabled={!summary}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {t(open ? "payroll.ui.hideBreakdown" : "payroll.ui.showBreakdown")}
        </Button>
      </div>
      {open && summary && (
        <div id={panelId} className="payroll-breakdown">
          <div>
            <Typography.Text strong>
              {t("payroll.ui.groupSalary")}
            </Typography.Text>
            <ul style={{ listStyle: "none", padding: 0, marginBlock: 8 }}>
              {Object.entries(summary.salary_components).map(([key, amount]) =>
                line(`payroll.line.${key}`, amount),
              )}
              {line("payroll.field.gross_salary", summary.total_gross_salary)}
            </ul>
          </div>
          <div>
            <Typography.Text strong>
              {t("payroll.pdf.additions")} / {t("payroll.pdf.deductions")}
            </Typography.Text>
            <ul style={{ listStyle: "none", padding: 0, marginBlock: 8 }}>
              {Object.entries(summary.additions).map(([key, amount]) =>
                line(`payroll.line.${key}`, amount),
              )}
              {line("payroll.field.total_additions", summary.total_additions)}
              {Object.entries(summary.deductions).map(([key, amount]) =>
                line(`payroll.line.${key}`, amount),
              )}
              {line("payroll.field.total_deductions", summary.total_deductions)}
              {line("payroll.field.net_salary", summary.total_net_salary)}
            </ul>
          </div>
          <div>
            <Typography.Text strong>
              {t("payroll.pdf.provisions")}
            </Typography.Text>
            <ul style={{ listStyle: "none", padding: 0, marginBlock: 8 }}>
              {PROVISIONS.map(([key, type, label]) =>
                line(
                  `payroll.line.${label}`,
                  summary.provisions[key],
                  summary.unknown_provision_counts[type],
                ),
              )}
              {line("payroll.ui.totalProvisions", summary.total_provisions)}
              {line(
                "payroll.field.total_company_cost",
                summary.total_company_cost,
              )}
            </ul>
            <Typography.Text type="secondary">
              {t("payroll.rent.rounding_difference")}:{" "}
              <ExactShareText share={summary.rent_rounding_difference} />
            </Typography.Text>
            <p>
              <Typography.Text type="secondary">
                {t("payroll.ui.roundingDifferenceNote")}
              </Typography.Text>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
