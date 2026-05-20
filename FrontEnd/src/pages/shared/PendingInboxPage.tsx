import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Badge, Button, Card, Col, Empty, Form, Input, Row, Select, Space, Table, Tag, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import {
  getPendingRequests,
  type PendingRequestItem,
  type PendingRequestType,
} from "../../services/api/pendingRequestsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import { isHeadOfficeOrganization } from "../../utils/organizationContext";
import { formatDateTime } from "../../utils/dateTime";

const TYPE_COLORS: Record<PendingRequestType, string> = {
  LEAVE: "blue",
  LOAN: "gold",
  ATTENDANCE: "orange",
  ASSET: "purple",
  EMPLOYEE_DELETION: "red",
};

const TYPE_LABEL_KEYS: Record<PendingRequestType, string> = {
  LEAVE: "pendingInbox.requestType.LEAVE",
  LOAN: "pendingInbox.requestType.LOAN",
  ATTENDANCE: "pendingInbox.requestType.ATTENDANCE",
  ASSET: "pendingInbox.requestType.ASSET",
  EMPLOYEE_DELETION: "pendingInbox.requestType.EMPLOYEE_DELETION",
};

interface Filters {
  request_type?: PendingRequestType;
  search?: string;
}

export default function PendingInboxPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const isHeadOffice = isHeadOfficeOrganization(user);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PendingRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<Filters>({});
  const [form] = Form.useForm();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPendingRequests({ ...filters, page, page_size: pageSize });
      if (isApiError(res)) {
        notification.error({ message: t("common.error"), description: res.message });
      } else {
        setData(res.data.items ?? []);
        setTotal(res.data.count ?? 0);
      }
    } catch (err: any) {
      notification.error({ message: t("common.error"), description: err?.message });
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refetch when tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [loadData]);

  const handleValuesChange = (_changed: Partial<Filters>, all: Filters) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const apply = () => {
      setFilters({
        request_type: all.request_type || undefined,
        search: all.search || undefined,
      });
      setPage(1);
    };
    if ("search" in _changed) {
      searchTimer.current = setTimeout(apply, 350);
    } else {
      apply();
    }
  };

  const columns: ColumnsType<PendingRequestItem> = [
    {
      title: t("pendingInbox.col.employee"),
      key: "employee",
      render: (_, record) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar
            src={record.avatar || undefined}
            size={36}
            style={{ background: "#f97316", flexShrink: 0, fontWeight: 700 }}
          >
            {!record.avatar ? record.name.charAt(0).toUpperCase() : undefined}
          </Avatar>
          <span style={{ fontWeight: 500 }}>{record.name}</span>
        </div>
      ),
    },
    {
      title: t("pendingInbox.col.requestType"),
      key: "request_type",
      render: (_, record) => (
        <Tag color={TYPE_COLORS[record.request_type] ?? "default"}>
          {t(TYPE_LABEL_KEYS[record.request_type], record.request_type_label)}
        </Tag>
      ),
    },
    {
      title: t("pendingInbox.col.action"),
      dataIndex: "action",
      key: "action",
    },
    {
      title: t("pendingInbox.col.approverRole"),
      dataIndex: "current_approver_role",
      key: "current_approver_role",
      render: (val: string) => <Tag>{val}</Tag>,
    },
    ...(isHeadOffice
      ? [
          {
            title: t("common.company"),
            dataIndex: "company_name",
            key: "company_name",
            render: (val?: string | null) => (val ? <Tag color="blue">{val}</Tag> : "-"),
          },
        ]
      : []),
    {
      title: t("pendingInbox.col.time"),
      dataIndex: "time",
      key: "time",
      render: (val: string) => formatDateTime(val),
    },
    {
      title: t("common.actions"),
      key: "actions",
      align: "center",
      render: (_, record) => (
        <Button
          icon={<EyeOutlined />}
          size="small"
          onClick={() => navigate(record.review_path)}
        >
          {t("common.review")}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        title={t("pendingInbox.title")}
        subtitle={t("pendingInbox.subtitle")}
        actions={
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>
            {t("common.refresh", "Refresh")}
          </Button>
        }
      />

      <Card style={{ marginBottom: 16, borderRadius: 16 }}>
        <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={10}>
              <Form.Item name="search" label={t("common.search")}>
                <Input
                  placeholder={t("pendingInbox.searchPlaceholder")}
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item name="request_type" label={t("pendingInbox.filterByType")}>
                <Select placeholder={t("pendingInbox.allTypes")} allowClear>
                  <Select.Option value="LEAVE">{t("pendingInbox.requestType.LEAVE")}</Select.Option>
                  <Select.Option value="LOAN">{t("pendingInbox.requestType.LOAN")}</Select.Option>
                  <Select.Option value="ATTENDANCE">{t("pendingInbox.requestType.ATTENDANCE")}</Select.Option>
                  <Select.Option value="ASSET">{t("pendingInbox.requestType.ASSET")}</Select.Option>
                  <Select.Option value="EMPLOYEE_DELETION">
                    {t("pendingInbox.requestType.EMPLOYEE_DELETION")}
                  </Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card
        style={{ borderRadius: 16 }}
        title={
          <Space>
            <Typography.Text strong>{t("pendingInbox.title")}</Typography.Text>
            <Badge
              count={total}
              overflowCount={999}
              style={{ backgroundColor: total > 0 ? "#f97316" : "#94a3b8" }}
            />
          </Space>
        }
      >
        <Table
          dataSource={data}
          columns={columns}
          rowKey={(r) => `${r.request_type}-${r.id}`}
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                description={
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{t("pendingInbox.empty")}</div>
                    <div style={{ color: "#94a3b8", marginTop: 4 }}>{t("pendingInbox.emptyDesc")}</div>
                  </div>
                }
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50"],
            onChange: (p, ps) => {
              setPage(p);
              if (ps !== pageSize) setPageSize(ps ?? 20);
            },
          }}
        />
      </Card>
    </div>
  );
}
