import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Col, Descriptions, Empty, Input, Row, Space, Spin, Table, Tag, Typography } from "antd";
import type { InputRef } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ScanOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import { isApiError } from "../../../services/api/apiTypes";
import {
  lookupAssetByCode,
  type AssetLookupDamageReport,
  type AssetLookupResult,
  type AssetLookupReturnRequest,
} from "../../../services/api/assetsApi";

const statusColorMap: Record<string, string> = {
  AVAILABLE: "green",
  ASSIGNED: "blue",
  UNDER_MAINTENANCE: "gold",
  LOST: "red",
  DAMAGED: "volcano",
  RETIRED: "default",
};

const requestStatusColorMap: Record<string, string> = {
  PENDING_MANAGER: "orange",
  PENDING: "gold",
  PENDING_HR: "gold",
  PENDING_CEO: "purple",
  APPROVED: "green",
  PROCESSED: "blue",
  REJECTED: "red",
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : value;
}

export default function AssetLookupPage() {
  const { t, language } = useI18n();
  const inputRef = useRef<InputRef>(null);
  const [rawValue, setRawValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AssetLookupResult | null>(null);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus({ cursor: "all" }), 0);
  };

  useEffect(() => {
    focusInput();
  }, []);

  const runLookup = async (value: string) => {
    // HID scanners often emit trailing CR/LF/TAB — strip and trim.
    const code = value.replace(/[\r\n\t]/g, "").trim();
    if (!code) {
      setRawValue("");
      focusInput();
      return;
    }

    setLoading(true);
    setError(null);
    setNotFoundCode(null);
    try {
      const response = await lookupAssetByCode(code);
      if (isApiError(response)) {
        const status = (response as { status_code?: number }).status_code;
        if (status === 404 || /not found/i.test(response.message)) {
          setResult(null);
          setNotFoundCode(code);
        } else {
          setResult(null);
          setError(response.message || t("common.error"));
        }
      } else {
        setResult(response.data);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        setResult(null);
        setNotFoundCode(code);
      } else {
        setResult(null);
        setError(err?.response?.data?.message || err?.message || t("common.error"));
      }
    } finally {
      setLoading(false);
      setRawValue("");
      focusInput();
    }
  };

  const damageColumns: ColumnsType<AssetLookupDamageReport> = [
    {
      title: t("common.details"),
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (value: string) => <Tag color={requestStatusColorMap[value] || "default"}>{value}</Tag>,
    },
    {
      title: t("hr.assets.reportedAt", "Reported At"),
      dataIndex: "reported_at",
      key: "reported_at",
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
  ];

  const returnColumns: ColumnsType<AssetLookupReturnRequest> = [
    {
      title: t("common.notes"),
      dataIndex: "note",
      key: "note",
      ellipsis: true,
      render: (value?: string) => value || "-",
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (value: string) => <Tag color={requestStatusColorMap[value] || "default"}>{value}</Tag>,
    },
    {
      title: t("hr.assets.requestedAt", "Requested At"),
      dataIndex: "requested_at",
      key: "requested_at",
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("hr.assets.lookup.title")}
        subtitle={t("hr.assets.lookup.subtitle")}
      />

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="auto">
            <Input
              ref={inputRef}
              size="large"
              autoFocus
              allowClear
              prefix={<ScanOutlined />}
              placeholder={t("hr.assets.lookup.placeholder")}
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              onPressEnter={() => void runLookup(rawValue)}
              onBlur={focusInput}
              disabled={loading}
            />
          </Col>
          <Col>
            <Button
              type="primary"
              size="large"
              loading={loading}
              onClick={() => void runLookup(rawValue)}
            >
              {t("hr.assets.lookup.searchButton")}
            </Button>
          </Col>
        </Row>
      </Card>

      {loading && (
        <Card>
          <Space direction="vertical" align="center" style={{ width: "100%", padding: 24 }}>
            <Spin />
            <Typography.Text type="secondary">{t("hr.assets.lookup.loading")}</Typography.Text>
          </Space>
        </Card>
      )}

      {!loading && error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      )}

      {!loading && notFoundCode && (
        <Alert
          type="warning"
          showIcon
          message={t("hr.assets.lookup.notFound", { code: notFoundCode })}
          style={{ marginBottom: 16 }}
        />
      )}

      {!loading && !result && !notFoundCode && !error && (
        <Card>
          <Empty description={t("hr.assets.lookup.ready")} />
        </Card>
      )}

      {!loading && result && (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card title={t("hr.assets.lookup.assetDetails", "Asset Details")}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={t("assets.assetCode")}>
                <Typography.Text strong>{result.asset.asset_code}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t("common.name")}>
                {language === "ar"
                  ? result.asset.name_ar || result.asset.name_en || "-"
                  : result.asset.name_en || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("common.type")}>{result.asset.type || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("common.status")}>
                <Tag color={statusColorMap[result.asset.status] || "default"}>{result.asset.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("assets.serialNumber")}>
                {result.asset.serial_number || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("assets.vendor")}>{result.asset.vendor || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("assets.purchaseDate")}>
                {result.asset.purchase_date || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("assets.warrantyExpiry")}>
                {result.asset.warranty_expiry || "-"}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title={t("hr.assets.lookup.activeAssignment")}>
            {result.active_assignment ? (
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label={t("hr.assets.employee")}>
                  {result.active_assignment.employee.full_name}
                </Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.assignedEmployeeId")}>
                  {result.active_assignment.employee.employee_id}
                </Descriptions.Item>
                <Descriptions.Item label={t("common.department", "Department")}>
                  {result.active_assignment.employee.department || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("common.jobTitle", "Job Title")}>
                  {result.active_assignment.employee.job_title || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.assignedAt")}>
                  {formatDateTime(result.active_assignment.assigned_at)}
                </Descriptions.Item>
                <Descriptions.Item label={t("hr.assets.assignedBy", "Assigned By")}>
                  {result.active_assignment.assigned_by_name || "-"}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Empty description={t("hr.assets.lookup.noActiveAssignment")} />
            )}
          </Card>

          <Card title={`${t("hr.assets.lookup.recentDamageReports")} (${result.recent_damage_reports.length})`}>
            <Table
              rowKey="id"
              size="small"
              columns={damageColumns}
              dataSource={result.recent_damage_reports}
              pagination={false}
              locale={{ emptyText: t("hr.assets.noDamageReports", "No damage reports for this asset.") }}
            />
          </Card>

          <Card title={`${t("hr.assets.lookup.recentReturnRequests")} (${result.recent_return_requests.length})`}>
            <Table
              rowKey="id"
              size="small"
              columns={returnColumns}
              dataSource={result.recent_return_requests}
              pagination={false}
              locale={{ emptyText: t("hr.assets.noReturnRequests", "No return requests for this asset.") }}
            />
          </Card>
        </Space>
      )}
    </div>
  );
}
