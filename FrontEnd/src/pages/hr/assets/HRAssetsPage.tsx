import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import {
  assignAsset,
  createAsset,
  deleteAsset,
  getAssetsDashboardSummary,
  listAssets,
  returnAsset,
  updateAsset,
  type Asset,
  type AssetDashboardSummary,
  type CreateAssetPayload,
} from "../../../services/api/assetsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { listEmployees, type Employee } from "../../../services/api/employeesApi";

const statusColorMap: Record<string, string> = {
  AVAILABLE: "green",
  ASSIGNED: "blue",
  UNDER_MAINTENANCE: "gold",
  LOST: "red",
  DAMAGED: "volcano",
  RETIRED: "default",
};

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <Typography.Text type="secondary">{title}</Typography.Text>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, marginTop: 6 }}>{value}</div>
    </Card>
  );
}

export default function HRAssetsPage() {
  const [apiMessage, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<AssetDashboardSummary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [createForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [returnForm] = Form.useForm();
  const selectedType = Form.useWatch("type", createForm);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [assetsRes, summaryRes] = await Promise.all([
        listAssets({ page: 1, page_size: 25 }),
        getAssetsDashboardSummary(),
      ]);

      if (isApiError(assetsRes)) {
        setError(assetsRes.message || "Failed to load assets.");
        return;
      }
      if (isApiError(summaryRes)) {
        setError(summaryRes.message || "Failed to load assets summary.");
        return;
      }

      setAssets(assetsRes.data.items || []);
      setSummary(summaryRes.data);
    } catch (err: any) {
      setError(err?.message || "Failed to load assets.");
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      const res = await listEmployees({ page: 1, page_size: 200 });
      if (!isApiError(res)) {
        setEmployees(res.data.results || []);
      }
    } catch {
      // Best effort load for assignment select.
    }
  };

  useEffect(() => {
    void loadData();
    void loadEmployees();
  }, []);

  const dataSource = useMemo(() => assets.map((item) => ({ ...item, key: item.id })), [assets]);
  const employeeOptions = useMemo(
    () =>
      employees.map((item) => ({
        label: `${item.full_name || item.full_name_en || item.employee_id} (${item.employee_id})`,
        value: item.id,
      })),
    [employees]
  );

  const columns: ColumnsType<Asset> = [
    {
      title: "Code",
      dataIndex: "asset_code",
      key: "asset_code",
      width: 140,
      render: (value: string, record) => (
        <Button
          type="link"
          style={{ paddingInline: 0 }}
          onClick={() => {
            setActiveAsset(record);
            setDetailsModalOpen(true);
          }}
        >
          {value}
        </Button>
      ),
    },
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (value: string, record) => (
        <Button
          type="link"
          style={{ paddingInline: 0 }}
          onClick={() => {
            setActiveAsset(record);
            setDetailsModalOpen(true);
          }}
        >
          {value}
        </Button>
      ),
    },
    { title: "Type", dataIndex: "type", key: "type", width: 120 },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 180,
      render: (status: string) => <Tag color={statusColorMap[status] || "default"}>{status}</Tag>,
    },
    { title: "Vendor", dataIndex: "vendor", key: "vendor", width: 180, render: (value?: string) => value || "-" },
    {
      title: "Warranty Expiry",
      dataIndex: "warranty_expiry",
      key: "warranty_expiry",
      width: 160,
      render: (value?: string | null) => value || "-",
    },
    {
      title: "Actions",
      key: "actions",
      width: 320,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setActiveAsset(record);
              setDetailsModalOpen(true);
            }}
          >
            View
          </Button>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setEditingAsset(record);

              const baseValues: Record<string, unknown> = {
                name: record.name,
                type: record.type,
                vendor: record.vendor || undefined,
                asset_value: record.asset_value ?? undefined,
                purchase_date: record.purchase_date ? dayjs(record.purchase_date) : undefined,
                warranty_expiry: record.warranty_expiry ? dayjs(record.warranty_expiry) : undefined,
                serial_number: record.serial_number || undefined,
                notes: record.notes || undefined,
                plate_number: record.plate_number || undefined,
                chassis_number: record.chassis_number || undefined,
                engine_number: record.engine_number || undefined,
                fuel_type: record.fuel_type || undefined,
                insurance_expiry: record.insurance_expiry || undefined,
                registration_expiry: record.registration_expiry || undefined,
                cpu: record.cpu || undefined,
                ram: record.ram || undefined,
                storage: record.storage || undefined,
                mac_address: record.mac_address || undefined,
                operating_system: record.operating_system || undefined,
              };

              if (record.type === "OTHER") {
                const details = record.flexible_attributes || {};
                const rows = Object.entries(details).map(([title, value]) => {
                  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
                  const valueType = item.type === "date" ? "date" : "body";
                  return {
                    title,
                    value_type: valueType,
                    body: typeof item.body === "string" ? item.body : undefined,
                    date: typeof item.date === "string" ? dayjs(item.date) : undefined,
                  };
                });
                baseValues.other_custom_details = rows;
              }

              createForm.setFieldsValue(baseValues);
              setCreateModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="small"
            disabled={record.status !== "AVAILABLE"}
            onClick={(e) => {
              e.stopPropagation();
              setActiveAsset(record);
              assignForm.resetFields();
              setAssignModalOpen(true);
            }}
          >
            Assign
          </Button>
          <Button
            size="small"
            disabled={record.status !== "ASSIGNED"}
            onClick={(e) => {
              e.stopPropagation();
              setActiveAsset(record);
              returnForm.resetFields();
              setReturnModalOpen(true);
            }}
          >
            Return
          </Button>
          <Popconfirm
            title="Delete asset"
            description="This will hard delete the asset. Continue?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={async (e) => {
              e?.stopPropagation?.();
              try {
                await deleteAsset(record.id);
                await apiMessage.success("Asset deleted.");
                await loadData();
              } catch (err: any) {
                await apiMessage.error(err?.message || "Failed to delete asset.");
              }
            }}
          >
            <Button
              danger
              size="small"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const normalizeOptional = (value?: string) => {
    const trimmed = (value || "").trim();
    return trimmed ? trimmed : undefined;
  };

  const normalizeDateOptional = (value?: any) => {
    if (!value) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    if (typeof value.format === "function") {
      return value.format("YYYY-MM-DD");
    }
    return undefined;
  };

  const handleCreateAsset = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);

      let flexibleAttributes: Record<string, unknown> | undefined;
      if (values.type === "OTHER") {
        const customRows = Array.isArray(values.other_custom_details) ? values.other_custom_details : [];
        const normalizedRows = customRows
          .map((row: { title?: string; value_type?: "body" | "date"; body?: string; date?: any }) => {
            const title = (row?.title || "").trim();
            const valueType = row?.value_type === "date" ? "date" : "body";
            const body = (row?.body || "").trim();
            const rawDate = row?.date;
            const dateValue = rawDate && typeof rawDate.format === "function" ? rawDate.format("YYYY-MM-DD") : null;
            return { title, valueType, body, date: dateValue };
          })
          .filter((row: { title: string }) => row.title.length > 0);

        if (normalizedRows.length === 0) {
          createForm.setFields([
            {
              name: "other_custom_details",
              errors: ["At least one custom detail with title is required."],
            },
          ]);
          setSubmitting(false);
          return;
        }

        flexibleAttributes = normalizedRows.reduce(
          (
            acc: Record<string, unknown>,
            row: { title: string; valueType: "body" | "date"; body: string; date: string | null }
          ) => {
            if (row.valueType === "date") {
              acc[row.title] = { type: "date", date: row.date };
            } else {
              acc[row.title] = { type: "body", body: row.body };
            }
            return acc;
          },
          {}
        );

        const hasAnyValidValue = Object.values(flexibleAttributes).some((item) => {
          if (!item || typeof item !== "object") return false;
          const details = item as Record<string, unknown>;
          if (details.type === "date") return Boolean(details.date);
          if (details.type === "body") return Boolean(details.body);
          return false;
        });

        if (!hasAnyValidValue) {
          createForm.setFields([
            {
              name: "other_custom_details",
              errors: ["Please provide a body or a date in at least one custom detail."],
            },
          ]);
          setSubmitting(false);
          return;
        }
      }

      const payload: CreateAssetPayload = {
        name: values.name,
        type: values.type,
        status: values.status || "AVAILABLE",
        serial_number: normalizeOptional(values.serial_number),
        purchase_date: normalizeDateOptional(values.purchase_date),
        warranty_expiry: normalizeDateOptional(values.warranty_expiry),
        asset_value: values.asset_value,
        vendor: normalizeOptional(values.vendor),
        notes: normalizeOptional(values.notes),
        flexible_attributes: flexibleAttributes,
        plate_number: normalizeOptional(values.plate_number),
        chassis_number: normalizeOptional(values.chassis_number),
        engine_number: normalizeOptional(values.engine_number),
        fuel_type: normalizeOptional(values.fuel_type),
        insurance_expiry: normalizeOptional(values.insurance_expiry),
        registration_expiry: normalizeOptional(values.registration_expiry),
        cpu: normalizeOptional(values.cpu),
        ram: normalizeOptional(values.ram),
        storage: normalizeOptional(values.storage),
        mac_address: normalizeOptional(values.mac_address),
        operating_system: normalizeOptional(values.operating_system),
      };

      if (editingAsset) {
        await updateAsset(editingAsset.id, payload);
      } else {
        await createAsset(payload);
      }
      setCreateModalOpen(false);
      createForm.resetFields();
      setEditingAsset(null);
      await apiMessage.success(editingAsset ? "Asset updated successfully." : "Asset created successfully.");
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || (editingAsset ? "Failed to update asset." : "Failed to create asset."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignAsset = async () => {
    if (!activeAsset) return;
    try {
      const values = await assignForm.validateFields();
      setSubmitting(true);
      await assignAsset(activeAsset.id, values.employee_id);
      setAssignModalOpen(false);
      setActiveAsset(null);
      await apiMessage.success("Asset assigned successfully.");
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || "Failed to assign asset.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnAsset = async () => {
    if (!activeAsset) return;
    try {
      const values = await returnForm.validateFields();
      setSubmitting(true);
      await returnAsset(activeAsset.id, {
        return_note: normalizeOptional(values.return_note),
        condition_on_return: normalizeOptional(values.condition_on_return),
      });
      setReturnModalOpen(false);
      setActiveAsset(null);
      await apiMessage.success("Asset returned successfully.");
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || "Failed to return asset.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingState title="Loading assets" lines={6} />;
  if (error) return <ErrorState title="Unable to load assets" description={error} onRetry={() => void loadData()} />;

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Assets"
        subtitle="Manage company assets and monitor availability."
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingAsset(null);
              createForm.resetFields();
              setCreateModalOpen(true);
            }}
          >
            Create Asset
          </Button>
        }
      />

      {summary && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title="Total" value={summary.total} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title="Assigned" value={summary.assigned} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title="Available" value={summary.available} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title="Damaged" value={summary.damaged} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title="Lost" value={summary.lost} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title="Warranty Soon" value={summary.warranty_expiring_soon} /></Col>
        </Row>
      )}

      <Card>
        <Table
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          scroll={{ x: 900 }}
          onRow={(record) => ({
            onClick: () => {
              setActiveAsset(record);
              setDetailsModalOpen(true);
            },
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      <Modal
        title={`Asset Details${activeAsset ? `: ${activeAsset.asset_code}` : ""}`}
        open={detailsModalOpen}
        onCancel={() => {
          setDetailsModalOpen(false);
          setActiveAsset(null);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setDetailsModalOpen(false);
              setActiveAsset(null);
            }}
          >
            Close
          </Button>,
        ]}
        width={900}
      >
        {activeAsset && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="Asset Code">{activeAsset.asset_code}</Descriptions.Item>
            <Descriptions.Item label="Name">{activeAsset.name || "-"}</Descriptions.Item>
            <Descriptions.Item label="Type">{activeAsset.type || "-"}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={statusColorMap[activeAsset.status] || "default"}>{activeAsset.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Vendor">{activeAsset.vendor || "-"}</Descriptions.Item>
            <Descriptions.Item label="Asset Value">{activeAsset.asset_value ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="Serial Number">{activeAsset.serial_number || "-"}</Descriptions.Item>
            <Descriptions.Item label="Purchase Date">{activeAsset.purchase_date || "-"}</Descriptions.Item>
            <Descriptions.Item label="Warranty Expiry">{activeAsset.warranty_expiry || "-"}</Descriptions.Item>
            <Descriptions.Item label="Notes" span={2}>{activeAsset.notes || "-"}</Descriptions.Item>

            {activeAsset.active_assignment && (
              <>
                <Descriptions.Item label="Assigned To">
                  {activeAsset.active_assignment.employee_name || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Assigned Employee ID">
                  {activeAsset.active_assignment.employee_id || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Assigned At">
                  {activeAsset.active_assignment.assigned_at || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Assignment Active">
                  {activeAsset.active_assignment.is_active ? "Yes" : "No"}
                </Descriptions.Item>
              </>
            )}

            {activeAsset.type === "VEHICLE" && (
              <>
                <Descriptions.Item label="Plate Number">{activeAsset.plate_number || "-"}</Descriptions.Item>
                <Descriptions.Item label="Chassis Number">{activeAsset.chassis_number || "-"}</Descriptions.Item>
                <Descriptions.Item label="Engine Number">{activeAsset.engine_number || "-"}</Descriptions.Item>
                <Descriptions.Item label="Fuel Type">{activeAsset.fuel_type || "-"}</Descriptions.Item>
                <Descriptions.Item label="Insurance Expiry">{activeAsset.insurance_expiry || "-"}</Descriptions.Item>
                <Descriptions.Item label="Registration Expiry">{activeAsset.registration_expiry || "-"}</Descriptions.Item>
              </>
            )}

            {activeAsset.type === "LAPTOP" && (
              <>
                <Descriptions.Item label="CPU">{activeAsset.cpu || "-"}</Descriptions.Item>
                <Descriptions.Item label="RAM">{activeAsset.ram || "-"}</Descriptions.Item>
                <Descriptions.Item label="Storage">{activeAsset.storage || "-"}</Descriptions.Item>
                <Descriptions.Item label="MAC Address">{activeAsset.mac_address || "-"}</Descriptions.Item>
                <Descriptions.Item label="Operating System">{activeAsset.operating_system || "-"}</Descriptions.Item>
              </>
            )}

            {activeAsset.type === "OTHER" && (
              <>
                {activeAsset.flexible_attributes && Object.keys(activeAsset.flexible_attributes).length > 0 ? (
                  Object.entries(activeAsset.flexible_attributes).map(([title, value]) => {
                    const details = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
                    const valueType = details.type === "date" ? "date" : "body";
                    const dateValue = typeof details.date === "string" ? details.date : null;
                    const bodyValue = typeof details.body === "string" ? details.body : null;
                    return (
                      <Descriptions.Item key={title} label={title} span={2}>
                        {valueType === "date" ? (dateValue || "-") : (bodyValue || "-")}
                      </Descriptions.Item>
                    );
                  })
                ) : (
                  <Descriptions.Item label="Custom Details" span={2}>
                    -
                  </Descriptions.Item>
                )}
              </>
            )}
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={editingAsset ? `Edit Asset: ${editingAsset.asset_code}` : "Create Asset"}
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
          setEditingAsset(null);
        }}
        onOk={handleCreateAsset}
        okText={editingAsset ? "Save Changes" : "Create"}
        confirmLoading={submitting}
        width={760}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required." }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="Type" rules={[{ required: true, message: "Type is required." }]}>
                <Select
                  options={[
                    { label: "Vehicle", value: "VEHICLE" },
                    { label: "Laptop", value: "LAPTOP" },
                    { label: "Other", value: "OTHER" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="vendor" label="Vendor">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="asset_value" label="Asset Value">
                <InputNumber style={{ width: "100%" }} min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="purchase_date" label="Purchase Date (YYYY-MM-DD)">
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="warranty_expiry" label="Warranty Expiry (YYYY-MM-DD)">
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="serial_number" label="Serial Number">
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>

          {selectedType === "VEHICLE" && (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="plate_number" label="Plate Number" rules={[{ required: true, message: "Plate number is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="chassis_number" label="Chassis Number" rules={[{ required: true, message: "Chassis number is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="engine_number" label="Engine Number" rules={[{ required: true, message: "Engine number is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="fuel_type" label="Fuel Type" rules={[{ required: true, message: "Fuel type is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {selectedType === "LAPTOP" && (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="cpu" label="CPU" rules={[{ required: true, message: "CPU is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="ram" label="RAM" rules={[{ required: true, message: "RAM is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="storage" label="Storage" rules={[{ required: true, message: "Storage is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="mac_address" label="MAC Address" rules={[{ required: true, message: "MAC address is required." }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="operating_system" label="Operating System" rules={[{ required: true, message: "Operating system is required." }]}>
                <Input />
              </Form.Item>
            </>
          )}

          {selectedType === "OTHER" && (
            <Form.Item label="Custom Details" required>
              <Form.List name="other_custom_details">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Row gutter={12} key={key} align="middle" style={{ marginBottom: 8 }}>
                        <Col span={8}>
                          <Form.Item
                            {...restField}
                            name={[name, "title"]}
                            label={name === 0 ? "Title" : ""}
                            rules={[{ required: true, message: "Title is required." }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="Custom detail title" />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...restField}
                            name={[name, "value_type"]}
                            label={name === 0 ? "Field Type" : ""}
                            initialValue="body"
                            rules={[{ required: true, message: "Type is required." }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              options={[
                                { label: "Body", value: "body" },
                                { label: "Date", value: "date" },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item noStyle shouldUpdate>
                            {({ getFieldValue }) => {
                              const valueType = getFieldValue(["other_custom_details", name, "value_type"]) || "body";
                              if (valueType === "date") {
                                return (
                                  <Form.Item
                                    {...restField}
                                    name={[name, "date"]}
                                    label={name === 0 ? "Date" : ""}
                                    rules={[{ required: true, message: "Date is required." }]}
                                    style={{ marginBottom: 0 }}
                                  >
                                    <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
                                  </Form.Item>
                                );
                              }

                              return (
                                <Form.Item
                                  {...restField}
                                  name={[name, "body"]}
                                  label={name === 0 ? "Body" : ""}
                                  rules={[{ required: true, message: "Body is required." }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="Custom detail body" />
                                </Form.Item>
                              );
                            }}
                          </Form.Item>
                        </Col>
                        <Col span={2}>
                          <Button
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            onClick={() => remove(name)}
                            aria-label="Remove custom detail"
                          />
                        </Col>
                      </Row>
                    ))}

                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => add()}
                      style={{ width: "100%", marginTop: 8 }}
                    >
                      Add Custom Detail
                    </Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={`Assign Asset${activeAsset ? `: ${activeAsset.asset_code}` : ""}`}
        open={assignModalOpen}
        onCancel={() => {
          setAssignModalOpen(false);
          setActiveAsset(null);
          assignForm.resetFields();
        }}
        onOk={handleAssignAsset}
        okText="Assign"
        confirmLoading={submitting}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="employee_id"
            label="Employee"
            rules={[{ required: true, message: "Please select an employee." }]}
          >
            <Select
              showSearch
              options={employeeOptions}
              optionFilterProp="label"
              placeholder="Select employee"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Return Asset${activeAsset ? `: ${activeAsset.asset_code}` : ""}`}
        open={returnModalOpen}
        onCancel={() => {
          setReturnModalOpen(false);
          setActiveAsset(null);
          returnForm.resetFields();
        }}
        onOk={handleReturnAsset}
        okText="Return"
        confirmLoading={submitting}
      >
        <Form form={returnForm} layout="vertical">
          <Form.Item name="return_note" label="Return Note">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="condition_on_return" label="Condition On Return">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
