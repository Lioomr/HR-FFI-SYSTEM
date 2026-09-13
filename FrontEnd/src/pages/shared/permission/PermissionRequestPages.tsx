import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../../i18n/useI18n";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  TimePicker,
  Typography,
  notification,
} from "antd";
import dayjs from "dayjs";
import PageHeader from "../../../components/ui/PageHeader";
import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../../../components/requests/ApprovalFlowMap";
import { formatDateTime } from "../../../utils/dateTime";
import { isApiError } from "../../../services/api/apiTypes";
import {
  cancelPermissionRequest,
  createPermissionRequest,
  decidePermissionRequest,
  downloadPermissionRequestPdf,
  getHrPermissionRequests,
  getManagerPermissionRequests,
  getMyPermissionRequests,
  getPermissionRequest,
  type PermissionRequest,
  type PermissionStatus,
} from "../../../services/api/permissionRequestsApi";

const statusColors: Record<PermissionStatus, string> = {
  pending_manager: "orange",
  pending_hr: "gold",
  approved: "green",
  rejected: "red",
  cancelled: "default",
};
function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}
function errorText(
  t: (key: string, fallback?: string) => string,
  error: unknown,
  fallback: string,
) {
  const typedError = error as {
    response?: { status?: number; data?: { message?: string } };
  };
  const status = httpStatus(error);
  const serverMessage = typedError.response?.data?.message;
  if (serverMessage) return serverMessage;
  if (status === 401) return t("permissionRequests.error.unauthorized");
  if (status === 403) return t("permissionRequests.error.forbidden");
  if (status === 404) return t("permissionRequests.error.notFound");
  if (
    !status &&
    error instanceof Error &&
    error.message.toLowerCase().includes("network")
  )
    return t("permissionRequests.error.network");
  return fallback;
}
function statusLabel(
  t: (key: string, fallback?: string) => string,
  status: PermissionStatus,
) {
  return t(
    `permissionRequests.status.${status === "pending_manager" ? "pendingManager" : status === "pending_hr" ? "pendingHr" : status}`,
  );
}
function historyLabel(
  t: (key: string, fallback?: string) => string,
  action: string,
) {
  return t(`permissionRequests.history.${action}`, action);
}

