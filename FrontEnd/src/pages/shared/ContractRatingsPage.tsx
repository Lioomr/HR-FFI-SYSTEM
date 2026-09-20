import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  EyeOutlined,
  FilePdfOutlined,
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
  StarOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import ResponsiveTable from "../../components/ui/ResponsiveTable";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import ApprovalTimeline from "../../components/requests/ApprovalTimeline";
import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import ApprovalSurface from "../../components/ceo/ApprovalSurface";
import ApprovalStatusTag, {
  type ApprovalStatusTone,
} from "../../components/ceo/ApprovalStatusTag";
import RatingComparisonView from "../../components/ratings/RatingComparisonView";
import CeoRatingDecisionPanel from "../../components/ratings/CeoRatingDecisionPanel";
import {
  CeoOutcomeTag,
  RatingActionErrors,
  RatingOutcomeDetails,
} from "../../components/ratings/RatingOutcomeDetails";
import {
  RatingHeaderDetails,
  RatingResponseDetails,
  SalaryTermsTags,
} from "../../components/ratings/RatingResponseDetails";
import { useRatingCriteria } from "../../components/ratings/ratingHelpers";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";
import { isApiError, type ApiResponse } from "../../services/api/apiTypes";
import { collectApiErrorMessages } from "../../utils/formErrors";
import {
  getHttpErrorMessage,
  isForbidden,
  isNotFound,
  isValidationError,
} from "../../services/api/httpErrors";
import { triggerBlobDownload } from "../../services/api/downloads";
import { previewBlob } from "../../utils/download";
import {
  acknowledgeRatingTerminationNotice,
  downloadContractRatingPdf,
  getContractRating,
  isRatedFullContractRating,
  listContractRatings,
  requestRatingHrComment,
  submitRatingCeoDecision,
  submitRatingHrComment,
  submitRatingHrGate,
  type CeoDecisionPayload,
  type ContractRatingStatus,
  type ContractRatingView,
  type FullContractRating,
  type HrCoarseContractRatingView,
  type RatingMode,
} from "../../services/api/contractRatingsApi";

const { Paragraph, Text } = Typography;

const HR_STATUS_OPTIONS: ContractRatingStatus[] = [
  "PENDING_HR_GATE",
  "PENDING_RESPONSES",
  "WAITING_MANAGER",
  "WAITING_EMPLOYEE",
  "PENDING_CEO",
  "DECIDED",
  "MANUAL_RESOLUTION_REQUIRED",
];

/** The CEO list is scoped server-side to PENDING_CEO + own decisions. */
const CEO_STATUS_OPTIONS: ContractRatingStatus[] = [
  "PENDING_CEO",
  "DECIDED",
  "MANUAL_RESOLUTION_REQUIRED",
];

/** Which control raised the current errors, so they render only there. */
type ActionScope = "gate" | "comment" | "decision" | "acknowledge";

function statusTone(status: ContractRatingStatus): ApprovalStatusTone {
  if (status === "DECIDED") return "approved";
  if (status === "MANUAL_RESOLUTION_REQUIRED") return "rejected";
  if (status.startsWith("PENDING")) return "pending";
  return "inProgress";
}

/** Outcome, whichever shape carries it. */
function outcomeOf(view: ContractRatingView) {
  if (view.viewer === "full") return view.ceo_decision;
  if (view.viewer === "hr_coarse") return view.outcome?.ceo_decision ?? "";
  return "";
}

