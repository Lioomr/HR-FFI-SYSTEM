import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Modal,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  DownloadOutlined,
  FileTextOutlined,
  LockOutlined,
  ReloadOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import PageHeader from "../../../../components/ui/PageHeader";
import BackButton from "../../../../components/ui/BackButton";
import LoadingState from "../../../../components/ui/LoadingState";
import ErrorState from "../../../../components/ui/ErrorState";
import Unauthorized403Page from "../../../Unauthorized403Page";
import ReasonModal from "../../../../components/payroll/ReasonModal";
import StaleRevisionAlert from "../../../../components/payroll/StaleRevisionAlert";
import PayrollTheme from "../../../../components/payroll/PayrollTheme";
import RunHeadlineTotals from "../../../../components/payroll/RunHeadlineTotals";
import ValidationPanel from "../../../../components/payroll/ValidationPanel";
import PayrollItemsGrid from "../../../../components/payroll/PayrollItemsGrid";
import {
  employeePath,
  legacyEmployeePath,
  type PayrollEmployeeSession,
  type PayrollListState,
} from "../../../../components/payroll/payrollNavigation";
import AccommodationReport from "../../../../components/payroll/AccommodationReport";
import AccommodationNoneAction from "../../../../components/payroll/AccommodationNoneAction";
import { validationPresentation } from "../../../../components/payroll/validationGroups";
import { PayrollStatusTag } from "../../../../components/payroll/payrollDisplay";
import { formatPayrollPeriod } from "../../../../components/payroll/payrollFormat";
import { useI18n } from "../../../../i18n/useI18n";
import { formatDateTime } from "../../../../utils/dateTime";
import { isForbidden, isNotFound } from "../../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../../services/api/downloads";
import {
  cancelRun,
  exportRun,
  finalizeRun,
  generateRunPayslips,
  getRun,
  getRunItem,
  getRunSummary,
  getValidationReport,
  recalculateRun,
} from "../../../../services/api/payrollApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../../services/api/payrollErrors";
import type {
  PayrollExportFormat,
  PayrollRunDto,
  PayrollRunItemDto,
  PayrollRunSummaryDto,
  ValidationReport,
} from "../../../../services/api/payrollTypes";

const { Text } = Typography;

type RunAction = "recalculate" | "finalize" | "cancel";

/** Errors about the request itself; anything else on finalize is a blocking report issue. */
const REQUEST_ERROR_CODES = new Set([
  "reason_required",
  "confirm_required",
  "run_cancelled",
  "run_not_draft",
  "field_not_editable",
]);

/**
 * D: payroll run page (contract 7.2-7.6). Headline totals, validation, the
 * items grid and the item drawer. Every mutation sends the run revision from
 * the last read plus a reason; a 409 stale_revision stops, reloads and lets
 * the user retry by hand.
 */
