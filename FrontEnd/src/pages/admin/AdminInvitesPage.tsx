import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import {
  MailOutlined,
  ReloadOutlined,
  StopOutlined,
  WhatsAppOutlined,
} from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import type {
  InviteDeliveryStatus,
  InviteDto,
  Role,
} from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import {
  createInvite,
  listInvites,
  resendInvite,
  revokeInvite,
} from "../../services/api/invitesApi";
import type {
  CreateInviteRequest,
  InviteChannel,
} from "../../services/api/invitesApi";
import PhoneNumberInput from "../../components/ui/PhoneNumberInput";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import { MAX_SEARCH_LENGTH, toSearchParam } from "../../utils/searchInput";

type UiMode = "loading" | "empty" | "error" | "ok";

type InviteStatus = "sent" | "accepted" | "revoked" | "expired";

// null = no delivery metadata available (older rows / pending)
// The raw provider name is deliberately dropped here: HR-facing UI never names
// the delivery vendor, it only reports the delivery state.
type DeliveryInfo = {
  sent: boolean | null;
  error: string | null;
  // Confirmed delivery state from the provider. "sent" means submitted to the
  // provider only — NOT confirmed delivery. null = older rows without metadata.
  deliveryStatus: InviteDeliveryStatus | null;
  providerSubmitted: boolean | null;
};

type InviteRow = {
  id: string | number;
  email: string | null;
  phoneNumber: string | null;
  channel: InviteChannel;
  role: Role;
  status: InviteStatus;
  invitedAt: string;
  expiresAt: string;
  invitedBy: string;
  delivery: DeliveryInfo;
};

type SendInviteValues = {
  channel: InviteChannel;
  email?: string;
  phone_number?: string;
  role: Role;
};

// Manager is intentionally absent: the backend no longer accepts Manager invites.
// Manager access is granted by assigning the person as a direct manager instead.
const roleOptions: Role[] = ["SystemAdmin", "HRManager", "CEO", "Employee"];

function statusTag(status: InviteStatus, t: any) {
  if (status === "sent") return <Tag color="gold">{t("status.pending")}</Tag>;
  if (status === "accepted")
    return <Tag color="green">{t("status.accepted")}</Tag>;
  if (status === "revoked") return <Tag color="red">{t("status.revoked")}</Tag>;
  return <Tag>{t("status.expired")}</Tag>;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return value.slice(0, 10);
}

// Prefer last_delivery; fall back to the channel-specific delivery snapshot.
function resolveDelivery(invite: InviteDto): DeliveryInfo {
  const channel = invite.channel === "whatsapp" ? "whatsapp" : "email";
  const last = invite.last_delivery;
  if (last) {
    return {
      sent: last.sent,
      error: last.error ?? null,
      deliveryStatus: last.delivery_status ?? null,
      providerSubmitted: last.provider_submitted ?? null,
    };
  }
  const fallback =
    channel === "whatsapp" ? invite.whatsapp_delivery : invite.email_delivery;
  if (fallback) {
    return {
      sent: fallback.sent,
      error: fallback.error ?? null,
      deliveryStatus: fallback.delivery_status ?? null,
      providerSubmitted: fallback.provider_submitted ?? null,
    };
  }
  return {
    sent: null,
    error: null,
    deliveryStatus: null,
    providerSubmitted: null,
  };
}

function toInviteRow(invite: InviteDto): InviteRow {
  return {
    id: invite.id,
    email: invite.email ?? null,
    phoneNumber: invite.phone_number ?? null,
    channel: invite.channel === "whatsapp" ? "whatsapp" : "email",
    role: invite.role,
    status: invite.status as InviteStatus,
    invitedAt: formatDate(invite.sent_at),
    expiresAt: formatDate(invite.expires_at),
    invitedBy: "-",
    delivery: resolveDelivery(invite),
  };
}

// Raw vendor identifiers must never reach the HR-facing UI, not even inside a
// pass-through error string from the delivery backend.
const PROVIDER_NAME_PATTERN = /bird|evolution/i;

