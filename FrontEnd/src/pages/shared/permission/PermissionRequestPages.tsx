import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../../i18n/useI18n";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  TimePicker,
  Typography,
  notification,
} from "antd";
import dayjs from "dayjs";
import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../../../components/requests/ApprovalFlowMap";
import { formatDateTime } from "../../../utils/dateTime";
import { fieldErrorsFromResponse } from "../../../utils/attendancePolicy";
import { isApiError } from "../../../services/api/apiTypes";
import { getSettings } from "../../../services/api/settingsApi";
import {
  PERMISSION_TYPES,
  cancelPermissionRequest,
  createPermissionRequest,
  decidePermissionRequest,
  downloadPermissionRequestPdf,
  getHrPermissionRequests,
  getManagerPermissionRequests,
  getMyPermissionRequests,
  getPermissionRequest,
  type CreatePermissionRequestPayload,
  type ExitType,
  type PermissionRequest,
  type PermissionStatus,
  type PermissionType,
} from "../../../services/api/permissionRequestsApi";
import EvidencePicker, { type EvidenceItem } from "./EvidencePicker";
import PermissionAttachmentsSection from "./PermissionAttachmentsSection";
import {
  DEFAULT_PERMISSION_POLICY,
  EXIT_MAX_MINUTES,
  PERMISSION_TYPE_COLORS,
  isOutsideRequestWindow,
  minutesBetween,
  permissionTypeLabel,
  splitServerErrors,
} from "./permissionRequestHelpers";

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
function timeWindow(request: PermissionRequest) {
  return request.from_time && request.to_time
    ? `${request.from_time.slice(0, 5)} - ${request.to_time.slice(0, 5)}`
    : null;
}

function PermissionTypeTag({ type }: { type: PermissionType }) {
  const { t } = useI18n();
  return (
    <Tag
      color={PERMISSION_TYPE_COLORS[type] ?? "default"}
      style={{ marginInlineEnd: 0 }}
    >
      {permissionTypeLabel(t, type)}
    </Tag>
  );
}

type PermissionFormValues = {
  permission_type: PermissionType;
  request_date?: dayjs.Dayjs;
  from_time?: dayjs.Dayjs;
  to_time?: dayjs.Dayjs;
  exit_type?: ExitType;
  reason: string;
  attachments?: EvidenceItem[];
};

/** Fields each type renders; a server error on any other field is form-level. */
const FIELDS_BY_TYPE: Record<PermissionType, readonly string[]> = {
  exit: ["from_time", "to_time", "exit_type", "reason"],
  late: ["request_date", "reason", "attachments"],
  during_shift: [
    "request_date",
    "from_time",
    "to_time",
    "reason",
    "attachments",
  ],
};
const ERROR_ALIASES: Record<string, string> = {
  attachment_metadata: "attachments",
  duration_minutes: "to_time",
};

