import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Grid,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { HistoryOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import { usePayrollEnums } from "../../hooks/usePayrollEnums";
import LoadingState from "../ui/LoadingState";
import MoneyText from "./MoneyText";
import StaleRevisionAlert from "./StaleRevisionAlert";
import PayrollHistoryDrawer from "./PayrollHistoryDrawer";
import { REASON_MAX_LENGTH } from "./ReasonModal";
import {
  ITEM_FIELD_MAP,
  MONEY_FIELDS,
  QUANTITY_FIELDS,
  SALARY_KEYS,
  buildItemChanges,
  itemToFormValues,
  needsSuspendedDecision,
  postedManualLine,
  type ItemFormValues,
} from "./itemEditForm";
import {
  getRunItem,
  listItemAdjustments,
  patchRunItem,
} from "../../services/api/payrollApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../services/api/payrollErrors";
import type {
  PayrollMoneyLine,
  PayrollRunItemDto,
  PayrollStatus,
  ProvisionLine,
  SalaryComponentLine,
  ValidationIssue,
  ZeroSalaryReason,
} from "../../services/api/payrollTypes";
import { isNonNegativeDecimal } from "../../utils/payrollMoney";

const { Text, Title } = Typography;

const ZERO_REASONS: ZeroSalaryReason[] = [
  "full_leave",
  "full_absence",
  "unpaid_leave",
  "not_joined",
  "suspended",
  "other",
];

const POSTED_LINE_TYPES = {
  bonus: "BONUS",
  incentive: "INCENTIVE",
  other_addition: "OTHER_ADDITION",
} as const;

const FIELD_LABEL_KEYS: Record<string, string> = {
  overtime_normal_hours: "payroll.ui.overtimeNormalHours",
  weekly_rest_work_days: "payroll.ui.weeklyRestWorkDays",
  official_holiday_work_days: "payroll.ui.officialHolidayWorkDays",
  bonus: "payroll.line.bonus",
  incentive: "payroll.line.incentive",
  other_addition: "payroll.line.other_addition",
  other_deduction: "payroll.line.other_deduction",
};

/** Read-only quantity (day/hour string) or a dash. */
const qty = (value: string | null | undefined) => (
  <span dir="ltr">{value ?? "—"}</span>
);

/**
 * G: per-employee drawer. Shows the item's lines and evidence read-only, and
 * (DRAFT only) a sparse edit form with a mandatory reason and the run revision
 * from the last read. A 409 stale_revision stops, reloads and lets HR retry.
 */
export default function ItemEditDrawer({
  runId,
  itemId,
  runStatus,
  open,
  onClose,
  onChanged,
  reportIssues = [],
}: {
  runId: number | string;
  itemId: number | null;
  runStatus: PayrollStatus;
  /** Validation-report issues for this item (blocking errors live only there). */
  reportIssues?: ValidationIssue[];
  open: boolean;
  onClose: () => void;
  /** Called after a save or a stale reload so the run page refreshes. */
  onChanged: () => void;
}) {
  const { t, direction } = useI18n();
  const { label } = usePayrollEnums();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<ItemFormValues & { reason: string }>();
  const [item, setItem] = useState<PayrollRunItemDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const editable = runStatus === "DRAFT";

  // The form takes the item as initialValues and is keyed by item id and run
  // revision, so it remounts with fresh values after a load, save or reload.
  const applyItem = useCallback((next: PayrollRunItemDto) => {
    setItem(next);
  }, []);

  const load = useCallback(async () => {
    if (itemId === null) return;
    setLoading(true);
    setLoadError(null);
    try {
      applyItem(await getRunItem(runId, itemId));
    } catch (err) {
      setLoadError(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.itemLoadFailed"),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [runId, itemId, applyItem, t]);

  useEffect(() => {
    if (open && itemId !== null) {
      setItem(null);
      setStaleMessage(null);
      setFormError(null);
      void load();
    }
  }, [open, itemId, load]);

  const loadAdjustments = useCallback(
    (page: number, pageSize: number) =>
      listItemAdjustments(runId, itemId ?? 0, { page, page_size: pageSize }),
    [runId, itemId],
  );

  const save = async () => {
    if (!item || itemId === null) return;
    let values: ItemFormValues & { reason: string };
    try {
      await form.validateFields();
      // Include fields that are not currently mounted (e.g. the zero-pay detail).
      values = {
        ...itemToFormValues(item),
        ...form.getFieldsValue(true),
      };
    } catch {
      return;
    }
    const changes = buildItemChanges(item, values);
    if (!changes) {
      message.info(t("payroll.ui.noChanges"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const updated = await patchRunItem(runId, itemId, {
        expected_revision: item.run_revision,
        changes,
        reason: values.reason.trim(),
      });
      setStaleMessage(null);
      applyItem(updated);
      message.success(t("payroll.ui.itemSaved"));
      onChanged();
    } catch (err) {
      const parsed = parsePayrollError(err, ITEM_FIELD_MAP);
      if (parsed.isStaleRevision) {
        setStaleMessage(
          parsed.formMessages[0] ??
            parsed.message ??
            t("payroll.ui.staleTitle"),
        );
        await load();
        onChanged();
        return;
      }
      if (parsed.fieldErrors.length) {
        form.setFields(
          parsed.fieldErrors as Parameters<typeof form.setFields>[0],
        );
      }
      if (parsed.formMessages.length || !parsed.fieldErrors.length) {
        setFormError(payrollErrorSummary(parsed, t("payroll.ui.saveFailed")));
      }
    } finally {
      setSaving(false);
    }
  };

  const decimalRule = {
    validator: (_: unknown, value?: string) =>
      !value || !value.trim() || isNonNegativeDecimal(value)
        ? Promise.resolve()
        : Promise.reject(new Error(t("payroll.ui.invalidAmount"))),
  };

  const lineLabel = (line: {
    type: string;
    label: string;
    label_key: string;
  }) => line.label || t(line.label_key) || line.type;

  const salaryColumns: ColumnsType<SalaryComponentLine> = [
    {
      title: t("payroll.ui.line"),
      key: "label",
      render: (_, line) => lineLabel(line),
    },
    {
      title: t("payroll.ui.amount"),
      key: "amount",
      align: "end",
      render: (_, line) => <MoneyText amount={line.amount} />,
    },
  ];

  const moneyLineColumns: ColumnsType<PayrollMoneyLine> = [
    {
      title: t("payroll.ui.line"),
      key: "label",
      render: (_, line) => (
        <Space size={4} wrap>
          {lineLabel(line)}
          {line.carried_in && (
            <Tag color="purple">{t("payroll.ui.carriedIn")}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: t("payroll.ui.quantity"),
      key: "quantity",
      render: (_, line) => qty(line.quantity),
    },
    {
      title: t("payroll.ui.requested"),
      key: "requested",
      align: "end",
      render: (_, line) => (
        <MoneyText amount={line.requested_amount ?? line.amount} />
      ),
    },
    {
      title: t("payroll.ui.collected"),
      key: "collected",
      align: "end",
      render: (_, line) => (
        <MoneyText amount={line.collected_amount ?? line.amount} />
      ),
    },
    {
      title: t("payroll.ui.uncollected"),
      key: "uncollected",
      align: "end",
      render: (_, line) =>
        line.uncollected_amount && line.uncollected_amount !== "0.00" ? (
          <MoneyText amount={line.uncollected_amount} />
        ) : (
          "—"
        ),
    },
  ];

  const provisionColumns: ColumnsType<ProvisionLine> = [
    {
      title: t("payroll.ui.line"),
      key: "label",
      render: (_, line) => lineLabel(line),
    },
    {
      title: t("payroll.ui.amount"),
      key: "amount",
      align: "end",
      render: (_, line) => <MoneyText amount={line.amount} />,
    },
  ];

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

  /**
   * Read-only evidence beside an entered amount: the posted (rounded) line and,
   * for other deduction, what was actually collected.
   */
  const postedEvidence = (field: (typeof MONEY_FIELDS)[number]) => {
    if (!item) return undefined;
    const line =
      field === "other_deduction"
        ? postedManualLine(item.deductions, "OTHER_DEDUCTION")
        : postedManualLine(item.additions, POSTED_LINE_TYPES[field]);
    if (!line) return undefined;
    const collected =
      field === "other_deduction"
        ? (line.collected_amount ?? line.amount)
        : line.amount;
    return (
      <span>
        {t("payroll.ui.postedAmount")}:{" "}
        <MoneyText amount={collected} size={11} />
      </span>
    );
  };

  const renderBody = () => {
    if (loading && !item) return <LoadingState />;
    if (loadError && !item)
      return <Alert type="error" showIcon message={loadError} />;
    if (!item) return null;
    const absence = item.absence;
    const overtime = item.overtime;
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        {staleMessage && (
          <StaleRevisionAlert
            message={staleMessage}
            onClose={() => setStaleMessage(null)}
          />
        )}

        <Descriptions
          size="small"
          bordered
          column={screens.md ? 2 : 1}
          items={[
            {
              key: "gross",
              label: t("payroll.field.gross_salary"),
              children: <MoneyText amount={item.gross_salary} />,
            },
            {
              key: "additions",
              label: t("payroll.field.total_additions"),
              children: <MoneyText amount={item.total_additions} />,
            },
            {
              key: "deductions",
              label: t("payroll.field.total_deductions"),
              children: <MoneyText amount={item.total_deductions} />,
            },
            {
              key: "net",
              label: t("payroll.field.net_salary"),
              children: <MoneyText amount={item.net_salary} strong />,
            },
            {
              key: "cost",
              label: t("payroll.field.total_company_cost"),
              children: (
                <Space size={4} wrap>
                  <MoneyText amount={item.total_company_cost} />
                  {item.cost_incomplete && (
                    <Tag color="orange">
                      {t("payroll.field.cost_incomplete")}
                      {costReasons(item).length
                        ? `: ${costReasons(item).join(", ")}`
                        : ""}
                    </Tag>
                  )}
                </Space>
              ),
            },
            {
              key: "days",
              label: t("payroll.ui.salaryDays"),
              children: t("payroll.ui.salaryDaysValue", {
                days: item.salary_days,
                employed: item.employed_calendar_days,
              }),
            },
          ]}
        />

        {reportIssues.some((issue) => issue.severity === "error") && (
          <Alert
            type="error"
            showIcon
            message={t("payroll.ui.itemBlockingErrors")}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {reportIssues
                  .filter((issue) => issue.severity === "error")
                  .map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>
                      {issue.message || t(issue.message_key)}
                    </li>
                  ))}
              </ul>
            }
          />
        )}
        {item.warnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t("payroll.ui.rowWarnings", {
              count: item.warnings.length,
            })}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {item.warnings.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.message || t(issue.message_key)}
                  </li>
                ))}
              </ul>
            }
          />
        )}
        {item.assumptions.length > 0 && (
          <Alert
            type="info"
            showIcon
            message={t("payroll.ui.assumptionsTitle")}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {item.assumptions.map((entry) => (
                  <li key={entry.key}>{entry.message || t(entry.key)}</li>
                ))}
              </ul>
            }
          />
        )}

        <Title level={5} style={{ margin: 0 }}>
          {t("payroll.ui.absenceTitle")}
        </Title>
        <Descriptions
          size="small"
          column={screens.md ? 2 : 1}
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
              children: absence.manual_confirmation_required ? (
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

        <Title level={5} style={{ margin: 0 }}>
          {t("payroll.ui.overtimeTitle")}
        </Title>
        <Descriptions
          size="small"
          column={screens.md ? 2 : 1}
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
          {t("payroll.ui.groupSalary")}
        </Title>
        <Table
          size="small"
          rowKey="type"
          pagination={false}
          columns={salaryColumns}
          dataSource={item.salary_components}
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
        <Title level={5} style={{ margin: 0 }}>
          {t("payroll.pdf.provisions")}
        </Title>
        <Table
          size="small"
          rowKey="type"
          pagination={false}
          columns={provisionColumns}
          dataSource={item.provisions}
        />

        <Divider style={{ margin: "4px 0" }} />
        {!editable ? (
          <Alert type="info" showIcon message={t("payroll.ui.itemReadOnly")} />
        ) : (
          <Form
            form={form}
            key={`${item.id}-${item.run_revision}`}
            layout="vertical"
            requiredMark
            initialValues={{ ...itemToFormValues(item), reason: "" }}
          >
            <Title level={5}>{t("payroll.ui.editTitle")}</Title>
            {formError && (
              <Alert
                type="error"
                showIcon
                message={formError}
                style={{ marginBottom: 12 }}
              />
            )}
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="absence_days_override"
                  label={t("payroll.ui.absenceOverride")}
                  extra={t("payroll.ui.absenceOverrideHelp")}
                  rules={[decimalRule]}
                >
                  <Input inputMode="decimal" dir="ltr" allowClear />
                </Form.Item>
              </Col>
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
              {MONEY_FIELDS.map((field) => (
                <Col xs={24} sm={12} key={field}>
                  <Form.Item
                    name={field}
                    label={t(FIELD_LABEL_KEYS[field])}
                    rules={[decimalRule]}
                    extra={postedEvidence(field)}
                  >
                    <Input inputMode="decimal" dir="ltr" />
                  </Form.Item>
                </Col>
              ))}
            </Row>
            {item.monthly_salary_components && (
              <>
                <Divider style={{ margin: "4px 0 12px" }} />
                <Space wrap style={{ marginBottom: 8 }}>
                  <Text strong>{t("payroll.ui.monthlySalaryTitle")}</Text>
                  {item.salary_adjusted && (
                    <Tag color="purple">{t("payroll.ui.salaryAdjusted")}</Tag>
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
            <Form.Item
              name="override_overtime_eligibility"
              label={t("payroll.ui.overtimeOverride")}
              extra={t("payroll.ui.overtimeOverrideHelp")}
              valuePropName="checked"
            >
              <Switch aria-label={t("payroll.ui.overtimeOverride")} />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="zero_salary_reason"
                  label={t("payroll.ui.zeroSalaryReason")}
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
            <Form.Item
              name="reason"
              label={t("payroll.ui.reasonLabel")}
              extra={t("payroll.ui.reasonHelp")}
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: t("payroll.ui.reasonRequired"),
                },
                {
                  max: REASON_MAX_LENGTH,
                  message: t("payroll.ui.reasonTooLong"),
                },
              ]}
            >
              <Input.TextArea
                rows={3}
                maxLength={REASON_MAX_LENGTH}
                showCount
                aria-label={t("payroll.ui.reasonLabel")}
              />
            </Form.Item>
            <Space>
              <Button
                type="primary"
                loading={saving}
                onClick={() => void save()}
              >
                {t("payroll.ui.saveItem")}
              </Button>
              <Button disabled={saving} onClick={() => form.resetFields()}>
                {t("payroll.ui.discardChanges")}
              </Button>
            </Space>
          </Form>
        )}
      </Space>
    );
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        placement={direction === "rtl" ? "left" : "right"}
        size={760}
        styles={{ wrapper: { maxWidth: "100vw" } }}
        destroyOnHidden
        title={
          item ? (
            <Space orientation="vertical" size={0}>
              <Text strong>{item.employee_name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
                {item.employee_id}
              </Text>
            </Space>
          ) : (
            t("payroll.ui.employee")
          )
        }
        extra={
          <Button
            icon={<HistoryOutlined />}
            disabled={!item}
            onClick={() => setHistoryOpen(true)}
          >
            {t("payroll.ui.adjustmentHistory")}
          </Button>
        }
      >
        {renderBody()}
      </Drawer>
      <PayrollHistoryDrawer
        open={historyOpen}
        title={t("payroll.ui.adjustmentHistory")}
        onClose={() => setHistoryOpen(false)}
        load={loadAdjustments}
      />
    </>
  );
}