// A safe, user-facing explanation. Any detail that names the delivery vendor is
// replaced by the generic message.
function safeDeliveryError(delivery: DeliveryInfo, t: any): string {
  const detail = delivery.error?.trim();
  if (!detail || PROVIDER_NAME_PATTERN.test(detail)) {
    return t("admin.invites.deliveryFailedGeneric");
  }
  return detail;
}

function makeTag(color: string | undefined, label: string, tip?: string) {
  const tag = <Tag color={color}>{label}</Tag>;
  return tip ? <Tooltip title={tip}>{tag}</Tooltip> : tag;
}

// WhatsApp delivery is reported asynchronously: a successful hand-off is NOT a
// confirmed delivery. Only show "Delivered"/"Read" when the back-end explicitly
// reports them; otherwise show Queued/Sent.
function whatsappDeliveryTag(delivery: DeliveryInfo, t: any) {
  // Read is the strongest confirmation available.
  if (delivery.deliveryStatus === "read") {
    return makeTag("green", t("admin.invites.deliveryRead"));
  }

  // Confirmed delivery is the only other path that may claim "Delivered".
  if (delivery.deliveryStatus === "delivered") {
    return makeTag("green", t("admin.invites.deliveryDelivered"));
  }

  // Accepted for delivery but not yet handed to the recipient.
  if (delivery.deliveryStatus === "queued") {
    return makeTag("blue", t("admin.invites.deliveryQueued"));
  }

  // Handed off (status "sent"/"unknown") — sent, not confirmed delivered.
  if (
    delivery.deliveryStatus === "sent" ||
    delivery.deliveryStatus === "unknown" ||
    delivery.providerSubmitted === true ||
    delivery.sent === true
  ) {
    return makeTag("blue", t("admin.invites.deliverySent"));
  }

  // Immediate send failure. For WhatsApp, `sent: false` can also mean "queued but
  // not confirmed delivered", so only fail when it was not accepted at all.
  if (delivery.deliveryStatus === "failed" || delivery.sent === false) {
    return makeTag(
      "red",
      t("admin.invites.deliveryFailed"),
      safeDeliveryError(delivery, t),
    );
  }

  // No delivery metadata available (older rows / not yet attempted).
  return <Tag>{t("admin.invites.deliveryPending")}</Tag>;
}

function deliveryTag(delivery: DeliveryInfo, channel: InviteChannel, t: any) {
  if (channel === "whatsapp") {
    return whatsappDeliveryTag(delivery, t);
  }

  // Email delivery is synchronous: the send response reflects acceptance.
  if (delivery.deliveryStatus === "read") {
    return makeTag("green", t("admin.invites.deliveryRead"));
  }
  if (delivery.deliveryStatus === "delivered") {
    return makeTag("green", t("admin.invites.deliveryDelivered"));
  }
  if (delivery.sent === true) {
    return makeTag("green", t("admin.invites.deliverySent"));
  }
  if (delivery.sent === false) {
    return makeTag(
      "red",
      t("admin.invites.deliveryFailed"),
      safeDeliveryError(delivery, t),
    );
  }
  return <Tag>{t("admin.invites.deliveryPending")}</Tag>;
}

