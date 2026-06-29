import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Input, Row, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { MailOutlined, ReloadOutlined, StopOutlined, WhatsAppOutlined } from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import type { InviteDeliveryStatus, InviteDto, Role } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import { createInvite, listInvites, resendInvite, revokeInvite, testWhatsappProvider } from "../../services/api/invitesApi";
import type { CreateInviteRequest, InviteChannel } from "../../services/api/invitesApi";
import PhoneNumberInput from "../../components/ui/PhoneNumberInput";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";

type UiMode = "loading" | "empty" | "error" | "ok";

type InviteStatus = "sent" | "accepted" | "revoked" | "expired";

// null = no delivery metadata available (older rows / pending)
type DeliveryInfo = {
  sent: boolean | null;
  provider: string | null;
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

const roleOptions: Role[] = ["SystemAdmin", "HRManager", "Manager", "CEO", "Employee"];

function statusTag(status: InviteStatus, t: any) {
  if (status === "sent") return <Tag color="gold">{t("status.pending")}</Tag>;
  if (status === "accepted") return <Tag color="green">{t("status.accepted")}</Tag>;
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
      provider: last.provider ?? null,
      error: last.error ?? null,
      deliveryStatus: last.delivery_status ?? null,
      providerSubmitted: last.provider_submitted ?? null,
    };
  }
  const fallback = channel === "whatsapp" ? invite.whatsapp_delivery : invite.email_delivery;
  if (fallback) {
    return {
      sent: fallback.sent,
      provider: fallback.provider ?? null,
      error: fallback.error ?? null,
      deliveryStatus: fallback.delivery_status ?? null,
      providerSubmitted: fallback.provider_submitted ?? null,
    };
  }
  return { sent: null, provider: null, error: null, deliveryStatus: null, providerSubmitted: null };
}

