import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  Collapse,
  Col,
  Form,
  Input,
  Radio,
  Segmented,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { HistoryOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../../../../components/ui/PageHeader";
import LoadingState from "../../../../components/ui/LoadingState";
import ErrorState from "../../../../components/ui/ErrorState";
import Unauthorized403Page from "../../../Unauthorized403Page";
import ReasonModal from "../../../../components/payroll/ReasonModal";
import StaleRevisionAlert from "../../../../components/payroll/StaleRevisionAlert";
import PayrollHistoryDrawer from "../../../../components/payroll/PayrollHistoryDrawer";
import PayrollTheme from "../../../../components/payroll/PayrollTheme";
import PayrollDraftGuard from "../../../../components/payroll/PayrollDraftGuard";
import { useI18n } from "../../../../i18n/useI18n";
import { usePayrollEnums } from "../../../../hooks/usePayrollEnums";
import { formatDateTime } from "../../../../utils/dateTime";
import { isForbidden } from "../../../../services/api/httpErrors";
import {
  getPayrollSettings,
  getPayrollSettingsHistory,
  getSalaryBases,
  updatePayrollSettings,
} from "../../../../services/api/payrollSettingsApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../../services/api/payrollErrors";
import type {
  EnumOption,
  PayrollSettings,
  SalaryBaseField,
  SalaryBaseType,
} from "../../../../services/api/payrollTypes";
import {
  isNonNegativeDecimal,
  isValidPercent,
} from "../../../../utils/payrollMoney";
import {
  SALARY_BASE_FIELDS,
  SETTINGS_FIELD_MAP,
  buildSettingsChanges,
  toFormValues,
  type SettingsFormValues,
} from "./payrollSettingsForm";

const { Text } = Typography;

export default function PayrollSettingsPage() {
  const { t } = useI18n();
  const { label } = usePayrollEnums();
  const [form] = Form.useForm<SettingsFormValues>();

  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [bases, setBases] = useState<EnumOption<SalaryBaseType>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [conflict, setConflict] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [searchParams] = useSearchParams();

  const [reasonOpen, setReasonOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const [modalError, setModalError] = useState<string>();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const applySettings = useCallback(
    (next: PayrollSettings) => {
      setSettings(next);
      form.resetFields();
      form.setFieldsValue(toFormValues(next));
      setDirty(false);
      setChangeCount(0);
    },
    [form],
  );

  const generation = useRef(0);
  const load = useCallback(
    async (preserve = true) => {
      const current = ++generation.current;
      setLoading(true);
      setLoadError(null);
      setForbidden(false);
      try {
        const [loaded, baseOptions] = await Promise.all([
          getPayrollSettings(),
          getSalaryBases(),
        ]);
        if (current !== generation.current) return;
        setBases(baseOptions);
        const draft =
          preserve && dirtyRef.current ? form.getFieldsValue(true) : null;
        applySettings(loaded);
        if (draft) {
          form.setFieldsValue(draft);
          setDirty(true);
          try {
            setChangeCount(
              Object.keys(buildSettingsChanges(loaded, draft) ?? {}).length,
            );
          } catch {
            setChangeCount(1);
          }
        }
      } catch (err) {
        if (current !== generation.current) return;
        if (isForbidden(err)) {
          setForbidden(true);
        } else {
          setLoadError(
            payrollErrorSummary(
              parsePayrollError(err),
              t("payroll.ui.settingsLoadFailed"),
            ),
          );
        }
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [applySettings, t, form],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!settings || searchParams.get("field") !== "annual_medical_invoice")
      return;
    const frame = requestAnimationFrame(() =>
      form.scrollToField("medical_mode", { focus: true, block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [settings, searchParams, form]);

  const loadHistory = useCallback(
    (page: number, pageSize: number) =>
      getPayrollSettingsHistory({ page, page_size: pageSize }),
    [],
  );

  const startSave = async () => {
    if (!settings || loading || saving || conflict) return;
    try {
      const values = await form.validateFields();
      if (!buildSettingsChanges(settings, values)) {
        message.info(t("payroll.ui.noChanges"));
        return;
      }
    } catch {
      return; // field errors are already shown inline
    }
    setReasonError(undefined);
    setModalError(undefined);
    setReasonOpen(true);
  };

  const save = async (reason: string) => {
    if (!settings) return;
    const values = form.getFieldsValue(true) as SettingsFormValues;
    const changes = buildSettingsChanges(settings, values);
    if (!changes) {
      setReasonOpen(false);
      return;
    }
    setSaving(true);
    setReasonError(undefined);
    setModalError(undefined);
    try {
      const saved = await updatePayrollSettings({
        ...changes,
        expected_revision: settings.settings_revision,
        reason,
      });
      setReasonOpen(false);
      setStaleMessage(null);
      applySettings(saved);
      message.success(t("payroll.ui.settingsSaved"));
    } catch (err) {
      const parsed = parsePayrollError(err, SETTINGS_FIELD_MAP);
      if (parsed.isStaleRevision) {
        setConflict(true);
        // Stop, tell the user, reload the latest values; they retry by hand.
        setReasonOpen(false);
        setStaleMessage(
          parsed.formMessages[0] ??
            parsed.message ??
            t("payroll.ui.staleTitle"),
        );
        await load();
        return;
      }
      const reasonField = parsed.fieldErrors.find(
        (entry) => entry.name[0] === "reason",
      );
      const formFields = parsed.fieldErrors.filter(
        (entry) => entry.name[0] !== "reason",
      );
      if (reasonField) setReasonError(reasonField.errors[0]);
      if (formFields.length) {
        form.setFields(formFields as Parameters<typeof form.setFields>[0]);
        setReasonOpen(false);
        message.error(formFields[0].errors[0] || t("payroll.ui.saveFailed"));
        return;
      }
      if (!reasonField) {
        setModalError(payrollErrorSummary(parsed, t("payroll.ui.saveFailed")));
      }
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) return <Unauthorized403Page />;
  if (loading && !settings) return <LoadingState />;
  if (loadError && !settings) {
    return (
      <ErrorState
        title={t("payroll.ui.settingsLoadFailed")}
        description={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (!settings) return null;

  const decimalRule = (required = true) => ({
    validator: (_: unknown, value?: string) => {
      if (!value || !value.trim()) {
        return required
          ? Promise.reject(new Error(t("payroll.ui.amountRequired")))
          : Promise.resolve();
      }
      return isNonNegativeDecimal(value)
        ? Promise.resolve()
        : Promise.reject(new Error(t("payroll.ui.invalidAmount")));
    },
  });

  const percentRule = {
    validator: (_: unknown, value?: string) =>
      value && isValidPercent(value)
        ? Promise.resolve()
        : Promise.reject(new Error(t("payroll.ui.invalidPercent"))),
  };

  const baseLabel = (field: SalaryBaseField) => t(`payroll.ui.base.${field}`);

  return (
    <PayrollTheme>
      <PayrollDraftGuard dirty={dirty} saving={saving} />
      <div className="payroll-settings">
        <PageHeader
          title={t("payroll.ui.settingsTitle")}
          subtitle={t("payroll.ui.settingsSubtitle")}
          tags={
            settings.settings_revision === 0 ? (
              <Tag color="gold">{t("payroll.ui.defaultsNotSaved")}</Tag>
            ) : (
              <Tag color="blue">
                {t("payroll.ui.revisionTag", {
                  revision: settings.settings_revision,
                })}
              </Tag>
            )
          }
          actions={
            <Space wrap>
              <Button
                aria-label={t("payroll.ux3.changeHistory")}
                icon={<HistoryOutlined />}
                onClick={() => setHistoryOpen(true)}
              >
                {t("payroll.ux3.changeHistory")}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void load()}
                loading={loading}
              >
                {t("payroll.ui.reload")}
              </Button>
            </Space>
          }
        />

        {staleMessage && (
          <>
            <Typography.Text>{t("payroll.ux3.draftRetained")}</Typography.Text>
            <StaleRevisionAlert
              message={staleMessage}
              onClose={() => setStaleMessage(null)}
            />
            <Button
              onClick={() => {
                setConflict(false);
                setStaleMessage(null);
              }}
            >
              {t("payroll.ux.reviewReloaded")}
            </Button>
          </>
        )}

        <Collapse
          className="payroll-calculation-notes"
          items={[
            {
              key: "notes",
              label: t("payroll.employee.notes"),
              children: (
                <>
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {settings.assumptions.map((entry) => (
                      <li key={entry.key}>{entry.message}</li>
                    ))}
                  </ul>
                  <Text>
                    {t("payroll.ui.fixedRulesTitle")} ·{" "}
                    <bdi dir="ltr">{settings.day_basis}</bdi> ·{" "}
                    {t("payroll.ui.roundingValue")} ·{" "}
                    {t("payroll.ui.overtimeLimitPeriodValue")}
                  </Text>
                </>
              ),
            },
          ]}
        />

        <Form
          form={form}
          layout="vertical"
          requiredMark
          onFinish={() => void startSave()}
          onValuesChange={(_, values) => {
            try {
              const count = Object.keys(
                buildSettingsChanges(settings, values) ?? {},
              ).length;
              setDirty(count > 0);
              setChangeCount(count);
            } catch {
              setDirty(true);
              setChangeCount(1);
            }
          }}
          initialValues={toFormValues(settings)}
        >
          <Row className="payroll-settings-grid" gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card
                title={t("payroll.ui.salaryBasesTitle")}
                style={{ borderRadius: 16, height: "100%" }}
              >
                <Text type="secondary">{t("payroll.ui.salaryBasesHelp")}</Text>
                <div className="payroll-settings-base-fields">
                  {SALARY_BASE_FIELDS.map((field) => (
                    <Row gutter={12} key={field} style={{ marginTop: 12 }}>
                      <Col xs={24} sm={24}>
                        <Form.Item
                          name={[field, "type"]}
                          label={baseLabel(field)}
                          rules={[{ required: true }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Select
                            aria-label={baseLabel(field)}
                            options={bases.map((option) => ({
                              value: option.value,
                              label: label(
                                "salary_base",
                                option.value,
                                option.label_key,
                              ),
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={24}>
                        <Form.Item
                          noStyle
                          shouldUpdate={(prev, next) =>
                            prev[field]?.type !== next[field]?.type
                          }
                        >
                          {({ getFieldValue }) =>
                            getFieldValue([field, "type"]) ===
                            "FIXED_AMOUNT" ? (
                              <Form.Item
                                name={[field, "fixed_amount"]}
                                label={t("payroll.ui.fixedMonthlyAmount")}
                                rules={[decimalRule()]}
                                style={{ marginBottom: 0 }}
                              >
                                <Input
                                  inputMode="decimal"
                                  dir="ltr"
                                  aria-label={`${baseLabel(field)} - ${t("payroll.ui.fixedMonthlyAmount")}`}
                                />
                              </Form.Item>
                            ) : null
                          }
                        </Form.Item>
                      </Col>
                    </Row>
                  ))}
                </div>
              </Card>
            </Col>

            <Col xs={24} xl={12}>
              <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                <Card
                  title={t("payroll.ui.gosiTitle")}
                  style={{ borderRadius: 16 }}
                >
                  <Text type="secondary">{t("payroll.ui.gosiHelp")}</Text>
                  <Row gutter={12} style={{ marginTop: 12 }}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="foreign_gosi_percent"
                        label={t("payroll.ui.foreignGosiRate")}
                        rules={[percentRule]}
                      >
                        <Input inputMode="decimal" dir="ltr" suffix="%" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="saudi_gosi_percent"
                        label={t("payroll.ui.saudiGosiRate")}
                        rules={[percentRule]}
                      >
                        <Input inputMode="decimal" dir="ltr" suffix="%" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <Card
                  title={t("payroll.pdf.provisions")}
                  style={{ borderRadius: 16 }}
                >
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="monthly_foreign_id_cost"
                        label={t("payroll.ui.monthlyForeignIdCost")}
                        extra={t("payroll.ui.monthlyForeignIdCostHelp")}
                        rules={[decimalRule()]}
                      >
                        <Input inputMode="decimal" dir="ltr" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="annual_air_ticket"
                        label={t("payroll.ui.annualAirTicket")}
                        rules={[decimalRule()]}
                      >
                        <Input inputMode="decimal" dir="ltr" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    className={
                      searchParams.get("field") === "annual_medical_invoice"
                        ? "payroll-highlighted-field"
                        : undefined
                    }
                    name="medical_mode"
                    label={t("payroll.ui.medicalTitle")}
                  >
                    <Segmented
                      aria-label={t("payroll.ui.medicalTitle")}
                      options={[
                        {
                          value: "amount",
                          label: t("payroll.ui.medicalAmount"),
                        },
                        {
                          value: "unknown",
                          label: t("payroll.ui.medicalUnknown"),
                        },
                        { value: "none", label: t("payroll.ui.medicalNone") },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, next) =>
                      prev.medical_mode !== next.medical_mode
                    }
                  >
                    {({ getFieldValue }) => {
                      const mode = getFieldValue("medical_mode");
                      if (mode === "amount") {
                        return (
                          <Form.Item
                            name="annual_medical_invoice"
                            label={t("payroll.ui.annualMedicalInvoice")}
                            rules={[decimalRule()]}
                          >
                            <Input inputMode="decimal" dir="ltr" />
                          </Form.Item>
                        );
                      }
                      return (
                        <Text type="secondary">
                          {mode === "unknown"
                            ? t("payroll.ui.medicalUnknownNote")
                            : t("payroll.ui.medicalNoneNote")}
                        </Text>
                      );
                    }}
                  </Form.Item>
                </Card>
              </Space>
            </Col>

            <Col xs={24}>
              <Card
                title={t("payroll.ui.policiesTitle")}
                style={{ borderRadius: 16 }}
              >
                <Row gutter={[24, 16]}>
                  <Col xs={24} lg={12}>
                    <Typography.Title level={5}>
                      {t("payroll.ui.provisionProration")}
                    </Typography.Title>
                    <Form.Item
                      name="provision_proration"
                      label={t("payroll.ui.provisionProration")}
                    >
                      <Radio.Group>
                        <Space orientation="vertical">
                          <Radio value="FULL_MONTH">
                            {label(
                              "provision_proration",
                              "FULL_MONTH",
                              "payroll.provision_proration.full_month",
                            )}
                          </Radio>
                          <Radio value="PRORATED_BY_DAYS">
                            {label(
                              "provision_proration",
                              "PRORATED_BY_DAYS",
                              "payroll.provision_proration.prorated_by_days",
                            )}
                          </Radio>
                        </Space>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Typography.Title level={5}>
                      {t("payroll.ux3.attendance")}
                    </Typography.Title>
                    <Form.Item
                      name="require_manual_absence_confirmation"
                      label={t(
                        "payroll.field.require_manual_absence_confirmation",
                      )}
                      valuePropName="checked"
                      extra={t("payroll.ui.manualAbsenceHelp")}
                    >
                      <Switch
                        aria-label={t(
                          "payroll.field.require_manual_absence_confirmation",
                        )}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <div
            className="payroll-settings-save"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 16,
            }}
          >
            <Text type="secondary">
              {t("payroll.employee.changeCount", { count: changeCount })} ·{" "}
              {settings.updated_at ? (
                <>
                  {t("payroll.ui.lastUpdated", { date: "" })}
                  <bdi dir="ltr">{formatDateTime(settings.updated_at)}</bdi>
                </>
              ) : (
                t("payroll.ui.defaultsHelp")
              )}
            </Text>
            <Space>
              <Button
                disabled={!dirty || saving}
                onClick={() => {
                  applySettings(settings);
                  setConflict(false);
                  setStaleMessage(null);
                }}
              >
                {t("payroll.ui.discardChanges")}
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                disabled={!dirty || conflict || saving || loading}
                loading={saving}
              >
                {t("payroll.ui.saveSettings")}
              </Button>
            </Space>
          </div>
        </Form>

        <ReasonModal
          open={reasonOpen}
          title={t("payroll.ui.saveSettingsTitle")}
          description={t("payroll.ui.saveSettingsDescription")}
          okText={t("payroll.ui.saveSettings")}
          submitting={saving}
          reasonError={reasonError}
          formError={modalError}
          onSubmit={(reason) => void save(reason)}
          onCancel={() => setReasonOpen(false)}
        />

        <PayrollHistoryDrawer
          fullWidth
          tableView
          open={historyOpen}
          title={t("payroll.ui.settingsHistoryTitle")}
          onClose={() => setHistoryOpen(false)}
          load={loadHistory}
        />
      </div>
    </PayrollTheme>
  );
}