export default function AdminInvitesPage() {
  const [form] = Form.useForm<SendInviteValues>();
  const { t } = useI18n();
  const channel =
    (Form.useWatch("channel", form) as InviteChannel | undefined) ?? "email";
  const isWhatsappChannel = channel === "whatsapp";

  const [mode, setMode] = useState<UiMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  const [rows, setRows] = useState<InviteRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | InviteStatus>("All");
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 8,
    total: 0,
  });

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "sent").length,
    [rows],
  );

  const loadInvites = useCallback(
    async (page = 1, pageSize = 8) => {
      setMode("loading");
      setError(null);
      setUnauthorized(false);

      try {
        const res = await listInvites({
          page,
          page_size: pageSize,
          search: toSearchParam(search),
          status: statusFilter === "All" ? undefined : statusFilter,
        });

        if (isApiError(res)) {
          setError(res.message || "Failed to load invites.");
          setMode("error");
          return;
        }

        const items = res.data.items || [];
        setRows(items.map(toInviteRow));
        setPagination((prev) => ({
          ...prev,
          current: res.data.page ?? page,
          pageSize: res.data.page_size ?? pageSize,
          total: res.data.count ?? items.length,
        }));
        setMode(items.length === 0 ? "empty" : "ok");
      } catch (err: any) {
        if (err?.response?.status === 403) {
          setUnauthorized(true);
          return;
        }
        setError("Failed to load invites.");
        setMode("error");
      }
    },
    [search, statusFilter],
  );

  useEffect(() => {
    loadInvites(pagination.current || 1, pagination.pageSize || 8);
  }, [loadInvites, pagination.current, pagination.pageSize]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, [search, statusFilter]);

  async function sendInvite(values: SendInviteValues) {
    setError(null);
    setSending(true);

    const channel: InviteChannel =
      values.channel === "whatsapp" ? "whatsapp" : "email";

    try {
      const payload: CreateInviteRequest =
        channel === "whatsapp"
          ? {
              channel,
              phone_number: values.phone_number?.trim(),
              role: values.role,
            }
          : { channel, email: values.email?.trim(), role: values.role };
      const res = await createInvite(payload);

      if (isApiError(res)) {
        const firstError = res.errors
          ? Object.values(res.errors).flat().join(" ")
          : res.message;
        setError(firstError || "Failed to send invite.");
        return;
      }

      const delivery =
        channel === "whatsapp"
          ? res.data.whatsapp_delivery
          : res.data.email_delivery;
      if (
        delivery &&
        !delivery.sent &&
        delivery.provider_submitted !== true &&
        delivery.delivery_status !== "queued" &&
        delivery.delivery_status !== "sent"
      ) {
        const channelLabel =
          channel === "whatsapp" ? "WhatsApp message" : "email";
        message.warning(
          `Invite created, but ${channelLabel} was not delivered${delivery.error ? `: ${delivery.error}` : "."}`,
        );
      } else {
        message.success("Invite sent successfully.");
      }
      form.resetFields([channel === "whatsapp" ? "phone_number" : "email"]);
      loadInvites(1, pagination.pageSize || 8);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }

      const data = e?.apiData || e?.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        // errors is [{ field: "...", message: "..." }, ...]
        const firstError = data.errors.map((err: any) => err.message).join(" ");
        setError(firstError);
      } else if (data?.errors) {
        const firstError = Object.values(data.errors).flat().join(" ");
        setError(firstError);
      } else {
        setError(e?.message || "Failed to send invite.");
      }
    } finally {
      setSending(false);
    }
  }

  async function resendInviteRow(invite: InviteRow) {
    try {
      message.loading({
        content: "Resending invite...",
        key: `resend-${invite.id}`,
      });
      const res = await resendInvite(invite.id);

      if (isApiError(res)) {
        message.error({
          content: res.message || "Failed to resend.",
          key: `resend-${invite.id}`,
        });
        return;
      }

      const channelLabel =
        invite.channel === "whatsapp" ? "WhatsApp message" : "email";
      const delivery = resolveDelivery(res.data);
      if (
        delivery.sent === false &&
        delivery.providerSubmitted !== true &&
        delivery.deliveryStatus !== "queued" &&
        delivery.deliveryStatus !== "sent"
      ) {
        message.warning({
          content: `Invite updated, but ${channelLabel} was not delivered${delivery.error ? `: ${delivery.error}` : "."}`,
          key: `resend-${invite.id}`,
        });
      } else {
        message.success({
          content: "Invite resent.",
          key: `resend-${invite.id}`,
        });
      }
      loadInvites(pagination.current || 1, pagination.pageSize || 8);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error({
        content: e?.message || "Failed to resend.",
        key: `resend-${invite.id}`,
      });
    }
  }

  async function revokeInviteRow(invite: InviteRow) {
    // Optimistic: flip the row to "revoked" immediately; restore its previous
    // status if the request fails.
    const previousStatus = invite.status;
    setRows((current) =>
      current.map((row) =>
        row.id === invite.id ? { ...row, status: "revoked" } : row,
      ),
    );
    try {
      message.loading({
        content: "Revoking invite...",
        key: `revoke-${invite.id}`,
      });
      const res = await revokeInvite(invite.id);

      if (isApiError(res)) {
        setRows((current) =>
          current.map((row) =>
            row.id === invite.id ? { ...row, status: previousStatus } : row,
          ),
        );
        message.error({
          content: res.message || "Failed to revoke.",
          key: `revoke-${invite.id}`,
        });
        return;
      }

      message.success({
        content: "Invite revoked.",
        key: `revoke-${invite.id}`,
      });
    } catch (e: any) {
      setRows((current) =>
        current.map((row) =>
          row.id === invite.id ? { ...row, status: previousStatus } : row,
        ),
      );
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error({
        content: e?.message || "Failed to revoke.",
        key: `revoke-${invite.id}`,
      });
    }
  }

  const columns: ColumnsType<InviteRow> = [
    {
      title: t("admin.invites.recipient"),
      key: "recipient",
      render: (_, record) => {
        const isWhatsapp = record.channel === "whatsapp";
        // WhatsApp invites are addressed by phone; the email is supporting detail
        // that HR may not have supplied yet.
        const primary = isWhatsapp ? record.phoneNumber : record.email;
        const secondary = isWhatsapp
          ? record.email || t("admin.invites.emailAddedDuringSignup")
          : null;
        return (
          <Space size={8} align="start">
            <Tag
              icon={isWhatsapp ? <WhatsAppOutlined /> : <MailOutlined />}
              color={isWhatsapp ? "green" : "blue"}
            >
              {isWhatsapp
                ? t("admin.invites.channelWhatsapp")
                : t("common.email")}
            </Tag>
            <div>
              {primary ? (
                <Typography.Text strong>{primary}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              )}
              {secondary && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {secondary}
                  </Typography.Text>
                </div>
              )}
            </div>
          </Space>
        );
      },
    },
    {
      title: t("common.role"),
      dataIndex: "role",
      key: "role",
      render: (v: Role) =>
        v === "SystemAdmin" ? (
          <Tag color="orange">{t(`role.${v}`, v)}</Tag>
        ) : v === "HRManager" ? (
          <Tag color="blue">{t(`role.${v}`, v)}</Tag>
        ) : v === "Manager" ? (
          // Manager invites are no longer issued; older rows are flagged as legacy
          // rather than presented as a role HR can still pick.
          <Tag>{t("admin.invites.legacyManagerRole")}</Tag>
        ) : v === "CEO" ? (
          <Tag color="purple">{t(`role.${v}`, v)}</Tag>
        ) : (
          <Tag>{t(`role.${v}`, v)}</Tag>
        ),
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      render: (v: InviteStatus) => statusTag(v, t),
    },
    {
      title: t("admin.invites.delivery"),
      key: "delivery",
      render: (_, record) => deliveryTag(record.delivery, record.channel, t),
    },
    {
      title: t("admin.invites.invited"),
      dataIndex: "invitedAt",
      key: "invitedAt",
    },
    {
      title: t("admin.invites.expires"),
      dataIndex: "expiresAt",
      key: "expiresAt",
    },
    {
      title: t("admin.invites.invitedBy"),
      dataIndex: "invitedBy",
      key: "invitedBy",
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      render: (_, record) => {
        const isWhatsapp = record.channel === "whatsapp";
        const resendLabel = isWhatsapp
          ? t("admin.invites.resendWhatsapp")
          : t("admin.invites.resendEmail");
        return (
          <Space>
            <Tooltip title={resendLabel}>
              <Button
                icon={isWhatsapp ? <WhatsAppOutlined /> : <MailOutlined />}
                onClick={() => resendInviteRow(record)}
                disabled={record.status !== "sent"}
              >
                {t("admin.invites.resend")}
              </Button>
            </Tooltip>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={() => revokeInviteRow(record)}
              disabled={record.status !== "sent"}
            >
              {t("admin.invites.revoke")}
            </Button>
          </Space>
        );
      },
    },
  ];

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title={t("loading.generic")} />;
  if (mode === "error")
    return (
      <ErrorState
        title={t("admin.invites.title")}
        description={error || t("common.tryAgain")}
        onRetry={() =>
          loadInvites(pagination.current || 1, pagination.pageSize || 8)
        }
      />
    );

  return (
    <div>
      <PageHeader
        title={t("admin.invites.title")}
        subtitle={`${t("admin.invites.pendingInvitations")}: ${pendingCount}`}
        actions={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => loadInvites(1, pagination.pageSize || 8)}
            >
              {t("common.refresh")}
            </Button>
          </Space>
        }
      />

      <Card
        style={{ borderRadius: 16, marginBottom: 16 }}
        bodyStyle={{ padding: 24 }}
      >
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t("admin.invites.sendInvitation")}
        </Typography.Title>
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 12 }}
          />
        )}
        <Form<SendInviteValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={sendInvite}
          initialValues={{ role: "Employee", channel: "email" }}
        >
          <Row gutter={16} align="bottom">
            <Col xs={24} md={5}>
              <Form.Item label={t("admin.invites.channel")} name="channel">
                <Segmented
                  size="large"
                  block
                  options={[
                    {
                      label: t("common.email"),
                      value: "email",
                      icon: <MailOutlined />,
                    },
                    {
                      label: t("admin.invites.channelWhatsapp"),
                      value: "whatsapp",
                      icon: <WhatsAppOutlined />,
                    },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              {isWhatsappChannel ? (
                // WhatsApp invites are addressed by phone only; the employee supplies
                // their email during signup and the back-end stores it on the invite.
                <Form.Item
                  label={t("admin.invites.phoneNumber")}
                  name="phone_number"
                  rules={[
                    {
                      required: true,
                      message: t("admin.invites.phoneRequired"),
                    },
                    {
                      pattern: /^\+[1-9]\d{7,14}$/,
                      message: t("admin.invites.phoneInvalid"),
                    },
                  ]}
                >
                  <PhoneNumberInput size="large" />
                </Form.Item>
              ) : (
                <Form.Item
                  label={t("common.email")}
                  name="email"
                  rules={[
                    { required: true, message: t("auth.emailRequired") },
                    { type: "email", message: t("auth.emailInvalid") },
                  ]}
                >
                  <Input
                    size="large"
                    placeholder="name@company.com"
                    autoComplete="email"
                  />
                </Form.Item>
              )}
            </Col>
            <Col xs={24} md={6}>
              <Form.Item
                label={t("common.role")}
                name="role"
                rules={[{ required: true, message: t("common.required") }]}
              >
                <Select
                  size="large"
                  options={roleOptions
                    .filter(
                      (r) =>
                        r !== "SystemAdmin" ||
                        useAuthStore.getState().user?.role === "SystemAdmin",
                    )
                    .map((r) => ({ label: t(`role.${r}`, r), value: r }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  loading={sending}
                  block
                >
                  {t("admin.invites.sendInvite")}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card style={{ borderRadius: 16 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t("admin.invites.invitationHistory")}
        </Typography.Title>
        <div
          className="responsive-filter-bar"
          style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
        >
          <Input
            allowClear
            maxLength={MAX_SEARCH_LENGTH}
            placeholder={t("admin.invites.searchByEmailOrPhone")}
            style={{ flex: "1 1 200px", minWidth: 150 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ flex: "0 1 180px", minWidth: 120 }}
            options={[
              { label: t("common.filter"), value: "All" },
              { label: t("status.pending"), value: "sent" },
              { label: t("status.accepted"), value: "accepted" },
              { label: t("status.revoked"), value: "revoked" },
              { label: t("status.expired"), value: "expired" },
            ]}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          {mode === "empty" || (mode === "ok" && rows.length === 0) ? (
            <EmptyState
              title={t("common.noData")}
              description={t("admin.invites.title")}
              actionText={t("admin.invites.sendInvitation")}
              onAction={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : (
            <Table<InviteRow>
              rowKey="id"
              columns={columns}
              dataSource={rows}
              scroll={{ x: 960 }}
              pagination={{
                current: pagination.current,
                pageSize: pagination.pageSize,
                total: pagination.total,
                showSizeChanger: true,
              }}
              onChange={(pager) => {
                setPagination((prev) => ({
                  ...prev,
                  current: pager.current,
                  pageSize: pager.pageSize,
                }));
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
