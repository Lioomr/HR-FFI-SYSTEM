import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  KeyOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import type { Role, UserDto } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import {
  listUsers,
  resetUserPassword,
  updateUserRole,
  updateUserStatus,
} from "../../services/api/usersApi";

type UserRow = {
  id: string | number;
  fullName: string;
  email: string;
  role: Role;
  status: "Active" | "Disabled";
  createdAt: string;
};

type UiMode = "loading" | "empty" | "error" | "ok";

type ResetResult = {
  mode: "temporary_password" | "reset_link";
  temporary_password?: string;
  reset_token?: string;
};

const roleOptions: Role[] = ["SystemAdmin", "HRManager", "Employee"];

function roleTag(role: Role) {
  if (role === "SystemAdmin") return <Tag color="orange">SystemAdmin</Tag>;
  if (role === "HRManager") return <Tag color="blue">HRManager</Tag>;
  return <Tag>Employee</Tag>;
}

function toUserRow(user: UserDto): UserRow {
  return {
    id: user.id,
    fullName: user.full_name || user.email,
    email: user.email,
    role: user.role,
    status: user.is_active ? "Active" : "Disabled",
    createdAt: "-",
  };
}

export default function AdminUsersListPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<UiMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "All">("All");
  const [status, setStatus] = useState<"All" | "Active" | "Disabled">("All");

  const [rows, setRows] = useState<UserRow[]>([]);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetMode, setResetMode] = useState<"temporary_password" | "reset_link">(
    "temporary_password"
  );
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [resetting, setResetting] = useState(false);

  const loadUsers = useCallback(
    async (params: { search?: string; role?: Role; status?: "active" | "inactive" }) => {
      setMode("loading");
      setError(null);
      setUnauthorized(false);

      try {
        const res = await listUsers(params);
        if (isApiError(res)) {
          setError(res.message || "Failed to load users.");
          setMode("error");
          return;
        }

        const items = Array.isArray(res.data as unknown)
          ? (res.data as UserDto[])
          : res.data.items || [];

        setRows(items.map(toUserRow));
        setMode(items.length === 0 ? "empty" : "ok");
      } catch (err: any) {
        const statusCode = err?.response?.status;
        if (statusCode === 403) {
          setUnauthorized(true);
          return;
        }
        setError("Failed to load users.");
        setMode("error");
      }
    },
    []
  );

  useEffect(() => {
    const trimmed = search.trim();
    const roleParam = role === "All" ? undefined : role;
    const statusParam =
      status === "All" ? undefined : status === "Active" ? "active" : "inactive";

    const timer = setTimeout(() => {
      loadUsers({ search: trimmed || undefined, role: roleParam, status: statusParam });
    }, 250);

    return () => clearTimeout(timer);
  }, [search, role, status, loadUsers]);

  const columns: ColumnsType<UserRow> = useMemo(
    () => [
      {
        title: "Name",
        dataIndex: "fullName",
        key: "fullName",
        render: (v) => <Typography.Text strong>{v}</Typography.Text>,
      },
      {
        title: "Email",
        dataIndex: "email",
        key: "email",
        render: (v) => <Typography.Text>{v}</Typography.Text>,
      },
      {
        title: "Role",
        dataIndex: "role",
        key: "role",
        render: (v: Role) => roleTag(v),
        filters: roleOptions.map((r) => ({ text: r, value: r })),
        onFilter: (value, record) => record.role === value,
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        render: (v: UserRow["status"]) =>
          v === "Active" ? <Tag color="green">Active</Tag> : <Tag color="red">Disabled</Tag>,
        filters: [
          { text: "Active", value: "Active" },
          { text: "Disabled", value: "Disabled" },
        ],
        onFilter: (value, record) => record.status === value,
      },
      {
        title: "Created",
        dataIndex: "createdAt",
        key: "createdAt",
      },
      {
        title: "Actions",
        key: "actions",
        width: 360,
        render: (_, record) => (
          <Space wrap>
            <Button
              icon={<UserSwitchOutlined />}
              onClick={async () => {
                try {
                  const res = await updateUserStatus(record.id, {
                    is_active: record.status !== "Active",
                  });

                  if (isApiError(res)) {
                    message.error(res.message || "Failed to update status.");
                    return;
                  }

                  setRows((prev) =>
                    prev.map((u) => (u.id === record.id ? toUserRow(res.data) : u))
                  );
                  message.success("User status updated.");
                } catch (err: any) {
                  if (err?.response?.status === 403) {
                    setUnauthorized(true);
                    return;
                  }
                  message.error("Failed to update status.");
                }
              }}
            >
              {record.status === "Active" ? "Disable" : "Enable"}
            </Button>

            <Select
              value={record.role}
              style={{ width: 150 }}
              options={roleOptions.map((r) => ({ label: r, value: r }))}
              onChange={async (nextRole) => {
                try {
                  const res = await updateUserRole(record.id, { role: nextRole });
                  if (isApiError(res)) {
                    message.error(res.message || "Failed to update role.");
                    return;
                  }
                  setRows((prev) =>
                    prev.map((u) => (u.id === record.id ? toUserRow(res.data) : u))
                  );
                  message.success("Role updated.");
                } catch (err: any) {
                  if (err?.response?.status === 403) {
                    setUnauthorized(true);
                    return;
                  }
                  message.error("Failed to update role.");
                }
              }}
            />

            <Button
              icon={<KeyOutlined />}
              onClick={() => {
                setResetUser(record);
                setResetMode("temporary_password");
                setResetResult(null);
                setResetOpen(true);
              }}
            >
              Reset Password
            </Button>
          </Space>
        ),
      },
    ],
    [setUnauthorized]
  );

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title="Loading users..." />;
  if (mode === "error") {
    return (
      <ErrorState
        title="Failed to load users"
        description={error || "Please try again."}
        onRetry={() => {
          const roleParam = role === "All" ? undefined : role;
          const statusParam =
            status === "All" ? undefined : status === "Active" ? "active" : "inactive";
          loadUsers({ search: search.trim() || undefined, role: roleParam, status: statusParam });
        }}
      />
    );
  }

  if (mode === "empty" || rows.length === 0) {
    return (
      <EmptyState
        title="No users yet"
        description="Create a user or send an invite to get started."
        actionText="Create User"
        onAction={() => navigate("/admin/users/create")}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Manage users, roles, and access (Phase 1)"
        actions={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate("/admin/users/create")}
            >
              Create User
            </Button>
          </Space>
        }
      />

      <Card style={{ borderRadius: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Space wrap>
            <Input
              allowClear
              placeholder="Search name or email..."
              style={{ width: 260 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <Select
              value={role}
              onChange={setRole}
              style={{ width: 180 }}
              options={[
                { label: "All roles", value: "All" },
                ...roleOptions.map((r) => ({ label: r, value: r })),
              ]}
            />

            <Select
              value={status}
              onChange={setStatus}
              style={{ width: 160 }}
              options={[
                { label: "All status", value: "All" },
                { label: "Active", value: "Active" },
                { label: "Disabled", value: "Disabled" },
              ]}
            />
          </Space>

          <Space wrap></Space>
        </Space>

        <div style={{ marginTop: 16 }}>
          <Table<UserRow>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 8 }}
          />
        </div>
      </Card>

      <Modal
        title="Reset User Password"
        open={resetOpen}
        onCancel={() => {
          if (resetting) return;
          setResetOpen(false);
          setResetUser(null);
          setResetResult(null);
        }}
        onOk={async () => {
          if (!resetUser) return;
          setResetting(true);
          try {
            const res = await resetUserPassword(resetUser.id, { mode: resetMode });
            if (isApiError(res)) {
              message.error(res.message || "Failed to reset password.");
              return;
            }
            setResetResult(res.data);
            message.success("Password reset generated.");
          } catch (err: any) {
            if (err?.response?.status === 403) {
              setUnauthorized(true);
              return;
            }
            message.error("Failed to reset password.");
          } finally {
            setResetting(false);
          }
        }}
        okText="Generate"
        confirmLoading={resetting}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Typography.Text>You are about to reset the password for:</Typography.Text>
          <Typography.Text strong>{resetUser?.email}</Typography.Text>

          <Radio.Group
            value={resetMode}
            onChange={(e) => setResetMode(e.target.value)}
          >
            <Radio value="temporary_password">Temporary password</Radio>
            <Radio value="reset_link">Reset link token</Radio>
          </Radio.Group>

          {resetResult?.temporary_password ? (
            <div>
              <Typography.Text strong>Temporary Password</Typography.Text>
              <Input
                value={resetResult.temporary_password}
                readOnly
                style={{ marginTop: 6 }}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          ) : null}

          {resetResult?.reset_token ? (
            <div>
              <Typography.Text strong>Reset Token</Typography.Text>
              <Input
                value={resetResult.reset_token}
                readOnly
                style={{ marginTop: 6 }}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          ) : null}
        </Space>
      </Modal>
    </div>
  );
}
