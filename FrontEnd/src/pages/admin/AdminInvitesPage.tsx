import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { MailOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import type { InviteDto, Role } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import {
  createInvite,
  listInvites,
  resendInvite,
  revokeInvite,
} from "../../services/api/invitesApi";

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

const roleOptions: { label: string; value: Role }[] = [
  { label: "System Admin", value: "SystemAdmin" },
  { label: "HR Manager", value: "HRManager" },
  { label: "Employee", value: "Employee" },
];

function statusTag(status: InviteStatus) {
  if (status === "sent") return <Tag color="gold">Pending</Tag>;
  if (status === "accepted") return <Tag color="green">Accepted</Tag>;
  if (status === "revoked") return <Tag color="red">Revoked</Tag>;
  return <Tag>Expired</Tag>;
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

      message.success("Invite sent successfully.");
      form.resetFields();
      loadInvites(1, pagination.pageSize || 8);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      setError(e?.message || "Failed to send invite.");
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

      message.success({ content: "Invite resent.", key: `resend-${invite.id}` });
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
      title: "Role",
      dataIndex: "role",
      key: "role",
      render: (v: Role) =>
        v === "SystemAdmin" ? (
          <Tag color="orange">SystemAdmin</Tag>
        ) : v === "HRManager" ? (
          <Tag color="blue">HRManager</Tag>
        ) : (
          <Tag>Employee</Tag>
        ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v: InviteStatus) => statusTag(v),
    },
    { title: "Invited", dataIndex: "invitedAt", key: "invitedAt" },
    { title: "Expires", dataIndex: "expiresAt", key: "expiresAt" },
    { title: "Invited By", dataIndex: "invitedBy", key: "invitedBy" },
    {
      title: "Actions",
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            icon={<MailOutlined />}
            onClick={() => resendInviteRow(record)}
            disabled={record.status !== "sent"}
          >
            Resend
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            onClick={() => revokeInviteRow(record)}
            disabled={record.status !== "sent"}
          >
            Revoke
          </Button>
        </Space>
      ),
    },
  ];

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title="Loading invites..." />;
  if (mode === "error") {
    return (
      <ErrorState
        title="Failed to load invites"
        description={error || "Please try again."}
        onRetry={() => loadInvites(pagination.current || 1, pagination.pageSize || 8)}
      />
    );
  }

  if (mode === "empty" || (mode === "ok" && rows.length === 0)) {
    return (
      <EmptyState
        title="No invites"
        description="Send your first invite to onboard a user."
        actionText="Send Invite"
        onAction={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Invites"
        subtitle={`Pending invites: ${pendingCount}`}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadInvites(1, pagination.pageSize || 8)}>
              Refresh
            </Button>
          </Space>
        }
      />

      <Card style={{ borderRadius: 16, marginBottom: 16 }} bodyStyle={{ padding: 24 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Send Invite
        </Typography.Title>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

        <Form<SendInviteValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={sendInvite}
          initialValues={{ role: "Employee" }}
        >
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label="Email"
              name="email"
              style={{ minWidth: 280, flex: 1 }}
              rules={[
                { required: true, message: "Email is required" },
                { type: "email", message: "Enter a valid email" },
              ]}
            >
              <Input size="large" placeholder="name@company.com" autoComplete="email" />
            </Form.Item>

            <Form.Item
              label="Role"
              name="role"
              style={{ minWidth: 220 }}
              rules={[{ required: true, message: "Role is required" }]}
            >
              <Select size="large" options={roleOptions} />
            </Form.Item>

            <Form.Item label=" " style={{ marginTop: 30 }}>
              <Button type="primary" htmlType="submit" size="large" loading={sending}>
                Send
              </Button>
            </Form.Item>
          </Space>
        </Form>
      </Card>

      <Card style={{ borderRadius: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Space wrap>
            <Input
              allowClear
              placeholder="Search email or role..."
              style={{ width: 260 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 180 }}
              options={[
                { label: "All status", value: "All" },
                { label: "Pending", value: "sent" },
                { label: "Accepted", value: "accepted" },
                { label: "Revoked", value: "revoked" },
                { label: "Expired", value: "expired" },
              ]}
            />
          </Space>
        </Space>

        <div style={{ marginTop: 16 }}>
          <Table<InviteRow>
            rowKey="id"
            columns={columns}
            dataSource={rows}
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
        </div>
      </Card>
    </div>
  );
}
