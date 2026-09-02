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
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined, ReloadOutlined } from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import { useAuthStore } from "../../auth/authStore";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";
import { isApiError } from "../../services/api/apiTypes";
import {
  approveContractDecision,
  getContractDecision,
  listContractDecisions,
  rejectContractDecision,
  submitContractDecision,
  type ContractDecision,
  type ContractDecisionStatus,
  type ContractDecisionSubmitPayload,
  type ContractDecisionType,
} from "../../services/api/contractDecisionsApi";

type FormValues = {
  decision_type: ContractDecisionType;
  proposed_contract_date?: Dayjs;
  proposed_contract_expiry?: Dayjs;
  basic_salary?: string;
  transportation_allowance?: string;
  accommodation_allowance?: string;
  telephone_allowance?: string;
  petrol_allowance?: string;
  other_allowance?: string;
  total_salary?: string;
  comment?: string;
};

const statusColors: Record<string, string> = {
  PENDING_HR: "orange",
  PENDING_CEO: "gold",
  APPROVED: "green",
  AUTO_APPROVED: "green",
  AUTO_RENEWED: "blue",
  REJECTED: "red",
  AUTO_RENEWAL_FAILED: "red",
  MANUAL_RESOLUTION_REQUIRED: "volcano",
};

const termFields = [
  "basic_salary",
  "transportation_allowance",
  "accommodation_allowance",
  "telephone_allowance",
  "petrol_allowance",
  "other_allowance",
  "total_salary",
] as const;

