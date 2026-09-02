import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  notification,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  FilterOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import {
  getPendingRequests,
  type PendingRequestItem,
  type PendingRequestType,
} from "../../services/api/pendingRequestsApi";
import {
  listNotifications,
  type NotificationDto,
} from "../../services/api/notificationsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import { isHeadOfficeOrganization } from "../../utils/organizationContext";
import { formatDateTime } from "../../utils/dateTime";
import {
  PENDING_TYPE_COLORS,
  PENDING_TYPE_LABEL_KEYS,
} from "../../utils/pendingRequests";
import NotificationItem from "../../components/notifications/NotificationItem";
import { useNotificationNavigate } from "../../components/notifications/notificationUrl";

interface Filters {
  request_type?: PendingRequestType;
  search?: string;
}

export default function PendingInboxPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const navigateToNotification = useNotificationNavigate();
  const user = useAuthStore((s) => s.user);
  const isHeadOffice = isHeadOfficeOrganization(user);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PendingRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<Filters>({});
  const [approvalNotifications, setApprovalNotifications] = useState<NotificationDto[]>([]);
  const [form] = Form.useForm();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPendingRequests({
        ...filters,
        page,
        page_size: pageSize,
      });
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
      } else {
        setData(res.data.items ?? []);
        setTotal(res.data.count ?? 0);
      }
    } catch (err: any) {
      notification.error({
        message: t("common.error"),
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, t]);

  const loadApprovalNotifications = useCallback(async () => {
    try {
      const response = await listNotifications({ category: "approval", page: 1, page_size: 20 });
      if (!isApiError(response)) setApprovalNotifications(response.data.items ?? []);
    } catch {
      // The workflow queue remains usable if notification history is unavailable.
    }
  }, []);

  useEffect(() => {
    loadData();
    loadApprovalNotifications();
  }, [loadData, loadApprovalNotifications]);

  // Refetch when tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [loadData]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

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
        <Tag color={PENDING_TYPE_COLORS[record.request_type] ?? "default"}>
          {t(
            PENDING_TYPE_LABEL_KEYS[record.request_type],
            record.request_type_label,
          )}
        </Tag>
      ),
    },
    {
      title: t("pendingInbox.col.action"),
      dataIndex: "action",
      key: "action",
      render: (value: string, record) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          {record.details ? (
            <Typography.Paragraph
              ellipsis={{ rows: 1 }}
              style={{ margin: "3px 0 0", color: "#64748b", fontSize: 12 }}
            >
              {record.details}
            </Typography.Paragraph>
          ) : null}
        </div>
      ),
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
            render: (val?: string | null) =>
              val ? <Tag color="blue">{val}</Tag> : "-",
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

  const typeCounts = data.reduce<Record<string, number>>((counts, item) => {
    counts[item.request_type] = (counts[item.request_type] || 0) + 1;
    return counts;
  }, {});
  const hasFilters = Boolean(filters.search || filters.request_type);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        title={t("pendingInbox.title")}
        subtitle={t("pendingInbox.subtitle")}
        tags={
          <Tag color={total ? "orange" : "green"}>
            {total ? t("pendingInbox.needsAttention") : t("pendingInbox.allClear")}
          </Tag>
        }
        actions={
          <Button
            icon={<ReloadOutlined />}
            onClick={loadData}
            loading={loading}
          >
            {t("common.refresh", "Refresh")}
          </Button>
        }
      />

      <Card
        title={
          <Space>
            <Typography.Text strong>{t("pendingInbox.notificationsTitle")}</Typography.Text>
            <Badge
              count={approvalNotifications.filter((item) => !item.is_read).length}
              showZero
              style={{ backgroundColor: "#f97316" }}
            />
          </Space>
        }
        extra={<Button type="link" onClick={() => navigate("/notifications")}>{t("pendingInbox.viewAllNotifications")}</Button>}
        style={{ marginBottom: 16, borderRadius: 16 }}
      >
        {approvalNotifications.length === 0 ? (
          <Empty description={t("pendingInbox.noNotifications")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {approvalNotifications.slice(0, 5).map((item) => (
              <NotificationItem
                key={item.id}
                notification={item}
                onSelect={(notification) => {
                  navigateToNotification(notification.action_url);
                }}
              />
            ))}
          </div>
        )}
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered={false} style={{ borderRadius: 14 }}>
            <Statistic
              title={t("pendingInbox.stats.total")}
              value={total}
              prefix={<AppstoreOutlined style={{ color: "#f97316" }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered={false} style={{ borderRadius: 14 }}>
            <Statistic
              title={t("pendingInbox.stats.leave")}
              value={typeCounts.LEAVE || 0}
              prefix={<ClockCircleOutlined style={{ color: "#1677ff" }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered={false} style={{ borderRadius: 14 }}>
            <Statistic
              title={t("pendingInbox.stats.loan")}
              value={typeCounts.LOAN || 0}
              prefix={<FileTextOutlined style={{ color: "#d48806" }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered={false} style={{ borderRadius: 14 }}>
            <Statistic
              title={t("pendingInbox.stats.other")}
              value={Math.max(total - (typeCounts.LEAVE || 0) - (typeCounts.LOAN || 0), 0)}
              prefix={<CheckCircleOutlined style={{ color: "#722ed1" }} />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        style={{ marginBottom: 16, borderRadius: 16 }}
        title={
          <Space>
            <FilterOutlined />
            <Typography.Text strong>{t("pendingInbox.filters")}</Typography.Text>
          </Space>
        }
        extra={
          hasFilters ? (
            <Button type="link" icon={<ClearOutlined />} onClick={() => { form.resetFields(); setFilters({}); setPage(1); }}>
              {t("pendingInbox.clearFilters")}
            </Button>
          ) : null
        }
      >
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
              <Form.Item
                name="request_type"
                label={t("pendingInbox.filterByType")}
              >
                <Select placeholder={t("pendingInbox.allTypes")} allowClear>
                  <Select.Option value="LEAVE">
                    {t("pendingInbox.requestType.LEAVE")}
                  </Select.Option>
                  <Select.Option value="LOAN">
                    {t("pendingInbox.requestType.LOAN")}
                  </Select.Option>
                  <Select.Option value="ATTENDANCE">
                    {t("pendingInbox.requestType.ATTENDANCE")}
                  </Select.Option>
                  <Select.Option value="ASSET">
                    {t("pendingInbox.requestType.ASSET")}
                  </Select.Option>
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
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {t("pendingInbox.empty")}
                    </div>
                    <div style={{ color: "#94a3b8", marginTop: 4 }}>
                      {t("pendingInbox.emptyDesc")}
                    </div>
                  </div>
                }
              />
            ),
          }}
          expandable={{
            expandedRowRender: (record) => (
              <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label={t("pendingInbox.detail.requestId")}>
                  #{record.id}
                </Descriptions.Item>
                <Descriptions.Item label={t("pendingInbox.detail.workflowId")}>
                  #{record.workflow_id}
                </Descriptions.Item>
                <Descriptions.Item label={t("pendingInbox.detail.description")}>
                  {record.details || t("pendingInbox.detail.noDescription")}
                </Descriptions.Item>
                <Descriptions.Item label={t("pendingInbox.detail.nextStep")}>
                  {record.current_approver_role}
                </Descriptions.Item>
              </Descriptions>
            ),
            rowExpandable: (record) => Boolean(record.details),
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
