import ExecutiveExemptMarker from "./ExecutiveExemptMarker";
import { useCallback, useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Collapse,
  Tabs,
  Button,
  Col,
  Descriptions,
  Divider,
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
import { useI18n } from "../../i18n/useI18n";
import { isManualInformation } from "./validationGroups";
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
import {
  isNonNegativeDecimal,
  moneyToInput,
  toQuantityString,
} from "../../utils/payrollMoney";
import { formatDateTime } from "../../utils/dateTime";
import type { PayrollHistoryEntry } from "../../services/api/payrollTypes";
import { useCanManagePayrollHrData } from "./payrollFormat";

const { Text, Title } = Typography;
const SOURCE_LABEL_KEYS = {
  employee_salary: "payroll.ui.groupSalary",
  attendance_absence: "payroll.line.absence",
  unpaid_leave: "payroll.ui.unpaidLeaveDays",
  manual_adjustment: "payroll.adjustment.manual_adjustment",
  loan: "payroll.line.loan",
  attendance_penalty: "payroll.line.attendance_penalty",
  penalty: "payroll.ui.penalties",
  carry_forward: "payroll.ui.carriedIn",
  company_settings: "payroll.ui.settingsTitle",
  rent_allocation: "payroll.line.accommodation_cost",
  legacy: "payroll.ui.legacyRun",
};

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

function changeSize(changes: object | null) {
  return changes
    ? Object.values(changes).reduce<number>(
        (count, value) =>
          count +
          (value && typeof value === "object" ? Object.keys(value).length : 1),
        0,
      )
    : 0;
}

/**
 * Full-page employee editor, reusing the sparse form contract and evidence tables. Shows the item's lines and evidence read-only, and
 * (DRAFT only) a sparse edit form with a mandatory reason and the run revision
 * from the last read. A 409 stale_revision stops, reloads and lets HR retry.
 */
export default function PayrollItemEditor({
  runId,
  itemId,
  runStatus,
  open,
  onChanged,
  reportIssues = [],
  issuesAvailable = true,
  onDirtyChange,
  onItemLoaded,
  initialTab,
  initialField,
}: {
  initialTab?: string;
  initialField?: string;
  issuesAvailable?: boolean;
  onDirtyChange?: (dirty: boolean, saving: boolean) => void;
  onItemLoaded?: (item: PayrollRunItemDto) => void;
  runId: number | string;
  itemId: number | null;
  runStatus: PayrollStatus;
  /** Validation-report issues for this item (blocking errors live only there). */
  reportIssues?: ValidationIssue[];
  open: boolean;
  /** Called after a save or a stale reload so the run page refreshes. */
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const canOpenProfiles = useCanManagePayrollHrData();
  const { label } = usePayrollEnums();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<ItemFormValues & { reason: string }>();
  const absenceValue = Form.useWatch("absence_days_override", form);
  const zeroReason = Form.useWatch("zero_salary_reason", form);
  const suspendedDecision = Form.useWatch("suspended_pay_decision", form);
  const [item, setItem] = useState<PayrollRunItemDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState("overview");
  const [changeCount, setChangeCount] = useState(0);
  const [noChangeFeedback, setNoChangeFeedback] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmation, setConfirmation] = useState<PayrollHistoryEntry>();
  const saveLock = useRef(false);
  const draftCount = useRef(0);
  const loadedIdentity = useRef("");
  const generation = useRef(0);
  const revisionRef = useRef<number | undefined>(undefined);
  revisionRef.current = item?.run_revision;
  draftCount.current = changeCount;
  useEffect(() => {
    if (
      initialTab &&
      [
        "overview",
        "absence",
        "additions",
        "deductions",
        "provisions",
        "history",
      ].includes(initialTab)
    )
      setActiveTab(initialTab);
  }, [initialTab, itemId]);
  useEffect(() => {
    if (!item || !initialField || (initialTab && activeTab !== initialTab))
      return;
    const frame = requestAnimationFrame(() =>
      form.scrollToField(initialField, { focus: true, block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [item, initialField, initialTab, activeTab, form]);
  useEffect(() => {
    onDirtyChange?.(changeCount > 0, saving);
  }, [changeCount, saving, onDirtyChange]);
  const editable = runStatus === "DRAFT";
  const alreadyConfirmed =
    !!item?.absence.manual_confirmed &&
    item.manual_inputs.absence_days_override !== null &&
    typeof absenceValue === "string" &&
    absenceValue.trim() !== "" &&
    isNonNegativeDecimal(absenceValue) &&
    toQuantityString(absenceValue) ===
      toQuantityString(item.manual_inputs.absence_days_override);
  useEffect(() => {
    let active = true;
    if (
      !item?.absence.manual_confirmed ||
      item.manual_inputs.absence_days_override === null
    )
      return;
    const current = item;
    void listItemAdjustments(runId, current.id, {
      page: 1,
      page_size: 25,
      type: "ABSENCE_OVERRIDE",
    })
      .then((page) => {
        const matching = page.items.find((entry) => {
          const overrides = entry.new_value.overrides;
          const value =
            entry.new_value["absence.override_days"] ??
            entry.new_value.absence_days_override ??
            (overrides && typeof overrides === "object"
              ? (overrides as Record<string, unknown>).absence_days_override
              : undefined);
          return (
            typeof value === "string" &&
            isNonNegativeDecimal(value) &&
            toQuantityString(value) ===
              toQuantityString(current.manual_inputs.absence_days_override!)
          );
        });
        if (active) setConfirmation(matching);
      })
      .catch(() => {
        if (active) setConfirmation(undefined);
      });
    return () => {
      active = false;
    };
  }, [runId, item]);

  // Replace the baseline and form values together after a save or stale reload.
  const applyItem = useCallback(
    (next: PayrollRunItemDto) => {
      setItem(next);
      setConfirmation(undefined);
      form.setFieldsValue({ ...itemToFormValues(next), reason: "" });
      setChangeCount(0);
      setNoChangeFeedback(false);
      onItemLoaded?.(next);
    },
    [form, onItemLoaded],
  );

  const load = useCallback(
    async (preserve = false) => {
      if (itemId === null) return;
      const current = ++generation.current;
      setLoading(true);
      setLoadError(null);
      try {
        const next = await getRunItem(runId, itemId);
        if (current !== generation.current) return;
        const revised =
          preserve &&
          revisionRef.current !== undefined &&
          revisionRef.current !== next.run_revision;
        const latest = form.getFieldsValue(true);
        const draft =
          preserve && (draftCount.current > 0 || !!latest.reason?.trim())
            ? latest
            : null;
        let count = 0;
        if (draft) {
          try {
            count = changeSize(
              buildItemChanges(next, { ...itemToFormValues(next), ...draft }),
            );
          } catch {
            count = 1;
          }
        }
        applyItem(next);
        if (revised && draft) {
          setConflict(true);
          setStaleMessage(t("payroll.ui.staleTitle"));
        }
        if (draft) {
          form.setFieldsValue(draft);
          setChangeCount(count);
        }
      } catch (err) {
        if (current !== generation.current) return;
        setLoadError(
          payrollErrorSummary(
            parsePayrollError(err),
            t("payroll.ui.itemLoadFailed"),
          ),
        );
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [runId, itemId, applyItem, t, form],
  );

  useEffect(() => {
    if (open && itemId !== null) {
      const identity = `${runId}:${itemId}`;
      const preserve = loadedIdentity.current === identity;
      loadedIdentity.current = identity;
      if (!preserve) {
        setItem(null);
        setStaleMessage(null);
        setFormError(null);
      }
      void load(preserve);
    }
  }, [open, itemId, runId, load]);

  const loadAdjustments = useCallback(
    (page: number, pageSize: number) =>
      listItemAdjustments(runId, itemId ?? 0, { page, page_size: pageSize }),
    [runId, itemId],
  );

  const save = async () => {
    if (!item || itemId === null || saveLock.current || conflict) return;
    if (changeCount === 0) {
      message.info(
        t(
          alreadyConfirmed
            ? "payroll.employee.alreadyConfirmed"
            : "payroll.employee.valuesSaved",
          { days: moneyToInput(item.manual_inputs.absence_days_override) },
        ),
      );
      return;
    }
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
      message.info(t("payroll.employee.valuesSaved"));
      return;
    }
    saveLock.current = true;
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
      await onChanged();
    } catch (err) {
      const parsed = parsePayrollError(err, ITEM_FIELD_MAP);
      if (parsed.isStaleRevision) {
        setConflict(true);
        setStaleMessage(
          parsed.formMessages[0] ??
            parsed.message ??
            t("payroll.ui.staleTitle"),
        );
        await load();
        await onChanged();
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
      saveLock.current = false;
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
          <Text type="secondary">
            {t(SOURCE_LABEL_KEYS[line.source_kind])}
            {line.source_id ? ` · ${line.source_id}` : ""}
          </Text>
          {line.carried_in && <Tag>{t("payroll.ui.carriedIn")}</Tag>}
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
    const fix = (issue: ValidationIssue) => {
      const field =
        issue.field?.replace(/^changes\./, "") ??
        (issue.code.includes("absence") || issue.code.includes("attendance")
          ? "absence_days_override"
          : issue.code.includes("overtime")
            ? "overtime_normal_hours"
            : issue.code.includes("suspended")
              ? "suspended_pay_decision"
              : issue.code.includes("zero")
                ? "zero_salary_reason"
                : undefined);
      const tab =
        field === "absence_days_override"
          ? "absence"
          : [
                ...QUANTITY_FIELDS,
                ...MONEY_FIELDS.filter((x) => x !== "other_deduction"),
                "override_overtime_eligibility",
              ].includes(field ?? "")
            ? "additions"
            : field === "other_deduction" ||
                /deduction|loan|penalty|claim/.test(issue.code)
              ? "deductions"
              : /medical|provision|accommodation|gosi/.test(issue.code)
                ? "provisions"
                : "overview";
      setActiveTab(tab);
      if (field)
        requestAnimationFrame(() =>
          form.scrollToField(
            field.startsWith("salary_components.")
              ? ["salary", field.split(".")[1]]
              : field,
            { focus: true, block: "center" },
          ),
        );
    };
    const edits = (content: React.ReactNode) => (editable ? content : null);
    const tabs = [
      {
        key: "overview",
        label: t("layout.menu.overview"),
        forceRender: true,
        children: (
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
                                  message: t(
                                    "payroll.ui.zeroSalaryDetailRequired",
                                  ),
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
                      options={(["FULL_PAY", "ZERO_PAY"] as const).map(
                        (value) => ({
                          value,
                          label: label(
                            "suspended_pay_decision",
                            value,
                            `payroll.suspended_pay_decision.${value.toLowerCase()}`,
                          ),
                        }),
                      )}
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
        ),
      },
      {
        key: "absence",
        label: t("payroll.ui.absenceTitle"),
        forceRender: true,
        children: (
          <>
            {" "}
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
                  children:
                    !item.executive_exempt &&
                    absence.manual_confirmation_required ? (
                      absence.manual_confirmed ? (
                        <Tag color="green">{t("payroll.ui.confirmed")}</Tag>
                      ) : (
                        <Tag color="red">
                          {t("payroll.ui.confirmationRequired")}
                        </Tag>
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
              :{" "}
              {absence.uncovered_dates.join(", ") ||
                t("payroll.ui.notRequired")}
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
                                  confirmation.actor?.name ??
                                  t("payroll.ui.unknown"),
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
        ),
      },
      {
        key: "additions",
        label: t("payroll.employee.additions"),
        forceRender: true,
        children: (
          <>
            {" "}
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
                  {MONEY_FIELDS.filter(
                    (field) => field !== "other_deduction",
                  ).map((field) => (
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
        ),
      },
      {
        key: "deductions",
        label: t("payroll.pdf.deductions"),
        forceRender: true,
        children: (
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
                {MONEY_FIELDS.filter(
                  (field) => field === "other_deduction",
                ).map((field) => (
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
              </Row>,
            )}
          </>
        ),
      },
      {
        key: "provisions",
        label: t("payroll.ux.columns.provisions"),
        forceRender: true,
        children: (
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
        ),
      },
      {
        key: "history",
        label: t("documentIntegrity.history"),
        children: (
          <PayrollHistoryDrawer
            key={item.run_revision}
            embedded
            open={activeTab === "history"}
            title={t("payroll.ui.adjustmentHistory")}
            onClose={() => undefined}
            load={loadAdjustments}
          />
        ),
      },
    ];
    return (
      <Form
        form={form}
        layout="vertical"
        disabled={saving}
        initialValues={{ ...itemToFormValues(item), reason: "" }}
        onValuesChange={() => {
          try {
            const changes = buildItemChanges(item, {
              ...itemToFormValues(item),
              ...form.getFieldsValue(true),
            });
            setNoChangeFeedback(!changes);
            setChangeCount(
              changes
                ? Object.values(changes).reduce(
                    (count, value) =>
                      count +
                      (value && typeof value === "object"
                        ? Object.keys(value).length
                        : 1),
                    0,
                  )
                : 0,
            );
          } catch {
            setNoChangeFeedback(false);
            setChangeCount(1);
          }
        }}
      >
        <div className="payroll-employee-layout">
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
                {t("payroll.field.cost_incomplete")}:{" "}
                {costReasons(item).join(", ")}
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
                      isManualInformation(issue, [item])
                        ? "info"
                        : issue.severity
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
                      <Button
                        size="small"
                        type="link"
                        onClick={() => fix(issue)}
                      >
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
          <section className="payroll-employee-sections">
            {staleMessage && (
              <StaleRevisionAlert
                message={staleMessage}
                onClose={() => setStaleMessage(null)}
              />
            )}
            {conflict && (
              <Button onClick={() => setConflict(false)}>
                {t("payroll.ux.retryAfterReview")}
              </Button>
            )}
            {formError && <Alert type="error" showIcon message={formError} />}
            {!editable && (
              <Alert type="info" message={t("payroll.ui.itemReadOnly")} />
            )}
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
            {editable && (
              <div
                className="payroll-employee-save"
                aria-label={t("payroll.ui.editTitle")}
              >
                <Text>
                  {t("payroll.employee.changeCount", { count: changeCount })}
                </Text>
                {noChangeFeedback &&
                  (!alreadyConfirmed || activeTab !== "absence") && (
                    <Text className="payroll-no-change" type="secondary">
                      {t("payroll.employee.valuesSaved")}
                    </Text>
                  )}
                <Form.Item
                  name="reason"
                  label={t("payroll.ui.reasonLabel")}
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
                    rows={1}
                    maxLength={REASON_MAX_LENGTH}
                    showCount
                    aria-label={t("payroll.ui.reasonLabel")}
                  />
                </Form.Item>

                <Button
                  type="primary"
                  disabled={conflict || changeCount === 0}
                  loading={saving}
                  onClick={() => void save()}
                >
                  {t("payroll.ui.saveItem")}
                </Button>
                <Button
                  disabled={saving}
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({
                      ...itemToFormValues(item),
                      reason: "",
                    });
                    setChangeCount(0);
                    setNoChangeFeedback(false);
                  }}
                >
                  {t("payroll.ui.discardChanges")}
                </Button>
              </div>
            )}
          </section>
        </div>
      </Form>
    );
  };

  return renderBody();
}
