import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import {
  Alert,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useI18n } from "../../i18n/useI18n";
import { usePayrollEnums } from "../../hooks/usePayrollEnums";
import MoneyText from "./MoneyText";
import {
  MONEY_FIELDS,
  QUANTITY_FIELDS,
  SALARY_KEYS,
  needsSuspendedDecision,
} from "./itemEditForm";
import {
  FIELD_LABEL_KEYS,
  ZERO_REASONS,
  qty,
  renderPostedEvidence,
} from "./payrollItemEditorShared";
import { formatDateTime } from "../../utils/dateTime";
import { moneyToInput } from "../../utils/payrollMoney";
import type {
  PayrollHistoryEntry,
  PayrollMoneyLine,
  PayrollRunItemDto,
  ProvisionLine,
  SalaryComponentLine,
  ValidationIssue,
} from "../../services/api/payrollTypes";

const { Text, Title } = Typography;

type DecimalRule = {
  validator: (_: unknown, value?: string) => Promise<void>;
};

const makeEdits = (editable: boolean) => (content: ReactNode) =>
  editable ? content : null;

export function OverviewTab({
  item,
  editable,
  reportIssues,
  suspendedDecision,
  zeroReason,
  salaryColumns,
  decimalRule,
}: {
  item: PayrollRunItemDto;
  editable: boolean;
  reportIssues: ValidationIssue[];
  suspendedDecision: string | null | undefined;
  zeroReason: string | null | undefined;
  salaryColumns: ColumnsType<SalaryComponentLine>;
  decimalRule: DecimalRule;
}) {
  const { t } = useI18n();
  const { label } = usePayrollEnums();
  const edits = makeEdits(editable);
  return (
    <>
      {" "}
      <Title level={5} style={{ margin: 0 }}>
        {t("payroll.ui.groupSalary")}
      </Title>
      <Table
        size="small"
        rowKey="type"
        pagination={false}
        columns={salaryColumns}
        dataSource={item.salary_components}
      />
      {edits(
        <>
          {" "}
          {item.monthly_salary_components && (
            <>
              <Divider style={{ margin: "4px 0 12px" }} />
              <Space wrap style={{ marginBottom: 8 }}>
                <Text strong>{t("payroll.ui.monthlySalaryTitle")}</Text>
                {item.salary_adjusted && (
                  <Tag>{t("payroll.ui.salaryAdjusted")}</Tag>
                )}
              </Space>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">
                  {t("payroll.ui.monthlySalaryHelp")}
                </Text>
              </div>
              <Row gutter={12}>
                {SALARY_KEYS.map((key) => (
                  <Col xs={24} sm={12} key={key}>
                    <Form.Item
                      name={["salary", key]}
                      label={t(`payroll.line.${key}`)}
                      rules={[decimalRule]}
                    >
                      <Input inputMode="decimal" dir="ltr" />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </>
          )}
        </>,
      )}
      {edits(
        <>
          {" "}
          {(item.net_salary === "0.00" ||
            item.net_salary === "0" ||
            (needsSuspendedDecision(item, reportIssues) &&
              (suspendedDecision ?? item.suspended_pay_decision) ===
                "ZERO_PAY") ||
            !!(zeroReason ?? item.zero_salary_reason)) && (
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="zero_salary_reason"
                  label={t("payroll.ui.zeroSalaryReason")}
                  extra={t("payroll.employee.zeroReasonHelp")}
                >
                  <Select
                    allowClear
                    aria-label={t("payroll.ui.zeroSalaryReason")}
                    options={ZERO_REASONS.map((value) => ({
                      value,
                      label: label(
                        "zero_salary_reason",
                        value,
                        `payroll.zero_salary_reason.${value}`,
                      ),
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  noStyle
                  shouldUpdate={(a, b) =>
                    a.zero_salary_reason !== b.zero_salary_reason
                  }
                >
                  {({ getFieldValue }) =>
                    getFieldValue("zero_salary_reason") === "other" ? (
                      <Form.Item
                        name="zero_salary_reason_detail"
                        label={t("payroll.ui.zeroSalaryDetail")}
                        rules={[
                          {
                            required: true,
                            whitespace: true,
                            message: t("payroll.ui.zeroSalaryDetailRequired"),
                          },
                        ]}
                      >
                        <Input />
                      </Form.Item>
                    ) : null
                  }
                </Form.Item>
              </Col>
            </Row>
          )}
          {needsSuspendedDecision(item, reportIssues) && (
            <Form.Item
              name="suspended_pay_decision"
              label={t("payroll.ui.suspendedPayDecision")}
            >
              <Select
                aria-label={t("payroll.ui.suspendedPayDecision")}
                options={(["FULL_PAY", "ZERO_PAY"] as const).map((value) => ({
                  value,
                  label: label(
                    "suspended_pay_decision",
                    value,
                    `payroll.suspended_pay_decision.${value.toLowerCase()}`,
                  ),
                }))}
              />
            </Form.Item>
          )}
        </>,
      )}
      <Collapse
        items={[
          {
            key: "notes",
            label: t("payroll.employee.notes"),
            children: (
              <ul>
                {item.assumptions.map((entry) => (
                  <li key={entry.key}>{entry.message || t(entry.key)}</li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </>
  );
}

export function AbsenceTab({
  item,
  editable,
  wide,
  alreadyConfirmed,
  confirmation,
  decimalRule,
}: {
  item: PayrollRunItemDto;
  editable: boolean;
  wide: boolean;
  alreadyConfirmed: boolean;
  confirmation: PayrollHistoryEntry | undefined;
  decimalRule: DecimalRule;
}) {
  const { t } = useI18n();
  const edits = makeEdits(editable);
  const absence = item.absence;
  return (
    <>
      {" "}
      <Title level={5} style={{ margin: 0 }}>
        {t("payroll.ui.absenceTitle")}
      </Title>
      <Descriptions
        size="small"
        column={wide ? 2 : 1}
        items={[
          {
            key: "att",
            label: t("payroll.ui.observedAbsentDays"),
            children: qty(absence.attendance_days),
          },
          {
            key: "unpaid",
            label: t("payroll.ui.unpaidLeaveDays"),
            children: qty(absence.unpaid_leave_days),
          },
          {
            key: "paid",
            label: t("payroll.ui.paidLeaveDays"),
            children: qty(absence.paid_leave_days),
          },
          {
            key: "penalty",
            label: t("payroll.ui.penaltyWithheldDays"),
            children: qty(absence.penalty_withheld_days),
          },
          {
            key: "override",
            label: t("payroll.ui.overrideDays"),
            children: qty(absence.override_days),
          },
          {
            key: "effective",
            label: t("payroll.ui.effectiveDays"),
            children: qty(absence.effective_days),
          },
          {
            key: "source",
            label: t("payroll.ui.attendanceSource"),
            children: absence.source_available ? (
              <Tag color="green">{t("payroll.ui.attendanceCovered")}</Tag>
            ) : (
              <Space orientation="vertical" size={2}>
                <Tag color="orange">
                  {t("payroll.ui.attendanceNotCovered", {
                    count: absence.uncovered_dates.length,
                  })}
                </Tag>
                {absence.mapping_start_date && (
                  <Text type="secondary">
                    {t("payroll.ui.mappingStart", {
                      date: absence.mapping_start_date,
                    })}
                  </Text>
                )}
              </Space>
            ),
          },
          {
            key: "manual",
            label: t("payroll.ui.manualConfirmation"),
            children:
              !item.executive_exempt && absence.manual_confirmation_required ? (
                absence.manual_confirmed ? (
                  <Tag color="green">{t("payroll.ui.confirmed")}</Tag>
                ) : (
                  <Tag color="red">{t("payroll.ui.confirmationRequired")}</Tag>
                )
              ) : (
                t("payroll.ui.notRequired")
              ),
          },
        ]}
      />
      <p>
        {t("payroll.ui.attendanceNotCovered", {
          count: absence.uncovered_dates.length,
        })}
        : {absence.uncovered_dates.join(", ") || t("payroll.ui.notRequired")}
      </p>
      <p>
        {t("payroll.line.absence")}:{" "}
        <MoneyText amount={item.absence_deduction} />
      </p>
      {edits(
        <Row gutter={16}>
          {" "}
          <Col xs={24} sm={12}>
            <Form.Item
              name="absence_days_override"
              label={t("payroll.ui.absenceOverride")}
              extra={t("payroll.ui.absenceOverrideHelp")}
              help={
                alreadyConfirmed ? (
                  <Text type="secondary">
                    {t("payroll.employee.alreadyConfirmed", {
                      days: moneyToInput(
                        item.manual_inputs.absence_days_override,
                      ),
                    })}
                    {confirmation && (
                      <>
                        {" "}
                        ·{" "}
                        {t("payroll.employee.confirmedBy", {
                          name:
                            confirmation.actor?.name ?? t("payroll.ui.unknown"),
                          date: formatDateTime(confirmation.created_at),
                        })}
                      </>
                    )}
                  </Text>
                ) : undefined
              }
              rules={[decimalRule]}
            >
              <Input inputMode="decimal" dir="ltr" allowClear />
            </Form.Item>
          </Col>
        </Row>,
      )}
    </>
  );
}

export function AdditionsTab({
  item,
  editable,
  wide,
  moneyLineColumns,
  decimalRule,
}: {
  item: PayrollRunItemDto;
  editable: boolean;
  wide: boolean;
  moneyLineColumns: ColumnsType<PayrollMoneyLine>;
  decimalRule: DecimalRule;
}) {
  const { t } = useI18n();
  const edits = makeEdits(editable);
  const overtime = item.overtime;
  return (
    <>
      {" "}
      <Title level={5} style={{ margin: 0 }}>
        {t("payroll.ui.overtimeTitle")}
      </Title>
      <Descriptions
        size="small"
        column={wide ? 2 : 1}
        items={[
          {
            key: "entered",
            label: t("payroll.ui.enteredNormalHours"),
            children: qty(overtime.normal_hours),
          },
          {
            key: "limit",
            label: t("payroll.ui.allowedOvertime"),
            children:
              overtime.allowed_overtime === null
                ? t("payroll.ui.noLimitSet")
                : qty(String(overtime.allowed_overtime)),
          },
          {
            key: "payable",
            label: t("payroll.ui.payableNormalHours"),
            children: qty(overtime.payable_normal_hours),
          },
          {
            key: "over",
            label: t("payroll.ui.overAllowedHours"),
            children: qty(overtime.over_allowed_hours),
          },
          {
            key: "unpaid",
            label: t("payroll.ui.unpaidNormalHours"),
            children: qty(overtime.unpaid_normal_hours),
          },
          {
            key: "override",
            label: t("payroll.ui.overtimeOverride"),
            children: overtime.override_overtime_eligibility
              ? t("payroll.ui.yes")
              : t("payroll.ui.no"),
          },
        ]}
      />
      <Title level={5} style={{ margin: 0 }}>
        {t("payroll.pdf.additions")}
      </Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        columns={moneyLineColumns}
        dataSource={item.additions}
        locale={{ emptyText: t("payroll.ui.noLines") }}
        scroll={{ x: 520 }}
      />
      {edits(
        <>
          <Row gutter={16}>
            {" "}
            {QUANTITY_FIELDS.map((field) => (
              <Col xs={24} sm={12} key={field}>
                <Form.Item
                  name={field}
                  label={t(FIELD_LABEL_KEYS[field])}
                  rules={[decimalRule]}
                >
                  <Input inputMode="decimal" dir="ltr" />
                </Form.Item>
              </Col>
            ))}
            {MONEY_FIELDS.filter((field) => field !== "other_deduction").map(
              (field) => (
                <Col xs={24} sm={12} key={field}>
                  <Form.Item
                    name={field}
                    label={t(FIELD_LABEL_KEYS[field])}
                    rules={[decimalRule]}
                    extra={renderPostedEvidence(item, field, t)}
                  >
                    <Input inputMode="decimal" dir="ltr" />
                  </Form.Item>
                </Col>
              ),
            )}
          </Row>{" "}
          <Form.Item
            name="override_overtime_eligibility"
            label={t("payroll.ui.overtimeOverride")}
            extra={t("payroll.ui.overtimeOverrideHelp")}
            valuePropName="checked"
          >
            <Switch aria-label={t("payroll.ui.overtimeOverride")} />
          </Form.Item>
        </>,
      )}
    </>
  );
}

export function DeductionsTab({
  item,
  editable,
  moneyLineColumns,
  decimalRule,
}: {
  item: PayrollRunItemDto;
  editable: boolean;
  moneyLineColumns: ColumnsType<PayrollMoneyLine>;
  decimalRule: DecimalRule;
}) {
  const { t } = useI18n();
  const edits = makeEdits(editable);
  return (
    <>
      {" "}
      <Title level={5} style={{ margin: 0 }}>
        {t("payroll.pdf.deductions")}
      </Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        columns={moneyLineColumns}
        dataSource={item.deductions}
        locale={{ emptyText: t("payroll.ui.noLines") }}
        scroll={{ x: 520 }}
      />
      {item.carry_forward.by_category.some(
        (entry) => entry.manual_reentry_required,
      ) && (
        <Alert
          type="warning"
          showIcon
          message={t("payroll.ui.manualReentryRequired")}
        />
      )}
      <Descriptions
        size="small"
        column={1}
        items={item.carry_forward.by_category.map((entry) => ({
          key: entry.type,
          label: entry.type,
          children: entry.manual_reentry_required
            ? t("payroll.ui.manualReentryRequired")
            : t("payroll.ui.notRequired"),
        }))}
      />
      {edits(
        <Row gutter={16}>
          {" "}
          {MONEY_FIELDS.filter((field) => field === "other_deduction").map(
            (field) => (
              <Col xs={24} sm={12} key={field}>
                <Form.Item
                  name={field}
                  label={t(FIELD_LABEL_KEYS[field])}
                  rules={[decimalRule]}
                  extra={renderPostedEvidence(item, field, t)}
                >
                  <Input inputMode="decimal" dir="ltr" />
                </Form.Item>
              </Col>
            ),
          )}
        </Row>,
      )}
    </>
  );
}

export function ProvisionsTab({
  item,
  provisionColumns,
}: {
  item: PayrollRunItemDto;
  provisionColumns: ColumnsType<ProvisionLine>;
}) {
  const { t } = useI18n();
  return (
    <>
      {" "}
      <Title level={5} style={{ margin: 0 }}>
        {t("payroll.pdf.provisions")}
      </Title>
      <Link
        to={`/hr/payroll/accommodation?employee_profile_id=${item.employee_profile_id}`}
      >
        {t("payroll.ui.assignmentsTitle")}
      </Link>
      <Table
        size="small"
        rowKey="type"
        pagination={false}
        columns={provisionColumns}
        dataSource={item.provisions}
      />
    </>
  );
}
