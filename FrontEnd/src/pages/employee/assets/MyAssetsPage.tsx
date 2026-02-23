import { useEffect, useMemo, useState } from "react";
import { Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import { listMyAssets, reportAssetIssue, type Asset } from "../../../services/api/assetsApi";
import { isApiError } from "../../../services/api/apiTypes";

const statusColorMap: Record<string, string> = {
  AVAILABLE: "green",
  ASSIGNED: "blue",
  UNDER_MAINTENANCE: "gold",
  LOST: "red",
  DAMAGED: "volcano",
  RETIRED: "default",
};

export default function MyAssetsPage() {
  const [apiMessage, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportForm] = Form.useForm();

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listMyAssets({ page: 1, page_size: 25 });
      if (isApiError(res)) {
        setError(res.message || "Failed to load your assets.");
        return;
      }
      setAssets(res.data.items || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load your assets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const dataSource = useMemo(() => assets.map((item) => ({ ...item, key: item.id })), [assets]);
  const openDetails = (asset: Asset) => {
    setSelectedAsset(asset);
    setDetailsOpen(true);
  };

  const columns: ColumnsType<Asset> = [
    {
      title: "Asset Code",
      dataIndex: "asset_code",
      key: "asset_code",
      width: 140,
      render: (value: string, record) => (
        <Button
          type="link"
          style={{ paddingInline: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            openDetails(record);
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
          onClick={(e) => {
            e.stopPropagation();
            openDetails(record);
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
    {
      title: "Serial Number",
      dataIndex: "serial_number",
      key: "serial_number",
      width: 180,
      render: (value?: string) => value || "-",
    },
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
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openDetails(record);
            }}
          >
            View
          </Button>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAsset(record);
              reportForm.resetFields();
              reportForm.setFieldsValue({ report_type: "DAMAGE" });
              setReportOpen(true);
            }}
          >
            Report
          </Button>
        </Space>
      ),
    },
  ];

  const handleSubmitIssue = async () => {
    if (!selectedAsset) return;
    try {
      const values = await reportForm.validateFields();
      setReporting(true);
      const reportType = values.report_type as "DAMAGE" | "LOST" | "OTHER";
      const description = (values.description || "").trim();
      const payloadDescription = `[${reportType}] ${description}`;

      const response = await reportAssetIssue(selectedAsset.id, { description: payloadDescription });
      if (isApiError(response)) {
        await apiMessage.error(response.message || "Failed to submit issue report.");
        return;
      }

      await apiMessage.success("Issue reported successfully.");
      setReportOpen(false);
      reportForm.resetFields();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(err?.message || "Failed to submit issue report.");
      }
    } finally {
      setReporting(false);
    }
  };

  if (loading) return <LoadingState title="Loading my assets" lines={5} />;
  if (error) return <ErrorState title="Unable to load assets" description={error} onRetry={() => void loadData()} />;

  return (
    <div>
      {contextHolder}
      <PageHeader title="My Assets" subtitle="Assets currently assigned to you." />
      {assets.length === 0 ? (
        <EmptyState title="No assigned assets" description="You currently have no active asset assignments." />
      ) : (
        <Card>
          <Table
            columns={columns}
            dataSource={dataSource}
            pagination={false}
            scroll={{ x: 1000 }}
            onRow={(record) => ({
              onClick: () => openDetails(record),
              style: { cursor: "pointer" },
            })}
          />
        </Card>
      )}

      <Modal
        title={`Asset Details${selectedAsset ? `: ${selectedAsset.asset_code}` : ""}`}
        open={detailsOpen}
        onCancel={() => {
          setDetailsOpen(false);
          setSelectedAsset(null);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setDetailsOpen(false);
              setSelectedAsset(null);
            }}
          >
            Close
          </Button>,
        ]}
        width={860}
      >
        {selectedAsset && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="Asset Code">{selectedAsset.asset_code}</Descriptions.Item>
            <Descriptions.Item label="Name">{selectedAsset.name || "-"}</Descriptions.Item>
            <Descriptions.Item label="Type">{selectedAsset.type || "-"}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={statusColorMap[selectedAsset.status] || "default"}>{selectedAsset.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Serial Number">{selectedAsset.serial_number || "-"}</Descriptions.Item>
            <Descriptions.Item label="Vendor">{selectedAsset.vendor || "-"}</Descriptions.Item>
            <Descriptions.Item label="Purchase Date">{selectedAsset.purchase_date || "-"}</Descriptions.Item>
            <Descriptions.Item label="Warranty Expiry">{selectedAsset.warranty_expiry || "-"}</Descriptions.Item>
            <Descriptions.Item label="Notes" span={2}>{selectedAsset.notes || "-"}</Descriptions.Item>

            {selectedAsset.type === "VEHICLE" && (
              <>
                <Descriptions.Item label="Plate Number">{selectedAsset.plate_number || "-"}</Descriptions.Item>
                <Descriptions.Item label="Chassis Number">{selectedAsset.chassis_number || "-"}</Descriptions.Item>
                <Descriptions.Item label="Engine Number">{selectedAsset.engine_number || "-"}</Descriptions.Item>
                <Descriptions.Item label="Fuel Type">{selectedAsset.fuel_type || "-"}</Descriptions.Item>
              </>
            )}

            {selectedAsset.type === "LAPTOP" && (
              <>
                <Descriptions.Item label="CPU">{selectedAsset.cpu || "-"}</Descriptions.Item>
                <Descriptions.Item label="RAM">{selectedAsset.ram || "-"}</Descriptions.Item>
                <Descriptions.Item label="Storage">{selectedAsset.storage || "-"}</Descriptions.Item>
                <Descriptions.Item label="Operating System">{selectedAsset.operating_system || "-"}</Descriptions.Item>
              </>
            )}

            {selectedAsset.type === "OTHER" && (
              <>
                {selectedAsset.flexible_attributes && Object.keys(selectedAsset.flexible_attributes).length > 0 ? (
                  Object.entries(selectedAsset.flexible_attributes).map(([title, value]) => {
                    const details = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
                    const valueType = details.type === "date" ? "date" : "body";
                    const bodyValue = typeof details.body === "string" ? details.body : null;
                    const dateValue = typeof details.date === "string" ? details.date : null;
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
        title={`Report Issue${selectedAsset ? `: ${selectedAsset.asset_code}` : ""}`}
        open={reportOpen}
        onCancel={() => {
          setReportOpen(false);
          reportForm.resetFields();
        }}
        onOk={handleSubmitIssue}
        okText="Submit Report"
        confirmLoading={reporting}
      >
        <Form form={reportForm} layout="vertical">
          <Form.Item
            name="report_type"
            label="Report Type"
            rules={[{ required: true, message: "Please select report type." }]}
          >
            <Select
              options={[
                { label: "Damage", value: "DAMAGE" },
                { label: "Lost", value: "LOST" },
                { label: "Other", value: "OTHER" },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="description"
            label="Details"
            rules={[{ required: true, message: "Please provide issue details." }]}
          >
            <Input.TextArea rows={4} placeholder="Describe the issue..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