export default function ContractRatingsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isCeoRoute = location.pathname.startsWith("/ceo/");
  const basePath = isCeoRoute ? "/ceo/contract-ratings" : "/hr/contract-ratings";
  // Same destinations ContractDecisionsPage uses for its employee links.
  const employeeProfilePath = (employeeId: number) =>
    isCeoRoute ? `/manager/team/${employeeId}` : `/hr/employees/${employeeId}`;

  const { criteria, error: criteriaError } = useRatingCriteria();
  const [records, setRecords] = useState<ContractRatingView[]>([]);
  const [record, setRecord] = useState<ContractRatingView | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    ContractRatingStatus | undefined
  >(isCeoRoute ? "PENDING_CEO" : "PENDING_HR_GATE");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const [errorScope, setErrorScope] = useState<ActionScope | null>(null);
  const [hrComment, setHrComment] = useState("");
  const [pdfAction, setPdfAction] = useState<"preview" | "download" | null>(
    null,
  );
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (id) {
        const response = await getContractRating(id);
        if (isApiError(response)) throw new Error(response.message);
        setRecord(response.data);
        if (response.data.viewer === "full") {
          setHrComment(response.data.hr_comment ?? "");
        }
        return;
      }
      const response = await listContractRatings({
        status: statusFilter,
        page: 1,
        page_size: 100,
      });
      if (isApiError(response)) throw new Error(response.message);
      setRecords(response.data.items ?? []);
    } catch (error) {
      setLoadError(
        isNotFound(error)
          ? t("contractRatings.notFound")
          : getHttpErrorMessage(error),
      );
    } finally {
      setLoading(false);
    }
  }, [id, statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusLabel = (status: ContractRatingStatus) =>
    t(`contractRatings.status.${status}`, status);

  /**
   * Runs one mutation and reports the status the backend returned (a 200 can
   * carry MANUAL_RESOLUTION_REQUIRED). 422 and 403 messages come from the
   * server and are listed, never swallowed. Resolves true on success.
   */
  const runAction = async (
    scope: ActionScope,
    request: () => Promise<ApiResponse<ContractRatingView | null>>,
  ): Promise<boolean> => {
    setActionLoading(true);
    setActionErrors([]);
    setErrorScope(scope);
    try {
      const response = await request();
      if (isApiError(response)) throw new Error(response.message);
      if (!response.data) {
        // Recorded, but the rating left this viewer's scope (e.g. a CEO
        // return moves it out of PENDING_CEO). Its detail is gone for them.
        messageApi.success(t("contractRatings.doneLeftQueue"));
        navigate(basePath);
        return true;
      }
      if (
        scope === "decision" &&
        isCeoRoute &&
        response.data.viewer === "full" &&
        response.data.status !== "PENDING_CEO" &&
        !response.data.ceo_decision
      ) {
        // A return was recorded. The rating is out of the CEO's scope now, so
        // its detail can no longer be re-fetched — go back to the queue.
        messageApi.success(t("contractRatings.doneLeftQueue"));
        navigate(basePath);
        return true;
      }
      setRecord(response.data);
      const text = t("contractRatings.resultStatus", {
        status: statusLabel(response.data.status),
      });
      if (response.data.status === "MANUAL_RESOLUTION_REQUIRED") {
        messageApi.warning(text);
      } else {
        messageApi.success(text);
      }
      return true;
    } catch (error) {
      if (isValidationError(error)) {
        const messages = collectApiErrorMessages(error);
        setActionErrors(
          messages.length ? messages : [getHttpErrorMessage(error)],
        );
      } else if (isForbidden(error)) {
        setActionErrors([
          getHttpErrorMessage(error),
          t("contractRatings.staleAction"),
        ]);
        await load();
      } else {
        setActionErrors([getHttpErrorMessage(error)]);
      }
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const runPdf = async (action: "preview" | "download") => {
    if (!id) return;
    const tab =
      action === "preview" ? window.open("about:blank", "_blank") : null;
    setPdfAction(action);
    try {
      const blob = await downloadContractRatingPdf(id);
      if (action === "download") {
        triggerBlobDownload(blob, `contract_rating_${id}.pdf`);
      } else if (!(await previewBlob(blob, tab))) {
        messageApi.error(t("contractRatings.pdfPreviewFailed"));
      }
    } catch (error) {
      tab?.close();
      messageApi.error(
        isForbidden(error)
          ? getHttpErrorMessage(error)
          : t(
              action === "preview"
                ? "contractRatings.pdfPreviewFailed"
                : "contractRatings.pdfFailed",
            ),
      );
    } finally {
      setPdfAction(null);
    }
  };

  const errorsFor = (scope: ActionScope) =>
    errorScope === scope ? actionErrors : [];

  const confirmGate = (ratingId: number, mode: RatingMode) => {
    setActionErrors([]);
    void modal.confirm({
      title: t(`contractRatings.gateConfirmTitle.${mode}`),
      content: t(`contractRatings.gateConfirmBody.${mode}`),
      okText: t(`contractRatings.gateAction.${mode}`),
      cancelText: t("common.cancel"),
      onOk: () => runAction("gate", () => submitRatingHrGate(ratingId, mode)),
    });
  };

  const confirmAcknowledge = (ratingId: number) => {
    setActionErrors([]);
    void modal.confirm({
      title: t("contractRatings.acknowledgeTitle"),
      content: t("contractRatings.acknowledgeBody"),
      okText: t("contractRatings.acknowledge"),
      cancelText: t("common.cancel"),
      onOk: () =>
        runAction("acknowledge", () =>
          acknowledgeRatingTerminationNotice(ratingId),
        ),
    });
  };

  // ── List ────────────────────────────────────────────────────────────────
  if (!id) {
    const pendingStatus: ContractRatingStatus = isCeoRoute
      ? "PENDING_CEO"
      : "PENDING_HR_GATE";
    const columns: ColumnsType<ContractRatingView> = [
      {
        title: t("contractRatings.employee"),
        key: "employee",
        render: (_, item) => (
          <Link
            to={`${basePath}/${item.id}`}
            style={{ color: "#f97316", fontWeight: 600, textDecoration: "none" }}
          >
            {item.employee.full_name || item.employee.employee_id}
          </Link>
        ),
      },
      {
        title: t("contractRatings.contractExpiry"),
        dataIndex: "contract_expiry",
        responsive: ["sm"],
        render: (value: string | null) => formatDateOnly(value),
      },
      {
        title: t("contractRatings.statusLabel"),
        dataIndex: "status",
        render: (value: ContractRatingStatus) => (
          <ApprovalStatusTag label={statusLabel(value)} tone={statusTone(value)} />
        ),
      },
      {
        title: t("contractRatings.routing"),
        key: "routing",
        responsive: ["md"],
        render: (_, item) => (
          <Space size={4} wrap>
            <RatingModeTag mode={item.rating_mode} />
            {item.viewer === "hr_coarse" && item.gate ? (
              <AccountConnectedTag connected={item.gate.account_connected} />
            ) : null}
          </Space>
        ),
      },
      {
        title: t("contractRatings.ceoDecision"),
        key: "outcome",
        responsive: ["md"],
        render: (_, item) => <CeoOutcomeTag decision={outcomeOf(item)} />,
      },
      {
        title: t("common.actions"),
        key: "actions",
        render: (_, item) => (
          <Button size="small" onClick={() => navigate(`${basePath}/${item.id}`)}>
            {t("common.view")}
          </Button>
        ),
      },
    ];

    return (
      <>
        {messageContext}
        <ApprovalQueuePage
          title={t("contractRatings.title")}
          subtitle={
            isCeoRoute
              ? t("contractRatings.subtitleCeo")
              : t("contractRatings.subtitleHr")
          }
          pendingCount={
            records.filter((item) => item.status === pendingStatus).length
          }
          loading={loading && !records.length}
          error={loadError}
          isEmpty={!loading && !records.length}
          emptyTitle={t("contractRatings.empty")}
          emptyDescription={t("contractRatings.emptyDescription")}
          onRetry={() => void load()}
          onRefresh={() => void load()}
          refreshing={loading}
          filters={
            <Space wrap>
              <Text>{t("contractRatings.filter")}</Text>
              <Select
                value={statusFilter}
                onChange={(value: ContractRatingStatus | undefined) =>
                  setStatusFilter(value)
                }
                allowClear
                style={{ minWidth: 240 }}
                aria-label={t("contractRatings.filter")}
                options={(isCeoRoute ? CEO_STATUS_OPTIONS : HR_STATUS_OPTIONS).map(
                  (value) => ({ value, label: statusLabel(value) }),
                )}
              />
            </Space>
          }
        >
          <ResponsiveTable
            mobileCard={{ titleKey: "employee", extraKey: "status" }}
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={records}
            scroll={{ x: "max-content" }}
            pagination={{ pageSize: 20 }}
          />
        </ApprovalQueuePage>
      </>
    );
  }

  // ── Detail ──────────────────────────────────────────────────────────────
  if (!record) {
    if (loading) return <LoadingState title={t("contractRatings.loading")} />;
    return (
      <ErrorState
        title={t("common.error")}
        description={loadError ?? t("contractRatings.notFound")}
        onRetry={() => void load()}
      />
    );
  }

  const canDownloadPdf = record.viewer === "full";
  const header = (
    <PageHeader
      title={t("contractRatings.detailTitle")}
      subtitle={record.employee.full_name}
      actions={
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            loading={loading}
          >
            {t("common.refresh")}
          </Button>
          {canDownloadPdf ? (
            <>
              <Button
                icon={<EyeOutlined />}
                loading={pdfAction === "preview"}
                onClick={() => void runPdf("preview")}
              >
                {t("contractRatings.previewPdf")}
              </Button>
              <Button
                icon={<FilePdfOutlined />}
                loading={pdfAction === "download"}
                onClick={() => void runPdf("download")}
              >
                {t("contractRatings.downloadPdf")}
              </Button>
            </>
          ) : null}
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(basePath)}>
            {t("common.back")}
          </Button>
        </Space>
      }
    />
  );

  const alerts = (
    <>
      {loadError ? (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={loadError} />
      ) : null}
      {record.status === "MANUAL_RESOLUTION_REQUIRED" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.manualResolutionNotice")}
          description={t("contractRatings.manualResolutionHint")}
        />
      ) : null}
    </>
  );

  // A privileged user who is also this employee's manager, or the employee
  // themself, receives only their own side. Point them at their own page.
  if (record.viewer === "employee" || record.viewer === "manager") {
    const ownPath = `/${record.viewer}/contract-ratings/${record.id}`;
    return (
      <>
        {header}
        <Card style={{ marginBottom: 16 }}>
          <RatingHeaderDetails rating={record} />
        </Card>
        <Alert
          type="info"
          showIcon
          message={t("contractRatings.restrictedViewTitle")}
          description={t("contractRatings.restrictedViewBody")}
          action={
            <Button size="small" onClick={() => navigate(ownPath)}>
              {t("contractRatings.openOwnPage")}
            </Button>
          }
        />
      </>
    );
  }

  if (record.viewer === "hr_coarse") {
    return (
      <>
        {messageContext}
        {modalContext}
        {header}
        {alerts}
        {renderCoarse(record)}
      </>
    );
  }

  return (
    <>
      {messageContext}
      {modalContext}
      {header}
      {alerts}
      {renderFull(record)}
    </>
  );

  /** HR without a CEO comment request: status, routing gate, outcome only. */
  function renderCoarse(item: HrCoarseContractRatingView) {
    const gateOpen = item.status === "PENDING_HR_GATE";
    const canAcknowledge =
      !isCeoRoute &&
      item.status === "DECIDED" &&
      item.outcome?.ceo_decision === "TERMINATE" &&
      item.outcome.scheduled_termination &&
      !item.outcome.employee_notified_of_termination_at;
    return (
      <>
        <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <RatingHeaderDetails
              rating={item}
              profileHref={employeeProfilePath(item.employee.id)}
            />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label={t("contractRatings.routing")}>
                <RatingModeTag mode={item.rating_mode} />
              </Descriptions.Item>
            </Descriptions>
          </Space>
        </ApprovalSurface>

        {gateOpen && item.gate && !isCeoRoute ? (
          <Card title={t("contractRatings.gateTitle")} style={{ marginBottom: 16 }}>
            <RatingActionErrors errors={errorsFor("gate")} />
            <Paragraph>{t("contractRatings.gateBody")}</Paragraph>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Space wrap>
                <Text strong>{t("contractRatings.accountConnected")}:</Text>
                <AccountConnectedTag connected={item.gate.account_connected} />
              </Space>
              {!item.gate.account_connected ? (
                <Alert
                  type="info"
                  showIcon
                  message={t("contractRatings.accountNotConnectedHint")}
                />
              ) : null}
              <Space wrap>
                <Button
                  type="primary"
                  icon={<StarOutlined aria-hidden />}
                  loading={actionLoading}
                  onClick={() => confirmGate(item.id, "RATE")}
                >
                  {t("contractRatings.gateAction.RATE")}
                </Button>
                <Button
                  icon={<SendOutlined aria-hidden />}
                  disabled={actionLoading}
                  onClick={() => confirmGate(item.id, "SKIP_TO_CEO")}
                >
                  {t("contractRatings.gateAction.SKIP_TO_CEO")}
                </Button>
              </Space>
            </Space>
          </Card>
        ) : gateOpen ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("contractRatings.gateNotYours")}
          />
        ) : null}

        {!gateOpen && !item.outcome ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("contractRatings.coarseTitle")}
            description={
              isCeoRoute
                ? t("contractRatings.coarseBodyCeoRoute")
                : t("contractRatings.coarseBody")
            }
          />
        ) : null}

        {item.outcome ? (
          <Card title={t("contractRatings.outcomeSection")} style={{ marginBottom: 16 }}>
            <RatingActionErrors errors={errorsFor("acknowledge")} />
            <RatingOutcomeDetails
              outcome={item.outcome}
              contractExpiry={item.contract_expiry}
            />
            {item.outcome.scheduled_termination ? (
              <Descriptions bordered size="small" column={1} style={{ marginTop: 12 }}>
                <Descriptions.Item label={t("contractRatings.employeeNotified")}>
                  {item.outcome.employee_notified_of_termination_at
                    ? formatDateTimeShort(
                        item.outcome.employee_notified_of_termination_at,
                      )
                    : t("contractRatings.employeeNotNotified")}
                </Descriptions.Item>
              </Descriptions>
            ) : null}
            {canAcknowledge ? (
              <Space direction="vertical" style={{ marginTop: 16 }}>
                <Text type="secondary">{t("contractRatings.acknowledgeHint")}</Text>
                <Button
                  type="primary"
                  icon={<CheckOutlined aria-hidden />}
                  loading={actionLoading}
                  onClick={() => confirmAcknowledge(item.id)}
                >
                  {t("contractRatings.acknowledge")}
                </Button>
              </Space>
            ) : null}
          </Card>
        ) : null}
      </>
    );
  }

  /** The CEO's package, or HR's once the CEO requested a comment. */
  function renderFull(item: FullContractRating) {
    const criteriaList = criteria?.criteria ?? [];
    const ceoPending = isCeoRoute && item.status === "PENDING_CEO";
    const canCeoAct = ceoPending && item.workflow?.can_approve !== false;
    const canAcknowledge =
      !isCeoRoute &&
      item.status === "DECIDED" &&
      item.ceo_decision === "TERMINATE" &&
      item.scheduled_termination &&
      !item.employee_notified_of_termination_at;

    return (
      <>
        {criteriaError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={criteriaError}
          />
        ) : null}

        {/* A. Employee details + F. existing contract */}
        <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <RatingHeaderDetails
              rating={item}
              profileHref={employeeProfilePath(item.employee.id)}
            />
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label={t("contractRatings.routing")}>
                <RatingModeTag mode={item.rating_mode} />
              </Descriptions.Item>
              <Descriptions.Item label={t("contractRatings.remainingDays")}>
                {item.remaining_contract_days ?? "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("contractRatings.employmentStatus")}>
                {item.employment_status || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("contractRatings.profileArchived")}>
                {item.is_archived ? t("common.yes") : t("common.no")}
              </Descriptions.Item>
              <Descriptions.Item label={t("contractRatings.currentSalary")} span={2}>
                <SalaryTermsTags terms={item.current_terms} />
              </Descriptions.Item>
            </Descriptions>
          </Space>
        </ApprovalSurface>

        {/* B, C, D. Evaluations and comparison — or the skipped banner */}
        {isRatedFullContractRating(item) ? (
          <Card style={{ marginBottom: 16 }}>
            <Tabs
              items={[
                {
                  key: "comparison",
                  label: t("contractRatings.comparison"),
                  children: (
                    <RatingComparisonView rating={item} criteria={criteriaList} />
                  ),
                },
                {
                  key: "manager",
                  label: t("contractRatings.managerEvaluation"),
                  children: item.manager_response ? (
                    <RatingResponseDetails
                      response={item.manager_response}
                      criteria={criteriaList}
                    />
                  ) : (
                    <Text type="secondary">
                      {t("contractRatings.notSubmittedYet")}
                    </Text>
                  ),
                },
                {
                  key: "employee",
                  label: t("contractRatings.employeeEvaluation"),
                  children: item.employee_response ? (
                    <RatingResponseDetails
                      response={item.employee_response}
                      criteria={criteriaList}
                    />
                  ) : (
                    <Text type="secondary">
                      {t("contractRatings.notSubmittedYet")}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("contractRatings.skippedTitle")}
            description={t("contractRatings.skippedBody", {
              name: item.hr_gate_decided_by_name || "—",
              date: item.hr_gate_decided_at
                ? formatDateTimeShort(item.hr_gate_decided_at)
                : "—",
            })}
          />
        )}

        {/* E. Advisory HR comment */}
        <Card
          title={
            <Space>
              <MessageOutlined aria-hidden />
              {t("contractRatings.hrCommentSection")}
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {renderHrComment(item, ceoPending && canCeoAct)}
        </Card>

        {/* Decision outcome, once recorded */}
        {item.ceo_decision ? (
          <Card title={t("contractRatings.outcomeSection")} style={{ marginBottom: 16 }}>
            <RatingOutcomeDetails
              outcome={{ ...item, ceo_decision: item.ceo_decision }}
              contractExpiry={item.contract_expiry}
            />
            {item.scheduled_termination ? (
              <Descriptions bordered size="small" column={1} style={{ marginTop: 12 }}>
                <Descriptions.Item label={t("contractRatings.employeeNotified")}>
                  {item.employee_notified_of_termination_at
                    ? formatDateTimeShort(item.employee_notified_of_termination_at)
                    : t("contractRatings.employeeNotNotified")}
                </Descriptions.Item>
              </Descriptions>
            ) : null}
            {canAcknowledge ? (
              <Space direction="vertical" style={{ marginTop: 16 }}>
                <RatingActionErrors errors={errorsFor("acknowledge")} />
                <Button
                  type="primary"
                  icon={<CheckOutlined aria-hidden />}
                  loading={actionLoading}
                  onClick={() => confirmAcknowledge(item.id)}
                >
                  {t("contractRatings.acknowledge")}
                </Button>
              </Space>
            ) : null}
          </Card>
        ) : null}

        {/* CEO decision */}
        {ceoPending ? (
          <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
            {canCeoAct ? (
              <CeoRatingDecisionPanel
                rating={item}
                loading={actionLoading}
                errors={errorsFor("decision")}
                onClearErrors={() => setActionErrors([])}
                onDecide={(payload: CeoDecisionPayload) =>
                  runAction("decision", () =>
                    submitRatingCeoDecision(item.id, payload),
                  )
                }
              />
            ) : (
              <Alert type="info" showIcon message={t("contractRatings.ceoCannotAct")} />
            )}
          </ApprovalSurface>
        ) : null}

        {/* G. Workflow history */}
        <Card title={t("contractRatings.history")}>
          {item.workflow?.history?.length ? (
            <ApprovalTimeline workflow={item.workflow} />
          ) : (
            <Text type="secondary">{t("contractRatings.historyEmpty")}</Text>
          )}
        </Card>
      </>
    );
  }

  function renderHrComment(item: FullContractRating, ceoCanRequest: boolean) {
    const requested = Boolean(item.hr_comment_requested_at);
    const commentBlock = item.hr_comment_submitted_at ? (
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label={t("contractRatings.hrCommentBy")}>
          {item.hr_comment_by_name || "—"} ·{" "}
          {formatDateTimeShort(item.hr_comment_submitted_at)}
        </Descriptions.Item>
        <Descriptions.Item label={t("contractRatings.hrComment")}>
          <span style={{ whiteSpace: "pre-wrap" }}>{item.hr_comment}</span>
        </Descriptions.Item>
      </Descriptions>
    ) : null;

    if (isCeoRoute) {
      if (!requested) {
        return ceoCanRequest ? (
          <Space direction="vertical">
            <RatingActionErrors errors={errorsFor("comment")} />
            <Text type="secondary">{t("contractRatings.requestHrCommentHint")}</Text>
            <Button
              icon={<MessageOutlined aria-hidden />}
              loading={actionLoading}
              onClick={() => {
                setActionErrors([]);
                void runAction("comment", () => requestRatingHrComment(item.id));
              }}
            >
              {t("contractRatings.requestHrComment")}
            </Button>
          </Space>
        ) : (
          <Text type="secondary">{t("contractRatings.hrCommentNotRequested")}</Text>
        );
      }
      return (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">
            {t("contractRatings.hrCommentRequestedAt", {
              name: item.hr_comment_requested_by_name || "—",
              date: formatDateTimeShort(item.hr_comment_requested_at),
            })}
          </Text>
          {commentBlock ?? (
            <Alert type="info" showIcon message={t("contractRatings.hrCommentAwaiting")} />
          )}
        </Space>
      );
    }

    // HR: the only input HR has on the content — an advisory comment.
    return (
      <Space direction="vertical" style={{ width: "100%" }}>
        <Text type="secondary">
          {t("contractRatings.hrCommentRequestedAt", {
            name: item.hr_comment_requested_by_name || "—",
            date: formatDateTimeShort(item.hr_comment_requested_at),
          })}
        </Text>
        {item.status === "DECIDED" ? (
          <Alert type="warning" showIcon message={t("contractRatings.hrCommentAfterDecision")} />
        ) : (
          <Alert type="info" showIcon message={t("contractRatings.hrCommentAdvisory")} />
        )}
        {commentBlock}
        <RatingActionErrors errors={errorsFor("comment")} />
        <Input.TextArea
          rows={4}
          value={hrComment}
          onChange={(event) => setHrComment(event.target.value)}
          aria-label={t("contractRatings.hrComment")}
          placeholder={t("contractRatings.hrCommentPlaceholder")}
        />
        <Button
          type="primary"
          icon={<MessageOutlined aria-hidden />}
          loading={actionLoading}
          disabled={!hrComment.trim()}
          onClick={() =>
            void runAction("comment", () =>
              submitRatingHrComment(item.id, hrComment.trim()),
            )
          }
        >
          {item.hr_comment_submitted_at
            ? t("contractRatings.updateHrComment")
            : t("contractRatings.submitHrComment")}
        </Button>
      </Space>
    );
  }
}

function RatingModeTag({ mode }: { mode: RatingMode | "" }) {
  const { t } = useI18n();
  if (!mode) {
    return <Tag>{t("contractRatings.ratingMode.UNDECIDED")}</Tag>;
  }
  return (
    <Tag color={mode === "RATE" ? "blue" : "purple"}>
      {t(`contractRatings.ratingMode.${mode}`)}
    </Tag>
  );
}

function AccountConnectedTag({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  return connected ? (
    <Tag color="green">{t("contractRatings.accountLinked")}</Tag>
  ) : (
    <Tag color="orange">{t("contractRatings.accountNotLinked")}</Tag>
  );
}
