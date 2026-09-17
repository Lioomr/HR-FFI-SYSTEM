import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Radio,
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
  ReloadOutlined,
  RollbackOutlined,
  SwapOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import ResponsiveTable from "../../components/ui/ResponsiveTable";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import ApprovalTimeline from "../../components/requests/ApprovalTimeline";
import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import ApprovalSurface from "../../components/ceo/ApprovalSurface";
import ApprovalActions from "../../components/ceo/ApprovalActions";
import ApprovalStatusTag from "../../components/ceo/ApprovalStatusTag";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import RatingComparisonView from "../../components/ratings/RatingComparisonView";
import {
  RatingHeaderDetails,
  RatingResponseDetails,
  RecommendationSummary,
  SalaryTermsTags,
} from "../../components/ratings/RatingResponseDetails";
import { useAuthStore } from "../../auth/authStore";
import {
  SALARY_PATTERN,
  useRatingCriteria,
} from "../../components/ratings/ratingHelpers";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";
import { isApiError } from "../../services/api/apiTypes";
import { collectApiErrorMessages } from "../../utils/formErrors";
import {
  getHttpErrorMessage,
  isForbidden,
  isNotFound,
  isValidationError,
} from "../../services/api/httpErrors";
import {
  CONTRACT_SALARY_COMPONENTS,
  type ContractDecisionType,
  type ContractSalaryComponent,
  type ContractSalaryTerms,
} from "../../services/api/contractDecisionsApi";
import {
  acknowledgeRatingTerminationNotice,
  getContractRating,
  isFullContractRating,
  listContractRatings,
  submitRatingCeoDecision,
  submitRatingHrReview,
  type CeoDecisionPayload,
  type ContractRatingStatus,
  type ContractRatingView,
  type FullContractRating,
  type HrReviewAction,
} from "../../services/api/contractRatingsApi";

const { Text } = Typography;

const STATUS_OPTIONS: ContractRatingStatus[] = [
  "PENDING_RESPONSES",
  "WAITING_MANAGER",
  "WAITING_EMPLOYEE",
  "PENDING_HR",
  "PENDING_CEO",
  "APPROVED",
  "REJECTED",
  "MANUAL_RESOLUTION_REQUIRED",
];

const ALTERNATIVE_OPTIONS: ContractDecisionType[] = [
  "RENEW",
  "RENEW_WITH_CHANGES",
  "TERMINATE",
];

type HrReturnTarget = "return-manager" | "return-employee" | "return-both";

type AlternativeValues = {
  ceo_selected_option?: ContractDecisionType;
  comment?: string;
  override_salary?: boolean;
  terms?: Partial<Record<ContractSalaryComponent, string>>;
  ceo_salary_override_reason?: string;
};

