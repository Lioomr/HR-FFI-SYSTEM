import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Collapse,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import { usePayrollEnums } from "../../hooks/usePayrollEnums";
import EmptyState from "../ui/EmptyState";
import type {
  PayrollRunItemDto,
  ValidationIssue,
  ValidationReport,
} from "../../services/api/payrollTypes";
import {
  ATTENDANCE_SOURCE_CODE,
  groupValidationIssues,
  issueFixTarget,
  isManualInformation,
  validationPresentation,
  type ValidationGroup,
} from "./validationGroups";
import MoneyText from "./MoneyText";
import { useCanManagePayrollHrData } from "./payrollFormat";

const { Text } = Typography;

function ParameterValue({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((entry, i) => (
          <li key={i}>
            <ParameterValue value={entry} />
          </li>
        ))}
      </ul>
    );
  if (value && typeof value === "object")
    return (
      <ul>
        {Object.values(value).map((entry, i) => (
          <li key={i}>
            <ParameterValue value={entry} />
          </li>
        ))}
      </ul>
    );
  return <bdi dir="ltr">{value == null ? "—" : String(value)}</bdi>;
}
export function IssueDetails({
  issue,
  informational = false,
}: {
  issue: ValidationIssue;
  informational?: boolean;
}) {
  const { t } = useI18n();
  const dates = issue.params?.uncovered_dates;
  const amountFields = [
    "requested_amount",
    "collected_amount",
    "uncollected_amount",
  ] as const;
  const known = new Set<string>([
    "uncovered_dates",
    "manual_confirmation_required",
  ]);
  for (const field of amountFields)
    if (
      typeof issue.params?.[field] === "string" ||
      issue.params?.[field] === null
    )
      known.add(field);
  const unknown = Object.values(
    Object.fromEntries(
      Object.entries(issue.params ?? {}).filter(([key]) => !known.has(key)),
    ),
  );
  return (
    <Space orientation="vertical" size={4}>
      {Array.isArray(dates) && (
        <>
          <Text type="secondary">
            {t("payroll.ui.attendanceNotCovered", { count: dates.length })}
          </Text>
          {dates.length > 0 && (
            <details>
              <summary>{t("payroll.ux3.dates")}</summary>
              <ul>
                {dates.map((date, i) => (
                  <li key={i}>
                    <bdi dir="ltr">{String(date)}</bdi>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {!informational &&
        issue.params?.manual_confirmation_required === true && (
          <Text>{t("payroll.ui.confirmationRequired")}</Text>
        )}
      {amountFields
        .filter((field) => known.has(field))
        .map((field) => (
          <Text key={field}>
            {t(
              field === "requested_amount"
                ? "payroll.ui.requested"
                : field === "collected_amount"
                  ? "payroll.ui.collected"
                  : "payroll.ui.uncollected",
            )}
            : <MoneyText amount={issue.params[field] as string | null} />
          </Text>
        ))}
      {unknown.length > 0 && (
        <details>
          <summary>{t("payroll.ux.details")}</summary>
          <ParameterValue value={unknown} />
        </details>
      )}
    </Space>
  );
}
export default function ValidationPanel({
  report,
  onOpenItem,
  index = null,
  onQuickNone,
  legacy = false,
  finalized = report.finalize_state === "finalized",
}: {
  report: ValidationReport;
  legacy?: boolean;
  finalized?: boolean;
  onOpenItem: (itemId: number, target?: string) => void;
  index?: PayrollRunItemDto[] | null;
  onQuickNone?: (
    employee: NonNullable<ValidationIssue["employee"]>,
  ) => React.ReactNode;
}) {
  const { t } = useI18n();
  const { label } = usePayrollEnums();
  const profiles = useCanManagePayrollHrData();
  const view = useMemo(
    () => validationPresentation(report, index),
    [report, index],
  );
  const groups = useMemo(
    () => groupValidationIssues(report, view.items),
    [report, view.items],
  );
  const title = (group: ValidationGroup) =>
    group.severity === "info" &&
    group.issues.some((issue) => isManualInformation(issue, view.items))
      ? t("payroll.ux3.confirmedGroup", { count: group.employeeCount })
      : group.severity !== "info" && group.code === ATTENDANCE_SOURCE_CODE
        ? t(
            group.manualConfirmation
              ? "payroll.ui.attendanceManualGroup"
              : "payroll.ui.attendanceSourceGroup",
            { count: group.employeeCount },
          )
        : label(
            "validation_codes",
            group.code,
            `payroll.validation.${group.code}`,
          );
  const action = (issue: ValidationIssue) => {
    const target = issueFixTarget(report.run_id, issue, profiles);
    if (!target) return null;
    return target.startsWith(`/hr/payroll/${report.run_id}/employees/`) ? (
      <Button
        type="link"
        onClick={() => onOpenItem(issue.employee!.item_id!, target)}
      >
        {t("payroll.employee.fix")}
      </Button>
    ) : (
      <Link to={target}>{t("payroll.employee.fix")}</Link>
    );
  };
  const columns: ColumnsType<ValidationIssue> = [
    {
      title: t("payroll.ui.employee"),
      key: "employee",
      width: 230,
      render: (_, issue) => {
        const employee = issue.employee;
        if (!employee)
          return <Text type="secondary">{t("payroll.ui.runLevel")}</Text>;
        const name = employee.employee_name || employee.employee_id;
        return (
          <Space orientation="vertical" size={0}>
            {employee.item_id !== null ? (
              <Button
                type="link"
                style={{ padding: 0, height: "auto" }}
                onClick={() => onOpenItem(employee.item_id!)}
              >
                {name}
              </Button>
            ) : profiles ? (
              <Link to={`/hr/employees/${employee.employee_profile_id}`}>
                {name}
              </Link>
            ) : (
              <Text>{name}</Text>
            )}
            <Text type="secondary">
              <bdi dir="ltr">{employee.employee_id}</bdi>
              {employee.item_id === null
                ? ` · ${t("payroll.ui.excludedEmployee")}`
                : ""}
            </Text>
          </Space>
        );
      },
    },
    {
      title: t("payroll.ui.issue"),
      key: "message",
      render: (_, issue) => (
        <Space orientation="vertical" size={4}>
          <Text>{issue.message}</Text>
          <IssueDetails
            issue={issue}
            informational={
              issue.severity === "info" ||
              isManualInformation(issue, view.items)
            }
          />
        </Space>
      ),
    },
    {
      title: t("payroll.ui.actions"),
      key: "actions",
      width: 210,
      render: (_, issue) => (
        <Space wrap>
          {action(issue)}
          {/accommodation/.test(issue.code) &&
            issue.employee &&
            onQuickNone?.(issue.employee)}
        </Space>
      ),
    },
  ];
  return (
    <div className="payroll-validation">
      <div className="payroll-validation-summary">
        <div>
          <Text type="secondary">{t("payroll.ux3.blocking")}</Text>
          <strong>{view.blocking}</strong>
        </div>
        <div>
          <Text type="secondary">{t("payroll.ux3.actionableWarnings")}</Text>
          <strong>{view.warnings}</strong>
        </div>
        {(!legacy || finalized) && (
          <div>
            <Text type="secondary">{t("payroll.ux3.finalizeState")}</Text>
            <Text
              strong={!finalized}
              type={finalized ? "secondary" : undefined}
            >
              {t(
                finalized
                  ? "payroll.finalize_state.finalized"
                  : report.can_finalize
                    ? "payroll.ui.canFinalize"
                    : "payroll.ui.cannotFinalize",
              )}
            </Text>
          </div>
        )}
        <Tag>
          {t(
            report.reconciliation.matches
              ? "payroll.ui.reconciled"
              : "payroll.ui.notReconciled",
          )}
        </Tag>
        <Tooltip title={t("payroll.ux3.apiCounts", report.counts)}>
          <Button
            type="link"
            aria-label={t("payroll.ux3.apiCounts", report.counts)}
          >
            {t("payroll.ux3.showApiCounts")}
          </Button>
        </Tooltip>
      </div>
      {!legacy && !finalized && (
        <div className="payroll-confirmation-progress">
          <Text>
            {view.progress
              ? t("payroll.ux3.progress", { confirmed: "{C}", total: "{M}" })
                  .split(/(\{C\}|\{M\})/)
                  .map((part, i) =>
                    part === "{C}" || part === "{M}" ? (
                      <bdi dir="ltr" key={i}>
                        {part === "{C}"
                          ? view.progress!.confirmed
                          : view.progress!.total}
                      </bdi>
                    ) : (
                      part
                    ),
                  )
              : t("payroll.ux.unavailable")}
          </Text>
          {view.progress ? (
            <Progress
              percent={
                view.progress && view.progress.total
                  ? (view.progress.confirmed / view.progress.total) * 100
                  : 0
              }
              showInfo={false}
              aria-label={
                view.progress
                  ? t("payroll.ux3.progress", view.progress)
                  : t("payroll.ux.unavailable")
              }
            />
          ) : (
            <div className="payroll-progress-placeholder" aria-hidden="true" />
          )}
          {!view.items && (
            <Text type="secondary">{t("payroll.ux.indexUnavailable")}</Text>
          )}
        </div>
      )}
      {groups.length === 0 ? (
        <EmptyState
          title={t("payroll.ui.noIssuesTitle")}
          description={t("payroll.ui.noIssues")}
        />
      ) : (
        <Collapse
          items={groups.map((group) => ({
            key: group.key,
            label: (
              <Space wrap>
                <Tag>
                  {group.severity === "info" ? (
                    <>
                      <InfoCircleOutlined /> {t("payroll.ux3.informational")}
                    </>
                  ) : (
                    label(
                      "validation_severity",
                      group.severity,
                      `payroll.validation_severity.${group.severity}`,
                    )
                  )}
                </Tag>
                <Text strong>{title(group)}</Text>
                <bdi dir="ltr">{group.issues.length}</bdi>
              </Space>
            ),
            children: (
              <>
                {group.severity === "info" &&
                  group.issues.some((issue) =>
                    isManualInformation(issue, view.items),
                  ) && (
                    <Text type="secondary">
                      {t("payroll.ux3.confirmedNoCoverage")}
                    </Text>
                  )}
                <Table
                  size="small"
                  rowKey={(issue, i) =>
                    `${issue.code}-${issue.employee?.employee_profile_id ?? "run"}-${i}`
                  }
                  columns={
                    group.severity === "info"
                      ? columns.filter((column) => column.key !== "actions")
                      : columns
                  }
                  dataSource={group.issues}
                  pagination={
                    group.issues.length > 10
                      ? { pageSize: 10, showSizeChanger: false }
                      : false
                  }
                  scroll={{ x: 640 }}
                />
              </>
            ),
          }))}
        />
      )}
    </div>
  );
}