export default function PayrollRunPage() {
  const [recordIndex, setRecordIndex] = useState<PayrollRunItemDto[] | null>(
    null,
  );
  const { run_id: runId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const listState = (
    location.state as { payrollList?: PayrollListState } | null
  )?.payrollList;
  const [searchParams] = useSearchParams();
  const { t, language } = useI18n();

  const [run, setRun] = useState<PayrollRunDto | null>(null);
  const [summary, setSummary] = useState<PayrollRunSummaryDto | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [gridKey, setGridKey] = useState(0);
  const [tab, setTab] = useState("items");

  const [action, setAction] = useState<RunAction | null>(null);
  const [refreshSettings, setRefreshSettings] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const [modalError, setModalError] = useState<string>();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [blockingErrors, setBlockingErrors] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  // Hook-based dialog: renders inside the app tree (RTL, locale). The static
  // Modal.confirm does not render under React 19 here (found in F4).
  const [modal, modalContext] = Modal.useModal();

  const generation = useRef(0);
  const loadAll = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError(null);
    try {
      const loadedRun = await getRun(runId);
      if (current !== generation.current) return;
      setRun(loadedRun);
      const [summaryResult, reportResult] = await Promise.allSettled([
        getRunSummary(runId),
        getValidationReport(runId),
      ]);
      if (current !== generation.current) return;
      setSummary(
        summaryResult.status === "fulfilled" ? summaryResult.value : null,
      );
      setReport(
        reportResult.status === "fulfilled" ? reportResult.value : null,
      );
    } catch (err) {
      if (current !== generation.current) return;
      setSummary(null);
      setReport(null);
      if (isForbidden(err)) setForbidden(true);
      else if (isNotFound(err)) setNotFound(true);
      else
        setLoadError(
          payrollErrorSummary(
            parsePayrollError(err),
            t("payroll.ui.runLoadFailed"),
          ),
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [runId, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** Reload the run, summary, validation and the visible grid page. */
  const refreshEverything = useCallback(async () => {
    await loadAll();
    setGridKey((key) => key + 1);
  }, [loadAll]);

  const openItem = useCallback(
    (itemId: number, session?: PayrollEmployeeSession, target?: string) => {
      const state = { ...session, listSearch: location.search };
      // Stamp the list history entry before pushing the employee route: browser
      // Back and the explicit Back to list both recover the same UI snapshot.
      navigate(location.pathname + location.search, {
        replace: true,
        state: { payrollList: session?.list ?? listState },
      });
      navigate(target ?? employeePath(runId, itemId), { state });
    },
    [navigate, runId, location.pathname, location.search, listState],
  );

  const costIncompleteReasons = useMemo(() => {
    const reasons: string[] = [];
    const accommodationUnknown =
      summary?.unknown_provision_counts?.ACCOMMODATION_COST ?? 0;
    if (accommodationUnknown) {
      reasons.push(
        t("payroll.ui.accommodationUnknownCount", {
          count: accommodationUnknown,
        }),
      );
    }
    const medicalMissing =
      (summary?.unknown_provision_counts?.MEDICAL ?? 0) > 0 ||
      report?.warnings.some(
        (issue) => issue.code === "medical_invoice_missing",
      );
    if (medicalMissing) reasons.push(t("payroll.ui.medicalInvoiceMissing"));
    return reasons;
  }, [summary, report, t]);

  const openAction = (next: RunAction) => {
    setReasonError(undefined);
    setModalError(undefined);
    setRefreshSettings(false);
    setAction(next);
  };

  const submitAction = async (reason: string) => {
    if (!run || !action) return;
    setSubmitting(true);
    setReasonError(undefined);
    setModalError(undefined);
    try {
      let result: { message: string };
      if (action === "recalculate") {
        result = await recalculateRun(run.id, {
          expected_revision: run.revision,
          refresh_settings: refreshSettings,
          reason,
        });
      } else if (action === "finalize") {
        result = await finalizeRun(run.id, {
          expected_revision: run.revision,
          reason,
        });
      } else {
        result = await cancelRun(run.id, {
          expected_revision: run.revision,
          reason,
        });
      }
      setAction(null);
      setStaleMessage(null);
      setBlockingErrors([]);
      message.success(result.message);
      await refreshEverything();
    } catch (err) {
      const parsed = parsePayrollError(err);
      if (parsed.isStaleRevision) {
        setAction(null);
        setStaleMessage(
          parsed.formMessages[0] ??
            parsed.message ??
            t("payroll.ui.staleTitle"),
        );
        await refreshEverything();
        return;
      }
      const reasonField = parsed.fieldErrors.find(
        (entry) => entry.name[0] === "reason",
      );
      if (reasonField) {
        setReasonError(reasonField.errors[0]);
        return;
      }
      const blocking =
        action === "finalize" &&
        parsed.httpStatus === 422 &&
        parsed.items.some(
          (item) =>
            item.employee !== undefined ||
            (item.code && !REQUEST_ERROR_CODES.has(item.code)),
        );
      if (blocking) {
        // Blocking validation: show it with the report rather than in the modal.
        setAction(null);
        setBlockingErrors(
          parsed.items.map((item) => item.message).filter(Boolean),
        );
        setTab("validation");
        await refreshEverything();
        return;
      }
      setModalError(payrollErrorSummary(parsed, t("payroll.ui.actionFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  const generate = () => {
    if (!run) return;
    modal.confirm({
      title: t("payroll.ui.generateTitle"),
      content: t("payroll.ui.generateDescription"),
      okText: t("payroll.ui.generatePayslips"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          const result = await generateRunPayslips(run.id);
          message.success(
            t("payroll.ui.generatedResult", {
              generated: result.generated_count ?? 0,
              total: result.total_payslips ?? 0,
            }),
          );
          await refreshEverything();
        } catch (err) {
          message.error(
            payrollErrorSummary(
              parsePayrollError(err),
              t("payroll.ui.actionFailed"),
            ),
          );
        }
      },
    });
  };

  const exportFile = async (format: PayrollExportFormat) => {
    if (!run) return;
    setExporting(true);
    try {
      const blob = await exportRun(run.id, format);
      triggerBlobDownload(blob, `payroll_run_${run.id}.${format}`);
    } catch (err) {
      message.error(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.runDetails.exportFailed"),
        ),
      );
    } finally {
      setExporting(false);
    }
  };

  const legacyPath = legacyEmployeePath(runId, searchParams.toString());
  if (legacyPath)
    return <Navigate replace to={legacyPath} state={location.state} />;
  if (forbidden) return <Unauthorized403Page />;
  if (loading && !run) return <LoadingState />;
  if (notFound) {
    return (
      <ErrorState
        title={t("payroll.runDetails.notFound")}
        onRetry={() => navigate("/hr/payroll")}
      />
    );
  }
  if (!run) {
    return (
      <ErrorState
        title={t("payroll.ui.runLoadFailed")}
        description={loadError ?? undefined}
        onRetry={() => void loadAll()}
      />
    );
  }

  const isDraft = run.status === "DRAFT";
  const finalized =
    run.status === "COMPLETED" ||
    run.status === "PAID" ||
    report?.finalize_state === "finalized";
  const showFinalizeGating = !run.legacy_calculation && !finalized;
  const canFinalize =
    showFinalizeGating && isDraft && !loading && report?.can_finalize === true;
  const finalizeBlockedReason = !report
    ? t("payroll.ui.validationUnavailable")
    : t("payroll.ui.cannotFinalizeHelp", { count: report.counts.errors });
  const period = formatPayrollPeriod(run.year, run.month, language);
  const validationView = report
    ? validationPresentation(report, recordIndex)
    : null;
  const quickNone = (employee: {
    employee_profile_id: number;
    employee_name: string;
    item_id: number | null;
  }) => (
    <AccommodationNoneAction
      employeeProfileId={employee.employee_profile_id}
      name={employee.employee_name}
      year={run.year}
      month={run.month}
      onSaved={async () => {
        if (employee.item_id !== null)
          await Promise.allSettled([getRunItem(run.id, employee.item_id)]);
        await refreshEverything();
      }}
    />
  );

  const actionTitles: Record<RunAction, string> = {
    recalculate: t("payroll.ui.recalculateTitle", { period }),
    finalize: t("payroll.ui.finalizeTitle", { period }),
    cancel: t("payroll.ui.cancelTitle", { period }),
  };
  const actionDescriptions: Record<RunAction, string> = {
    recalculate: t("payroll.ui.recalculateDescription"),
    finalize: t("payroll.ui.finalizeDescription"),
    cancel: t("payroll.ui.cancelDescription"),
  };
  const actionOk: Record<RunAction, string> = {
    recalculate: t("payroll.ui.recalculate"),
    finalize: t("payroll.ui.finalize"),
    cancel: t("payroll.ui.cancelRun"),
  };

  return (
    <PayrollTheme>
      {modalContext}
      <PageHeader
        title={t("payroll.ui.runTitle", { period })}
        subtitle={
          <Space wrap size={12}>
            <span>{run.company_name}</span>
            {run.calculated_at && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("payroll.ui.calculatedAt", { date: "" })}
                <bdi dir="ltr">{formatDateTime(run.calculated_at)}</bdi>
              </Text>
            )}
          </Space>
        }
        tags={
          <Space size={4} wrap>
            <PayrollStatusTag status={run.status} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("payroll.ui.revisionTag", { revision: run.revision })}
            </Text>
            {run.legacy_calculation && <Tag>{t("payroll.ui.legacyRun")}</Tag>}
          </Space>
        }
        actions={
          <Space wrap>
            {isDraft && (
              <>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => openAction("recalculate")}
                >
                  {t("payroll.ui.recalculate")}
                </Button>
                {showFinalizeGating && (
                  <Tooltip
                    title={canFinalize ? undefined : finalizeBlockedReason}
                  >
                    <Button
                      type="primary"
                      icon={<LockOutlined />}
                      disabled={!canFinalize}
                      onClick={() => openAction("finalize")}
                    >
                      {t("payroll.ui.finalize")}
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
            {run.status === "COMPLETED" && (
              <Button
                type="primary"
                icon={<FileTextOutlined />}
                onClick={generate}
              >
                {t("payroll.ui.generatePayslips")}
              </Button>
            )}
            <Dropdown
              menu={{
                items: (["xlsx", "pdf", "csv"] as const).map((format) => ({
                  key: format,
                  label: t(`payroll.ui.export_${format}`),
                  onClick: () => void exportFile(format),
                })),
              }}
            >
              <Button icon={<DownloadOutlined />} loading={exporting}>
                {t("payroll.export")}
              </Button>
            </Dropdown>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "reload",
                    label: t("payroll.ui.reload"),
                    onClick: () => void refreshEverything(),
                  },
                  ...(isDraft
                    ? [
                        {
                          key: "cancel",
                          label: t("payroll.ui.cancelRun"),
                          danger: true,
                          onClick: () => openAction("cancel"),
                        },
                      ]
                    : []),
                ],
              }}
            >
              <Button icon={<MoreOutlined />}>
                {t("payroll.ux.moreActions")}
              </Button>
            </Dropdown>
            <BackButton
              onClick={() => navigate("/hr/payroll")}
              style={{ minHeight: 40 }}
            >
              {t("payroll.runDetails.backToDashboard")}
            </BackButton>
          </Space>
        }
      />

      {staleMessage && (
        <StaleRevisionAlert
          message={staleMessage}
          onClose={() => setStaleMessage(null)}
        />
      )}
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={loadError}
          style={{ marginBottom: 16 }}
        />
      )}
      {showFinalizeGating && blockingErrors.length > 0 && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setBlockingErrors([])}
          style={{ marginBottom: 16 }}
          message={t("payroll.ui.finalizeBlocked")}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {blockingErrors.slice(0, 5).map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          }
        />
      )}
      {run.status === "CANCELLED" && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("payroll.ui.cancelledBanner", {
            date: formatDateTime(run.cancelled_at),
          })}
          description={run.cancel_reason || undefined}
        />
      )}
      {run.legacy_calculation && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("payroll.ui.legacyRunHelp")}
        />
      )}

      <div
        className="payroll-status-strip"
        role="region"
        aria-label={t("payroll.ux.runStatus")}
      >
        <Space wrap size={16}>
          <Text type={report?.counts.errors ? "danger" : undefined}>
            {report && !loading
              ? t("payroll.ui.errorsCount", { count: report.counts.errors })
              : t("payroll.ux.unavailable")}
          </Text>
          <Text>
            {report && !loading
              ? t("payroll.ui.warningsCount", {
                  count: validationView?.warnings ?? report.counts.warnings,
                })
              : t("payroll.ux.unavailable")}
          </Text>
          {(finalized || showFinalizeGating) && (
            <Text type="secondary">
              {finalized
                ? t("payroll.finalize_state.finalized")
                : report && !loading
                  ? t(
                      report.can_finalize
                        ? "payroll.ui.canFinalize"
                        : "payroll.ui.cannotFinalize",
                    )
                  : t("payroll.ux.unavailable")}
            </Text>
          )}
        </Space>
        <Space wrap size={12}>
          <Text type="secondary">
            {report && !loading
              ? t("payroll.ui.employeesChecked", {
                  count: report.employees_checked,
                  excluded: report.excluded_employees_checked,
                })
              : t("payroll.ux.unavailable")}
          </Text>
          {summary?.reconciliation && !loading && (
            <Tag color={summary.reconciliation.matches ? "success" : "error"}>
              {t(
                summary.reconciliation.matches
                  ? "payroll.ui.reconciled"
                  : "payroll.ui.notReconciled",
              )}
            </Tag>
          )}
        </Space>
      </div>
      <RunHeadlineTotals
        run={run}
        summary={summary}
        costIncompleteReasons={costIncompleteReasons}
        onValidation={() => setTab("validation")}
      />

      <Card styles={{ body: { padding: 16 } }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "items",
              label: t("payroll.ui.employeesTab"),
              children: (
                <PayrollItemsGrid
                  runId={run.id}
                  summary={summary}
                  refreshKey={gridKey}
                  report={loading ? null : report}
                  runStatus={run.status}
                  legacy={run.legacy_calculation}
                  revision={run.revision}
                  onChanged={loadAll}
                  initialState={listState}
                  onIndexLoaded={setRecordIndex}
                  onOpenItem={(item, session) => openItem(item.id, session)}
                />
              ),
            },
            {
              key: "validation",
              // One visual badge; the accessible name retains exact actionable counts.
              label: (
                <span
                  aria-label={
                    report
                      ? t("payroll.ux3.validationCounts", {
                          errors:
                            validationView?.blocking ?? report.counts.errors,
                          warnings:
                            validationView?.warnings ?? report.counts.warnings,
                        })
                      : t("payroll.ui.validation")
                  }
                >
                  {t("payroll.ui.validation")}
                  {report && (
                    <bdi
                      dir="ltr"
                      aria-hidden="true"
                      style={{ display: "inline-block", marginInlineStart: 6 }}
                    >
                      <Badge
                        style={{ direction: "ltr" }}
                        count={
                          (validationView?.blocking ?? report.counts.errors) +
                          (validationView?.warnings ?? report.counts.warnings)
                        }
                        overflowCount={99}
                      />
                    </bdi>
                  )}
                </span>
              ),
              children: report ? (
                <ValidationPanel
                  report={report}
                  legacy={run.legacy_calculation}
                  finalized={finalized}
                  index={recordIndex}
                  onQuickNone={quickNone}
                  onOpenItem={(id, target) => openItem(id, undefined, target)}
                />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message={t("payroll.ui.validationUnavailable")}
                />
              ),
            },
            {
              key: "accommodation",
              label: t("payroll.ui.accommodationTab"),
              children: (
                <AccommodationReport
                  runId={run.id}
                  refreshKey={gridKey}
                  index={recordIndex}
                  onQuickNone={quickNone}
                />
              ),
            },
          ]}
        />
      </Card>

      <ReasonModal
        open={action !== null}
        title={action ? actionTitles[action] : ""}
        description={action ? actionDescriptions[action] : undefined}
        okText={action ? actionOk[action] : undefined}
        okDanger={action === "cancel"}
        submitting={submitting}
        reasonError={reasonError}
        formError={modalError}
        extra={
          action === "recalculate" ? (
            <div style={{ marginBottom: 12 }}>
              <Checkbox
                checked={refreshSettings}
                onChange={(event) => setRefreshSettings(event.target.checked)}
              >
                {t("payroll.ui.refreshSettings")}
              </Checkbox>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("payroll.ui.refreshSettingsHelp", {
                    revision: run.settings_revision,
                  })}
                </Text>
              </div>
            </div>
          ) : undefined
        }
        onSubmit={(reason) => void submitAction(reason)}
        onCancel={() => setAction(null)}
      />
    </PayrollTheme>
  );
}
