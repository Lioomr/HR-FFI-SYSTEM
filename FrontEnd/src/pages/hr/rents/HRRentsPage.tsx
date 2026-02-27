import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { BellOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import Unauthorized403Page from "../../Unauthorized403Page";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import { listAssets, type Asset } from "../../../services/api/assetsApi";
import {
  createRent,
  deleteRent,
  listRents,
  notifyRent,
  updateRent,
  type CreateRentDto,
  type RentItem,
} from "../../../services/api/rentsApi";
import { listRentTypes, type RentType } from "../../../services/api/rentTypesApi";
import { useI18n } from "../../../i18n/useI18n";
import SARIcon from "../../../components/icons/SARIcon";

const { Title, Text } = Typography;

type StatusFilter = "all" | "upcoming" | "overdue";
type RentFormValues = {
  rent_type_id: number;
  asset_id?: number;
  property_name_en?: string;
  property_name_ar?: string;
  property_address?: string;
  recurrence: "ONE_TIME" | "MONTHLY";
  one_time_due_date?: Dayjs;
  start_date?: Dayjs;
  due_day?: number;
  reminder_days: number;
  amount?: number;
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD-MM-YYYY") : "-";
}

function formatMoney(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";

  // Use Intl.NumberFormat but strip trailing '.00' if it's a whole number
  const formatted = new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(num);

  return formatted;
}

export default function HRRentsPage() {
  const { t, language } = useI18n();
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const [createForm] = Form.useForm<RentFormValues>();
  const [editForm] = Form.useForm<RentFormValues>();

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
  }, []);

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
  }, [page, pageSize, rentTypeFilter, search, statusFilter]);

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
    recurrence: values.recurrence,
    one_time_due_date: values.recurrence === "ONE_TIME" ? values.one_time_due_date?.format("YYYY-MM-DD") || null : null,
    start_date: values.recurrence === "MONTHLY" ? values.start_date?.format("YYYY-MM-DD") || null : null,
    due_day: values.recurrence === "MONTHLY" ? values.due_day ?? null : null,
    reminder_days: values.reminder_days,
    amount: values.amount ?? null,
  });

  const handleCreate = async () => {
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
    const response = await deleteRent(id);
    if (isApiError(response)) {
      message.error(response.message || t("hr.rents.errorDelete", "Failed to delete rent"));
      return;
    }
    message.success(t("hr.rents.successDelete", "Rent deleted"));
    loadData(page, pageSize);
  };

  const handleNotify = async (id: number) => {
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

  const recurrenceOptions = useMemo(
    () => [
      { label: t("hr.rents.recurrence.oneTime", "One Time"), value: "ONE_TIME" },
      { label: t("hr.rents.recurrence.monthly", "Monthly"), value: "MONTHLY" },
    ],
    [t]
  );

  const columns = [
    {
      title: t("hr.rents.colRentType", "Rent Type"),
      key: "rent_type",
      render: (_: unknown, record: RentItem) =>
        language === "ar" ? (record.rent_type?.name_ar || record.rent_type?.name_en || "-") : (record.rent_type?.name_en || "-"),
    },
    {
      title: t("hr.rents.colAssetProperty", "Asset / Property"),
      key: "asset_property",
      render: (_: unknown, record: RentItem) => {
        if (record.asset) return language === "ar" ? (record.asset.name_ar || record.asset.name_en) : record.asset.name_en;
        return language === "ar" ? (record.property_name_ar || record.property_name_en || "-") : (record.property_name_en || "-");
      }
    },
    {
      title: t("hr.rents.colRecurrence", "Recurrence"),
      key: "recurrence",
      render: (_: unknown, record: RentItem) => (
        <Tag color={record.recurrence === "ONE_TIME" ? "blue" : "purple"}>
          {record.recurrence === "ONE_TIME"
            ? t("hr.rents.recurrence.oneTime", "One Time")
            : t("hr.rents.recurrence.monthly", "Monthly")}
        </Tag>
      ),
    },
    {
      title: t("hr.rents.colDueDate", "Due Date"),
      key: "due_date",
      render: (_: unknown, record: RentItem) => formatDate(record.next_due_date),
    },
    {
      title: t("hr.rents.colDaysRemaining", "Days Remaining"),
      key: "days_remaining",
      render: (_: unknown, record: RentItem) => {
        if (record.days_remaining === null || record.days_remaining === undefined) return "-";
        if (record.days_remaining < 0) return <Badge status="error" text={`${record.days_remaining}`} />;
        if (record.days_remaining <= 30) return <Badge status="warning" text={`${record.days_remaining}`} />;
        return <span>{record.days_remaining}</span>;
      },
    },
    {
      title: t("hr.rents.colAmount", "Amount"),
      key: "amount",
      render: (_: unknown, record: RentItem) => (
        <Space size={6} align="center" style={{ whiteSpace: "nowrap" }}>
          <SARIcon size={14} color="var(--text-primary)" />
          <Text strong style={{ color: "var(--text-primary)" }}>
            {formatMoney(record.amount)}
          </Text>
        </Space>
      ),
    },
    {
      title: t("hr.rents.colReminderDays", "Reminder (Days)"),
      key: "reminder_days",
      render: (_: unknown, record: RentItem) =>
        t("hr.rents.reminderBefore", { days: record.reminder_days }, "{days} days before"),
    },
    {
      title: t("hr.rents.colStatus", "Status"),
      key: "status",
      render: (_: unknown, record: RentItem) => {
        const color = record.status === "OVERDUE" ? "red" : record.status === "UPCOMING" ? "gold" : "green";
        const label =
          record.status === "OVERDUE"
            ? t("hr.rents.status.overdue", "OVERDUE")
            : record.status === "UPCOMING"
              ? t("hr.rents.status.upcoming", "UPCOMING")
              : t("hr.rents.status.scheduled", "SCHEDULED");
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: t("hr.rents.colLastReminder", "Last Reminder"),
      key: "last_reminder",
      render: (_: unknown, record: RentItem) =>
        record.last_reminder_sent_at ? formatDate(record.last_reminder_sent_at) : t("hr.rents.notSent", "Not Sent"),
    },
    {
      title: t("hr.rents.colActions", "Actions"),
      key: "actions",
      align: "center" as const,
      render: (_: unknown, record: RentItem) => (
        <Space size="middle">
          <Tooltip title={t("common.edit", "Edit")}>
            <Button
              type="text"
              shape="circle"
              icon={<EditOutlined style={{ color: "var(--brand-primary)" }} />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t("common.delete", "Delete")}>
            <Popconfirm title={t("hr.rents.confirmDelete", "Delete this rent?")} onConfirm={() => handleDelete(record.id)}>
              <Button type="text" danger shape="circle" icon={<DeleteOutlined />} />
            </Popconfirm>
          </Tooltip>
          <Tooltip title={t("hr.rents.notify", "Notify")}>
            <Button
              type="text"
              shape="circle"
              icon={<BellOutlined style={{ color: "var(--brand-accent)" }} />}
              loading={notifyingId === record.id}
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
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t("hr.rents.createButton", "Create Rent")}
          </Button>
        </Space>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={items}
          loading={loading}
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

      <Modal title={t("hr.rents.createTitle", "Create Rent")} open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} confirmLoading={submitting}>
        <Form form={createForm} layout="vertical" initialValues={{ recurrence: "ONE_TIME", reminder_days: 30 }}>
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
