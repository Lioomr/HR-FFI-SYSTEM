import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Segmented, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";

import {
  listEmployeeDeletionRequests,
  type EmployeeDeletionRequest,
  type EmployeeDeletionStatus,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { isForbidden } from "../../services/api/httpErrors";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

const STATUS_TABS: EmployeeDeletionStatus[] = ["PENDING_CEO", "REJECTED", "EXECUTED"];

const STATUS_COLOR: Record<EmployeeDeletionStatus, string> = {
  PENDING_CEO: "gold",
  REJECTED: "red",
  EXECUTED: "green",
};

const PAGE_SIZE = 20;

export default function CEOEmployeeDeletionInboxPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<EmployeeDeletionStatus>("PENDING_CEO");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EmployeeDeletionRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const response = await listEmployeeDeletionRequests({
        status: statusFilter,
        page,
        page_size: PAGE_SIZE,
      });
      if (isApiError(response)) {
        setError(response.message || t("employees.removalInbox.errorGeneric"));
        return;
      }
      setItems(response.data.items || []);
      setTotal(typeof response.data.count === "number" ? response.data.count : (response.data.items || []).length);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }
      setError(err?.message || t("employees.removalInbox.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const segmentedOptions = useMemo(
    () =>
      STATUS_TABS.map((status) => ({
        label: t(`employees.removalInbox.status.${status}`),
        value: status,
      })),
    [t],
  );

  const columns: ColumnsType<EmployeeDeletionRequest> = [
    {
      title: t("employees.removalInbox.colEmployee"),
      key: "employee",
      render: (_, record) => {
        const snapshot = record.request_snapshot || {};
        const localized =
          language === "ar"
            ? snapshot.full_name_ar || snapshot.full_name || snapshot.full_name_en
            : snapshot.full_name_en || snapshot.full_name || snapshot.full_name_ar;
        const displayName = localized || snapshot.employee_id || `#${record.id}`;
        return (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Text strong>{displayName}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {snapshot.email || snapshot.target_user_email || snapshot.employee_id || "-"}
            </Text>
          </div>
        );
      },
    },
    {
      title: t("employees.removalInbox.colDepartment"),
      key: "department",
      render: (_, record) => {
        const snapshot = record.request_snapshot || {};
        return <Text>{snapshot.department_name || "-"}</Text>;
      },
    },
    {
      title: t("employees.removalInbox.colCompany"),
      key: "company",
      render: (_, record) => <Text>{record.company_name || "-"}</Text>,
    },
    {
      title: t("employees.removalInbox.colRequestedBy"),
      key: "requested_by",
      render: (_, record) => <Text>{record.requested_by_name || "-"}</Text>,
    },
    {
      title: t("employees.removalInbox.colReason"),
      dataIndex: "reason",
      key: "reason",
      render: (value: string) => (
        <Text style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {value || "-"}
        </Text>
      ),
    },
    {
      title: t("employees.removalInbox.colCreatedAt"),
      dataIndex: "created_at",
      key: "created_at",
      width: 160,
      render: (value: string) => (value ? dayjs(value).format("MMM DD, YYYY HH:mm") : "-"),
    },
    {
      title: t("employees.removalInbox.colStatus"),
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (value: EmployeeDeletionStatus) => (
        <Tag color={STATUS_COLOR[value] || "default"}>
          {t(`employees.removalInbox.status.${value}`)}
        </Tag>
      ),
    },
    {
      title: t("employees.removalInbox.colAction"),
      key: "action",
      width: 120,
      render: (_, record) => (
        <Button
          type="link"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/ceo/employees/deletion-requests/${record.id}`);
          }}
        >
          {t("employees.removalInbox.review")}
        </Button>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  return (
    <div style={{ padding: "0 12px" }}>
      <PageHeader
        title={t("employees.removalInbox.title")}
        subtitle={t("employees.removalInbox.subtitle")}
      />

      <Card bordered={false} style={{ borderRadius: 12, marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
        <Segmented
          options={segmentedOptions}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value as EmployeeDeletionStatus);
            setPage(1);
          }}
        />
      </Card>

      <Card bordered={false} style={{ borderRadius: 16 }} bodyStyle={{ padding: 0 }}>
        {loading && items.length === 0 ? (
          <div style={{ padding: 40 }}>
            <LoadingState />
          </div>
        ) : error ? (
          <div style={{ padding: 40 }}>
            <ErrorState
              title={t("common.error")}
              description={error}
              onRetry={load}
            />
          </div>
        ) : (
          <Table
            rowKey="id"
            dataSource={items}
            columns={columns}
            loading={loading}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              onChange: (next) => setPage(next),
              showSizeChanger: false,
              style: { padding: 24 },
            }}
            onRow={(record) => ({
              onClick: () => navigate(`/ceo/employees/deletion-requests/${record.id}`),
              style: { cursor: "pointer" },
            })}
            locale={{ emptyText: t("employees.removalInbox.empty") }}
          />
        )}
      </Card>
    </div>
  );
}