/** The global request policy; defaults apply until settings load. */
function usePermissionPolicy() {
  const [policy, setPolicy] = useState(DEFAULT_PERMISSION_POLICY);
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((response) => {
        if (cancelled || isApiError(response)) return;
        const attendance = response.data.attendance;
        setPolicy({
          advanceDays:
            attendance?.permission_request_advance_limit_days ??
            DEFAULT_PERMISSION_POLICY.advanceDays,
          duringShiftMaxMinutes:
            attendance?.during_shift_permission_max_minutes ??
            DEFAULT_PERMISSION_POLICY.duringShiftMaxMinutes,
          lateLimit:
            attendance?.approved_late_permission_limit_per_month ??
            DEFAULT_PERMISSION_POLICY.lateLimit,
        });
      })
      .catch(() => {
        // Keep the defaults; the server enforces the real policy on submit.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return policy;
}

/**
 * Final-approved Late Permissions in the month of `date`. Uses the server's
 * own counter from any Late request dated that month; with none, nothing has
 * been used yet.
 */
function useLateUsage(
  date: dayjs.Dayjs | undefined,
  enabled: boolean,
  fallbackLimit: number,
) {
  const monthKey = enabled && date ? date.format("YYYY-MM") : null;
  const [usage, setUsage] = useState<{ usage: number; limit: number } | null>(
    null,
  );
  useEffect(() => {
    if (!monthKey) return;
    let cancelled = false;
    const month = dayjs(`${monthKey}-01`);
    getMyPermissionRequests({
      date_from: month.startOf("month").format("YYYY-MM-DD"),
      date_to: month.endOf("month").format("YYYY-MM-DD"),
      page_size: 100,
    })
      .then((response) => {
        if (cancelled || isApiError(response)) return;
        const late = (response.data.items ?? []).filter(
          (item) => item.permission_type === "late",
        );
        const counted = late.find(
          (item) => item.monthly_late_permission_usage != null,
        );
        setUsage({
          usage: counted?.monthly_late_permission_usage ?? 0,
          limit: counted?.monthly_late_permission_limit ?? fallbackLimit,
        });
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fallbackLimit, monthKey]);
  return monthKey ? usage : null;
}

export function PermissionRequestFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [form] = Form.useForm<PermissionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [companyRequired, setCompanyRequired] = useState(false);
  const policy = usePermissionPolicy();
  const today = dayjs();
  const type = (Form.useWatch("permission_type", form) ??
    "exit") as PermissionType;
  const requestDate = Form.useWatch("request_date", form) as
    | dayjs.Dayjs
    | undefined;
  const from = Form.useWatch("from_time", form) as dayjs.Dayjs | undefined;
  const to = Form.useWatch("to_time", form) as dayjs.Dayjs | undefined;
  const timed = type !== "late";
  const duration = minutesBetween(from, to);
  const maxMinutes =
    type === "exit" ? EXIT_MAX_MINUTES : policy.duringShiftMaxMinutes;
  const durationInvalid = timed && (duration <= 0 || duration > maxMinutes);
  const lateUsage = useLateUsage(
    requestDate,
    type === "late",
    policy.lateLimit,
  );

  function buildPayload(
    values: PermissionFormValues,
  ): CreatePermissionRequestPayload {
    const reason = values.reason.trim();
    const evidence = values.attachments ?? [];
    const requestDay = (values.request_date ?? dayjs()).format("YYYY-MM-DD");
    if (values.permission_type === "late") {
      return {
        permission_type: "late",
        request_date: requestDay,
        reason,
        attachments: evidence.map((item) => item.file),
        attachment_metadata: evidence.map((item) => item.metadata),
      };
    }
    const fromTime = (values.from_time as dayjs.Dayjs).format("HH:mm");
    const toTime = (values.to_time as dayjs.Dayjs).format("HH:mm");
    if (values.permission_type === "during_shift") {
      return {
        permission_type: "during_shift",
        request_date: requestDay,
        from_time: fromTime,
        to_time: toTime,
        reason,
        attachments: evidence.map((item) => item.file),
        attachment_metadata: evidence.map((item) => item.metadata),
      };
    }
    // Exit keeps the legacy same-day JSON payload, without permission_type.
    return {
      request_date: dayjs().format("YYYY-MM-DD"),
      from_time: fromTime,
      to_time: toTime,
      exit_type: values.exit_type ?? "personal",
      reason,
      duration_minutes: duration,
    };
  }

  function showServerErrors(errors: Record<string, string>, fallback: string) {
    const { fields, other } = splitServerErrors(
      errors,
      FIELDS_BY_TYPE[type],
      ERROR_ALIASES,
    );
    form.setFields(fields);
    setFormErrors(other.length ? other : fields.length ? [] : [fallback]);
  }

  async function submit(values: PermissionFormValues) {
    setSubmitting(true);
    setFormErrors([]);
    setCompanyRequired(false);
    try {
      const response = await createPermissionRequest(buildPayload(values));
      if (isApiError(response)) {
        showServerErrors(
          fieldErrorsFromResponse({ response: { data: response } }),
          response.message,
        );
        return;
      }
      notification.success({
        message: response.message || t("permissionRequests.success.submitted"),
      });
      navigate("/employee/permission-requests");
    } catch (error) {
      const status = httpStatus(error);
      if (status === 422) {
        showServerErrors(
          fieldErrorsFromResponse(error),
          errorText(t, error, t("permissionRequests.error.submit")),
        );
      } else if (status === 403) {
        setCompanyRequired(true);
      } else {
        notification.error({
          message: t("permissionRequests.error.submit"),
          description: errorText(
            t,
            error,
            t("permissionRequests.error.submit"),
          ),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const typeHint =
    type === "late"
      ? t("permissionRequests.type.lateHint")
      : type === "during_shift"
        ? t("permissionRequests.type.duringShiftHint")
        : t("permissionRequests.type.exitHint");

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <PageHeader
        title={t("permissionRequests.newTitle")}
        subtitle={
          // Late and During Shift explain their date window under the date field.
          type === "exit"
            ? `${t("permissionRequests.formSubtitle")} (${today.format("YYYY-MM-DD")})`
            : undefined
        }
      />
      <Card>
        {companyRequired && (
          <Alert
            type="warning"
            showIcon
            title={t("permissionRequests.error.companyRequired")}
            description={t("attendancePolicy.companyRequiredHint")}
            style={{ marginBottom: 16 }}
          />
        )}
        {formErrors.length > 0 && (
          <Alert
            type="error"
            showIcon
            title={t("permissionRequests.form.fixErrors")}
            description={
              formErrors.length === 1 ? (
                formErrors[0]
              ) : (
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {formErrors.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )
            }
            style={{ marginBottom: 16 }}
          />
        )}
        <Form<PermissionFormValues>
          form={form}
          layout="vertical"
          onFinish={submit}
          onValuesChange={(changed) => {
            if ("permission_type" in changed) setFormErrors([]);
          }}
          initialValues={{
            permission_type: "exit",
            exit_type: "personal",
            request_date: today,
            attachments: [],
          }}
        >
          <Form.Item
            label={t("permissionRequests.type.label")}
            name="permission_type"
            extra={typeHint}
          >
            <Segmented
              block
              options={PERMISSION_TYPES.map((value) => ({
                value,
                label: permissionTypeLabel(t, value),
              }))}
            />
          </Form.Item>

          {type !== "exit" && (
            <Form.Item
              label={t("permissionRequests.form.requestDate")}
              name="request_date"
              extra={t("permissionRequests.form.dateWindow", {
                days: policy.advanceDays,
              })}
              rules={[
                {
                  required: true,
                  message: t("permissionRequests.form.dateRequired"),
                },
              ]}
            >
              <DatePicker
                allowClear={false}
                style={{ width: "100%", maxWidth: 260 }}
                disabledDate={(day) =>
                  isOutsideRequestWindow(day, today, policy.advanceDays)
                }
              />
            </Form.Item>
          )}

          {type === "late" && (
            <Flex vertical gap={12} style={{ marginBottom: 16 }}>
              <Alert
                type="info"
                showIcon
                title={t("permissionRequests.form.lateNoTimes")}
              />
              {lateUsage && (
                <Alert
                  type={
                    lateUsage.usage >= lateUsage.limit ? "warning" : "success"
                  }
                  showIcon
                  title={t("permissionRequests.form.lateUsage", lateUsage)}
                  description={
                    lateUsage.usage >= lateUsage.limit
                      ? t("permissionRequests.form.lateLimitReached")
                      : undefined
                  }
                />
              )}
            </Flex>
          )}

          {timed && (
            <>
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
              <Flex vertical gap={2}>
                <Typography.Text type={durationInvalid ? "danger" : undefined}>
                  {duration > 0
                    ? t("permissionRequests.form.duration", {
                        minutes: duration,
                      })
                    : t("permissionRequests.form.chooseWindow")}
                </Typography.Text>
                <Typography.Text
                  type={duration > maxMinutes ? "danger" : "secondary"}
                >
                  {duration > maxMinutes
                    ? t("permissionRequests.form.durationTooLong", {
                        minutes: maxMinutes,
                      })
                    : t("permissionRequests.form.maxDuration", {
                        minutes: maxMinutes,
                      })}
                </Typography.Text>
              </Flex>
            </>
          )}

          {type === "exit" && (
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
          )}

          <Form.Item
            label={t("permissionRequests.form.reason")}
            name="reason"
            style={{ marginTop: type === "during_shift" ? 16 : undefined }}
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

          {type !== "exit" && (
            <Form.Item
              label={
                type === "late"
                  ? t("permissionRequests.evidence.title")
                  : t("permissionRequests.evidence.optional")
              }
              name="attachments"
              rules={
                type === "late"
                  ? [
                      {
                        validator: (_, value?: EvidenceItem[]) =>
                          value?.length
                            ? Promise.resolve()
                            : Promise.reject(
                                new Error(
                                  t("permissionRequests.evidence.required"),
                                ),
                              ),
                      },
                    ]
                  : []
              }
            >
              <EvidencePicker disabled={submitting} />
            </Form.Item>
          )}

          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            disabled={durationInvalid}
          >
            {t("permissionRequests.form.submit")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function RequestList({
  inbox,
  embedded = false,
}: {
  inbox: "mine" | "manager" | "hr";
  /** Rendered as a tab of another page, which owns the header. */
  embedded?: boolean;
}) {
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
  // The API has no permission_type filter, so this narrows the loaded page only.
  const [typeFilter, setTypeFilter] = useState<PermissionType | "all">("all");
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
  const visibleItems =
    typeFilter === "all"
      ? items
      : items.filter((item) => item.permission_type === typeFilter);
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
      {!embedded && (
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
      )}
      <Card>
        <Flex wrap gap={12} style={{ marginBottom: 16 }}>
          <Select
            aria-label={t("permissionRequests.list.status")}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            style={{ width: 190 }}
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
          <Select
            aria-label={t("permissionRequests.list.typeFilter")}
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 220 }}
            options={[
              {
                value: "all",
                label: `${t("permissionRequests.list.typeFilter")}: ${t("permissionRequests.list.allTypes")}`,
              },
              ...PERMISSION_TYPES.map((value) => ({
                value,
                label: permissionTypeLabel(t, value),
              })),
            ]}
          />
        </Flex>
        {typeFilter !== "all" && (
          <Typography.Paragraph type="secondary">
            {t("permissionRequests.list.typeFilterNote")}
          </Typography.Paragraph>
        )}
        <ResponsiveTable
          mobileCard={{ titleKey: "reference_no", extraKey: "status" }}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: (
              <Empty description={t("permissionRequests.list.empty")} />
            ),
          }}
          dataSource={visibleItems}
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
                    key: "employee",
                    title: t("permissionRequests.list.employee"),
                    render: (_: unknown, record: PermissionRequest) =>
                      record.employee.full_name,
                  },
                ]
              : []),
            {
              key: "permission_type",
              title: t("permissionRequests.list.permissionType"),
              render: (_: unknown, record: PermissionRequest) => (
                <PermissionTypeTag type={record.permission_type ?? "exit"} />
              ),
            },
            {
              title: t("permissionRequests.list.date"),
              dataIndex: "request_date",
            },
            {
              key: "time",
              title: t("permissionRequests.list.time"),
              render: (_: unknown, record: PermissionRequest) =>
                timeWindow(record) ?? "—",
            },
            {
              key: "type",
              title: t("permissionRequests.detail.exitType"),
              render: (_: unknown, record: PermissionRequest) =>
                record.exit_type
                  ? language === "ar"
                    ? record.exit_type_label_ar
                    : record.exit_type_label
                  : "—",
            },
            {
              key: "status",
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
export function ManagerPermissionRequestsPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  return <RequestList inbox="manager" embedded={embedded} />;
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
  const permissionType = request.permission_type ?? "exit";
  const isExit = permissionType === "exit";
  const timeRange = timeWindow(request);
  const typeLabel =
    language === "ar" ? request.exit_type_label_ar : request.exit_type_label;
  const attachments = request.attachments ?? [];
  return (
    <div>
      <PageHeader
        title={request.reference_no}
        actions={
          // The permission PDF is the Exit Permission form.
          isExit ? (
            <Button loading={pdfBusy} onClick={() => void downloadPdf()}>
              {t("permissionRequests.detail.downloadPdf")}
            </Button>
          ) : undefined
        }
      />
      <Card>
        <Descriptions bordered column={1}>
          <Descriptions.Item label={t("permissionRequests.detail.employee")}>
            {request.employee.full_name}
          </Descriptions.Item>
          <Descriptions.Item
            label={t("permissionRequests.detail.permissionType")}
          >
            <PermissionTypeTag type={permissionType} />
          </Descriptions.Item>
          <Descriptions.Item label={t("permissionRequests.detail.date")}>
            {request.request_date}
          </Descriptions.Item>
          {timeRange && (
            <Descriptions.Item label={t("permissionRequests.detail.time")}>
              <span
                dir="ltr"
                style={{ unicodeBidi: "isolate", whiteSpace: "nowrap" }}
              >
                {timeRange}
              </span>{" "}
              {t("permissionRequests.detail.duration", {
                minutes: request.duration_minutes,
              })}
            </Descriptions.Item>
          )}
          {isExit && (
            <Descriptions.Item label={t("permissionRequests.detail.exitType")}>
              {typeLabel}
            </Descriptions.Item>
          )}
          {permissionType === "late" &&
            request.monthly_late_permission_usage != null &&
            request.monthly_late_permission_limit != null && (
              <Descriptions.Item
                label={t("permissionRequests.detail.lateUsageLabel")}
              >
                {t("permissionRequests.detail.lateUsage", {
                  usage: request.monthly_late_permission_usage,
                  limit: request.monthly_late_permission_limit,
                })}
              </Descriptions.Item>
            )}
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
      {(!isExit || attachments.length > 0) && (
        <PermissionAttachmentsSection
          request={request}
          // `can_cancel` is exactly "the owner, while pending", the same
          // condition the server applies to adding evidence.
          canAdd={request.workflow.can_cancel}
          onUpdated={setRequest}
        />
      )}
      <ApprovalTrail request={request} />
    </div>
  );
}
