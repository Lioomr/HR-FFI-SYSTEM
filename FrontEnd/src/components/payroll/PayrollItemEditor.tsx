import { useCallback, useEffect, useState, useRef } from "react";
import {
  Alert,
  Tabs,
  Button,
  Form,
  Grid,
  Input,
  Typography,
  message,
} from "antd";
import { useI18n } from "../../i18n/useI18n";
import LoadingState from "../ui/LoadingState";
import StaleRevisionAlert from "./StaleRevisionAlert";
import PayrollHistoryDrawer from "./PayrollHistoryDrawer";
import { REASON_MAX_LENGTH } from "./ReasonModal";
import {
  ITEM_FIELD_MAP,
  MONEY_FIELDS,
  QUANTITY_FIELDS,
  buildItemChanges,
  itemToFormValues,
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
  PayrollRunItemDto,
  PayrollStatus,
  ValidationIssue,
} from "../../services/api/payrollTypes";
import {
  isNonNegativeDecimal,
  moneyToInput,
  toQuantityString,
} from "../../utils/payrollMoney";
import type { PayrollHistoryEntry } from "../../services/api/payrollTypes";
import { useCanManagePayrollHrData } from "./payrollFormat";
import { changeSize, makeDecimalRule } from "./payrollItemEditorShared";
import { usePayrollItemColumns } from "./usePayrollItemColumns";
import PayrollItemEditorSummary from "./PayrollItemEditorSummary";
import {
  AbsenceTab,
  AdditionsTab,
  DeductionsTab,
  OverviewTab,
  ProvisionsTab,
} from "./PayrollItemEditorTabs";

const { Text } = Typography;

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

  const decimalRule = makeDecimalRule(t);

  const { salaryColumns, moneyLineColumns, provisionColumns } =
    usePayrollItemColumns();

  const renderBody = () => {
    if (loading && !item) return <LoadingState />;
    if (loadError && !item)
      return <Alert type="error" showIcon message={loadError} />;
    if (!item) return null;
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
    const tabs = [
      {
        key: "overview",
        label: t("layout.menu.overview"),
        forceRender: true,
        children: (
          <OverviewTab
            item={item}
            editable={editable}
            reportIssues={reportIssues}
            suspendedDecision={suspendedDecision}
            zeroReason={zeroReason}
            salaryColumns={salaryColumns}
            decimalRule={decimalRule}
          />
        ),
      },
      {
        key: "absence",
        label: t("payroll.ui.absenceTitle"),
        forceRender: true,
        children: (
          <AbsenceTab
            item={item}
            editable={editable}
            wide={!!screens.md}
            alreadyConfirmed={alreadyConfirmed}
            confirmation={confirmation}
            decimalRule={decimalRule}
          />
        ),
      },
      {
        key: "additions",
        label: t("payroll.employee.additions"),
        forceRender: true,
        children: (
          <AdditionsTab
            item={item}
            editable={editable}
            wide={!!screens.md}
            moneyLineColumns={moneyLineColumns}
            decimalRule={decimalRule}
          />
        ),
      },
      {
        key: "deductions",
        label: t("payroll.pdf.deductions"),
        forceRender: true,
        children: (
          <DeductionsTab
            item={item}
            editable={editable}
            moneyLineColumns={moneyLineColumns}
            decimalRule={decimalRule}
          />
        ),
      },
      {
        key: "provisions",
        label: t("payroll.ux.columns.provisions"),
        forceRender: true,
        children: (
          <ProvisionsTab item={item} provisionColumns={provisionColumns} />
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
          <PayrollItemEditorSummary
            item={item}
            reportIssues={reportIssues}
            issuesAvailable={issuesAvailable}
            canOpenProfiles={canOpenProfiles}
            onFix={fix}
          />
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
