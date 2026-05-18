import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { BellOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import Unauthorized403Page from "../../Unauthorized403Page";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import { listAssets, type Asset } from "../../../services/api/assetsApi";
import {
  createRent,
  createRentPayment,
  deleteRent,
  listRents,
  notifyRent,
  updateRent,
  type CreateRentDto,
  type CreateRentPaymentDto,
  type RentItem,
  type RentPaymentCategory,
  type RentPaymentStatus,
} from "../../../services/api/rentsApi";
import { listRentTypes, type RentType } from "../../../services/api/rentTypesApi";
import { useI18n } from "../../../i18n/useI18n";
import SARIcon from "../../../components/icons/SARIcon";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";

const { Title, Text } = Typography;

type StatusFilter = "all" | "upcoming" | "overdue";
type RentFormValues = {
  rent_type_id: number;
  asset_id?: number;
  property_name_en?: string;
  property_name_ar?: string;
  property_address?: string;
  lease_start_date?: Dayjs;
  lease_end_date?: Dayjs;
  annual_rent_value?: number;
  security_deposit?: number;
  payment_schedule?: string;
  auto_renewal?: boolean;
  notice?: string;
  payments?: string;
  recurrence: "ONE_TIME" | "MONTHLY";
  one_time_due_date?: Dayjs;
  start_date?: Dayjs;
  due_day?: number;
  reminder_days: number;
  amount?: number;
};
type RentPaymentFormValues = {
  payment_number: number;
  category: RentPaymentCategory;
  status: RentPaymentStatus;
  amount: number;
  due_date?: Dayjs;
  paid_date?: Dayjs;
  notes?: string;
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD-MM-YYYY") : "-";
}

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "-";

  // Use Intl.NumberFormat but strip trailing '.00' if it's a whole number
  const formatted = new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(num);

  return formatted;
}

function formatDuration(
  value: number | null | undefined,
  t: (key: string, params?: Record<string, any> | string, fallback?: string) => string
): string {
  if (value === null || value === undefined) return "-";
  if (value < 0) return t("hr.rents.duration.expired", { days: Math.abs(value) }, "{days} day(s) expired");
  if (value === 0) return t("hr.rents.duration.endsToday", "Ends today");
  return t("hr.rents.duration.days", { days: value }, "{days} day(s)");
}

