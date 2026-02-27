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

import { useI18n } from "../../../i18n/useI18n";

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
  const { t, language } = useI18n();
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
        setError(assetsRes.message || t("assets.loadFailed"));
        return;
      }
      if (isApiError(summaryRes)) {
        setError(summaryRes.message || t("hr.assets.unableToLoadSummary"));
        return;
      }

      setAssets(assetsRes.data.items || []);
      setSummary(summaryRes.data);
    } catch (err: any) {
      setError(err?.message || t("assets.loadFailed"));
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
      title: t("assets.assetCode"),
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
      title: t("common.name"),
      key: "name",
      render: (_: unknown, record) => (
        <Button
          type="link"
          style={{ paddingInline: 0 }}
          onClick={() => {
            setActiveAsset(record);
            setDetailsModalOpen(true);
          }}
        >
          {language === "ar" ? (record.name_ar || record.name_en) : record.name_en}
        </Button>
      ),
    },
    { title: t("common.type"), dataIndex: "type", key: "type", width: 120 },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 180,
      render: (status: string) => <Tag color={statusColorMap[status] || "default"}>{status}</Tag>,
    },
    { title: t("assets.vendor"), dataIndex: "vendor", key: "vendor", width: 180, render: (value?: string) => value || "-" },
    {
      title: t("assets.warrantyExpiry"),
      dataIndex: "warranty_expiry",
      key: "warranty_expiry",
      width: 160,
      render: (value?: string | null) => value || "-",
    },
    {
      title: t("common.actions"),
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
            {t("common.view")}
          </Button>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setEditingAsset(record);

              const baseValues: Record<string, unknown> = {
                name_en: record.name_en,
                name_ar: record.name_ar,
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
            {t("hr.assets.edit")}
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
            {t("hr.assets.assign")}
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
            {t("hr.assets.return")}
          </Button>
          <Popconfirm
            title={t("hr.assets.deleteAsset")}
            description={t("hr.assets.deleteConfirm")}
            okText={t("hr.assets.delete")}
            okButtonProps={{ danger: true }}
            onConfirm={async (e) => {
              e?.stopPropagation?.();
              try {
                await deleteAsset(record.id);
                await apiMessage.success(t("hr.assets.deleteSuccess"));
                await loadData();
              } catch (err: any) {
                await apiMessage.error(err?.message || t("hr.assets.deleteFailed"));
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
              {t("hr.assets.delete")}
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

        const hasAnyValidValue = Object.values(flexibleAttributes || {}).some((item) => {
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
        name_en: values.name_en,
        name_ar: values.name_ar,
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
      await apiMessage.success(editingAsset ? t("hr.assets.updateSuccess") : t("hr.assets.createSuccess"));
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || (editingAsset ? t("hr.assets.updateFailed") : t("hr.assets.createFailed")));
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
      await apiMessage.success(t("hr.assets.assignSuccess"));
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || t("hr.assets.assignFailed"));
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
      await apiMessage.success(t("hr.assets.returnSuccess"));
      await loadData();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || t("hr.assets.returnFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingState title={t("hr.assets.loadingAssets")} lines={6} />;
  if (error) return <ErrorState title={t("assets.unableToLoad")} description={error} onRetry={() => void loadData()} />;

  return (
    <div>
      {contextHolder}
      <PageHeader
        title={t("hr.assets.title")}
        subtitle={t("hr.assets.subtitle")}
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
            {t("hr.assets.createAsset")}
          </Button>
        }
      />

      {summary && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title={t("hr.assets.total")} value={summary.total} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title={t("hr.assets.assigned")} value={summary.assigned} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title={t("hr.assets.available")} value={summary.available} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title={t("hr.assets.damaged")} value={summary.damaged} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title={t("hr.assets.lost")} value={summary.lost} /></Col>
          <Col xs={24} sm={12} md={8} lg={4}><StatCard title={t("hr.assets.warrantySoon")} value={summary.warranty_expiring_soon} /></Col>
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
        title={activeAsset ? `${t("assets.details")}: ${activeAsset.asset_code}` : t("assets.details")}
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
            {t("common.close")}
          </Button>,
        ]}
        width={900}
      >
        {activeAsset && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label={t("assets.assetCode")}>{activeAsset.asset_code}</Descriptions.Item>
            <Descriptions.Item label={t("common.name")}>{language === "ar" ? (activeAsset.name_ar || activeAsset.name_en || "-") : (activeAsset.name_en || "-")}</Descriptions.Item>
            <Descriptions.Item label={t("common.type")}>{activeAsset.type || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("common.status")}>
              <Tag color={statusColorMap[activeAsset.status] || "default"}>{activeAsset.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("assets.vendor")}>{activeAsset.vendor || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("hr.assets.assetValue")}>{activeAsset.asset_value ?? "-"}</Descriptions.Item>
            <Descriptions.Item label={t("assets.serialNumber")}>{activeAsset.serial_number || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("assets.purchaseDate")}>{activeAsset.purchase_date || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("assets.warrantyExpiry")}>{activeAsset.warranty_expiry || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("common.notes")} span={2}>{activeAsset.notes || "-"}</Descriptions.Item>

            {activeAsset.active_assignment && (
              <>
                <Descriptions.Item label={t("hr.assets.assignedTo")}>
                  {activeAsset.active_assignment.employee_name || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.assignedEmployeeId")}>
                  {activeAsset.active_assignment.employee_id || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.assignedAt")}>
                  {activeAsset.active_assignment.assigned_at || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.assignmentActive")}>
                  {activeAsset.active_assignment.is_active ? t("common.yes") : t("common.no")}
                </Descriptions.Item>
              </>
            )}

            {activeAsset.type === "VEHICLE" && (
              <>
                <Descriptions.Item label={t("assets.plateNumber")}>{activeAsset.plate_number || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.chassisNumber")}>{activeAsset.chassis_number || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.engineNumber")}>{activeAsset.engine_number || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.fuelType")}>{activeAsset.fuel_type || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.insuranceExpiry")}>{activeAsset.insurance_expiry || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.registrationExpiry")}>{activeAsset.registration_expiry || "-"}</Descriptions.Item>
              </>
            )}

            {activeAsset.type === "LAPTOP" && (
              <>
                <Descriptions.Item label={t("assets.cpu")}>{activeAsset.cpu || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.ram")}>{activeAsset.ram || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.storage")}>{activeAsset.storage || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.macAddress")}>{activeAsset.mac_address || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.os")}>{activeAsset.operating_system || "-"}</Descriptions.Item>
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
                  <Descriptions.Item label={t("assets.customDetails")} span={2}>
                    -
                  </Descriptions.Item>
                )}
              </>
            )}
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={editingAsset ? `${t("hr.assets.editAsset")}: ${editingAsset.asset_code}` : t("hr.assets.createAsset")}
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
          setEditingAsset(null);
        }}
        onOk={handleCreateAsset}
        okText={editingAsset ? t("hr.assets.saveChanges") : t("hr.assets.create")}
        confirmLoading={submitting}
        width={760}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name_en" label={t("common.name")} rules={[{ required: true, message: t("hr.assets.nameReq") }]}>
                <Input placeholder="Name (English)" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name_ar" label={t("common.nameAr", "Name (Arabic)")}>
                <Input placeholder="Name (Arabic)" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="type" label={t("common.type")} rules={[{ required: true, message: t("hr.assets.typeReq") }]}>
                <Select
                  options={[
                    { label: t("hr.assets.vehicle"), value: "VEHICLE" },
                    { label: t("hr.assets.laptop"), value: "LAPTOP" },
                    { label: t("hr.assets.other"), value: "OTHER" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="vendor" label={t("assets.vendor")}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="asset_value" label={t("hr.assets.assetValue")}>
                <InputNumber style={{ width: "100%" }} min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="purchase_date" label={t("assets.purchaseDate")}>
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="warranty_expiry" label={t("assets.warrantyExpiry")}>
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="serial_number" label={t("assets.serialNumber")}>
            <Input />
          </Form.Item>
          <Form.Item name="notes" label={t("common.notes")}>
            <Input.TextArea rows={2} />
          </Form.Item>

          {selectedType === "VEHICLE" && (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="plate_number" label={t("assets.plateNumber")} rules={[{ required: true, message: t("hr.assets.plateReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="chassis_number" label={t("assets.chassisNumber")} rules={[{ required: true, message: t("hr.assets.chassisReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="engine_number" label={t("assets.engineNumber")} rules={[{ required: true, message: t("hr.assets.engineReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="fuel_type" label={t("assets.fuelType")} rules={[{ required: true, message: t("hr.assets.fuelReq") }]}>
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
                  <Form.Item name="cpu" label={t("assets.cpu")} rules={[{ required: true, message: t("hr.assets.cpuReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="ram" label={t("assets.ram")} rules={[{ required: true, message: t("hr.assets.ramReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="storage" label={t("assets.storage")} rules={[{ required: true, message: t("hr.assets.storageReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="mac_address" label={t("hr.assets.macAddress")} rules={[{ required: true, message: t("hr.assets.macReq") }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="operating_system" label={t("assets.os")} rules={[{ required: true, message: t("hr.assets.osReq") }]}>
                <Input />
              </Form.Item>
            </>
          )}

          {selectedType === "OTHER" && (
            <Form.Item label={t("assets.customDetails")} required>
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
                            rules={[{ required: true, message: t("hr.assets.titleReq") }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder={t("hr.assets.customDetailTitle")} />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...restField}
                            name={[name, "value_type"]}
                            label={name === 0 ? t("hr.assets.fieldType") : ""}
                            initialValue="body"
                            rules={[{ required: true, message: t("hr.assets.typeReq") }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              options={[
                                { label: t("hr.assets.body"), value: "body" },
                                { label: t("hr.assets.date"), value: "date" },
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
                                    label={name === 0 ? t("hr.assets.date") : ""}
                                    rules={[{ required: true, message: t("hr.assets.dateReq") }]}
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
                                  label={name === 0 ? t("hr.assets.body") : ""}
                                  rules={[{ required: true, message: t("hr.assets.bodyReq") }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder={t("hr.assets.customDetailBody")} />
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
                      {t("hr.assets.addCustomDetail")}
                    </Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={activeAsset ? `${t("hr.assets.assignAsset")}: ${activeAsset.asset_code}` : t("hr.assets.assignAsset")}
        open={assignModalOpen}
        onCancel={() => {
          setAssignModalOpen(false);
          setActiveAsset(null);
          assignForm.resetFields();
        }}
        onOk={handleAssignAsset}
        okText={t("hr.assets.assign")}
        confirmLoading={submitting}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="employee_id"
            label={t("hr.assets.employee")}
            rules={[{ required: true, message: t("hr.assets.pleaseSelectEmployee") }]}
          >
            <Select
              showSearch
              options={employeeOptions}
              optionFilterProp="label"
              placeholder={t("hr.assets.selectEmployee")}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={activeAsset ? `${t("hr.assets.returnAsset")}: ${activeAsset.asset_code}` : t("hr.assets.returnAsset")}
        open={returnModalOpen}
        onCancel={() => {
          setReturnModalOpen(false);
          setActiveAsset(null);
          returnForm.resetFields();
        }}
        onOk={handleReturnAsset}
        okText={t("hr.assets.return")}
        confirmLoading={submitting}
      >
        <Form form={returnForm} layout="vertical">
          <Form.Item name="return_note" label={t("hr.assets.returnNote")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="condition_on_return" label={t("hr.assets.conditionOnReturn")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div >
  );
}
