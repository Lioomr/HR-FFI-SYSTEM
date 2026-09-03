import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import ApprovalTimeline from "../../components/requests/ApprovalTimeline";
import { useAuthStore } from "../../auth/authStore";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";
import { isApiError } from "../../services/api/apiTypes";
import {
  apply422ToForm,
  collectApiErrorMessages,
} from "../../utils/formErrors";
import {
  getHttpErrorMessage,
  isForbidden,
  isNotFound,
  isValidationError,
} from "../../services/api/httpErrors";
import {
  approveContractDecision,
  getContractDecision,
  listContractDecisions,
  rejectContractDecision,
  submitContractDecision,
  CONTRACT_SALARY_COMPONENTS,
  type ContractDecision,
  type ContractDecisionStatus,
  type ContractDecisionSubmitPayload,
  type ContractDecisionType,
  type ContractSalaryComponent,
  type ContractSalaryTerms,
} from "../../services/api/contractDecisionsApi";

type FormValues = Partial<Record<ContractSalaryComponent, string>> & {
  decision_type: ContractDecisionType;
  proposed_contract_date?: Dayjs;
  proposed_contract_expiry?: Dayjs;
  comment?: string;
};

/**
 * Every member of the backend status set. A status missing here would render
 * as an uncoloured tag, so the map is exhaustive by type.
 */
const statusColors: Record<ContractDecisionStatus, string> = {
  PENDING_HR: "orange",
  PENDING_CEO: "gold",
  APPROVED: "green",
  AUTO_APPROVED: "green",
  AUTO_RENEWED: "blue",
  REJECTED: "red",
  AUTO_RENEWAL_FAILED: "volcano",
  MANUAL_RESOLUTION_REQUIRED: "volcano",
};

/**
 * `employees.contract_expiry.submit_decision` accepts exactly these two
 * statuses; anything else answers 422, so the HR action stays hidden elsewhere.
 * `AUTO_RENEWAL_FAILED` is deliberately absent — the backend does not accept a
 * resubmission for it.
 */
const HR_ACTIONABLE_STATUSES: ContractDecisionStatus[] = [
  "PENDING_HR",
  "MANUAL_RESOLUTION_REQUIRED",
];

/** Decimal(12,2), non-negative, at most ten integer digits — mirrors the backend. */
const SALARY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const MAX_SALARY_TOTAL = 9999999999.99;

