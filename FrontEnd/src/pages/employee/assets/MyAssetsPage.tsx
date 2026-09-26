import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  message,
} from "antd";
import {
  EyeOutlined,
  LaptopOutlined,
  RollbackOutlined,
  ToolOutlined,
  UndoOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import { WorkspaceCard } from "../../../components/ui/workspace/Workspace";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import {
  listMyAssetDamageReports,
  listMyAssetReturnRequests,
  listMyAssets,
  reportAssetIssue,
  requestAssetReturn,
  type Asset,
  type AssetDamageReport,
  type AssetReturnRequest,
} from "../../../services/api/assetsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";
import {
  getDetailedApiMessage,
  getDetailedHttpErrorMessage,
} from "../../../services/api/userErrorMessages";

const statusColorMap: Record<string, string> = {
  AVAILABLE: "green",
  ASSIGNED: "blue",
  UNDER_MAINTENANCE: "gold",
  LOST: "red",
  DAMAGED: "volcano",
  RETIRED: "default",
};

const ASSET_STATUSES = Object.keys(statusColorMap);

const requestStatusColorMap: Record<string, string> = {
  PENDING_MANAGER: "orange",
  PENDING: "gold",
  PENDING_HR: "gold",
  PENDING_CEO: "purple",
  APPROVED: "green",
  PROCESSED: "blue",
  REJECTED: "red",
};

export default function MyAssetsPage() {
  const { t, language } = useI18n();
  const [apiMessage, contextHolder] = message.useMessage();
  const [assetLoading, setAssetLoading] = useState(true);
  const [requestLoading, setRequestLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(10);
  const [assetTotal, setAssetTotal] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reportForm] = Form.useForm();
  const [returnForm] = Form.useForm();
  const [returnOpen, setReturnOpen] = useState(false);

  const [requestAssetFilter, setRequestAssetFilter] = useState<
    number | undefined
  >();
  const [damageReports, setDamageReports] = useState<AssetDamageReport[]>([]);
  const [damagePage, setDamagePage] = useState(1);
  const [damagePageSize, setDamagePageSize] = useState(5);
  const [damageTotal, setDamageTotal] = useState(0);
  const [returnRequests, setReturnRequests] = useState<AssetReturnRequest[]>(
    [],
  );
  const [returnPage, setReturnPage] = useState(1);
  const [returnPageSize, setReturnPageSize] = useState(5);
  const [returnTotal, setReturnTotal] = useState(0);

  const getAssetDisplayName = (asset: Asset) =>
    language === "ar"
      ? asset.name_ar || asset.name_en || "-"
      : asset.name_en || asset.name_ar || "-";

  const loadAssets = async () => {
    setAssetLoading(true);
    try {
      const res = await listMyAssets({
        page: assetPage,
        page_size: assetPageSize,
        search: appliedSearch || undefined,
        type: typeFilter,
        status: statusFilter,
      });
      if (isApiError(res)) {
        setError(res.message || t("assets.loadFailed"));
        return;
      }
      setAssets(res.data.items || []);
      setAssetTotal(res.data.count || 0);
      setError(null);
    } catch (err: any) {
      setError(err?.message || t("assets.loadFailed"));
    } finally {
      setAssetLoading(false);
    }
  };

  const loadRequestHistory = async () => {
    setRequestLoading(true);
    try {
      const [damageRes, returnRes] = await Promise.all([
        listMyAssetDamageReports({
          page: damagePage,
          page_size: damagePageSize,
          asset: requestAssetFilter,
        }),
        listMyAssetReturnRequests({
          page: returnPage,
          page_size: returnPageSize,
          asset: requestAssetFilter,
        }),
      ]);

      if (isApiError(damageRes)) {
        setRequestError(
          damageRes.message || t("assets.requestHistoryUnavailable"),
        );
        return;
      }
      if (isApiError(returnRes)) {
        setRequestError(
          returnRes.message || t("assets.requestHistoryUnavailable"),
        );
        return;
      }

      setDamageReports(damageRes.data.items || []);
      setDamageTotal(damageRes.data.count || 0);
      setReturnRequests(returnRes.data.items || []);
      setReturnTotal(returnRes.data.count || 0);
      setRequestError(null);
    } catch (err: any) {
      setRequestError(err?.message || t("assets.requestHistoryUnavailable"));
    } finally {
      setRequestLoading(false);
    }
  };

  useEffect(() => {
    void loadAssets();
  }, [assetPage, assetPageSize, appliedSearch, typeFilter, statusFilter]);

  useEffect(() => {
    void loadRequestHistory();
  }, [
    damagePage,
    damagePageSize,
    returnPage,
    returnPageSize,
    requestAssetFilter,
  ]);

  const dataSource = useMemo(
    () => assets.map((item) => ({ ...item, key: item.id })),
    [assets],
  );
  const requestAssetOptions = useMemo(
    () =>
      assets.map((item) => ({
        label: `${item.asset_code} - ${getAssetDisplayName(item)}`,
        value: item.id,
      })),
    [assets, language],
  );

  const openDetails = (asset: Asset) => {
    setSelectedAsset(asset);
    setDetailsOpen(true);
  };

  const resetAssetFilters = () => {
    setSearchText("");
    setAppliedSearch("");
    setTypeFilter(undefined);
    setStatusFilter(undefined);
    setAssetPage(1);
  };

  const damageColumns: ColumnsType<AssetDamageReport> = [
    {
      title: t("assets.assetCode"),
      dataIndex: "asset_code",
      key: "asset_code",
      width: 140,
    },
    {
      title: t("common.details"),
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      responsive: ["md"],
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (value: string) => (
        <Tag color={requestStatusColorMap[value] || "default"}>
          {t(`assets.requestStatus.${value}`, value)}
        </Tag>
      ),
    },
    {
      title: t("assets.decision"),
      key: "decision",
      ellipsis: true,
      responsive: ["lg"],
      render: (_, record) =>
        record.ceo_decision_note || record.hr_decision_note || "-",
    },
  ];

  const returnColumns: ColumnsType<AssetReturnRequest> = [
    {
      title: t("assets.assetCode"),
      dataIndex: "asset_code",
      key: "asset_code",
      width: 140,
    },
    {
      title: t("common.notes"),
      dataIndex: "note",
      key: "note",
      ellipsis: true,
      responsive: ["md"],
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (value: string) => (
        <Tag color={requestStatusColorMap[value] || "default"}>
          {t(`assets.requestStatus.${value}`, value)}
        </Tag>
      ),
    },
    {
      title: t("assets.decision"),
      key: "decision",
      ellipsis: true,
      responsive: ["lg"],
      render: (_, record) =>
        record.ceo_decision_note ||
        record.hr_decision_note ||
        record.manager_decision_note ||
        "-",
    },
  ];

  const columns: ColumnsType<Asset> = [
    {
      title: t("assets.assetCode"),
      dataIndex: "asset_code",
      key: "asset_code",
      width: 140,
      render: (value: string) => <span className="ffi-code">{value}</span>,
    },
    {
      title: t("common.name"),
      key: "name",
      render: (_: unknown, record) => (
        <Button
          type="link"
          style={{ paddingInline: 0, fontWeight: 600 }}
          onClick={(e) => {
            e.stopPropagation();
            openDetails(record);
          }}
        >
          {getAssetDisplayName(record)}
        </Button>
      ),
    },
    {
      title: t("common.type"),
      dataIndex: "type",
      key: "type",
      width: 120,
      responsive: ["md"],
      render: (value: string) =>
        value === "VEHICLE"
          ? t("hr.assets.vehicle", "Vehicle")
          : value === "LAPTOP"
            ? t("hr.assets.laptop", "Laptop")
            : value === "OTHER"
              ? t("hr.assets.other", "Other")
              : value || "-",
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 160,
      render: (status: string) => (
        <Tag color={statusColorMap[status] || "default"}>
          {t(`assets.status.${status}`, status)}
        </Tag>
      ),
    },
    {
      title: t("assets.serialNumber"),
      dataIndex: "serial_number",
      key: "serial_number",
      width: 180,
      responsive: ["lg"],
      render: (value?: string) => value || "-",
    },
    {
      title: t("assets.warrantyExpiry"),
      dataIndex: "warranty_expiry",
      key: "warranty_expiry",
      width: 160,
      responsive: ["xl"],
      render: (value?: string | null) => value || "-",
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 340,
      render: (_, record) => (
        <Space size={4} style={{ whiteSpace: "nowrap" }}>
          <Button
            size="small"
            icon={<EyeOutlined aria-hidden="true" />}
            onClick={(e) => {
              e.stopPropagation();
              openDetails(record);
            }}
          >
            {t("common.view")}
          </Button>
          <Button
            size="small"
            type="text"
            icon={<ToolOutlined aria-hidden="true" />}
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
          <Button
            size="small"
            type="text"
            icon={<RollbackOutlined aria-hidden="true" />}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAsset(record);
              returnForm.resetFields();
              setReturnOpen(true);
            }}
          >
            {t("assets.returnRequest", "Return Request")}
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

      const response = await reportAssetIssue(selectedAsset.id, {
        description: payloadDescription,
      });
      if (isApiError(response)) {
        await apiMessage.error(
          getDetailedApiMessage(
            t,
            response.message,
            "assets.submitIssueFailed",
          ),
        );
        return;
      }

      await apiMessage.success(t("assets.submitIssueSuccess"));
      setReportOpen(false);
      reportForm.resetFields();
      setDamagePage(1);
      await Promise.all([loadAssets(), loadRequestHistory()]);
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(
          getDetailedHttpErrorMessage(t, err, "assets.submitIssueFailed"),
        );
      }
    } finally {
      setReporting(false);
    }
  };

  const handleReturnRequest = async () => {
    if (!selectedAsset) return;
    try {
      const values = await returnForm.validateFields();
      setReturning(true);
      const response = await requestAssetReturn(selectedAsset.id, {
        note: (values.note || "").trim(),
      });
      if (isApiError(response)) {
        await apiMessage.error(
          getDetailedApiMessage(
            t,
            response.message,
            "assets.submitIssueFailed",
          ),
        );
        return;
      }
      await apiMessage.success(
        t("assets.returnRequested", "Return request submitted"),
      );
      setReturnOpen(false);
      returnForm.resetFields();
      setReturnPage(1);
      await Promise.all([loadAssets(), loadRequestHistory()]);
    } catch (err: any) {
      if (!err?.errorFields) {
        await apiMessage.error(
          getDetailedHttpErrorMessage(t, err, "assets.submitIssueFailed"),
        );
      }
    } finally {
      setReturning(false);
    }
  };

  if (assetLoading && assets.length === 0 && !error) {
    return <LoadingState title={t("assets.loadingMyAssets")} lines={5} />;
  }
  if (error)
    return (
      <ErrorState
        title={t("assets.unableToLoad")}
        description={error}
        onRetry={() => void loadAssets()}
      />
    );

  const requestAssetFilterSelect = (
    <Select
      allowClear
      value={requestAssetFilter}
      className="ffi-toolbar__field"
      style={{ maxWidth: 360 }}
      placeholder={t("assets.allAssets", "All assets")}
      aria-label={t("assets.filterRequestsByAsset", "Filter by asset")}
      onChange={(value) => {
        setRequestAssetFilter(value);
        setDamagePage(1);
        setReturnPage(1);
      }}
      options={requestAssetOptions}
    />
  );

  const requestHistoryError = requestError ? (
    <div style={{ padding: 24 }}>
      <ErrorState
        title={t(
          "assets.requestHistoryUnavailable",
          "Unable to load request history",
        )}
        description={requestError}
        onRetry={() => void loadRequestHistory()}
      />
    </div>
  ) : null;

  const hasAssetFilters = Boolean(appliedSearch || typeFilter || statusFilter);

  const assetsView = (
    <WorkspaceCard
      toolbar={
        <>
          <Input.Search
            allowClear
            value={searchText}
            className="ffi-toolbar__search"
            placeholder={t(
              "assets.searchPlaceholder",
              "Search by asset code, serial number, or name",
            )}
            onChange={(e) => setSearchText(e.target.value)}
            onSearch={(value) => {
              setAppliedSearch(value.trim());
              setAssetPage(1);
            }}
          />
          <Select
            allowClear
            value={typeFilter}
            className="ffi-toolbar__field"
            placeholder={t("common.type")}
            aria-label={t("common.type")}
            onChange={(value) => {
              setTypeFilter(value);
              setAssetPage(1);
            }}
            options={[
              { label: t("hr.assets.vehicle", "Vehicle"), value: "VEHICLE" },
              { label: t("hr.assets.laptop", "Laptop"), value: "LAPTOP" },
              { label: t("hr.assets.other", "Other"), value: "OTHER" },
            ]}
          />
          <Select
            allowClear
            value={statusFilter}
            className="ffi-toolbar__field"
            placeholder={t("common.status")}
            aria-label={t("common.status")}
            onChange={(value) => {
              setStatusFilter(value);
              setAssetPage(1);
            }}
            options={ASSET_STATUSES.map((value) => ({
              label: t(`assets.status.${value}`, value),
              value,
            }))}
          />
          <Button
            type="text"
            icon={<UndoOutlined aria-hidden="true" />}
            className="ffi-toolbar__reset"
            disabled={!hasAssetFilters && !searchText}
            onClick={resetAssetFilters}
          >
            {t("common.reset")}
          </Button>
        </>
      }
      title={t("assets.myAssets")}
      count={t("assets.count", { count: assetTotal })}
      busy={assetLoading && assets.length > 0}
    >
      {assetTotal === 0 && !assetLoading ? (
        <div style={{ padding: 24 }}>
          <EmptyState
            title={t("assets.noAssets")}
            description={t("assets.noAssetsDesc")}
          />
        </div>
      ) : (
        <ResponsiveTable
          mobileCard={{
            titleKey: "name",
            extraKey: "status",
            actionsKey: "actions",
          }}
          columns={columns}
          dataSource={dataSource}
          loading={assetLoading}
          scroll={{ x: "max-content" }}
          pagination={{
            current: assetPage,
            pageSize: assetPageSize,
            total: assetTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setAssetPage(page);
              setAssetPageSize(pageSize);
            },
          }}
          onRow={(record) => ({
            onClick: () => openDetails(record),
            style: { cursor: "pointer" },
          })}
        />
      )}
    </WorkspaceCard>
  );

  const damageView = (
    <WorkspaceCard
      toolbar={requestAssetFilterSelect}
      title={t("assets.damageReports", "Damage Reports")}
      count={t("common.requestsCount", { count: damageTotal })}
      busy={requestLoading && damageReports.length > 0}
    >
      {requestHistoryError ?? (
        <ResponsiveTable
          mobileCard={{ titleKey: "asset_code", extraKey: "status" }}
          rowKey="id"
          columns={damageColumns}
          dataSource={damageReports}
          loading={requestLoading}
          scroll={{ x: "max-content" }}
          pagination={{
            current: damagePage,
            pageSize: damagePageSize,
            total: damageTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setDamagePage(page);
              setDamagePageSize(pageSize);
            },
          }}
        />
      )}
    </WorkspaceCard>
  );

  const returnView = (
    <WorkspaceCard
      toolbar={requestAssetFilterSelect}
      title={t("assets.returnRequests", "Return Requests")}
      count={t("common.requestsCount", { count: returnTotal })}
      busy={requestLoading && returnRequests.length > 0}
    >
      {requestHistoryError ?? (
        <ResponsiveTable
          mobileCard={{ titleKey: "asset_code", extraKey: "status" }}
          rowKey="id"
          columns={returnColumns}
          dataSource={returnRequests}
          loading={requestLoading}
          scroll={{ x: "max-content" }}
          pagination={{
            current: returnPage,
            pageSize: returnPageSize,
            total: returnTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setReturnPage(page);
              setReturnPageSize(pageSize);
            },
          }}
        />
      )}
    </WorkspaceCard>
  );

  return (
    <div>
      {contextHolder}
      <PageHeader
        title={t("assets.myAssets")}
        subtitle={t("assets.myAssetsDesc")}
      />

      <Tabs
        className="ffi-pill-tabs"
        items={[
          {
            key: "assets",
            icon: <LaptopOutlined aria-hidden="true" />,
            label: (
              <span>
                {t("assets.myAssets")}{" "}
                <span className="ffi-tab-count">{assetTotal}</span>
              </span>
            ),
            children: assetsView,
          },
          {
            key: "damage",
            icon: <WarningOutlined aria-hidden="true" />,
            label: (
              <span>
                {t("assets.damageReports", "Damage Reports")}{" "}
                <span className="ffi-tab-count">{damageTotal}</span>
              </span>
            ),
            children: damageView,
          },
          {
            key: "return",
            icon: <RollbackOutlined aria-hidden="true" />,
            label: (
              <span>
                {t("assets.returnRequests", "Return Requests")}{" "}
                <span className="ffi-tab-count">{returnTotal}</span>
              </span>
            ),
            children: returnView,
          },
        ]}
      />

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
        width="min(860px, 96vw)"
        style={{ top: 16 }}
      >
        {selectedAsset && (
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label={t("assets.assetCode")}>
              {selectedAsset.asset_code}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.name")}>
              {getAssetDisplayName(selectedAsset)}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.type")}>
              {selectedAsset.type || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.status")}>
              <Tag color={statusColorMap[selectedAsset.status] || "default"}>
                {selectedAsset.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("assets.serialNumber")}>
              {selectedAsset.serial_number || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("assets.vendor")}>
              {selectedAsset.vendor || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("assets.purchaseDate")}>
              {selectedAsset.purchase_date || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("assets.warrantyExpiry")}>
              {selectedAsset.warranty_expiry || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.notes")} span={2}>
              {selectedAsset.notes || "-"}
            </Descriptions.Item>

            {selectedAsset.type === "VEHICLE" && (
              <>
                <Descriptions.Item label={t("assets.plateNumber")}>
                  {selectedAsset.plate_number || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("assets.chassisNumber")}>
                  {selectedAsset.chassis_number || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("assets.engineNumber")}>
                  {selectedAsset.engine_number || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("assets.fuelType")}>
                  {selectedAsset.fuel_type || "-"}
                </Descriptions.Item>
              </>
            )}

            {selectedAsset.type === "LAPTOP" && (
              <>
                <Descriptions.Item label={t("assets.cpu")}>
                  {selectedAsset.cpu || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("assets.ram")}>
                  {selectedAsset.ram || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("assets.storage")}>
                  {selectedAsset.storage || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("assets.os")}>
                  {selectedAsset.operating_system || "-"}
                </Descriptions.Item>
              </>
            )}

            {selectedAsset.type === "OTHER" && (
              <>
                {selectedAsset.flexible_attributes &&
                Object.keys(selectedAsset.flexible_attributes).length > 0 ? (
                  Object.entries(selectedAsset.flexible_attributes).map(
                    ([title, value]) => {
                      const details =
                        value && typeof value === "object"
                          ? (value as Record<string, unknown>)
                          : {};
                      const valueType =
                        details.type === "date" ? "date" : "body";
                      const bodyValue =
                        typeof details.body === "string" ? details.body : null;
                      const dateValue =
                        typeof details.date === "string" ? details.date : null;
                      return (
                        <Descriptions.Item key={title} label={title} span={2}>
                          {valueType === "date"
                            ? dateValue || "-"
                            : bodyValue || "-"}
                        </Descriptions.Item>
                      );
                    },
                  )
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
        onOk={() => void handleSubmitIssue()}
        okText={t("assets.submitReport")}
        confirmLoading={reporting}
        width="min(520px, 96vw)"
        style={{ top: 16 }}
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
            rules={[
              { required: true, message: t("assets.provideIssueDetails") },
            ]}
          >
            <Input.TextArea rows={4} placeholder={t("assets.describeIssue")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${t("assets.returnRequest", "Return Request")}${selectedAsset ? `: ${selectedAsset.asset_code}` : ""}`}
        open={returnOpen}
        onCancel={() => {
          setReturnOpen(false);
          returnForm.resetFields();
        }}
        onOk={() => void handleReturnRequest()}
        okText={t("assets.returnRequest", "Return Request")}
        confirmLoading={returning}
        width="min(520px, 96vw)"
        style={{ top: 16 }}
      >
        <Form form={returnForm} layout="vertical">
          <Form.Item
            name="note"
            label={t("common.notes")}
            rules={[
              { required: true, message: t("assets.provideIssueDetails") },
            ]}
          >
            <Input.TextArea rows={3} placeholder={t("assets.describeIssue")} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