export default function ContractRatingsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const user = useAuthStore((state) => state.user);
  const isCeoRoute = location.pathname.startsWith("/ceo/");
  const isCeo = isCeoRoute || user?.role === "CEO";
  const isHr =
    !isCeoRoute && (user?.role === "HRManager" || user?.role === "SystemAdmin");
  const basePath = isCeo ? "/ceo/contract-ratings" : "/hr/contract-ratings";

  const { criteria, error: criteriaError } = useRatingCriteria();
  const [records, setRecords] = useState<ContractRatingView[]>([]);
  const [record, setRecord] = useState<ContractRatingView | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    ContractRatingStatus | undefined
  >(isCeo ? "PENDING_CEO" : "PENDING_HR");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();

  // HR dialogs
  const [hrApproveOpen, setHrApproveOpen] = useState(false);
  const [hrApproveComment, setHrApproveComment] = useState("");
  const [hrReturnOpen, setHrReturnOpen] = useState(false);
  const [hrReturnTarget, setHrReturnTarget] =
    useState<HrReturnTarget>("return-manager");
  const [hrReturnReason, setHrReturnReason] = useState("");

  // CEO dialogs
  const [ceoAcceptOpen, setCeoAcceptOpen] = useState(false);
  const [ceoAcceptComment, setCeoAcceptComment] = useState("");
  const [ceoReturnReason, setCeoReturnReason] = useState("");
  const [reasonAction, setReasonAction] = useState<
    "DECLINE" | "RETURN_TO_HR" | null
  >(null);
  const [alternativeOpen, setAlternativeOpen] = useState(false);
  const [alternativeForm] = Form.useForm<AlternativeValues>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (id) {
        const response = await getContractRating(id);
        if (isApiError(response)) throw new Error(response.message);
        setRecord(response.data);
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
      if (isForbidden(error)) setLoadError(t("contractRatings.forbidden"));
      else if (isNotFound(error)) setLoadError(t("contractRatings.notFound"));
      else setLoadError(getHttpErrorMessage(error));
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
   * Reports the status the backend returned. A 200 can carry
   * MANUAL_RESOLUTION_REQUIRED when the contract changed underneath the rating.
   */
  const announce = (next: ContractRatingView) => {
    const text = t("contractRatings.resultStatus", {
      status: statusLabel(next.status),
    });
    if (
      next.status === "MANUAL_RESOLUTION_REQUIRED" ||
      next.status === "REJECTED"
    ) {
      messageApi.warning(text);
    } else {
      messageApi.success(text);
    }
  };

  /** Runs one mutation; returns true when the dialog may close. */
  const runAction = async (
    request: () => Promise<
      Awaited<ReturnType<typeof submitRatingHrReview>>
    >,
  ): Promise<boolean> => {
    setActionLoading(true);
    setActionErrors([]);
    try {
      const response = await request();
      if (isApiError(response)) throw new Error(response.message);
      setRecord(response.data);
      announce(response.data);
      return true;
    } catch (error) {
      if (isValidationError(error)) {
        setActionErrors(collectApiErrorMessages(error));
      } else if (isForbidden(error)) {
        setActionErrors([t("contractRatings.staleAction")]);
        await load();
      } else {
        setActionErrors([getHttpErrorMessage(error)]);
      }
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const hrReview = async (action: HrReviewAction, comment: string) => {
    if (!record) return false;
    return runAction(() =>
      submitRatingHrReview(record.id, { action, comment }),
    );
  };

  const ceoDecide = async (payload: CeoDecisionPayload) => {
    if (!record) return false;
    return runAction(() => submitRatingCeoDecision(record.id, payload));
  };

  const acknowledge = () => {
    if (!record) return;
    void modal.confirm({
      title: t("contractRatings.acknowledgeTitle"),
      content: t("contractRatings.acknowledgeBody"),
      okText: t("contractRatings.acknowledge"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        const ok = await runAction(() =>
          acknowledgeRatingTerminationNotice(record.id),
        );
        if (!ok) messageApi.error(t("contractRatings.actionFailed"));
      },
    });
  };

  // ── List ────────────────────────────────────────────────────────────────
  if (!id) {
    const pendingStatus: ContractRatingStatus = isCeo
      ? "PENDING_CEO"
      : "PENDING_HR";
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
          <ApprovalStatusTag label={statusLabel(value)} status={value} />
        ),
      },
      {
        title: t("contractRatings.recommendation"),
        key: "recommendation",
        responsive: ["md"],
        render: (_, item) =>
          isFullContractRating(item) &&
          item.manager_response?.recommendation ? (
            <Tag
              color={
                item.manager_response.recommendation === "TERMINATE"
                  ? "red"
                  : "blue"
              }
            >
              {t(
                `contractRatings.recommendationLabel.${item.manager_response.recommendation}`,
              )}
            </Tag>
          ) : (
            "—"
          ),
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
            isCeo
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
                options={STATUS_OPTIONS.map((value) => ({
                  value,
                  label: statusLabel(value),
                }))}
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
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(basePath)}>
            {t("common.back")}
          </Button>
        </Space>
      }
    />
  );

  // A privileged user who is also this employee's manager, or the employee
  // themself, receives the restricted payload. Point them at their own page
  // rather than rendering an HR view from data that is not there.
  if (!isFullContractRating(record)) {
    const ownPath =
      "employee_response" in record
        ? `/employee/contract-ratings/${record.id}`
        : `/manager/contract-ratings/${record.id}`;
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

  const item: FullContractRating = record;
  const criteriaList = criteria?.criteria ?? [];
  const manager = item.manager_response;
  const employee = item.employee_response;
  const canHrReview = isHr && item.status === "PENDING_HR";
  const ceoPending = isCeo && item.status === "PENDING_CEO";
  const canCeoDecide = ceoPending && Boolean(item.workflow?.can_approve);
  const canAcknowledge =
    isHr &&
    item.status === "APPROVED" &&
    item.scheduled_termination &&
    !item.employee_notified_of_termination_at;
  const hasSalaryProposal = Boolean(
    manager?.recommended_change_types?.includes("SALARY_INCREASE") ||
      item.salary_change_proposed,
  );

  const openAlternative = () => {
    setActionErrors([]);
    alternativeForm.resetFields();
    const proposed: Partial<Record<ContractSalaryComponent, string>> = {};
    const base =
      manager?.proposed_terms && Object.keys(manager.proposed_terms).length
        ? manager.proposed_terms
        : item.current_terms;
    for (const field of CONTRACT_SALARY_COMPONENTS) {
      const value = base?.[field];
      if (value != null && value !== "") proposed[field] = String(value);
    }
    alternativeForm.setFieldsValue({ terms: proposed });
    setAlternativeOpen(true);
  };

  const submitAlternative = async (values: AlternativeValues) => {
    const payload: CeoDecisionPayload = {
      action: "DECLINE_WITH_ALTERNATIVE",
      ceo_selected_option: values.ceo_selected_option,
      comment: (values.comment ?? "").trim(),
    };
    if (
      values.ceo_selected_option === "RENEW_WITH_CHANGES" &&
      values.override_salary
    ) {
      const terms: ContractSalaryTerms = {};
      for (const field of CONTRACT_SALARY_COMPONENTS) {
        const raw = (values.terms?.[field] ?? "").trim();
        if (raw) terms[field] = raw;
      }
      payload.ceo_approved_terms = terms;
      payload.ceo_salary_override_reason = (
        values.ceo_salary_override_reason ?? ""
      ).trim();
    }
    if (await ceoDecide(payload)) setAlternativeOpen(false);
  };

  const errorList = actionErrors.length ? (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message={t("contractRatings.validationTitle")}
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {actionErrors.map((text, index) => (
            <li key={`${text}-${index}`}>{text}</li>
          ))}
        </ul>
      }
    />
  ) : null;

  return (
    <>
      {messageContext}
      {modalContext}
      {header}
      {loadError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={loadError}
        />
      ) : null}
      {criteriaError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={criteriaError}
        />
      ) : null}

      {item.status === "MANUAL_RESOLUTION_REQUIRED" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.manualResolutionNotice")}
          description={t("contractRatings.manualResolutionHint")}
        />
      ) : null}

      {item.scheduled_termination && item.status === "APPROVED"
        ? renderTermination(item)
        : null}

      {/* A. Employee details */}
      <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <RatingHeaderDetails rating={item} />
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
            <Descriptions.Item label={t("contractRatings.remainingDays")}>
              {item.remaining_contract_days ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractRatings.employmentStatus")}>
              {item.employment_status || "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractRatings.profileArchived")}>
              {item.is_archived ? t("common.yes") : t("common.no")}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </ApprovalSurface>

      {/* F. Manager recommendation, called out */}
      <Card
        title={t("contractRatings.managerRecommendation")}
        style={{ marginBottom: 16 }}
      >
        {manager ? (
          <RecommendationSummary response={manager} />
        ) : (
          <Text type="secondary">{t("contractRatings.notSubmittedYet")}</Text>
        )}
      </Card>

      {/* G + H. Salary proposal and existing contract terms */}
      <Card title={t("contractRatings.salarySection")} style={{ marginBottom: 16 }}>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label={t("contractRatings.currentSalary")}>
            <SalaryTermsTags terms={item.current_terms} />
          </Descriptions.Item>
          {hasSalaryProposal ? (
            <>
              {Object.keys(item.salary_before_snapshot ?? {}).length ? (
                <Descriptions.Item label={t("contractRatings.salaryBefore")}>
                  <SalaryTermsTags terms={item.salary_before_snapshot} />
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t("contractRatings.proposedSalary")}>
                <SalaryTermsTags terms={manager?.proposed_terms} />
              </Descriptions.Item>
              {Object.keys(item.ceo_approved_terms ?? {}).length ? (
                <Descriptions.Item label={t("contractRatings.ceoApprovedSalary")}>
                  <SalaryTermsTags terms={item.ceo_approved_terms} />
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t("contractRatings.salaryIncrease")}>
                {item.salary_increase_amount}
                {item.salary_increase_percent != null
                  ? ` (${item.salary_increase_percent}%)`
                  : ""}
              </Descriptions.Item>
              <Descriptions.Item label={t("contractRatings.salaryEffectiveDate")}>
                {formatDateOnly(item.salary_effective_date)}
              </Descriptions.Item>
              {item.ceo_salary_override_reason ? (
                <Descriptions.Item label={t("contractRatings.overrideReason")}>
                  {item.ceo_salary_override_reason}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t("contractRatings.salaryApplied")}>
                {item.salary_change_applied_at ? (
                  <Space wrap>
                    <Tag color="green">
                      {formatDateTimeShort(item.salary_change_applied_at)}
                    </Tag>
                    <SalaryTermsTags terms={item.salary_after_snapshot} />
                  </Space>
                ) : (
                  t("contractRatings.salaryNotApplied")
                )}
              </Descriptions.Item>
            </>
          ) : (
            <Descriptions.Item label={t("contractRatings.proposedSalary")}>
              {t("contractRatings.noSalaryProposal")}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* B, C, D. Evaluations and comparison */}
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
              children: manager ? (
                <RatingResponseDetails
                  response={manager}
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
              children: employee ? (
                <RatingResponseDetails
                  response={employee}
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

      {/* E. HR review and CEO decision */}
      <Card title={t("contractRatings.reviewSection")} style={{ marginBottom: 16 }}>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
          <Descriptions.Item label={t("contractRatings.hrReviewedBy")}>
            {item.hr_reviewed_by_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.hrDecidedAt")}>
            {item.hr_decided_at ? formatDateTimeShort(item.hr_decided_at) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.hrComment")} span={2}>
            {item.hr_comment || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.ceoAction")}>
            {item.ceo_action
              ? t(`contractRatings.ceoActionLabel.${item.ceo_action}`)
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.ceoSelectedOption")}>
            {item.ceo_selected_option
              ? t(`contractRatings.alternative.${item.ceo_selected_option}`)
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.ceoDecidedBy")}>
            {item.ceo_decided_by_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.ceoDecidedAt")}>
            {item.ceo_decided_at ? formatDateTimeShort(item.ceo_decided_at) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.ceoComment")} span={2}>
            {item.ceo_comment || "—"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Actions */}
      {canHrReview || canCeoDecide || canAcknowledge || ceoPending ? (
        <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
          {!hrApproveOpen &&
          !hrReturnOpen &&
          !ceoAcceptOpen &&
          !reasonAction &&
          !alternativeOpen
            ? errorList
            : null}
          {canHrReview ? (
            <ApprovalActions
              size="middle"
              approveLabel={t("contractRatings.hrApprove")}
              rejectLabel={t("contractRatings.hrReturn")}
              subjectLabel={item.employee.full_name}
              approveLoading={actionLoading}
              approveDisabled={!manager || !employee}
              onApprove={() => {
                setActionErrors([]);
                setHrApproveComment("");
                setHrApproveOpen(true);
              }}
              onReject={() => {
                setActionErrors([]);
                setHrReturnReason("");
                setHrReturnTarget("return-manager");
                setHrReturnOpen(true);
              }}
            />
          ) : null}
          {ceoPending && !canCeoDecide ? (
            <Alert
              type="info"
              showIcon
              message={t("contractRatings.ceoCannotAct")}
            />
          ) : null}
          {canCeoDecide ? (
            <Space wrap>
              <ApprovalActions
                size="middle"
                approveLabel={t("contractRatings.ceoActionLabel.ACCEPT")}
                rejectLabel={t("contractRatings.ceoActionLabel.DECLINE")}
                subjectLabel={item.employee.full_name}
                approveLoading={actionLoading}
                onApprove={() => {
                  setActionErrors([]);
                  setCeoAcceptComment("");
                  setCeoAcceptOpen(true);
                }}
                onReject={() => {
                  setActionErrors([]);
                  setReasonAction("DECLINE");
                }}
              />
              <Button
                icon={<SwapOutlined aria-hidden />}
                onClick={openAlternative}
                disabled={actionLoading}
                style={{ borderRadius: 8, fontWeight: 600 }}
              >
                {t("contractRatings.ceoActionLabel.DECLINE_WITH_ALTERNATIVE")}
              </Button>
              <Button
                icon={<RollbackOutlined aria-hidden />}
                onClick={() => {
                  setActionErrors([]);
                  setCeoReturnReason("");
                  setReasonAction("RETURN_TO_HR");
                }}
                disabled={actionLoading}
                style={{ borderRadius: 8, fontWeight: 600 }}
              >
                {t("contractRatings.ceoActionLabel.RETURN_TO_HR")}
              </Button>
            </Space>
          ) : null}
          {canAcknowledge ? (
            <Button
              type="primary"
              icon={<CheckOutlined aria-hidden />}
              loading={actionLoading}
              onClick={acknowledge}
            >
              {t("contractRatings.acknowledge")}
            </Button>
          ) : null}
        </ApprovalSurface>
      ) : null}

      {/* I. Workflow history */}
      <Card title={t("contractRatings.history")}>
        {item.workflow?.history?.length ? (
          <ApprovalTimeline workflow={item.workflow} />
        ) : (
          <Text type="secondary">{t("contractRatings.historyEmpty")}</Text>
        )}
      </Card>

      {/* HR approve */}
      <Modal
        open={hrApproveOpen}
        title={t("contractRatings.hrApproveTitle")}
        okText={t("contractRatings.hrApprove")}
        cancelText={t("common.cancel")}
        okButtonProps={{ loading: actionLoading }}
        onCancel={() => !actionLoading && setHrApproveOpen(false)}
        onOk={async () => {
          if (await hrReview("approve", hrApproveComment.trim())) {
            setHrApproveOpen(false);
          }
        }}
        destroyOnHidden
      >
        {errorList}
        <Input.TextArea
          rows={3}
          value={hrApproveComment}
          onChange={(event) => setHrApproveComment(event.target.value)}
          placeholder={t("contractRatings.optionalComment")}
          aria-label={t("contractRatings.optionalComment")}
        />
      </Modal>

      {/* HR return */}
      <Modal
        open={hrReturnOpen}
        title={t("contractRatings.hrReturnTitle")}
        okText={t("contractRatings.hrReturn")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true, loading: actionLoading }}
        onCancel={() => !actionLoading && setHrReturnOpen(false)}
        onOk={async () => {
          const reason = hrReturnReason.trim();
          if (!reason) {
            setActionErrors([t("contractRatings.reasonRequired")]);
            return;
          }
          if (await hrReview(hrReturnTarget, reason)) setHrReturnOpen(false);
        }}
        destroyOnHidden
      >
        {errorList}
        <Form layout="vertical">
          <Form.Item label={t("contractRatings.returnTarget")} required>
            <Radio.Group
              value={hrReturnTarget}
              onChange={(event) => setHrReturnTarget(event.target.value)}
              options={(
                [
                  "return-manager",
                  "return-employee",
                  "return-both",
                ] as HrReturnTarget[]
              ).map((value) => ({
                value,
                label: t(`contractRatings.returnTargetLabel.${value}`),
              }))}
            />
          </Form.Item>
          <Form.Item label={t("contractRatings.returnReason")} required>
            <Input.TextArea
              rows={4}
              value={hrReturnReason}
              onChange={(event) => setHrReturnReason(event.target.value)}
              aria-label={t("contractRatings.returnReason")}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* CEO accept */}
      <Modal
        open={ceoAcceptOpen}
        title={t("contractRatings.ceoAcceptTitle")}
        okText={t("contractRatings.ceoActionLabel.ACCEPT")}
        cancelText={t("common.cancel")}
        okButtonProps={{ loading: actionLoading }}
        onCancel={() => !actionLoading && setCeoAcceptOpen(false)}
        onOk={async () => {
          if (
            await ceoDecide({
              action: "ACCEPT",
              comment: ceoAcceptComment.trim(),
            })
          ) {
            setCeoAcceptOpen(false);
          }
        }}
        destroyOnHidden
      >
        {errorList}
        <Alert
          type={manager?.recommendation === "TERMINATE" ? "warning" : "info"}
          showIcon
          style={{ marginBottom: 12 }}
          message={t(
            manager?.recommendation === "TERMINATE"
              ? "contractRatings.acceptTerminateHint"
              : hasSalaryProposal
                ? "contractRatings.acceptSalaryHint"
                : "contractRatings.acceptHint",
          )}
        />
        <Input.TextArea
          rows={3}
          value={ceoAcceptComment}
          onChange={(event) => setCeoAcceptComment(event.target.value)}
          placeholder={t("contractRatings.optionalComment")}
          aria-label={t("contractRatings.optionalComment")}
        />
      </Modal>

      {/* CEO decline — terminal, so the shared rejection dialog fits */}
      <RejectReasonModal
        open={reasonAction === "DECLINE"}
        title={t("contractRatings.ceoDeclineTitle")}
        subject={item.employee.full_name}
        confirmText={t("contractRatings.ceoActionLabel.DECLINE")}
        loading={actionLoading}
        errorMessage={actionErrors.length ? actionErrors.join(" ") : null}
        onCancel={() => setReasonAction(null)}
        onSubmit={async (reason) => {
          if (await ceoDecide({ action: "DECLINE", comment: reason })) {
            setReasonAction(null);
          }
        }}
      />

      {/* CEO return to HR — non-terminal, so not the "rejection is final" dialog */}
      <Modal
        open={reasonAction === "RETURN_TO_HR"}
        title={t("contractRatings.ceoReturnTitle")}
        okText={t("contractRatings.ceoActionLabel.RETURN_TO_HR")}
        cancelText={t("common.cancel")}
        okButtonProps={{ loading: actionLoading }}
        onCancel={() => !actionLoading && setReasonAction(null)}
        onOk={async () => {
          const reason = ceoReturnReason.trim();
          if (!reason) {
            setActionErrors([t("contractRatings.reasonRequired")]);
            return;
          }
          if (await ceoDecide({ action: "RETURN_TO_HR", comment: reason })) {
            setReasonAction(null);
          }
        }}
        destroyOnHidden
      >
        {errorList}
        <Typography.Paragraph type="secondary">
          {t("contractRatings.ceoReturnHint")}
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label={t("contractRatings.returnReason")} required>
            <Input.TextArea
              rows={4}
              value={ceoReturnReason}
              onChange={(event) => setCeoReturnReason(event.target.value)}
              aria-label={t("contractRatings.returnReason")}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* CEO decline with alternative */}
      <Modal
        open={alternativeOpen}
        title={t("contractRatings.ceoAlternativeTitle")}
        footer={null}
        onCancel={() => !actionLoading && setAlternativeOpen(false)}
        destroyOnHidden
      >
        {errorList}
        <Form<AlternativeValues>
          form={alternativeForm}
          layout="vertical"
          onFinish={submitAlternative}
        >
          <Form.Item
            name="ceo_selected_option"
            label={t("contractRatings.ceoSelectedOption")}
            rules={[
              { required: true, message: t("contractRatings.fieldRequired") },
            ]}
          >
            <Radio.Group
              options={ALTERNATIVE_OPTIONS.map((value) => ({
                value,
                label: t(`contractRatings.alternative.${value}`),
              }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const option = alternativeForm.getFieldValue(
                "ceo_selected_option",
              ) as ContractDecisionType | undefined;
              if (option === "TERMINATE") {
                return (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={t("contractRatings.alternativeTerminateHint")}
                  />
                );
              }
              if (option !== "RENEW_WITH_CHANGES") return null;
              const override = alternativeForm.getFieldValue(
                "override_salary",
              ) as boolean | undefined;
              return (
                <>
                  <Form.Item name="override_salary" valuePropName="checked">
                    <Checkbox>{t("contractRatings.overrideSalary")}</Checkbox>
                  </Form.Item>
                  {!override ? (
                    <Text
                      type="secondary"
                      style={{ display: "block", marginBottom: 16 }}
                    >
                      {hasSalaryProposal
                        ? t("contractRatings.alternativeKeepsProposal")
                        : t("contractRatings.alternativeNoSalary")}
                    </Text>
                  ) : (
                    <>
                      <Text
                        type="secondary"
                        style={{ display: "block", marginBottom: 8 }}
                      >
                        {t("contractRatings.overrideSalaryHint")}
                      </Text>
                      {CONTRACT_SALARY_COMPONENTS.map((field) => (
                        <Form.Item
                          key={field}
                          name={["terms", field]}
                          label={t(`contractDecisions.terms.${field}`)}
                          rules={[
                            {
                              validator: (_rule, value?: string) => {
                                const raw = (value ?? "").trim();
                                if (!raw || SALARY_PATTERN.test(raw)) {
                                  return Promise.resolve();
                                }
                                return Promise.reject(
                                  new Error(
                                    t("contractDecisions.invalidAmount"),
                                  ),
                                );
                              },
                            },
                          ]}
                        >
                          <Input inputMode="decimal" autoComplete="off" />
                        </Form.Item>
                      ))}
                      <Form.Item
                        name="ceo_salary_override_reason"
                        label={t("contractRatings.overrideReason")}
                        rules={[
                          {
                            required: true,
                            whitespace: true,
                            message: t("contractRatings.reasonRequired"),
                          },
                        ]}
                      >
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </>
                  )}
                </>
              );
            }}
          </Form.Item>
          <Form.Item
            name="comment"
            label={t("contractRatings.ceoComment")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("contractRatings.reasonRequired"),
              },
            ]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={actionLoading}
            block
          >
            {t("contractRatings.ceoActionLabel.DECLINE_WITH_ALTERNATIVE")}
          </Button>
        </Form>
      </Modal>
    </>
  );

  function renderTermination(rating: FullContractRating) {
    const processed = Boolean(rating.termination_processed_at);
    return (
      <Alert
        type={processed ? "error" : "warning"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          processed
            ? t("contractRatings.terminationProcessed")
            : t("contractRatings.terminationScheduled", {
                date: formatDateOnly(rating.contract_expiry),
              })
        }
        description={
          <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
            {processed ? (
              <>
                <Descriptions.Item label={t("contractRatings.employmentStatus")}>
                  {rating.employment_status}
                </Descriptions.Item>
                <Descriptions.Item label={t("contractRatings.profileArchived")}>
                  {rating.is_archived ? t("common.yes") : t("common.no")}
                </Descriptions.Item>
                <Descriptions.Item label={t("contractRatings.archiveReason")}>
                  {rating.archive_reason === "END_OF_CONTRACT"
                    ? t("contractRatings.archiveReasonEndOfContract")
                    : rating.archive_reason || "—"}
                </Descriptions.Item>
                <Descriptions.Item label={t("contractRatings.lastWorkingDate")}>
                  {formatDateOnly(rating.contract_expiry)}
                </Descriptions.Item>
                <Descriptions.Item label={t("contractRatings.processedAt")}>
                  {formatDateTimeShort(rating.termination_processed_at)}
                </Descriptions.Item>
              </>
            ) : null}
            <Descriptions.Item label={t("contractRatings.employeeNotified")}>
              {rating.employee_notified_of_termination_at
                ? formatDateTimeShort(rating.employee_notified_of_termination_at)
                : t("contractRatings.employeeNotNotified")}
            </Descriptions.Item>
          </Descriptions>
        }
      />
    );
  }
}
