import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Select, Space, Table, Tag } from "antd";
import { EyeOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import TeamMemberCell from "../../components/manager/TeamMemberCell";
import {
  getManagerTeam,
  type ManagerTeamMember,
} from "../../services/api/managerApi";
import { isApiError } from "../../services/api/apiTypes";
import { useManagerAccess } from "../../hooks/useManagerAccess";
import { managedCountLabel } from "../../utils/managerCapability";
import { useI18n } from "../../i18n/useI18n";

const ALL_DEPARTMENTS = "__all__";

/** Directory of the people who report to the signed-in manager. Read-only. */
export default function ManagerTeamPage() {
  const { t } = useI18n();
  const { access } = useManagerAccess();
  const navigate = useNavigate();

  const [data, setData] = useState<ManagerTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await getManagerTeam();
        if (isApiError(res)) {
          setError(res.message || t("manager.team.failedLoad"));
          return;
        }
        setData(res.data ?? []);
      } catch (err: any) {
        setError(err?.message || t("manager.team.failedLoad"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const departments = useMemo(() => {
    const unique = new Set<string>();
    data.forEach((member) => {
      if (member.department) unique.add(member.department);
    });
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.filter((member) => {
      if (department !== ALL_DEPARTMENTS && member.department !== department)
        return false;
      if (!needle) return true;
      return [
        member.employee_id,
        member.full_name_en,
        member.full_name,
        member.full_name_ar,
        member.email,
        member.mobile,
        member.department,
        member.position,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [data, department, query]);

  const isFiltered = query.trim().length > 0 || department !== ALL_DEPARTMENTS;
  const managedEmployeeCount = access.managed_employee_count || data.length;

  const memberName = (member: ManagerTeamMember) =>
    member.full_name_en || member.full_name || member.email || "—";

  const columns: ColumnsType<ManagerTeamMember> = [
    {
      title: t("employees.form.empNumber"),
      dataIndex: "employee_id",
      key: "employee_id",
      width: 130,
      render: (value: string) => (
        <span className="tabular-nums">{value || "—"}</span>
      ),
    },
    {
      title: t("common.name"),
      key: "name",
      render: (_, record) => (
        <TeamMemberCell
          name={memberName(record)}
          secondary={record.email || undefined}
        />
      ),
    },
    {
      title: t("profile.department"),
      dataIndex: "department",
      key: "department",
      render: (value: string) => value || "—",
    },
    {
      title: t("profile.position"),
      dataIndex: "position",
      key: "position",
      render: (value: string) => value || "—",
    },
    {
      title: t("employees.form.mobile"),
      dataIndex: "mobile",
      key: "mobile",
      render: (value: string) =>
        value ? (
          <span className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
            {value}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: t("common.status"),
      dataIndex: "employment_status",
      key: "employment_status",
      width: 130,
      render: (value?: string) =>
        value ? (
          <Tag
            color={value.toUpperCase() === "ACTIVE" ? "green" : "default"}
            style={{
              borderRadius: 999,
              paddingInline: 10,
              fontWeight: 600,
              marginInlineEnd: 0,
            }}
          >
            {value}
          </Tag>
        ) : (
          <span style={{ color: "#94a3b8" }}>—</span>
        ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 150,
      render: (_, record) => (
        <Button
          size="small"
          icon={<EyeOutlined aria-hidden />}
          onClick={(event) => {
            // The row itself navigates too; stop the double handling.
            event.stopPropagation();
            navigate(`/manager/team/${record.id}`);
          }}
          aria-label={`${t("manager.team.viewProfile")}: ${memberName(record)}`}
          style={{ borderRadius: 8, fontWeight: 600 }}
        >
          {t("manager.team.viewProfile")}
        </Button>
      ),
    },
  ];

  return (
    <ApprovalQueuePage
      title={t("manager.team.title")}
      subtitle={managedCountLabel(t, managedEmployeeCount)}
      loading={loading}
      error={error}
      isEmpty={filtered.length === 0}
      emptyTitle={
        isFiltered
          ? t("manager.team.noMatches")
          : t("manager.empty.noDirectReportsTitle")
      }
      emptyDescription={
        isFiltered
          ? t("manager.team.noMatchesDesc")
          : t("manager.empty.noDirectReportsDesc")
      }
      onRetry={() => load()}
      onRefresh={() => load({ isRefresh: true })}
      refreshing={refreshing}
      filters={
        <Space size={12} wrap style={{ width: "100%" }}>
          <Input
            allowClear
            prefix={<SearchOutlined aria-hidden style={{ color: "#94a3b8" }} />}
            placeholder={t("manager.team.searchPlaceholder")}
            aria-label={t("manager.team.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 320, maxWidth: "100%" }}
          />
          <Select
            value={department}
            onChange={setDepartment}
            aria-label={t("manager.team.departmentFilter")}
            style={{ width: 220, maxWidth: "100%" }}
            options={[
              {
                value: ALL_DEPARTMENTS,
                label: t("manager.team.departmentFilter"),
              },
              ...departments.map((name) => ({ value: name, label: name })),
            ]}
          />
          {isFiltered && (
            <Button
              type="link"
              onClick={() => {
                setQuery("");
                setDepartment(ALL_DEPARTMENTS);
              }}
              style={{ padding: 0, fontWeight: 600 }}
            >
              {t("common.clearFilters")}
            </Button>
          )}
        </Space>
      }
    >
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        scroll={{ x: 1000 }}
        pagination={{
          pageSize: 20,
          showSizeChanger: false,
          hideOnSinglePage: true,
          style: { paddingInline: 16 },
        }}
        onRow={(record) => ({
          onClick: () => navigate(`/manager/team/${record.id}`),
          style: { cursor: "pointer" },
        })}
      />
    </ApprovalQueuePage>
  );
}
