import { Link } from "react-router-dom";
import { Button, Typography } from "antd";
import { useI18n } from "../../i18n/useI18n";
import { usePayrollEnums } from "../../hooks/usePayrollEnums";
import ExecutiveExemptMarker from "./ExecutiveExemptMarker";
import MoneyText from "./MoneyText";
import { isManualInformation } from "./validationGroups";
import type {
  PayrollRunItemDto,
  ValidationIssue,
} from "../../services/api/payrollTypes";

const { Text } = Typography;

export default function PayrollItemEditorSummary({
  item,
  reportIssues,
  issuesAvailable,
  canOpenProfiles,
  onFix,
}: {
  item: PayrollRunItemDto;
  reportIssues: ValidationIssue[];
  issuesAvailable: boolean;
  canOpenProfiles: boolean;
  onFix: (issue: ValidationIssue) => void;
}) {
  const { t } = useI18n();
  const { label } = usePayrollEnums();
  const costReasons = (current: PayrollRunItemDto) => {
    const reasons: string[] = [];
    if (
      current.accommodation_status === "unknown" ||
      current.accommodation_cost === null
    ) {
      reasons.push(
        label(
          "accommodation_status",
          "unknown",
          "payroll.accommodation_status.unknown",
        ),
      );
    }
    if (current.medical_provision === null) {
      reasons.push(t("payroll.ui.medicalInvoiceMissing"));
    }
    return reasons;
  };
  return (
    <aside
      className="payroll-employee-summary"
      aria-label={t("payroll.runDetails.summary")}
    >
      {item.executive_exempt && <ExecutiveExemptMarker />}
      {[
        "gross_salary",
        "total_additions",
        "total_deductions",
        "net_salary",
        "total_company_cost",
      ].map((field) => (
        <div className="payroll-employee-total" key={field}>
          <Text type="secondary">{t(`payroll.field.${field}`)}</Text>
          <MoneyText amount={item[field as "gross_salary"]} strong />
        </div>
      ))}
      {item.cost_incomplete && (
        <Text type="secondary">
          {t("payroll.field.cost_incomplete")}: {costReasons(item).join(", ")}
        </Text>
      )}
      <div className="payroll-employee-issues">
        <Text strong>
          {issuesAvailable ? (
            <>
              {t("payroll.ui.errorsCount", {
                count: reportIssues.filter(
                  (issue) => issue.severity === "error",
                ).length,
              })}{" "}
              ·{" "}
              {t("payroll.ui.warningsCount", {
                count: reportIssues.filter(
                  (issue) =>
                    issue.severity === "warning" &&
                    !isManualInformation(issue, [item]),
                ).length,
              })}
            </>
          ) : (
            t("payroll.ui.validationUnavailable")
          )}
        </Text>
        <ul>
          {reportIssues.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              data-severity={
                isManualInformation(issue, [item]) ? "info" : issue.severity
              }
            >
              <span>
                {isManualInformation(issue, [item]) && (
                  <>{t("payroll.ux3.confirmedNoCoverage")} · </>
                )}
                {issue.message}
              </span>
              {isManualInformation(issue, [
                item,
              ]) ? null : /medical|invoice/.test(issue.code) ? (
                <Link to="/hr/payroll/settings">
                  {t("payroll.employee.fix")}
                </Link>
              ) : /accommodation/.test(issue.code) ? (
                <Link to="/hr/payroll/accommodation">
                  {t("payroll.employee.fix")}
                </Link>
              ) : canOpenProfiles &&
                /hire|archived|prehire|terminated/.test(issue.code) ? (
                <Link to={`/hr/employees/${item.employee_profile_id}`}>
                  {t("payroll.employee.fix")}
                </Link>
              ) : (
                <Button size="small" type="link" onClick={() => onFix(issue)}>
                  {t("payroll.employee.fix")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p>
        {t("payroll.ui.salaryDaysValue", {
          days: item.salary_days,
          employed: item.employed_calendar_days,
        })}
      </p>
    </aside>
  );
}