function isValidSalaryString(value: string): boolean {
  if (!SALARY_PATTERN.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

/**
 * Previews the total the backend will derive. Returns null when the components
 * cannot produce a storable total (non-finite, or past `Decimal(12,2)`).
 */
function deriveTotal(
  values: Partial<Record<ContractSalaryComponent, string>>,
): string | null {
  let total = 0;
  for (const field of CONTRACT_SALARY_COMPONENTS) {
    const raw = (values[field] ?? "").trim();
    if (!raw) continue;
    if (!isValidSalaryString(raw)) return null;
    total += Number(raw);
  }
  if (!Number.isFinite(total) || total > MAX_SALARY_TOTAL) return null;
  return total.toFixed(2);
}

export default function ContractDecisionsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const user = useAuthStore((state) => state.user);
  const isCeoRoute = location.pathname.startsWith("/ceo/");
  const isCeo = isCeoRoute || user?.role === "CEO";
  const isHr =
    !isCeoRoute && (user?.role === "HRManager" || user?.role === "SystemAdmin");
  const [records, setRecords] = useState<ContractDecision[]>([]);
  const [record, setRecord] = useState<ContractDecision | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    ContractDecisionStatus | undefined
  >(isCeo ? "PENDING_CEO" : "PENDING_HR");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadForbidden, setLoadForbidden] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [decisionErrors, setDecisionErrors] = useState<string[]>([]);
  const [form] = Form.useForm<FormValues>();
  const [comment, setComment] = useState("");
  const [messageApi, messageContext] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadForbidden(false);
    try {
      if (id) {
        const response = await getContractDecision(id);
        if (isApiError(response)) throw new Error(response.message);
        setRecord(response.data);
        return;
      }
      const response = await listContractDecisions({
        status: statusFilter,
        page: 1,
        page_size: 100,
      });
      if (isApiError(response)) throw new Error(response.message);
      setRecords(response.data.items ?? []);
    } catch (error) {
      if (isForbidden(error)) {
        setLoadForbidden(true);
        setLoadError(t("contractDecisions.forbidden"));
      } else if (isNotFound(error)) {
        setLoadError(t("contractDecisions.notFound"));
      } else {
        setLoadError(getHttpErrorMessage(error));
      }
    } finally {
      setLoading(false);
    }
  }, [id, statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openHrModal = (item: ContractDecision) => {
    setRecord(item);
    setSubmitErrors([]);
    form.resetFields();
    // Prefill from the contract's current terms so an untouched field re-sends
    // its existing value instead of silently clearing it.
    const currentTerms: Partial<Record<ContractSalaryComponent, string>> = {};
    for (const field of CONTRACT_SALARY_COMPONENTS) {
      const value = item.original_terms?.[field];
      if (value != null && value !== "") currentTerms[field] = String(value);
    }
    form.setFieldsValue({
      ...currentTerms,
      decision_type: (item.decision_type || "RENEW") as ContractDecisionType,
      proposed_contract_date: item.proposed_contract_date
        ? dayjs(item.proposed_contract_date)
        : undefined,
      proposed_contract_expiry: item.proposed_contract_expiry
        ? dayjs(item.proposed_contract_expiry)
        : undefined,
    });
    setModalOpen(true);
  };

  /**
   * Reports the status the backend actually returned. An approve call can come
   * back 200 with `MANUAL_RESOLUTION_REQUIRED`, so "the request succeeded" and
   * "the contract was approved" are different facts.
   */
  const announceResolvedStatus = (decision: ContractDecision) => {
    const status = decision.status_label || decision.status;
    const text = t("contractDecisions.resultStatus", { status });
    if (
      decision.status === "MANUAL_RESOLUTION_REQUIRED" ||
      decision.status === "AUTO_RENEWAL_FAILED" ||
      decision.status === "REJECTED"
    ) {
      messageApi.warning(text);
      return;
    }
    messageApi.success(text);
  };

  const submitHrDecision = async (values: FormValues) => {
    if (!record) return;
    setActionLoading(true);
    setSubmitErrors([]);
    try {
      const proposed_terms: ContractSalaryTerms = {};
      if (values.decision_type !== "TERMINATE") {
        for (const field of CONTRACT_SALARY_COMPONENTS) {
          const raw = (values[field] ?? "").trim();
          const current = record.original_terms?.[field];
          const hadValue = current != null && current !== "";
          if (raw === "") {
            // An emptied prefilled field is a deliberate clear; a field that was
            // already empty stays omitted so the backend keeps its value.
            if (hadValue) proposed_terms[field] = null;
            continue;
          }
          proposed_terms[field] = raw;
        }
      }
      // `total_salary` is never sent: the backend derives it from the six
      // components and rejects a non-null total that disagrees with them.
      const payload: ContractDecisionSubmitPayload = {
        decision_type: values.decision_type,
        proposed_contract_date:
          values.proposed_contract_date?.format("YYYY-MM-DD") ?? null,
        proposed_contract_expiry:
          values.proposed_contract_expiry?.format("YYYY-MM-DD") ?? null,
        proposed_terms,
        hr_comment: values.comment ?? "",
      };
      const response = await submitContractDecision(
        record.employee.id,
        payload,
      );
      if (isApiError(response)) throw new Error(response.message);
      setRecord(response.data);
      announceResolvedStatus(response.data);
      setModalOpen(false);
      await load();
    } catch (error) {
      if (isValidationError(error)) {
        apply422ToForm(form, error);
        setSubmitErrors(collectApiErrorMessages(error));
      } else if (isForbidden(error)) {
        setSubmitErrors([t("contractDecisions.staleAction")]);
        await load();
      } else {
        setSubmitErrors([getHttpErrorMessage(error)]);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const decideAsCeo = async (approve: boolean) => {
    if (!record) return;
    setActionLoading(true);
    setDecisionErrors([]);
    try {
      const response = approve
        ? await approveContractDecision(record.id, comment)
        : await rejectContractDecision(record.id, comment);
      if (isApiError(response)) throw new Error(response.message);
      setRecord(response.data);
      announceResolvedStatus(response.data);
      setDecisionModalOpen(false);
      setComment("");
      await load();
    } catch (error) {
      if (isValidationError(error)) {
        setDecisionErrors(collectApiErrorMessages(error));
      } else if (isForbidden(error)) {
        setDecisionErrors([t("contractDecisions.staleAction")]);
        await load();
      } else {
        setDecisionErrors([getHttpErrorMessage(error)]);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const columns: ColumnsType<ContractDecision> = [
    {
      title: t("contractDecisions.employee"),
      key: "employee",
      render: (_, item) => (
        <Typography.Text strong>{item.employee.full_name}</Typography.Text>
      ),
    },
    {
      title: t("contractDecisions.expiry"),
      dataIndex: "original_contract_expiry",
      responsive: ["sm"],
      render: (value: string) => formatDateOnly(value),
    },
    {
      title: t("contractDecisions.status"),
      dataIndex: "status",
      render: (value: ContractDecisionStatus, item) => (
        <Tag color={statusColors[value] ?? "default"}>
          {item.status_label || value}
        </Tag>
      ),
    },
    {
      title: t("contractDecisions.submitted"),
      dataIndex: "submitted_at",
      responsive: ["md"],
      render: (value: string | null) =>
        value ? formatDateTimeShort(value) : "—",
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_, item) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() =>
              navigate(
                `${isCeo ? "/ceo" : "/hr"}/contract-decisions/${item.id}`,
              )
            }
          >
            {t("common.view")}
          </Button>
          {isHr && HR_ACTIONABLE_STATUSES.includes(item.status) ? (
            <Button
              size="small"
              type="primary"
              onClick={() => openHrModal(item)}
            >
              {item.status === "MANUAL_RESOLUTION_REQUIRED"
                ? t("contractDecisions.resolve")
                : t("contractDecisions.takeAction")}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  if (id) {
    if (record) return renderDetail(record);
    if (loading) return <LoadingState title={t("contractDecisions.loading")} />;
    return (
      <ErrorState
        title={loadForbidden ? t("common.forbidden") : t("common.error")}
        description={loadError ?? t("contractDecisions.notFound")}
        onRetry={loadForbidden ? undefined : () => void load()}
      />
    );
  }

  function renderTerms(terms: ContractSalaryTerms | null | undefined) {
    const fields = [...CONTRACT_SALARY_COMPONENTS, "total_salary" as const];
    const entries = fields
      .map((field) => [field, terms?.[field]] as const)
      .filter(([, value]) => value != null && value !== "");
    if (!entries.length)
      return <Typography.Text type="secondary">—</Typography.Text>;
    return (
      <Space wrap>
        {entries.map(([field, value]) => (
          <Tag
            key={field}
            color={field === "total_salary" ? "blue" : "default"}
          >
            {t(`contractDecisions.terms.${field}`)}: {value}
          </Tag>
        ))}
      </Space>
    );
  }

  function renderDetail(item: ContractDecision) {
    const canSubmit = isHr && HR_ACTIONABLE_STATUSES.includes(item.status);
    const canApprove = Boolean(
      isCeo && item.status === "PENDING_CEO" && item.workflow?.can_approve,
    );
    const canReject = Boolean(
      isCeo && item.status === "PENDING_CEO" && item.workflow?.can_reject,
    );
    return (
      <>
        {messageContext}
        <PageHeader
          title={t("contractDecisions.detailTitle")}
          actions={
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void load()}
                loading={loading}
              >
                {t("common.refresh")}
              </Button>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() =>
                  navigate(
                    isCeo
                      ? "/ceo/contract-decisions"
                      : "/hr/contract-decisions",
                  )
                }
              >
                {t("common.back")}
              </Button>
            </Space>
          }
        />
        {loadError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={loadError}
          />
        ) : null}
        <Card loading={loading}>
          <Descriptions bordered column={{ xs: 1, sm: 1, md: 2 }}>
            <Descriptions.Item label={t("contractDecisions.employee")}>
              {item.employee.full_name}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.employeeId")}>
              {item.employee.employee_id}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.originalExpiry")}>
              {formatDateOnly(item.original_contract_expiry)}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.status")}>
              <Tag color={statusColors[item.status] ?? "default"}>
                {item.status_label || item.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.decision")}>
              {item.decision_type_label || "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.ceoDeadline")}>
              {item.ceo_deadline ? formatDateTimeShort(item.ceo_deadline) : "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.proposedExpiry")}>
              {item.proposed_contract_expiry
                ? formatDateOnly(item.proposed_contract_expiry)
                : "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.hrComment")}>
              {item.hr_comment || "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.ceoComment")}>
              {item.ceo_comment || "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.automaticRenewal")}>
              {item.automatic_renewal ? t("common.yes") : t("common.no")}
            </Descriptions.Item>
            {item.automatic_renewal_reason ? (
              <Descriptions.Item
                label={t("contractDecisions.automaticReason")}
                span={2}
              >
                {item.automatic_renewal_reason}
              </Descriptions.Item>
            ) : null}
            {item.failure_reason ? (
              <Descriptions.Item
                label={t("contractDecisions.failure")}
                span={2}
              >
                {item.failure_reason}
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item
              label={t("contractDecisions.proposedTerms")}
              span={2}
            >
              {renderTerms(item.proposed_terms)}
            </Descriptions.Item>
            {item.finalized_at ? (
              <Descriptions.Item
                label={t("contractDecisions.finalNotification")}
                span={2}
              >
                {item.final_notification_sent_at
                  ? `${t("contractDecisions.finalNotificationSent")} ${formatDateTimeShort(
                      item.final_notification_sent_at,
                    )}`
                  : `${t("contractDecisions.finalNotificationPending")} (${
                      item.final_notification_attempts
                    })`}
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item
              label={t("contractDecisions.notifications")}
              span={2}
            >
              <Space wrap>
                {item.notification_status?.length
                  ? item.notification_status.map((notification) => (
                      <Tag key={notification.id} color="cyan">
                        {notification.milestone || notification.event_key}:{" "}
                        {notification.deliveries.length
                          ? notification.deliveries
                              .map(
                                (delivery) =>
                                  `${delivery.channel} ${delivery.status}`,
                              )
                              .join(", ")
                          : t("contractDecisions.deliveryInAppOnly")}
                      </Tag>
                    ))
                  : "—"}
              </Space>
            </Descriptions.Item>
          </Descriptions>

          {item.status === "AUTO_RENEWED" ? (
            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              message={t("contractDecisions.autoRenewed")}
              description={item.automatic_renewal_reason || undefined}
            />
          ) : null}
          {item.status === "AUTO_APPROVED" ? (
            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              message={t("contractDecisions.autoApprovedNotice")}
              description={item.automatic_renewal_reason || undefined}
            />
          ) : null}
          {item.status === "AUTO_RENEWAL_FAILED" ? (
            <Alert
              style={{ marginTop: 20 }}
              type="error"
              showIcon
              message={t("contractDecisions.renewalFailedNotice")}
              description={item.failure_reason || undefined}
            />
          ) : null}
          {item.status === "MANUAL_RESOLUTION_REQUIRED" ? (
            <Alert
              style={{ marginTop: 20 }}
              type="warning"
              showIcon
              message={t("contractDecisions.manualResolutionNotice")}
              description={item.failure_reason || undefined}
            />
          ) : null}

          <Space style={{ marginTop: 20 }} wrap>
            {canSubmit ? (
              <Button type="primary" onClick={() => openHrModal(item)}>
                {item.status === "MANUAL_RESOLUTION_REQUIRED"
                  ? t("contractDecisions.resolve")
                  : t("contractDecisions.takeAction")}
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => {
                  setDecisionErrors([]);
                  setDecisionModalOpen(true);
                }}
              >
                {t("contractDecisions.approve")}
              </Button>
            ) : null}
            {canReject ? (
              <Button
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  setDecisionErrors([]);
                  setDecisionModalOpen(true);
                }}
              >
                {t("contractDecisions.reject")}
              </Button>
            ) : null}
          </Space>
        </Card>

        <Card title={t("contractDecisions.history")} style={{ marginTop: 20 }}>
          {item.workflow?.history?.length ? (
            <ApprovalTimeline workflow={item.workflow} />
          ) : (
            <Typography.Text type="secondary">
              {t("contractDecisions.historyEmpty")}
            </Typography.Text>
          )}
        </Card>
        {renderHrModal()}
        {renderCeoModal()}
      </>
    );
  }

  function renderErrorList(messages: string[]) {
    if (!messages.length) return null;
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("contractDecisions.validationTitle")}
        description={
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {messages.map((text, index) => (
              <li key={`${text}-${index}`}>{text}</li>
            ))}
          </ul>
        }
      />
    );
  }

  function renderHrModal() {
    return (
      <Modal
        title={t("contractDecisions.hrModalTitle")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={submitHrDecision}
          initialValues={{ decision_type: "RENEW" }}
        >
          {renderErrorList(submitErrors)}
          <Form.Item
            name="decision_type"
            label={t("contractDecisions.decision")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "RENEW", label: t("contractDecisions.renew") },
                {
                  value: "RENEW_WITH_CHANGES",
                  label: t("contractDecisions.renewChanges"),
                },
                { value: "TERMINATE", label: t("contractDecisions.terminate") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="proposed_contract_date"
            label={t("contractDecisions.newStart")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="proposed_contract_expiry"
            label={t("contractDecisions.newExpiry")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {t("contractDecisions.termsHint")}
          </Typography.Paragraph>
          {CONTRACT_SALARY_COMPONENTS.map((field) => (
            <Form.Item
              key={field}
              name={field}
              label={t(`contractDecisions.terms.${field}`)}
              rules={[
                {
                  validator: (_rule, value?: string) => {
                    const raw = (value ?? "").trim();
                    if (!raw || isValidSalaryString(raw)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(t("contractDecisions.invalidAmount")),
                    );
                  },
                },
              ]}
            >
              <Input inputMode="decimal" autoComplete="off" />
            </Form.Item>
          ))}
          <Form.Item shouldUpdate>
            {() => {
              const derived = deriveTotal(form.getFieldsValue());
              return (
                <Typography.Paragraph type="secondary">
                  {t("contractDecisions.derivedTotal")}:{" "}
                  <Typography.Text strong>
                    {derived ?? t("contractDecisions.derivedTotalInvalid")}
                  </Typography.Text>
                </Typography.Paragraph>
              );
            }}
          </Form.Item>
          <Form.Item name="comment" label={t("contractDecisions.hrComment")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={actionLoading}
            block
          >
            {t("contractDecisions.submit")}
          </Button>
        </Form>
      </Modal>
    );
  }

  function renderCeoModal() {
    return (
      <Modal
        title={t("contractDecisions.ceoModalTitle")}
        open={decisionModalOpen}
        onCancel={() => setDecisionModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        {renderErrorList(decisionErrors)}
        <Input.TextArea
          rows={4}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("contractDecisions.commentPlaceholder")}
          aria-label={t("contractDecisions.commentPlaceholder")}
        />
        <Space style={{ marginTop: 12 }} wrap>
          <Button
            type="primary"
            loading={actionLoading}
            onClick={() => void decideAsCeo(true)}
          >
            {t("contractDecisions.approve")}
          </Button>
          <Button
            danger
            loading={actionLoading}
            onClick={() => void decideAsCeo(false)}
          >
            {t("contractDecisions.reject")}
          </Button>
        </Space>
      </Modal>
    );
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title={t("contractDecisions.title")}
        subtitle={
          isCeo
            ? t("contractDecisions.subtitleCeo")
            : t("contractDecisions.subtitle")
        }
        actions={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            loading={loading}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Text>{t("contractDecisions.filter")}</Typography.Text>
          <Select
            value={statusFilter}
            onChange={(value: ContractDecisionStatus | undefined) =>
              setStatusFilter(value)
            }
            allowClear
            style={{ minWidth: 220 }}
            aria-label={t("contractDecisions.filter")}
            options={[
              { value: "PENDING_HR", label: t("contractDecisions.pendingHr") },
              {
                value: "PENDING_CEO",
                label: t("contractDecisions.pendingCeo"),
              },
              { value: "APPROVED", label: t("contractDecisions.approved") },
              {
                value: "AUTO_APPROVED",
                label: t("contractDecisions.autoApproved"),
              },
              {
                value: "AUTO_RENEWED",
                label: t("contractDecisions.autoRenewedShort"),
              },
              { value: "REJECTED", label: t("contractDecisions.rejected") },
              {
                value: "AUTO_RENEWAL_FAILED",
                label: t("contractDecisions.renewalFailed"),
              },
              {
                value: "MANUAL_RESOLUTION_REQUIRED",
                label: t("contractDecisions.manualResolution"),
              },
            ]}
          />
        </Space>
        {loadError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={loadError}
            action={
              loadForbidden ? undefined : (
                <Button size="small" onClick={() => void load()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        ) : null}
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={records}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: t("contractDecisions.empty") }}
          pagination={{ pageSize: 20 }}
        />
      </Card>
      {renderHrModal()}
      {renderCeoModal()}
    </>
  );
}
