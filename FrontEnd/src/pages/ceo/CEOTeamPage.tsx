import { useCallback, useEffect, useMemo, useState } from "react";
import { Input, Table, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import {
  getManagerTeam,
  type ManagerTeamMember,
} from "../../services/api/managerApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

export default function CEOTeamPage() {
  const { t } = useI18n();
  const [data, setData] = useState<ManagerTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await getManagerTeam();
        if (isApiError(res)) {
          setError(res.message || t("ceo.team.failedLoad"));
          return;
        }
        setData(res.data ?? []);
      } catch (err: any) {
        setError(err?.message || t("ceo.team.failedLoad"));
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((member) =>
      [
        member.employee_id,
        member.full_name_en,
        member.full_name,
        member.email,
        member.department,
        member.position,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [data, query]);

  const columns: ColumnsType<ManagerTeamMember> = [
    {
      title: t("employees.form.empNumber"),
      dataIndex: "employee_id",
      key: "employee_id",
      width: 140,
      render: (value: string) => (
        <span className="tabular-nums">{value || "—"}</span>
      ),
    },
    {
      title: t("common.name"),
      key: "name",
      render: (_, record) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "#0f172a" }}>
            {record.full_name_en || record.full_name || "—"}
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.email || "—"}
          </Text>
        </div>
      ),
    },
    {
      title: t("employees.form.mobile"),
      dataIndex: "mobile",
      key: "mobile",
      render: (value: string) => value || "—",
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
  ];

  return (
    <ApprovalQueuePage
      title={t("ceo.team.title")}
      subtitle={t("ceo.team.subtitle")}
      loading={loading}
      error={error}
      isEmpty={filtered.length === 0}
      emptyTitle={query.trim() ? t("ceo.team.noMatches") : t("ceo.team.empty")}
      emptyDescription={
        query.trim()
          ? t("ceo.approvals.emptyFilteredDescription")
          : t("ceo.team.emptyDescription")
      }
      onRetry={() => load()}
      onRefresh={() => load({ isRefresh: true })}
      refreshing={refreshing}
      filters={
        <Input
          allowClear
          prefix={<SearchOutlined aria-hidden style={{ color: "#94a3b8" }} />}
          placeholder={t("ceo.team.searchPlaceholder")}
          aria-label={t("ceo.team.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ maxWidth: 360 }}
        />
      }
    >
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        scroll={{ x: 900 }}
        pagination={{
          pageSize: 20,
          showSizeChanger: false,
          hideOnSinglePage: true,
          style: { paddingInline: 16 },
        }}
      />
    </ApprovalQueuePage>
  );
}