export default function HRRentsPage() {
  const { t, language } = useI18n();
  const user = useAuthStore((state) => state.user);
  const isHeadOffice = isHeadOfficeOrganization(user);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [notifyingId, setNotifyingId] = useState<number | null>(null);
  const [items, setItems] = useState<RentItem[]>([]);
  const [rentTypes, setRentTypes] = useState<RentType[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rentTypeFilter, setRentTypeFilter] = useState<number | undefined>(undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<RentItem | null>(null);
  const [viewing, setViewing] = useState<RentItem | null>(null);

  const [createForm] = Form.useForm<RentFormValues>();
  const [editForm] = Form.useForm<RentFormValues>();
  const [paymentForm] = Form.useForm<RentPaymentFormValues>();

  const loadReferenceData = useCallback(async () => {
    try {
      const [rentTypeRes, assetRes] = await Promise.all([listRentTypes(), listAssets({ page: 1, page_size: 200 })]);

      if (!isApiError(rentTypeRes)) setRentTypes(rentTypeRes.data || []);
      if (!isApiError(assetRes)) setAssets(assetRes.data.items || []);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }
      message.error(err.message || t("hr.rents.errorLoadRefs", "Failed to load reference data"));
    }
  }, [t]);

  const loadData = useCallback(async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const response = await listRents({
        page: nextPage,
        page_size: nextPageSize,
        search: search || undefined,
        status: statusFilter,
        rent_type: rentTypeFilter,
      });

      if (isApiError(response)) {
        message.error(response.message || t("hr.rents.errorLoad", "Failed to load rents"));
        setLoading(false);
        return;
      }

      setItems(response.data.items || []);
      setTotal(response.data.count || 0);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
      } else {
        message.error(err.message || t("hr.rents.errorLoad", "Failed to load rents"));
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, rentTypeFilter, search, statusFilter, t]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    loadData(1, pageSize);
    setPage(1);
  }, [loadData, pageSize, rentTypeFilter, search, statusFilter]);

  const toPayload = (values: RentFormValues): CreateRentDto => ({
    rent_type_id: values.rent_type_id,
    asset_id: values.asset_id ?? null,
    property_name_en: values.property_name_en || "",
    property_name_ar: values.property_name_ar || "",
    property_address: values.property_address || "",
    lease_start_date: values.lease_start_date?.format("YYYY-MM-DD") || null,
    lease_end_date: values.lease_end_date?.format("YYYY-MM-DD") || null,
    annual_rent_value: values.annual_rent_value ?? null,
    security_deposit: values.security_deposit ?? null,
    payment_schedule: values.payment_schedule || "",
    auto_renewal: values.auto_renewal ?? false,
    notice: values.notice || "",
    payments: values.payments || "",
    recurrence: values.recurrence,
    one_time_due_date: values.recurrence === "ONE_TIME" ? values.one_time_due_date?.format("YYYY-MM-DD") || null : null,
    start_date: values.recurrence === "MONTHLY" ? values.start_date?.format("YYYY-MM-DD") || null : null,
    due_day: values.recurrence === "MONTHLY" ? values.due_day ?? null : null,
    reminder_days: values.reminder_days,
    amount: values.amount ?? null,
  });

  const handleCreate = async () => {
    if (isHeadOffice) return;
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      const response = await createRent(toPayload(values));
      if (isApiError(response)) {
        message.error(response.message || t("hr.rents.errorCreate", "Failed to create rent"));
        setSubmitting(false);
        return;
      }
      setCreateOpen(false);
      createForm.resetFields();
      message.success(t("hr.rents.successCreate", "Rent created"));
      loadData(1, pageSize);
      setPage(1);
    } catch (err: any) {
      if (!err?.errorFields) message.error(err.message || t("hr.rents.errorCreate", "Failed to create rent"));
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (item: RentItem) => {
    setEditing(item);
    editForm.setFieldsValue({
      rent_type_id: item.rent_type.id,
      asset_id: item.asset?.id,
      property_name_en: item.property_name_en,
      property_name_ar: item.property_name_ar,
      property_address: item.property_address,
      lease_start_date: item.lease_start_date ? dayjs(item.lease_start_date) : undefined,
      lease_end_date: item.lease_end_date ? dayjs(item.lease_end_date) : undefined,
      annual_rent_value: item.annual_rent_value === null ? undefined : Number(item.annual_rent_value),
      security_deposit: item.security_deposit === null ? undefined : Number(item.security_deposit),
      payment_schedule: item.payment_schedule,
      auto_renewal: item.auto_renewal,
      notice: item.notice,
      payments: item.payments,
      recurrence: item.recurrence,
      one_time_due_date:
        item.recurrence === "ONE_TIME" && item.one_time_due_date ? dayjs(item.one_time_due_date) : undefined,
      start_date: item.recurrence === "MONTHLY" && item.start_date ? dayjs(item.start_date) : undefined,
      due_day: item.recurrence === "MONTHLY" ? item.due_day || undefined : undefined,
      reminder_days: item.reminder_days,
      amount: item.amount === null ? undefined : Number(item.amount),
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (isHeadOffice) return;
    if (!editing) return;

    try {
      const values = await editForm.validateFields();
      setSubmitting(true);
      const response = await updateRent(editing.id, toPayload(values));
      if (isApiError(response)) {
        message.error(response.message || t("hr.rents.errorUpdate", "Failed to update rent"));
        setSubmitting(false);
        return;
      }
      message.success(t("hr.rents.successUpdate", "Rent updated"));
      setEditOpen(false);
      setEditing(null);
      editForm.resetFields();
      loadData(page, pageSize);
    } catch (err: any) {
      if (!err?.errorFields) message.error(err.message || t("hr.rents.errorUpdate", "Failed to update rent"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (isHeadOffice) return;
    const response = await deleteRent(id);
    if (isApiError(response)) {
      message.error(response.message || t("hr.rents.errorDelete", "Failed to delete rent"));
      return;
    }
    message.success(t("hr.rents.successDelete", "Rent deleted"));
    loadData(page, pageSize);
  };

  const handleNotify = async (id: number) => {
    if (isHeadOffice) return;
    setNotifyingId(id);
    try {
      const response = await notifyRent(id);
      if (isApiError(response)) {
        message.error(response.message || t("hr.rents.errorNotify", "Failed to send reminder"));
        return;
      }
      message.success(t("hr.rents.successNotify", "Reminder sent"));
      loadData(page, pageSize);
    } catch (err: any) {
      message.error(err.message || t("hr.rents.errorNotify", "Failed to send reminder"));
    } finally {
      setNotifyingId(null);
    }
  };

  const openView = (record: RentItem) => {
    setViewing(record);
    const nextPaymentNumber = (record.payment_records?.length || 0) + 1;
    paymentForm.setFieldsValue({
      payment_number: nextPaymentNumber,
      category: "rent",
      status: "pending",
      amount: undefined,
      due_date: undefined,
      paid_date: undefined,
      notes: "",
    });
  };

  const handleAddPayment = async () => {
    if (!viewing || isHeadOffice) return;

    try {
      const values = await paymentForm.validateFields();
      setPaymentSubmitting(true);
      const payload: CreateRentPaymentDto = {
        payment_number: values.payment_number,
        category: values.category,
        status: values.status,
        amount: values.amount,
        due_date: values.due_date?.format("YYYY-MM-DD") || null,
        paid_date: values.status === "paid" ? values.paid_date?.format("YYYY-MM-DD") || null : null,
        notes: values.notes || "",
      };
      const response = await createRentPayment(viewing.id, payload);
      if (isApiError(response)) {
        message.error(response.message || t("hr.rents.payments.errorCreate", "Failed to add payment record"));
        return;
      }

      const updatedViewing = {
        ...viewing,
        payment_records: [...(viewing.payment_records || []), response.data].sort(
          (a, b) => a.payment_number - b.payment_number || a.id - b.id
        ),
      };
      setViewing(updatedViewing);
      setItems((current) => current.map((item) => (item.id === updatedViewing.id ? updatedViewing : item)));
      paymentForm.resetFields();
      paymentForm.setFieldsValue({
        payment_number: updatedViewing.payment_records.length + 1,
        category: "rent",
        status: "pending",
      });
      message.success(t("hr.rents.payments.successCreate", "Payment record added"));
    } catch (err: any) {
      if (!err?.errorFields) message.error(err.message || t("hr.rents.payments.errorCreate", "Failed to add payment record"));
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const recurrenceOptions = useMemo(
    () => [
      { label: t("hr.rents.recurrence.oneTime", "One Time"), value: "ONE_TIME" },
      { label: t("hr.rents.recurrence.monthly", "Monthly"), value: "MONTHLY" },
    ],
    [t]
  );

  const paymentCategoryOptions = useMemo(
    () => [
      { label: t("hr.rents.payments.category.rent", "Rent"), value: "rent" },
      { label: t("hr.rents.payments.category.securityDeposit", "Security Deposit"), value: "security_deposit" },
      { label: t("hr.rents.payments.category.other", "Other"), value: "other" },
    ],
    [t]
  );

  const paymentStatusOptions = useMemo(
    () => [
      { label: t("hr.rents.payments.status.pending", "Pending"), value: "pending" },
      { label: t("hr.rents.payments.status.paid", "Paid"), value: "paid" },
      { label: t("hr.rents.payments.status.cancelled", "Cancelled"), value: "cancelled" },
    ],
    [t]
  );

  const getRentName = (record: RentItem) => {
    if (record.asset) return language === "ar" ? (record.asset.name_ar || record.asset.name_en) : record.asset.name_en;
    return language === "ar" ? (record.property_name_ar || record.property_name_en || "-") : (record.property_name_en || "-");
  };

  const getStatusTag = (record: RentItem) => {
    const color = record.status === "OVERDUE" ? "red" : record.status === "UPCOMING" ? "gold" : "green";
    const label =
      record.status === "OVERDUE"
        ? t("hr.rents.status.overdue", "OVERDUE")
        : record.status === "UPCOMING"
          ? t("hr.rents.status.upcoming", "UPCOMING")
          : t("hr.rents.status.scheduled", "SCHEDULED");
    return <Tag color={color}>{label}</Tag>;
  };

  const renderMoney = (value: string | number | null | undefined) => (
    <Space size={6} align="center" style={{ whiteSpace: "nowrap" }}>
      <SARIcon size={14} color="var(--text-primary)" />
      <Text strong style={{ color: "var(--text-primary)" }}>
        {formatMoney(value)}
      </Text>
    </Space>
  );

  const getPaymentCategoryLabel = (category: RentPaymentCategory) =>
    paymentCategoryOptions.find((option) => option.value === category)?.label || category;

  const getPaymentStatusTag = (status: RentPaymentStatus) => {
    const color = status === "paid" ? "green" : status === "cancelled" ? "red" : "gold";
    return <Tag color={color}>{paymentStatusOptions.find((option) => option.value === status)?.label || status}</Tag>;
  };

  const columns = [
    {
      title: t("hr.rents.colNoId", "No. / ID"),
      key: "no_id",
      width: 110,
      render: (_: unknown, record: RentItem, index: number) => (
        <Space direction="vertical" size={0}>
          <Text strong>{(page - 1) * pageSize + index + 1}</Text>
          <Text type="secondary">ID {record.id}</Text>
        </Space>
      ),
    },
    {
      title: t("hr.rents.colName", "Name"),
      key: "name",
      render: (_: unknown, record: RentItem) => <Text strong>{getRentName(record)}</Text>,
    },
    {
      title: t("hr.rents.colLocation", "Location"),
      key: "location",
      render: (_: unknown, record: RentItem) => record.property_address || "-",
    },
    {
      title: t("hr.rents.colLeaseEndDate", "Lease End Date"),
      key: "lease_end_date",
      render: (_: unknown, record: RentItem) => formatDate(record.lease_end_date || record.next_due_date),
    },
    {
      title: t("hr.rents.colRemainingLeaseDuration", "Remaining Lease Duration"),
      key: "remaining_lease_duration",
      render: (_: unknown, record: RentItem) => {
        const duration = record.remaining_lease_duration ?? record.days_remaining;
        if (duration === null || duration === undefined) return "-";
        if (duration < 0) return <Badge status="error" text={formatDuration(duration, t)} />;
        if (duration <= record.reminder_days) return <Badge status="warning" text={formatDuration(duration, t)} />;
        return <span>{formatDuration(duration, t)}</span>;
      },
    },
    {
      title: t("hr.rents.colStatus", "Status"),
      key: "status",
      render: (_: unknown, record: RentItem) => getStatusTag(record),
    },
    {
      title: t("hr.rents.colActions", "Actions"),
      key: "actions",
      align: "center" as const,
      render: (_: unknown, record: RentItem) => (
        <Space size="middle">
          <Tooltip title={t("common.view", "View")}>
            <Button
              type="text"
              shape="circle"
              icon={<EyeOutlined style={{ color: "var(--brand-primary)" }} />}
              onClick={() => openView(record)}
            />
          </Tooltip>
          <Tooltip title={t("common.edit", "Edit")}>
            <Button
              type="text"
              shape="circle"
              icon={<EditOutlined style={{ color: "var(--brand-primary)" }} />}
              disabled={isHeadOffice}
              title={isHeadOffice ? t("organization.headOffice.switchToEditRecords") : undefined}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t("common.delete", "Delete")}>
            <Popconfirm title={t("hr.rents.confirmDelete", "Delete this rent?")} onConfirm={() => handleDelete(record.id)}>
              <Button
                type="text"
                danger
                shape="circle"
                icon={<DeleteOutlined />}
                disabled={isHeadOffice}
                title={isHeadOffice ? t("organization.headOffice.switchToEditRecords") : undefined}
              />
            </Popconfirm>
          </Tooltip>
          <Tooltip title={t("hr.rents.notify", "Notify")}>
            <Button
              type="text"
              shape="circle"
              icon={<BellOutlined style={{ color: "var(--brand-accent)" }} />}
              loading={notifyingId === record.id}
              disabled={isHeadOffice}
              title={isHeadOffice ? t("organization.headOffice.switchToUseAction") : undefined}
              onClick={() => handleNotify(record.id)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>
          {t("layout.rents", "Rents")}
        </Title>
        <Space wrap>
          <Input.Search allowClear placeholder={`${t("common.search", "Search")}...`} onSearch={(value) => setSearch(value)} style={{ width: 240 }} />
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={[
              { value: "all", label: t("hr.rents.filter.all", "All") },
              { value: "upcoming", label: t("hr.rents.filter.upcoming", "Upcoming") },
              { value: "overdue", label: t("hr.rents.filter.overdue", "Overdue") },
            ]}
            style={{ width: 150 }}
          />
          <Select
            allowClear
            placeholder={t("hr.rents.filter.rentType", "Rent Type")}
            value={rentTypeFilter}
            onChange={(value) => setRentTypeFilter(value)}
            options={rentTypes.map((rt) => ({ value: rt.id, label: language === "ar" ? (rt.name_ar || rt.name_en) : rt.name_en }))}
            style={{ width: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => loadData(page, pageSize)}>
            {t("common.refresh", "Refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            disabled={isHeadOffice}
            title={isHeadOffice ? t("organization.headOffice.switchToCreateRecords") : undefined}
          >
            {t("hr.rents.createButton", "Create Rent")}
          </Button>
        </Space>
      </div>

      <Card bordered={false} style={{ borderRadius: 8 }}>
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <Empty description={t("hr.rents.empty", "No rent records found.")} /> }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
              loadData(nextPage, nextPageSize);
            },
          }}
        />
      </Card>

      <Modal
        title={viewing ? `${t("hr.rents.viewTitle", "Rent Details")}: ${getRentName(viewing)}` : t("hr.rents.viewTitle", "Rent Details")}
        open={!!viewing}
        onCancel={() => setViewing(null)}
        footer={[
          <Button key="close" onClick={() => setViewing(null)}>
            {t("common.close", "Close")}
          </Button>,
        ]}
        width="min(900px, 96vw)"
        style={{ top: 16 }}
      >
        {viewing && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label={t("hr.rents.colRentType", "Rent Type")}>
                {language === "ar"
                  ? (viewing.rent_type?.name_ar || viewing.rent_type?.name_en || "-")
                  : (viewing.rent_type?.name_en || "-")}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colName", "Name")}>{getRentName(viewing)}</Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colLocation", "Location")}>
                {viewing.property_address || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colStatus", "Status")}>{getStatusTag(viewing)}</Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.leaseStartDate", "Lease Start Date")}>
                {formatDate(viewing.lease_start_date)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colLeaseEndDate", "Lease End Date")}>
                {formatDate(viewing.lease_end_date)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colRemainingLeaseDuration", "Remaining Lease Duration")}>
                {formatDuration(viewing.remaining_lease_duration ?? viewing.days_remaining, t)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.notificationDate", "Notification Date")}>
                {formatDate(viewing.notification_date)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.annualRentValue", "Annual Rent Value")}>
                {renderMoney(viewing.annual_rent_value)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.securityDeposit", "Security Deposit")}>
                {renderMoney(viewing.security_deposit)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.paymentSchedule", "Payment Schedule")}>
                {viewing.payment_schedule || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.autoRenewal", "Auto Renewal")}>
                {viewing.auto_renewal ? t("common.yes", "Yes") : t("common.no", "No")}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.notice", "Notice")}>{viewing.notice || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.field.payments", "Payments")}>
                {viewing.payments || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colRecurrence", "Recurrence")}>
                <Tag color={viewing.recurrence === "ONE_TIME" ? "blue" : "purple"}>
                  {viewing.recurrence === "ONE_TIME"
                    ? t("hr.rents.recurrence.oneTime", "One Time")
                    : t("hr.rents.recurrence.monthly", "Monthly")}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colDueDate", "Due Date")}>
                {formatDate(viewing.next_due_date)}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colReminderDays", "Reminder (Days)")}>
                {t("hr.rents.reminderBefore", { days: viewing.reminder_days }, "{days} days before")}
              </Descriptions.Item>
              <Descriptions.Item label={t("hr.rents.colLastReminder", "Last Reminder")}>
                {viewing.last_reminder_sent_at ? formatDate(viewing.last_reminder_sent_at) : t("hr.rents.notSent", "Not Sent")}
              </Descriptions.Item>
              {isHeadOffice && (
                <Descriptions.Item label={t("common.company", "Company")} span={2}>
                  {viewing.company_name ? <Tag color="blue">{viewing.company_name}</Tag> : "-"}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Tabs
              items={[
                {
                  key: "payment-records",
                  label: `${t("hr.rents.payments.title", "Payment Records")} (${viewing.payment_records?.length || 0})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={viewing.payment_records || []}
                      scroll={{ x: "max-content" }}
                      locale={{ emptyText: <Empty description={t("hr.rents.payments.empty", "No payment records yet.")} /> }}
                      columns={[
                        {
                          title: t("hr.rents.payments.colNumber", "No."),
                          dataIndex: "payment_number",
                          width: 72,
                        },
                        {
                          title: t("hr.rents.payments.colCategory", "Category"),
                          dataIndex: "category",
                          render: (value: RentPaymentCategory) => getPaymentCategoryLabel(value),
                        },
                        {
                          title: t("hr.rents.payments.colStatus", "Status"),
                          dataIndex: "status",
                          render: (value: RentPaymentStatus) => getPaymentStatusTag(value),
                        },
                        {
                          title: t("hr.rents.payments.colAmount", "Amount"),
                          dataIndex: "amount",
                          render: (value: string | number) => renderMoney(value),
                        },
                        {
                          title: t("hr.rents.payments.colPaidDate", "Paid Date"),
                          dataIndex: "paid_date",
                          render: (value?: string | null) => formatDate(value),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "add-payment",
                  label: t("hr.rents.payments.addTitle", "Add Payment Record"),
                  children: (
                    <Form
                      form={paymentForm}
                      layout="vertical"
                      initialValues={{ category: "rent", status: "pending" }}
                      disabled={isHeadOffice}
                    >
                      <Space align="start" wrap style={{ width: "100%" }}>
                        <Form.Item
                          name="payment_number"
                          label={t("hr.rents.payments.fieldNumber", "Payment No.")}
                          rules={[{ required: true, message: t("common.required", "Required") }]}
                        >
                          <InputNumber min={1} style={{ width: 130 }} />
                        </Form.Item>
                        <Form.Item
                          name="category"
                          label={t("hr.rents.payments.fieldCategory", "Category")}
                          rules={[{ required: true, message: t("common.required", "Required") }]}
                        >
                          <Select options={paymentCategoryOptions} style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item
                          name="status"
                          label={t("hr.rents.payments.fieldStatus", "Status")}
                          rules={[{ required: true, message: t("common.required", "Required") }]}
                        >
                          <Select options={paymentStatusOptions} style={{ width: 150 }} />
                        </Form.Item>
                        <Form.Item
                          name="amount"
                          label={t("hr.rents.payments.fieldAmount", "Amount")}
                          rules={[{ required: true, message: t("common.required", "Required") }]}
                        >
                          <InputNumber min={0} style={{ width: 160 }} />
                        </Form.Item>
                      </Space>
                      <Space align="start" wrap style={{ width: "100%" }}>
                        <Form.Item name="due_date" label={t("hr.rents.payments.fieldDueDate", "Due Date")}>
                          <DatePicker style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate>
                          {({ getFieldValue }) =>
                            getFieldValue("status") === "paid" ? (
                              <Form.Item
                                name="paid_date"
                                label={t("hr.rents.payments.fieldPaidDate", "Paid Date")}
                                rules={[{ required: true, message: t("common.required", "Required") }]}
                              >
                                <DatePicker style={{ width: 180 }} />
                              </Form.Item>
                            ) : null
                          }
                        </Form.Item>
                      </Space>
                      <Form.Item name="notes" label={t("hr.rents.payments.fieldNotes", "Notes")}>
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Button type="primary" onClick={handleAddPayment} loading={paymentSubmitting} disabled={isHeadOffice}>
                        {t("hr.rents.payments.addButton", "Add Payment")}
                      </Button>
                    </Form>
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Modal>

      <Modal title={t("hr.rents.createTitle", "Create Rent")} open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} confirmLoading={submitting}>
        <Form form={createForm} layout="vertical" initialValues={{ recurrence: "ONE_TIME", reminder_days: 30, auto_renewal: false }}>
          <Form.Item name="rent_type_id" label={t("hr.rents.colRentType", "Rent Type")} rules={[{ required: true, message: t("common.required", "Required") }]}>
            <Select options={rentTypes.map((rt) => ({ value: rt.id, label: language === "ar" ? (rt.name_ar || rt.name_en) : rt.name_en }))} />
          </Form.Item>
          <Form.Item name="asset_id" label={t("hr.rents.field.assetOptional", "Asset (Optional)")}>
            <Select allowClear options={assets.map((asset) => ({ value: asset.id, label: language === "ar" ? (asset.name_ar || asset.name_en) : asset.name_en }))} />
          </Form.Item>
          <Form.Item name="property_name_en" label={t("hr.rents.field.propertyNameEn", "Property Name (EN)")}>
            <Input />
          </Form.Item>
          <Form.Item name="property_name_ar" label={t("hr.rents.field.propertyNameAr", "Property Name (AR)")}>
            <Input />
          </Form.Item>
          <Form.Item name="property_address" label={t("hr.rents.field.propertyAddress", "Property Address")}>
            <Input />
          </Form.Item>
          <Form.Item name="lease_start_date" label={t("hr.rents.field.leaseStartDate", "Lease Start Date")}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="lease_end_date" label={t("hr.rents.colLeaseEndDate", "Lease End Date")}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="annual_rent_value" label={t("hr.rents.field.annualRentValue", "Annual Rent Value")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="security_deposit" label={t("hr.rents.field.securityDeposit", "Security Deposit")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="payment_schedule" label={t("hr.rents.field.paymentSchedule", "Payment Schedule")}>
            <Input />
          </Form.Item>
          <Form.Item name="auto_renewal" label={t("hr.rents.field.autoRenewal", "Auto Renewal")} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notice" label={t("hr.rents.field.notice", "Notice")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="payments" label={t("hr.rents.field.payments", "Payments")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="recurrence" label={t("hr.rents.colRecurrence", "Recurrence")} rules={[{ required: true, message: t("common.required", "Required") }]}>
            <Select options={recurrenceOptions} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue("recurrence") === "ONE_TIME" ? (
                <Form.Item name="one_time_due_date" label={t("hr.rents.colDueDate", "Due Date")} rules={[{ required: true, message: t("common.required", "Required") }]}>
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              ) : (
                <>
                  <Form.Item name="start_date" label={t("hr.rents.field.startDate", "Start Date")} rules={[{ required: true, message: t("common.required", "Required") }]}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name="due_day" label={t("hr.rents.field.dueDay", "Due Day")} rules={[{ required: true, message: t("common.required", "Required") }]}>
                    <InputNumber min={1} max={28} style={{ width: "100%" }} />
                  </Form.Item>
                </>
              )
            }
          </Form.Item>
          <Form.Item name="reminder_days" label={t("hr.rents.field.reminderDays", "Reminder Days")} rules={[{ required: true, message: t("common.required", "Required") }]}>
            <InputNumber min={1} max={365} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="amount" label={t("hr.rents.colAmount", "Amount")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("hr.rents.editTitle", "Edit Rent")} open={editOpen} onOk={handleEdit} onCancel={() => setEditOpen(false)} confirmLoading={submitting}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="rent_type_id" label={t("hr.rents.colRentType", "Rent Type")} rules={[{ required: true, message: t("common.required", "Required") }]}>
            <Select options={rentTypes.map((rt) => ({ value: rt.id, label: language === "ar" ? (rt.name_ar || rt.name_en) : rt.name_en }))} />
          </Form.Item>
          <Form.Item name="asset_id" label={t("hr.rents.field.assetOptional", "Asset (Optional)")}>
            <Select allowClear options={assets.map((asset) => ({ value: asset.id, label: language === "ar" ? (asset.name_ar || asset.name_en) : asset.name_en }))} />
          </Form.Item>
          <Form.Item name="property_name_en" label={t("hr.rents.field.propertyNameEn", "Property Name (EN)")}>
            <Input />
          </Form.Item>
          <Form.Item name="property_name_ar" label={t("hr.rents.field.propertyNameAr", "Property Name (AR)")}>
            <Input />
          </Form.Item>
          <Form.Item name="property_address" label={t("hr.rents.field.propertyAddress", "Property Address")}>
            <Input />
          </Form.Item>
          <Form.Item name="lease_start_date" label={t("hr.rents.field.leaseStartDate", "Lease Start Date")}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="lease_end_date" label={t("hr.rents.colLeaseEndDate", "Lease End Date")}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="annual_rent_value" label={t("hr.rents.field.annualRentValue", "Annual Rent Value")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="security_deposit" label={t("hr.rents.field.securityDeposit", "Security Deposit")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="payment_schedule" label={t("hr.rents.field.paymentSchedule", "Payment Schedule")}>
            <Input />
          </Form.Item>
          <Form.Item name="auto_renewal" label={t("hr.rents.field.autoRenewal", "Auto Renewal")} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notice" label={t("hr.rents.field.notice", "Notice")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="payments" label={t("hr.rents.field.payments", "Payments")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="recurrence" label={t("hr.rents.colRecurrence", "Recurrence")} rules={[{ required: true, message: t("common.required", "Required") }]}>
            <Select options={recurrenceOptions} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue("recurrence") === "ONE_TIME" ? (
                <Form.Item name="one_time_due_date" label={t("hr.rents.colDueDate", "Due Date")} rules={[{ required: true, message: t("common.required", "Required") }]}>
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              ) : (
                <>
                  <Form.Item name="start_date" label={t("hr.rents.field.startDate", "Start Date")} rules={[{ required: true, message: t("common.required", "Required") }]}>
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name="due_day" label={t("hr.rents.field.dueDay", "Due Day")} rules={[{ required: true, message: t("common.required", "Required") }]}>
                    <InputNumber min={1} max={28} style={{ width: "100%" }} />
                  </Form.Item>
                </>
              )
            }
          </Form.Item>
          <Form.Item name="reminder_days" label={t("hr.rents.field.reminderDays", "Reminder Days")} rules={[{ required: true, message: t("common.required", "Required") }]}>
            <InputNumber min={1} max={365} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="amount" label={t("hr.rents.colAmount", "Amount")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {!loading && items.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">{t("hr.rents.empty", "No rent records found.")}</Text>
        </div>
      )}
    </div>
  );
}
