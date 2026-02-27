import { useEffect, useMemo, useState } from "react";
import { Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import { listMyAssets, reportAssetIssue, type Asset } from "../../../services/api/assetsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";
import { getDetailedApiMessage, getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

const statusColorMap: Record<string, string> = {
  AVAILABLE: "green",
  ASSIGNED: "blue",
  UNDER_MAINTENANCE: "gold",
  LOST: "red",
  DAMAGED: "volcano",
  RETIRED: "default",
};

export default function MyAssetsPage() {
  const { t } = useI18n();
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
        setError(res.message || t("assets.loadFailed"));
        return;
      }
      setAssets(res.data.items || []);
    } catch (err: any) {
      setError(err?.message || t("assets.loadFailed"));
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
      title: t("assets.assetCode"),
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
      title: t("common.name"),
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
    { title: t("common.type"), dataIndex: "type", key: "type", width: 120 },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 180,
      render: (status: string) => <Tag color={statusColorMap[status] || "default"}>{status}</Tag>,
    },
    {
      title: t("assets.serialNumber"),
      dataIndex: "serial_number",
      key: "serial_number",
      width: 180,
      render: (value?: string) => value || "-",
    },
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
            {t("common.view")}
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
            {t("assets.report")}
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
        await apiMessage.error(getDetailedApiMessage(t, response.message, "assets.submitIssueFailed"));
        return;
      }

      await apiMessage.success(t("assets.submitIssueSuccess"));
      setReportOpen(false);
      reportForm.resetFields();
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(getDetailedHttpErrorMessage(t, err, "assets.submitIssueFailed"));
      }
    } finally {
      setReporting(false);
    }
  };

  if (loading) return <LoadingState title={t("assets.loadingMyAssets")} lines={5} />;
  if (error) return <ErrorState title={t("assets.unableToLoad")} description={error} onRetry={() => void loadData()} />;

  return (
    <div>
      {contextHolder}
      <PageHeader title={t("assets.myAssets")} subtitle={t("assets.myAssetsDesc")} />
      {assets.length === 0 ? (
        <EmptyState title={t("assets.noAssets")} description={t("assets.noAssetsDesc")} />
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
        title={`${t("assets.details")}${selectedAsset ? `: ${selectedAsset.asset_code}` : ""}`}
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
            {t("common.close")}
          </Button>,
        ]}
        width={860}
      >
        {selectedAsset && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label={t("assets.assetCode")}>{selectedAsset.asset_code}</Descriptions.Item>
            <Descriptions.Item label={t("common.name")}>{selectedAsset.name || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("common.type")}>{selectedAsset.type || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("common.status")}>
              <Tag color={statusColorMap[selectedAsset.status] || "default"}>{selectedAsset.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("assets.serialNumber")}>{selectedAsset.serial_number || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("assets.vendor")}>{selectedAsset.vendor || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("assets.purchaseDate")}>{selectedAsset.purchase_date || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("assets.warrantyExpiry")}>{selectedAsset.warranty_expiry || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("common.notes")} span={2}>{selectedAsset.notes || "-"}</Descriptions.Item>

            {selectedAsset.type === "VEHICLE" && (
              <>
                <Descriptions.Item label={t("assets.plateNumber")}>{selectedAsset.plate_number || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.chassisNumber")}>{selectedAsset.chassis_number || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.engineNumber")}>{selectedAsset.engine_number || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.fuelType")}>{selectedAsset.fuel_type || "-"}</Descriptions.Item>
              </>
            )}

            {selectedAsset.type === "LAPTOP" && (
              <>
                <Descriptions.Item label={t("assets.cpu")}>{selectedAsset.cpu || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.ram")}>{selectedAsset.ram || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.storage")}>{selectedAsset.storage || "-"}</Descriptions.Item>
                <Descriptions.Item label={t("assets.os")}>{selectedAsset.operating_system || "-"}</Descriptions.Item>
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
        title={`${t("assets.reportIssue")}${selectedAsset ? `: ${selectedAsset.asset_code}` : ""}`}
        open={reportOpen}
        onCancel={() => {
          setReportOpen(false);
          reportForm.resetFields();
        }}
        onOk={handleSubmitIssue}
        okText={t("assets.submitReport")}
        confirmLoading={reporting}
      >
        <Form form={reportForm} layout="vertical">
          <Form.Item
            name="report_type"
            label={t("assets.reportType")}
            rules={[{ required: true, message: t("assets.selectReportType") }]}
          >
            <Select
              options={[
                { label: t("assets.damage"), value: "DAMAGE" },
                { label: t("assets.lost"), value: "LOST" },
                { label: t("assets.other"), value: "OTHER" },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="description"
            label={t("common.details")}
            rules={[{ required: true, message: t("assets.provideIssueDetails") }]}
          >
            <Input.TextArea rows={4} placeholder={t("assets.describeIssue")} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
