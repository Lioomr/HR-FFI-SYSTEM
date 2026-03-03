import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { MailOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import type { InviteDto, Role } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import { createInvite, listInvites, resendInvite, revokeInvite } from "../../services/api/invitesApi";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";

type UiMode = "loading" | "empty" | "error" | "ok";

type InviteStatus = "sent" | "accepted" | "revoked" | "expired";

type InviteRow = {
  id: string | number;
  email: string;
  role: Role;
  status: InviteStatus;
  invitedAt: string;
  expiresAt: string;
  invitedBy: string;
};

type SendInviteValues = {
  email: string;
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

function toInviteRow(invite: InviteDto): InviteRow {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status as InviteStatus,
    invitedAt: formatDate(invite.sent_at),
    expiresAt: formatDate(invite.expires_at),
    invitedBy: "-",
  };
}

export default function AdminInvitesPage() {
  const [form] = Form.useForm<SendInviteValues>();
  const { t } = useI18n();

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

    try {
      const res = await createInvite({
        email: values.email,
        role: values.role,
      });

      if (isApiError(res)) {
        const firstError = res.errors
          ? Object.values(res.errors).flat().join(" ")
          : res.message;
        setError(firstError || "Failed to send invite.");
        return;
      }

      const delivery = res.data.email_delivery;
      if (delivery && !delivery.sent) {
        message.warning(
          `Invite created, but email was not delivered${delivery.error ? `: ${delivery.error}` : "."}`
        );
      } else {
        message.success("Invite sent successfully.");
      }
      form.resetFields();
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
      message.loading({ content: "Resending invite...", key: `resend-${invite.id}` });
      const res = await resendInvite(invite.id);

      if (isApiError(res)) {
        message.error({ content: res.message || "Failed to resend.", key: `resend-${invite.id}` });
        return;
      }

      const delivery = res.data.email_delivery;
      if (delivery && !delivery.sent) {
        message.warning({
          content: `Invite updated, but email was not delivered${delivery.error ? `: ${delivery.error}` : "."}`,
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
      title: "Email",
      dataIndex: "email",
      key: "email",
      render: (v) => <Typography.Text strong>{v}</Typography.Text>,
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
    { title: t("admin.invites.invited"), dataIndex: "invitedAt", key: "invitedAt" },
    { title: t("admin.invites.expires"), dataIndex: "expiresAt", key: "expiresAt" },
    { title: t("admin.invites.invitedBy"), dataIndex: "invitedBy", key: "invitedBy" },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            icon={<MailOutlined />}
            onClick={() => resendInviteRow(record)}
            disabled={record.status !== "sent"}
          >
            {t("admin.invites.resend")}
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            onClick={() => revokeInviteRow(record)}
            disabled={record.status !== "sent"}
          >
            {t("admin.invites.revoke")}
          </Button>
        </Space>
      ),
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
        <Form<SendInviteValues> form={form} layout="vertical" requiredMark={false} onFinish={sendInvite} initialValues={{ role: "Employee" }}>
          <Row gutter={16} align="bottom">
            <Col xs={24} md={11}>
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
            </Col>
            <Col xs={24} md={7}>
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
            <Col xs={24} md={6}>
              <Form.Item>
                <Button type="primary" htmlType="submit" size="large" loading={sending} block>
                  {t("common.submit")}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
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
              scroll={{ x: 800 }}
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
