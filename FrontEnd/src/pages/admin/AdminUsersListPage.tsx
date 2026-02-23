import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  KeyOutlined,
  UserSwitchOutlined,
  SearchOutlined,
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
import { useI18n } from "../../i18n/useI18n";

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

const roleOptions: Role[] = ["SystemAdmin", "HRManager", "Manager", "Employee", "CEO"];

// Color map for role badge
const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  SystemAdmin: { bg: "#fee2e2", text: "#dc2626", border: "#fecaca" },
  HRManager: { bg: "#fff4e6", text: "#ea580c", border: "#fed7aa" },
  Manager: { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
  CEO: { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
  CFO: { bg: "#d1fae5", text: "#065f46", border: "#a7f3d0" },
  Employee: { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" },
};

// Deterministic avatar color from string
function avatarColor(name: string): string {
  const colors = ["#f97316", "#ea580c", "#fb923c", "#94a3b8", "#64748b", "#f59e0b", "#10b981"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function roleTag(role: Role) {
  const c = ROLE_COLORS[role] || ROLE_COLORS["Employee"];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
    >
      {role}
    </span>
  );
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
  const { t } = useI18n();

  const [mode, setMode] = useState<UiMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "All">("All");
  const [status, setStatus] = useState<"All" | "Active" | "Disabled">("All");

  const [rows, setRows] = useState<UserRow[]>([]);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetMode, setResetMode] = useState<"temporary_password" | "reset_link">("temporary_password");
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
        const items = res.data.items || [];
        setRows(items.map(toUserRow));
        setMode(items.length === 0 ? "empty" : "ok");
      } catch (err: any) {
        if (err?.response?.status === 403) { setUnauthorized(true); return; }
        setError("Failed to load users.");
        setMode("error");
      }
    },
    []
  );

  useEffect(() => {
    const trimmed = search.trim();
    const roleParam = role === "All" ? undefined : role;
    const statusParam = status === "All" ? undefined : status === "Active" ? "active" : "inactive";
    const timer = setTimeout(() => {
      loadUsers({ search: trimmed || undefined, role: roleParam, status: statusParam });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, role, status, loadUsers]);

  const columns: ColumnsType<UserRow> = useMemo(
    () => [
      {
        title: t("common.name"),
        dataIndex: "fullName",
        key: "fullName",
        render: (v: string, record) => (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar
              size={34}
              style={{
                background: avatarColor(v),
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {v.charAt(0).toUpperCase()}
            </Avatar>
            <div>
              <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>{v}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{record.email}</div>
            </div>
          </div>
        ),
      },
      {
        title: t("common.role"),
        dataIndex: "role",
        key: "role",
        render: (v: Role) => roleTag(v),
        filters: roleOptions.map((r) => ({ text: r, value: r })),
        onFilter: (value, record) => record.role === value,
      },
      {
        title: t("common.status"),
        dataIndex: "status",
        key: "status",
        render: (v: UserRow["status"]) =>
          v === "Active" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#10b981", fontWeight: 600, fontSize: 13 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
              {t("status.active")}
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#94a3b8", fontWeight: 600, fontSize: 13 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", display: "inline-block" }} />
              {t("status.inactive")}
            </span>
          ),
        filters: [
          { text: t("status.active"), value: "Active" },
          { text: t("status.inactive"), value: "Disabled" },
        ],
        onFilter: (value, record) => record.status === value,
      },
      {
        title: t("common.actions"),
        key: "actions",
        width: 200,
        render: (_, record) => (
          <Space size={6}>
            <Tooltip title={record.status === "Active" ? t("admin.users.deactivate") : t("admin.users.activate")}>
              <Button
                icon={<UserSwitchOutlined />}
                size="small"
                style={{
                  borderRadius: 8,
                  borderColor: record.status === "Active" ? "#fde68a" : "#bbf7d0",
                  color: record.status === "Active" ? "#b45309" : "#065f46",
                  background: record.status === "Active" ? "#fffbeb" : "#f0fdf4",
                }}
                onClick={async () => {
                  try {
                    const res = await updateUserStatus(record.id, { is_active: record.status !== "Active" });
                    if (isApiError(res)) { message.error(res.message || t("error.generic")); return; }
                    setRows((prev) => prev.map((u) => (u.id === record.id ? toUserRow(res.data) : u)));
                    message.success(t("common.save"));
                  } catch (err: any) {
                    if (err?.response?.status === 403) { setUnauthorized(true); return; }
                    message.error(t("error.generic"));
                  }
                }}
              />
            </Tooltip>

            <Select
              value={record.role}
              size="small"
              style={{ width: 140, borderRadius: 8 }}
              options={roleOptions.map((r) => ({ label: r, value: r }))}
              onChange={async (nextRole) => {
                try {
                  const res = await updateUserRole(record.id, { role: nextRole });
                  if (isApiError(res)) { message.error(res.message || t("error.generic")); return; }
                  setRows((prev) => prev.map((u) => (u.id === record.id ? toUserRow(res.data) : u)));
                  message.success(t("common.save"));
                } catch (err: any) {
                  if (err?.response?.status === 403) { setUnauthorized(true); return; }
                  message.error(t("error.generic"));
                }
              }}
            />

            <Tooltip title={t("admin.users.resetPassword")}>
              <Button
                icon={<KeyOutlined />}
                size="small"
                style={{ borderRadius: 8 }}
                onClick={() => { setResetUser(record); setResetMode("temporary_password"); setResetResult(null); setResetOpen(true); }}
              />
            </Tooltip>
          </Space>
        ),
      },
    ],
    [setUnauthorized, t]
  );

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title={t("loading.generic")} />;
  if (mode === "error") {
    return <ErrorState title={t("admin.users.title")} description={error || t("common.tryAgain")} onRetry={() => { const roleParam = role === "All" ? undefined : role; const statusParam = status === "All" ? undefined : status === "Active" ? "active" : "inactive"; loadUsers({ search: search.trim() || undefined, role: roleParam, status: statusParam }); }} />;
  }
  if (mode === "empty" || rows.length === 0) {
    return <EmptyState title={t("common.noData")} description={t("admin.users.subtitle")} actionText={t("admin.users.createUser")} onAction={() => navigate("/admin/users/create")} />;
  }

  return (
    <div>
      <PageHeader
        title={t("admin.users.title")}
        subtitle={t("admin.users.subtitle")}
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate("/admin/users/create")}
            style={{ borderRadius: 10 }}
          >
            {t("admin.users.createUser")}
          </Button>
        }
      />

      {/* Filter Bar */}
      <div
        style={{
          background: "white",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
          placeholder={t("admin.users.searchPlaceholder")}
          style={{ width: 280, borderRadius: 10 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={role}
          onChange={setRole}
          style={{ width: 160 }}
          options={[
            { label: t("common.filter") + " Role", value: "All" },
            ...roleOptions.map((r) => ({ label: r, value: r })),
          ]}
        />
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 140 }}
          options={[
            { label: t("common.filter") + " Status", value: "All" },
            { label: t("status.active"), value: "Active" },
            { label: t("status.inactive"), value: "Disabled" },
          ]}
        />
        <div style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? "user" : "users"}
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          background: "white",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <Table<UserRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, style: { padding: "12px 20px" } }}
        />
      </div>

      {/* Reset Password Modal */}
      <Modal
        title={<span style={{ fontWeight: 700 }}>{t("admin.users.resetPassword")}</span>}
        open={resetOpen}
        onCancel={() => { if (resetting) return; setResetOpen(false); setResetUser(null); setResetResult(null); }}
        onOk={async () => {
          if (!resetUser) return;
          setResetting(true);
          try {
            const res = await resetUserPassword(resetUser.id, { mode: resetMode });
            if (isApiError(res)) { message.error(res.message || t("error.generic")); return; }
            setResetResult(res.data);
            message.success(t("common.confirm"));
          } catch (err: any) {
            if (err?.response?.status === 403) { setUnauthorized(true); return; }
            message.error(t("error.generic"));
          } finally { setResetting(false); }
        }}
        okText={t("common.confirm")}
        confirmLoading={resetting}
        styles={{ body: { padding: 24 } }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={14}>
          <Typography.Text>
            {t("common.confirm")}: <strong>{resetUser?.email}</strong>
          </Typography.Text>
          <Radio.Group value={resetMode} onChange={(e) => setResetMode(e.target.value)}>
            <Space direction="vertical">
              <Radio value="temporary_password">Temporary password</Radio>
              <Radio value="reset_link">Reset link token</Radio>
            </Space>
          </Radio.Group>
          {resetResult?.temporary_password && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Temporary Password</div>
              <Input value={resetResult.temporary_password} readOnly onFocus={(e) => e.currentTarget.select()} style={{ borderRadius: 8, fontFamily: "monospace" }} />
            </div>
          )}
          {resetResult?.reset_token && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Reset Token</div>
              <Input value={resetResult.reset_token} readOnly onFocus={(e) => e.currentTarget.select()} style={{ borderRadius: 8, fontFamily: "monospace" }} />
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
}