export default function ContractDecisionsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const user = useAuthStore((state) => state.user);
  const isCeoRoute = location.pathname.startsWith("/ceo/");
  const isCeo = isCeoRoute || user?.role === "CEO";
  const isHr = !isCeoRoute && (user?.role === "HRManager" || user?.role === "SystemAdmin");
  const [records, setRecords] = useState<ContractDecision[]>([]);
  const [record, setRecord] = useState<ContractDecision | null>(null);
  const [statusFilter, setStatusFilter] = useState<ContractDecisionStatus | undefined>(
    isCeo ? "PENDING_CEO" : "PENDING_HR",
  );
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [comment, setComment] = useState("");
  const [messageApi, messageContext] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
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
      messageApi.error((error as Error)?.message || t("common.error", "Unable to load contract decisions"));
    } finally {
      setLoading(false);
    }
  }, [id, messageApi, statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openHrModal = (item: ContractDecision) => {
    setRecord(item);
    form.resetFields();
    form.setFieldsValue({
      proposed_contract_date: item.proposed_contract_date ? dayjs(item.proposed_contract_date) : undefined,
      proposed_contract_expiry: item.proposed_contract_expiry ? dayjs(item.proposed_contract_expiry) : undefined,
    });
    setModalOpen(true);
  };

  const submitHrDecision = async (values: FormValues) => {
    if (!record) return;
    setActionLoading(true);
    try {
      const proposed_terms: Record<string, string | null> = {};
      for (const field of termFields) {
        if (values[field] !== undefined && values[field] !== "") proposed_terms[field] = values[field] ?? null;
      }
      const payload: ContractDecisionSubmitPayload = {
        decision_type: values.decision_type,
        proposed_contract_date: values.proposed_contract_date?.format("YYYY-MM-DD") ?? null,
        proposed_contract_expiry: values.proposed_contract_expiry?.format("YYYY-MM-DD") ?? null,
        proposed_terms,
        hr_comment: values.comment ?? "",
      };
      const response = await submitContractDecision(record.employee.id, payload);
      if (isApiError(response)) throw new Error(response.message);
      messageApi.success(t("contractDecisions.submitSuccess", "Decision submitted to the CEO."));
      setModalOpen(false);
      await load();
    } catch (error) {
      messageApi.error((error as Error)?.message || t("common.error", "Unable to submit decision"));
    } finally {
      setActionLoading(false);
    }
  };

  const decideAsCeo = async (approve: boolean) => {
    if (!record) return;
    setActionLoading(true);
    try {
      const response = approve
        ? await approveContractDecision(record.id, comment)
        : await rejectContractDecision(record.id, comment);
      if (isApiError(response)) throw new Error(response.message);
      messageApi.success(approve ? t("contractDecisions.approveSuccess", "Contract decision approved.") : t("contractDecisions.rejectSuccess", "Contract decision rejected."));
      setDecisionModalOpen(false);
      setComment("");
      await load();
    } catch (error) {
      messageApi.error((error as Error)?.message || t("common.error", "Unable to complete decision"));
    } finally {
      setActionLoading(false);
    }
  };

  const columns: ColumnsType<ContractDecision> = [
    {
      title: t("contractDecisions.employee", "Employee"),
      key: "employee",
      render: (_, item) => <Typography.Text strong>{item.employee.full_name}</Typography.Text>,
    },
    {
      title: t("contractDecisions.expiry", "Contract expiry"),
      dataIndex: "original_contract_expiry",
      render: (value: string) => formatDateOnly(value),
    },
    {
      title: t("contractDecisions.status", "Status"),
      dataIndex: "status",
      render: (value: string, item) => <Tag color={statusColors[value] ?? "default"}>{item.status_label}</Tag>,
    },
    {
      title: t("contractDecisions.submitted", "Submitted"),
      dataIndex: "submitted_at",
      render: (value: string | null) => (value ? formatDateTimeShort(value) : "—"),
    },
    {
      title: t("common.actions", "Actions"),
      key: "actions",
      render: (_, item) => (
        <Space>
          <Button size="small" onClick={() => navigate(`${isCeo ? "/ceo" : "/hr"}/contract-decisions/${item.id}`)}>
            {t("common.view", "View")}
          </Button>
          {isHr && item.status === "PENDING_HR" ? (
            <Button size="small" type="primary" onClick={() => openHrModal(item)}>
              {t("contractDecisions.takeAction", "Take action")}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  if (id && record) {
    const canSubmit = isHr && record.status === "PENDING_HR";
    const canDecide = isCeo && record.status === "PENDING_CEO" && record.workflow?.can_approve;
    return (
      <>
        {messageContext}
        <PageHeader
          title={t("contractDecisions.detailTitle", "Contract decision")}
          actions={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate(isCeo ? "/ceo/contract-decisions" : "/hr/contract-decisions")}>{t("common.back", "Back")}</Button>}
        />
        <Card loading={loading}>
          <Descriptions bordered column={2}>
            <Descriptions.Item label={t("contractDecisions.employee", "Employee")}>{record.employee.full_name}</Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.employeeId", "Employee ID")}>{record.employee.employee_id}</Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.originalExpiry", "Original expiry")}>{formatDateOnly(record.original_contract_expiry)}</Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.status", "Status")}><Tag color={statusColors[record.status]}>{record.status_label}</Tag></Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.decision", "Decision")}>{record.decision_type_label || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.ceoDeadline", "CEO deadline")}>{record.ceo_deadline ? formatDateTimeShort(record.ceo_deadline) : "—"}</Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.proposedExpiry", "Proposed expiry")}>{record.proposed_contract_expiry ? formatDateOnly(record.proposed_contract_expiry) : "—"}</Descriptions.Item>
            <Descriptions.Item label={t("contractDecisions.hrComment", "HR comment")}>{record.hr_comment || "—"}</Descriptions.Item>
            {record.automatic_renewal ? <Descriptions.Item label={t("contractDecisions.automaticReason", "Automatic processing reason")}>{record.automatic_renewal_reason || "—"}</Descriptions.Item> : null}
            {record.failure_reason ? <Descriptions.Item label={t("contractDecisions.failure", "Failure")}>{record.failure_reason}</Descriptions.Item> : null}
            {record.finalized_at ? <Descriptions.Item label={t("contractDecisions.finalNotification", "Final notification")}>
              {record.final_notification_sent_at
                ? t("contractDecisions.finalNotificationSent", "Sent") + ` ${formatDateTimeShort(record.final_notification_sent_at)}`
                : `${t("contractDecisions.finalNotificationPending", "Pending retry")} (${record.final_notification_attempts})`}
            </Descriptions.Item> : null}
            <Descriptions.Item label={t("contractDecisions.notifications", "Notification status")} span={2}>
              <Space wrap>
                {record.notification_status?.length ? record.notification_status.map((notification) => (
                  <Tag key={notification.id} color="cyan">
                    {notification.milestone || notification.event_key}: {notification.deliveries.map((delivery) => `${delivery.channel} ${delivery.status}`).join(", ") || "in-app"}
                  </Tag>
                )) : "—"}
              </Space>
            </Descriptions.Item>
          </Descriptions>
          {record.status === "AUTO_RENEWED" ? <Alert style={{ marginTop: 20 }} type="info" message={t("contractDecisions.autoRenewed", "This contract was automatically renewed because HR took no action.")} /> : null}
          <Space style={{ marginTop: 20 }}>
            {canSubmit ? <Button type="primary" onClick={() => openHrModal(record)}>{t("contractDecisions.takeAction", "Take action")}</Button> : null}
            {canDecide ? <Button type="primary" icon={<CheckOutlined />} onClick={() => setDecisionModalOpen(true)}>{t("contractDecisions.approve", "Approve")}</Button> : null}
            {canDecide ? <Button danger icon={<CloseOutlined />} onClick={() => setDecisionModalOpen(true)}>{t("contractDecisions.reject", "Reject")}</Button> : null}
          </Space>
        </Card>
        {renderHrModal()}
        {renderCeoModal()}
      </>
    );
  }

  function renderHrModal() {
    return (
      <Modal title={t("contractDecisions.hrModalTitle", "Submit HR contract decision")} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={submitHrDecision} initialValues={{ decision_type: "RENEW" }}>
          <Form.Item name="decision_type" label={t("contractDecisions.decision", "Decision")} rules={[{ required: true }]}>
            <Select options={[{ value: "RENEW", label: t("contractDecisions.renew", "Renew") }, { value: "RENEW_WITH_CHANGES", label: t("contractDecisions.renewChanges", "Renew with changes") }, { value: "TERMINATE", label: t("contractDecisions.terminate", "Terminate") }]} />
          </Form.Item>
          <Form.Item name="proposed_contract_date" label={t("contractDecisions.newStart", "New contract date")}><DatePicker style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="proposed_contract_expiry" label={t("contractDecisions.newExpiry", "New contract expiry")}><DatePicker style={{ width: "100%" }} /></Form.Item>
          <Typography.Text type="secondary">{t("contractDecisions.termsHint", "For renewal with changes, enter only the salary or allowance fields that should change.")}</Typography.Text>
          {termFields.map((field) => <Form.Item key={field} name={field} label={field.replaceAll("_", " ")}><Input /></Form.Item>)}
          <Form.Item name="comment" label={t("contractDecisions.hrComment", "HR comment")}><Input.TextArea rows={3} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={actionLoading} block>{t("contractDecisions.submit", "Submit to CEO")}</Button>
        </Form>
      </Modal>
    );
  }

  function renderCeoModal() {
    return (
      <Modal title={t("contractDecisions.ceoModalTitle", "CEO decision")} open={decisionModalOpen} onCancel={() => setDecisionModalOpen(false)} confirmLoading={actionLoading} onOk={() => decideAsCeo(true)} okText={t("contractDecisions.approve", "Approve")} cancelText={t("contractDecisions.reject", "Reject")}>
        <Input.TextArea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("contractDecisions.commentPlaceholder", "Optional comment")} />
        <Button danger style={{ marginTop: 12 }} onClick={() => decideAsCeo(false)} loading={actionLoading}>{t("contractDecisions.reject", "Reject")}</Button>
      </Modal>
    );
  }

  return (
    <>
      {messageContext}
      <PageHeader title={t("contractDecisions.title", "Contract decisions")} subtitle={t("contractDecisions.subtitle", isCeo ? "Review HR contract decisions." : "Manage upcoming contract expiries.")} actions={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>{t("common.refresh", "Refresh")}</Button>} />
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Typography.Text>{t("contractDecisions.filter", "Show")}</Typography.Text>
          <Select
            value={statusFilter}
            onChange={(value: ContractDecisionStatus | undefined) => setStatusFilter(value)}
            allowClear
            style={{ minWidth: 220 }}
            options={[
              { value: "PENDING_HR", label: t("contractDecisions.pendingHr", "Awaiting HR action") },
              { value: "PENDING_CEO", label: t("contractDecisions.pendingCeo", "Pending CEO approval") },
              { value: "APPROVED", label: t("contractDecisions.approved", "Approved") },
              { value: "AUTO_APPROVED", label: t("contractDecisions.autoApproved", "CEO auto-approved") },
              { value: "AUTO_RENEWED", label: t("contractDecisions.autoRenewedShort", "Automatically renewed") },
              { value: "REJECTED", label: t("contractDecisions.rejected", "Rejected") },
              { value: "AUTO_RENEWAL_FAILED", label: t("contractDecisions.renewalFailed", "Manual resolution required") },
              { value: "MANUAL_RESOLUTION_REQUIRED", label: t("contractDecisions.manualResolution", "Manual resolution required") },
            ]}
          />
        </Space>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={records} pagination={{ pageSize: 20 }} />
      </Card>
    </>
  );
}