export function PermissionRequestFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const from = Form.useWatch("from_time", form) as dayjs.Dayjs | undefined;
  const to = Form.useWatch("to_time", form) as dayjs.Dayjs | undefined;
  const duration = from && to ? to.diff(from, "minute") : 0;
  async function submit(values: {
    from_time: dayjs.Dayjs;
    to_time: dayjs.Dayjs;
    exit_type: "business" | "personal" | "emergency";
    reason: string;
  }) {
    setSubmitting(true);
    try {
      const response = await createPermissionRequest({
        request_date: dayjs().format("YYYY-MM-DD"),
        from_time: values.from_time.format("HH:mm"),
        to_time: values.to_time.format("HH:mm"),
        exit_type: values.exit_type,
        reason: values.reason.trim(),
        duration_minutes: duration,
      });
      if (isApiError(response))
        notification.error({ message: response.message });
      else {
        notification.success({
          message:
            response.message || t("permissionRequests.success.submitted"),
        });
        navigate("/employee/permission-requests");
      }
    } catch (error) {
      notification.error({
        message: t("permissionRequests.error.submit"),
        description: errorText(t, error, t("permissionRequests.error.submit")),
      });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <PageHeader
        title={t("permissionRequests.newTitle")}
        subtitle={`${t("permissionRequests.formSubtitle")} (${dayjs().format("YYYY-MM-DD")})`}
      />
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{ exit_type: "personal" }}
        >
          <Space style={{ width: "100%" }} size="middle" wrap>
            <Form.Item
              label={t("permissionRequests.form.fromTime")}
              name="from_time"
              rules={[
                {
                  required: true,
                  message: t("permissionRequests.form.timeRequired"),
                },
              ]}
            >
              <TimePicker format="HH:mm" minuteStep={1} />
            </Form.Item>
            <Form.Item
              label={t("permissionRequests.form.toTime")}
              name="to_time"
              rules={[
                {
                  required: true,
                  message: t("permissionRequests.form.timeRequired"),
                },
              ]}
            >
              <TimePicker format="HH:mm" minuteStep={1} />
            </Form.Item>
          </Space>
          <Typography.Text
            type={duration > 120 || duration <= 0 ? "danger" : undefined}
          >
            {duration > 0
              ? t("permissionRequests.form.duration", { minutes: duration })
              : t("permissionRequests.form.chooseWindow")}
          </Typography.Text>
          <Form.Item
            label={t("permissionRequests.form.exitType")}
            name="exit_type"
            style={{ marginTop: 16 }}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                {
                  value: "business",
                  label: t("permissionRequests.form.business"),
                },
                {
                  value: "personal",
                  label: t("permissionRequests.form.personal"),
                },
                {
                  value: "emergency",
                  label: t("permissionRequests.form.emergency"),
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            label={t("permissionRequests.form.reason")}
            name="reason"
            rules={[
              {
                required: true,
                message: t("permissionRequests.form.reasonRequired"),
              },
              { min: 1 },
              { max: 1000 },
            ]}
          >
            <Input.TextArea rows={5} maxLength={1000} showCount />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            disabled={duration <= 0 || duration > 120}
          >
            {t("permissionRequests.form.submit")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function RequestList({ inbox }: { inbox: "mine" | "manager" | "hr" }) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<PermissionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PermissionStatus | "all">(
    inbox === "mine"
      ? "all"
      : inbox === "manager"
        ? "pending_manager"
        : "pending_hr",
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetcher =
        inbox === "mine"
          ? getMyPermissionRequests
          : inbox === "manager"
            ? getManagerPermissionRequests
            : getHrPermissionRequests;
      const response = await fetcher({ status, page, page_size: 10 });
      if (isApiError(response)) {
        notification.error({
          message: t("permissionRequests.error.load"),
          description: response.message,
        });
        setItems([]);
      } else {
        setItems(response.data.items || []);
        setTotal(response.data.count || 0);
      }
    } catch (error) {
      notification.error({
        message: t("permissionRequests.error.load"),
        description: errorText(t, error, t("permissionRequests.error.load")),
      });
    } finally {
      setLoading(false);
    }
  }, [inbox, page, status, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const title =
    inbox === "mine"
      ? t("permissionRequests.list.mineTitle")
      : inbox === "manager"
        ? t("permissionRequests.list.managerTitle")
        : t("permissionRequests.list.hrTitle");
  const path =
    inbox === "mine" ? "/employee" : inbox === "manager" ? "/manager" : "/hr";
  return (
    <div>
      <PageHeader
        title={title}
        actions={
          inbox === "mine" ? (
            <Button
              type="primary"
              onClick={() => navigate("/employee/permission-requests/new")}
            >
              {t("permissionRequests.list.new")}
            </Button>
          ) : undefined
        }
      />
      <Card>
        <Select
          aria-label={t("permissionRequests.list.status")}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          style={{ width: 190, marginBottom: 16 }}
          options={[
            { value: "all", label: t("permissionRequests.list.all") },
            {
              value: "pending_manager",
              label: statusLabel(t, "pending_manager"),
            },
            { value: "pending_hr", label: statusLabel(t, "pending_hr") },
            { value: "approved", label: statusLabel(t, "approved") },
            { value: "rejected", label: statusLabel(t, "rejected") },
            { value: "cancelled", label: statusLabel(t, "cancelled") },
          ]}
        />
        <Table
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: (
              <Empty description={t("permissionRequests.list.empty")} />
            ),
          }}
          dataSource={items}
          scroll={{ x: "max-content" }}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage }}
          onRow={(record) => ({
            onClick: () => navigate(`${path}/permission-requests/${record.id}`),
          })}
          columns={[
            {
              title: t("permissionRequests.list.reference"),
              dataIndex: "reference_no",
            },
            ...(inbox !== "mine"
              ? [
                  {
                    title: t("permissionRequests.list.employee"),
                    render: (_: unknown, record: PermissionRequest) =>
                      record.employee.full_name,
                  },
                ]
              : []),
            {
              title: t("permissionRequests.list.date"),
              dataIndex: "request_date",
            },
            {
              title: t("permissionRequests.list.time"),
              render: (_: unknown, record: PermissionRequest) =>
                `${record.from_time.slice(0, 5)} - ${record.to_time.slice(0, 5)}`,
            },
            {
              title: t("permissionRequests.list.type"),
              render: (_: unknown, record: PermissionRequest) =>
                language === "ar"
                  ? record.exit_type_label_ar
                  : record.exit_type_label,
            },
            {
              title: t("permissionRequests.list.status"),
              render: (_: unknown, record: PermissionRequest) => (
                <Tag color={statusColors[record.status]}>
                  {language === "ar"
                    ? record.status_label_ar
                    : record.status_label || statusLabel(t, record.status)}
                </Tag>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
export function MyPermissionRequestsPage() {
  return <RequestList inbox="mine" />;
}
export function ManagerPermissionRequestsPage() {
  return <RequestList inbox="manager" />;
}
export function HrPermissionRequestsPage() {
  return <RequestList inbox="hr" />;
}

function ApprovalTrail({ request }: { request: PermissionRequest }) {
  const { t } = useI18n();
  const managerSkipped =
    !request.direct_manager &&
    !request.manager_decision &&
    (request.workflow.current_stage === "hr" ||
      request.status === "pending_hr" ||
      request.status === "approved" ||
      request.status === "rejected");
  const managerDecision = request.manager_decision;
  const hrDecision = request.hr_decision;
  const hrSkipped =
    !hrDecision &&
    request.status === "approved" &&
    managerDecision === "approved";
  const managerActor = managerDecision
    ? request.manager_decision_by?.full_name ||
      request.manager_decision_by?.email
    : request.workflow.current_stage === "manager"
      ? request.workflow.current_actor?.full_name ||
        request.workflow.current_actor?.email ||
        request.direct_manager?.full_name
      : request.direct_manager?.full_name || undefined;
  const hrActor = hrDecision
    ? request.hr_decision_by?.full_name || request.hr_decision_by?.email
    : request.workflow.current_stage === "hr"
      ? request.workflow.current_actor?.full_name ||
        request.workflow.current_actor?.email
      : null;
  const decisionText = (decision: "approved" | "rejected" | null) =>
    decision === "approved"
      ? t("permissionRequests.detail.approvedDecision")
      : decision === "rejected"
        ? t("permissionRequests.detail.rejectedDecision")
        : undefined;
  const stageState = (
    decision: "approved" | "rejected" | null,
    skipped: boolean,
    current: boolean,
  ): ApprovalFlowStage["state"] =>
    request.status === "cancelled" && !decision
      ? "cancelled"
      : skipped
        ? "skipped"
        : decision === "rejected"
          ? "rejected"
          : decision === "approved"
            ? "completed"
            : current
              ? "current"
              : "upcoming";
  const stages: ApprovalFlowStage[] = [
    {
      key: "submitted",
      title: t("permissionRequests.detail.submitted"),
      labelKey: "permissionRequests.detail.submitted",
      state: "completed",
      note: t("permissionRequests.detail.submitted"),
      detail: request.employee.full_name,
      at: request.created_at,
    },
    {
      key: "manager",
      title: t("permissionRequests.detail.managerStage"),
      labelKey: "permissionRequests.detail.managerStage",
      state: stageState(
        managerDecision,
        managerSkipped,
        request.workflow.current_stage === "manager",
      ),
      note: managerSkipped
        ? t("permissionRequests.detail.notRequired")
        : [decisionText(managerDecision), request.manager_decision_note]
            .filter(Boolean)
            .join(" - ") || t("leave.approvalMap.current"),
      detail: managerActor ? managerActor : undefined,
      at: request.manager_decision_at,
    },
    {
      key: "hr",
      title: t("permissionRequests.detail.hrStage"),
      labelKey: "permissionRequests.detail.hrStage",
      state: stageState(
        hrDecision,
        hrSkipped,
        request.workflow.current_stage === "hr",
      ),
      note: hrSkipped
        ? t("permissionRequests.detail.notRequired")
        : [decisionText(hrDecision), request.hr_decision_note]
            .filter(Boolean)
            .join(" - ") || t("leave.approvalMap.current"),
      detail: hrActor ? hrActor : undefined,
      at: request.hr_decision_at,
    },
  ];
  return (
    <ApprovalFlowMap
      eyebrow={t("leave.approvalMap.eyebrow")}
      title={t("permissionRequests.detail.trail")}
      stages={stages}
      t={t}
    />
  );
}

export function PermissionRequestDetailPage({
  role,
}: {
  role: "employee" | "manager" | "hr";
}) {
  const { t, language } = useI18n();
  const { id } = useParams();
  const [request, setRequest] = useState<PermissionRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [comment, setComment] = useState("");
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getPermissionRequest(id);
      if (isApiError(response))
        setError(response.message || t("permissionRequests.error.load"));
      else setRequest(response.data);
    } catch (failure) {
      setError(errorText(t, failure, t("permissionRequests.error.load")));
    } finally {
      setLoading(false);
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(action: "cancel" | "approve" | "reject") {
    if (!id || busy) return;
    setBusy(true);
    try {
      const response =
        action === "cancel"
          ? await cancelPermissionRequest(id)
          : await decidePermissionRequest(
              id,
              role === "hr" ? "hr" : "manager",
              action,
              comment,
            );
      if (isApiError(response)) {
        notification.error({
          message: t("permissionRequests.error.action"),
          description: response.message,
        });
        if (response.message.toLowerCase().includes("no longer")) await load();
      } else {
        setRequest(response.data);
        setComment("");
        notification.success({
          message:
            action === "cancel"
              ? t("permissionRequests.success.cancelled")
              : response.message || t("permissionRequests.success.updated"),
        });
      }
    } catch (failure) {
      notification.error({
        message: t("permissionRequests.error.action"),
        description: errorText(
          t,
          failure,
          t("permissionRequests.error.action"),
        ),
      });
      if (httpStatus(failure) === 422) await load();
    } finally {
      setBusy(false);
    }
  }
  async function downloadPdf() {
    if (!request || pdfBusy) return;
    setPdfBusy(true);
    try {
      const blob = await downloadPermissionRequestPdf(request.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `permission_request_${request.reference_no}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notification.success({ message: t("permissionRequests.success.pdf") });
    } catch (failure) {
      notification.error({
        message: t("permissionRequests.error.pdf"),
        description: errorText(t, failure, t("permissionRequests.error.pdf")),
      });
    } finally {
      setPdfBusy(false);
    }
  }
  if (loading)
    return (
      <Card>
        <Spin tip={t("loading.generic")} />
      </Card>
    );
  if (error || !request)
    return (
      <Card>
        <Alert
          type="error"
          message={error || t("permissionRequests.error.notFound")}
          action={
            <Button onClick={() => void load()}>
              {t("permissionRequests.error.retry")}
            </Button>
          }
        />
      </Card>
    );
  const typeLabel =
    language === "ar" ? request.exit_type_label_ar : request.exit_type_label;
  return (
    <div>
      <PageHeader
        title={request.reference_no}
        actions={
          <Button loading={pdfBusy} onClick={() => void downloadPdf()}>
            {t("permissionRequests.detail.downloadPdf")}
          </Button>
        }
      />
      <Card>
        <Descriptions bordered column={1}>
          <Descriptions.Item label={t("permissionRequests.detail.employee")}>
            {request.employee.full_name}
          </Descriptions.Item>
          <Descriptions.Item label={t("permissionRequests.detail.date")}>
            {request.request_date}
          </Descriptions.Item>
          <Descriptions.Item label={t("permissionRequests.detail.time")}>
            <span
              dir="ltr"
              style={{ unicodeBidi: "isolate", whiteSpace: "nowrap" }}
            >
              {request.from_time.slice(0, 5)} - {request.to_time.slice(0, 5)}
            </span>{" "}
            {t("permissionRequests.detail.duration", {
              minutes: request.duration_minutes,
            })}
          </Descriptions.Item>
          <Descriptions.Item label={t("permissionRequests.detail.exitType")}>
            {typeLabel}
          </Descriptions.Item>
          <Descriptions.Item label={t("permissionRequests.detail.reason")}>
            {request.reason}
          </Descriptions.Item>
          <Descriptions.Item label={t("permissionRequests.list.status")}>
            <Tag color={statusColors[request.status]}>
              {(language === "ar"
                ? request.status_label_ar
                : request.status_label) || statusLabel(t, request.status)}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item
            label={t("permissionRequests.detail.directManager")}
          >
            {request.direct_manager?.full_name ||
              t("permissionRequests.detail.none")}
          </Descriptions.Item>
        </Descriptions>
        {(request.workflow.can_approve || request.workflow.can_reject) && (
          <>
            <Input.TextArea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              showCount
              placeholder={t("permissionRequests.detail.decisionComment")}
              style={{ marginTop: 16 }}
            />
            <Space style={{ marginTop: 12 }}>
              <Button
                type="primary"
                loading={busy}
                disabled={!request.workflow.can_approve}
                onClick={() => void act("approve")}
              >
                {t("permissionRequests.detail.approve")}
              </Button>
              <Button
                danger
                loading={busy}
                disabled={!request.workflow.can_reject}
                onClick={() => void act("reject")}
              >
                {t("permissionRequests.detail.reject")}
              </Button>
            </Space>
          </>
        )}
        {request.workflow.can_cancel && (
          <Button
            danger
            loading={busy}
            onClick={() =>
              Modal.confirm({
                title: t("permissionRequests.detail.cancelTitle"),
                onOk: () => act("cancel"),
              })
            }
            style={{ marginTop: 16 }}
          >
            {t("permissionRequests.detail.cancel")}
          </Button>
        )}
        <Typography.Title level={5} style={{ marginTop: 24 }}>
          {t("permissionRequests.detail.history")}
        </Typography.Title>
        {request.workflow.history.length ? (
          request.workflow.history.map((entry) => (
            <Typography.Paragraph key={entry.id}>
              {historyLabel(t, entry.action)} -{" "}
              {entry.actor?.full_name || t("permissionRequests.detail.system")}{" "}
              ({formatDateTime(entry.at)}){entry.note ? `: ${entry.note}` : ""}
            </Typography.Paragraph>
          ))
        ) : (
          <Empty description={t("permissionRequests.list.empty")} />
        )}
      </Card>
      <ApprovalTrail request={request} />
    </div>
  );
}