// Map raw provider identifiers to short, human-friendly brand labels.
function providerLabel(provider: string | null): string | null {
  if (!provider) return null;
  const p = provider.toLowerCase();
  if (p.includes("evolution")) return "Evolution";
  if (p.includes("bird")) return "Bird";
  return provider;
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

// A safe, user-facing fallback when the provider returns no error detail.
function safeDeliveryError(delivery: DeliveryInfo, t: any): string {
  return delivery.error || t("admin.invites.deliveryFailedGeneric");
}

function makeTag(color: string | undefined, label: string, provider: string | null, tip?: string) {
  const tag = (
    <Tag color={color}>
      {label}
      {provider ? ` · ${provider}` : ""}
    </Tag>
  );
  return tip ? <Tooltip title={tip}>{tag}</Tooltip> : tag;
}

// WhatsApp delivery is reported through Evolution asynchronously: a successful
// provider submission is NOT a confirmed delivery. Only show "Delivered" when
// the back-end explicitly reports delivered/read; otherwise show Queued/Submitted.
function whatsappDeliveryTag(delivery: DeliveryInfo, t: any) {
  const provider = providerLabel(delivery.provider);

  // Immediate provider send failure.
  if (delivery.deliveryStatus === "failed" || delivery.sent === false) {
    return makeTag("red", t("admin.invites.deliveryFailed"), provider, safeDeliveryError(delivery, t));
  }

  // Confirmed delivery (or read) is the only path that may claim "Delivered".
  if (delivery.deliveryStatus === "delivered" || delivery.deliveryStatus === "read") {
    return makeTag("green", t("admin.invites.deliveryDelivered"), provider);
  }

  // Accepted by the provider but not yet delivered.
  if (delivery.deliveryStatus === "queued") {
    return makeTag("blue", t("admin.invites.deliveryQueued"), provider);
  }

  // Submitted to the provider (status "sent"/"unknown") — handed off, not delivered.
  if (
    delivery.deliveryStatus === "sent" ||
    delivery.deliveryStatus === "unknown" ||
    delivery.providerSubmitted === true ||
    delivery.sent === true
  ) {
    return makeTag("blue", t("admin.invites.deliverySubmitted"), provider);
  }

  // No delivery metadata available (older rows / not yet attempted).
  return <Tag>{t("admin.invites.deliveryPending")}</Tag>;
}

function deliveryTag(delivery: DeliveryInfo, channel: InviteChannel, t: any) {
  if (channel === "whatsapp") {
    return whatsappDeliveryTag(delivery, t);
  }

  // Email delivery is synchronous: the provider response reflects acceptance,
  // so the existing sent/failed behavior is kept unchanged.
  const provider = providerLabel(delivery.provider);
  if (delivery.sent === true) {
    return makeTag("green", t("admin.invites.deliverySent"), provider);
  }
  if (delivery.sent === false) {
    return makeTag("red", t("admin.invites.deliveryFailed"), provider, delivery.error || undefined);
  }
  return <Tag>{t("admin.invites.deliveryPending")}</Tag>;
}

export default function AdminInvitesPage() {
  const [form] = Form.useForm<SendInviteValues>();
  const { t } = useI18n();
  const channel = (Form.useWatch("channel", form) as InviteChannel | undefined) ?? "email";

  const [mode, setMode] = useState<UiMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

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
    [rows]
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
          search: search.trim() || undefined,
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
    [search, statusFilter]
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

    const channel: InviteChannel = values.channel === "whatsapp" ? "whatsapp" : "email";

    try {
      const payload: CreateInviteRequest =
        channel === "whatsapp"
          ? { channel, phone_number: values.phone_number?.trim(), role: values.role }
          : { channel, email: values.email?.trim(), role: values.role };
      const res = await createInvite(payload);

      if (isApiError(res)) {
        const firstError = res.errors
          ? Object.values(res.errors).flat().join(" ")
          : res.message;
        setError(firstError || "Failed to send invite.");
        return;
      }

      const delivery = channel === "whatsapp" ? res.data.whatsapp_delivery : res.data.email_delivery;
      if (delivery && !delivery.sent) {
        const channelLabel = channel === "whatsapp" ? "WhatsApp message" : "email";
        message.warning(
          `Invite created, but ${channelLabel} was not delivered${delivery.error ? `: ${delivery.error}` : "."}`
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

  async function testWhatsapp() {
    const phone = testPhone.trim();
    if (!phone) {
      message.warning(t("admin.invites.phoneRequired"));
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      message.warning(t("admin.invites.phoneInvalid"));
      return;
    }

    setTesting(true);
    try {
      message.loading({ content: t("admin.invites.testWhatsappSending"), key: "test-whatsapp" });
      const res = await testWhatsappProvider(phone);

      if (isApiError(res)) {
        message.error({ content: res.message || t("admin.invites.testWhatsappFailed"), key: "test-whatsapp" });
        return;
      }

      const result = res.data;
      if (result?.sent) {
        const provider = providerLabel(result.provider ?? null);
        message.success({
          content: provider
            ? `${t("admin.invites.testWhatsappSent")} · ${provider}`
            : t("admin.invites.testWhatsappSent"),
          key: "test-whatsapp",
        });
      } else {
        message.warning({
          content: result?.error
            ? `${t("admin.invites.testWhatsappFailed")}: ${result.error}`
            : t("admin.invites.testWhatsappFailed"),
          key: "test-whatsapp",
        });
      }
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error({ content: e?.message || t("admin.invites.testWhatsappFailed"), key: "test-whatsapp" });
    } finally {
      setTesting(false);
    }
  }

  async function resendInviteRow(invite: InviteRow) {
    try {
      message.loading({ content: "Resending invite...", key: `resend-${invite.id}` });
      const res = await resendInvite(invite.id);

      if (isApiError(res)) {
        message.error({ content: res.message || "Failed to resend.", key: `resend-${invite.id}` });
        return;
      }

      const channelLabel = invite.channel === "whatsapp" ? "WhatsApp message" : "email";
      const delivery = resolveDelivery(res.data);
      if (delivery.sent === false) {
        message.warning({
          content: `Invite updated, but ${channelLabel} was not delivered${delivery.error ? `: ${delivery.error}` : "."}`,
          key: `resend-${invite.id}`,
        });
      } else {
        message.success({ content: "Invite resent.", key: `resend-${invite.id}` });
      }
      loadInvites(pagination.current || 1, pagination.pageSize || 8);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error({ content: e?.message || "Failed to resend.", key: `resend-${invite.id}` });
    }
  }

  async function revokeInviteRow(invite: InviteRow) {
    try {
      message.loading({ content: "Revoking invite...", key: `revoke-${invite.id}` });
      const res = await revokeInvite(invite.id);

      if (isApiError(res)) {
        message.error({ content: res.message || "Failed to revoke.", key: `revoke-${invite.id}` });
        return;
      }

      message.success({ content: "Invite revoked.", key: `revoke-${invite.id}` });
      loadInvites(pagination.current || 1, pagination.pageSize || 8);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error({ content: e?.message || "Failed to revoke.", key: `revoke-${invite.id}` });
    }
  }

  const columns: ColumnsType<InviteRow> = [
    {
      title: t("admin.invites.recipient"),
      key: "recipient",
      render: (_, record) => {
        const recipient = record.channel === "whatsapp" ? record.phoneNumber : record.email;
        return (
          <Space size={4}>
            <Tag
              icon={record.channel === "whatsapp" ? <WhatsAppOutlined /> : <MailOutlined />}
              color={record.channel === "whatsapp" ? "green" : "blue"}
            >
              {record.channel === "whatsapp" ? t("admin.invites.channelWhatsapp") : t("common.email")}
            </Tag>
            {recipient ? (
              <Typography.Text strong>{recipient}</Typography.Text>
            ) : (
              <Typography.Text type="secondary">-</Typography.Text>
            )}
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
          <Tag color="geekblue">{t(`role.${v}`, v)}</Tag>
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
    { title: t("admin.invites.invited"), dataIndex: "invitedAt", key: "invitedAt" },
    { title: t("admin.invites.expires"), dataIndex: "expiresAt", key: "expiresAt" },
    { title: t("admin.invites.invitedBy"), dataIndex: "invitedBy", key: "invitedBy" },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      render: (_, record) => {
        const isWhatsapp = record.channel === "whatsapp";
        const resendLabel = isWhatsapp ? t("admin.invites.resendWhatsapp") : t("admin.invites.resendEmail");
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
  if (mode === "error") return <ErrorState title={t("admin.invites.title")} description={error || t("common.tryAgain")} onRetry={() => loadInvites(pagination.current || 1, pagination.pageSize || 8)} />;

  return (
    <div>
      <PageHeader
        title={t("admin.invites.title")}
        subtitle={`${t("admin.dashboard.pendingInvites")}: ${pendingCount}`}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadInvites(1, pagination.pageSize || 8)}>{t("common.refresh")}</Button>
          </Space>
        }
      />

      <Card style={{ borderRadius: 16, marginBottom: 16 }} bodyStyle={{ padding: 24 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>{t("admin.invites.sendInvite")}</Typography.Title>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        <Form<SendInviteValues> form={form} layout="vertical" requiredMark={false} onFinish={sendInvite} initialValues={{ role: "Employee", channel: "email" }}>
          <Row gutter={16} align="bottom">
            <Col xs={24} md={5}>
              <Form.Item label={t("admin.invites.channel")} name="channel">
                <Segmented
                  size="large"
                  block
                  options={[
                    { label: t("common.email"), value: "email", icon: <MailOutlined /> },
                    { label: t("admin.invites.channelWhatsapp"), value: "whatsapp", icon: <WhatsAppOutlined /> },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              {channel === "whatsapp" ? (
                <Form.Item
                  label={t("admin.invites.phoneNumber")}
                  name="phone_number"
                  rules={[
                    { required: true, message: t("admin.invites.phoneRequired") },
                    { pattern: /^\+[1-9]\d{7,14}$/, message: t("admin.invites.phoneInvalid") },
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
                  <Input size="large" placeholder="name@company.com" autoComplete="email" />
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
                  options={roleOptions.filter(
                    (r) => r !== "SystemAdmin" || useAuthStore.getState().user?.role === "SystemAdmin"
                  ).map((r) => ({ label: t(`role.${r}`, r), value: r }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item>
                <Button type="primary" htmlType="submit" size="large" loading={sending} block>
                  {t("common.submit")}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div
          style={{
            marginTop: 4,
            paddingTop: 16,
            borderTop: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
            {t("admin.invites.testWhatsappLabel")}
          </Typography.Text>
          <div style={{ flex: "0 1 260px", minWidth: 200 }}>
            <PhoneNumberInput
              size="middle"
              value={testPhone}
              onChange={(v) => setTestPhone(v ?? "")}
              disabled={testing}
            />
          </div>
          <Button
            icon={<WhatsAppOutlined />}
            onClick={() => testWhatsapp()}
            loading={testing}
          >
            {t("admin.invites.testWhatsapp")}
          </Button>
        </div>
      </Card>

      <Card style={{ borderRadius: 16 }}>
        <div className="responsive-filter-bar" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Input allowClear placeholder={t("admin.users.searchPlaceholder")} style={{ flex: "1 1 200px", minWidth: 150 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={statusFilter} onChange={setStatusFilter} style={{ flex: "0 1 180px", minWidth: 120 }} options={[
            { label: t("common.filter"), value: "All" },
            { label: t("status.pending"), value: "sent" },
            { label: t("status.accepted"), value: "accepted" },
            { label: t("status.revoked"), value: "revoked" },
            { label: t("status.expired"), value: "expired" },
          ]} />
        </div>

        <div style={{ marginTop: 16 }}>
          {(mode === "empty" || (mode === "ok" && rows.length === 0)) ? (
            <EmptyState
              title={t("common.noData")}
              description={t("admin.invites.title")}
              actionText={t("admin.invites.sendInvite")}
              onAction={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }}
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
