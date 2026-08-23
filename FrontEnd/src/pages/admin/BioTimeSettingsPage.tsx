import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import {
  bioTimeApi,
  DEFAULT_SYNC_DAYS_BACK,
} from "../../services/api/bioTimeApi";
import type {
  BioTimeConfig,
  BioTimeConfigPayload,
  BioTimeEmployeeMap,
  BioTimeSyncResult,
  UnmappedBioTimeUser,
} from "../../services/api/bioTimeApi";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import { unwrapEnvelope } from "../../utils/dataUtils";
import { formatDateTime } from "../../utils/dateTime";
import { getFirstApiErrorMessage } from "../../utils/formErrors";

const { Title, Text } = Typography;

interface ConfigFormValues extends BioTimeConfigPayload {
  password?: string;
}

const MAPPING_PAGE_SIZE = 25;
const UNMAPPED_PAGE_SIZE = 25;
const EMPLOYEE_SEARCH_PAGE_SIZE = 50;
const EMPLOYEE_SEARCH_DEBOUNCE_MS = 350;

const resolveErrorMessage = (error: unknown, fallback: string): string =>
  getFirstApiErrorMessage(error) ||
  (error as { message?: string })?.message ||
  fallback;

const BioTimeSettingsPage: React.FC = () => {
  const { t, language } = useI18n();
  const [form] = Form.useForm<ConfigFormValues>();

  // ── Config ────────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<BioTimeConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Sync ──────────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [daysBack, setDaysBack] = useState<number>(DEFAULT_SYNC_DAYS_BACK);
  const [syncResult, setSyncResult] = useState<BioTimeSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ── Mappings ──────────────────────────────────────────────────────────────
  const [mappedUsers, setMappedUsers] = useState<BioTimeEmployeeMap[]>([]);
  const [mappedTotal, setMappedTotal] = useState(0);
  const [mappedPage, setMappedPage] = useState(1);
  const [mappedPageSize, setMappedPageSize] = useState(MAPPING_PAGE_SIZE);
  const [loadingMapped, setLoadingMapped] = useState(false);
  const [mappedError, setMappedError] = useState<string | null>(null);

  const [unmappedUsers, setUnmappedUsers] = useState<UnmappedBioTimeUser[]>([]);
  const [unmappedTotal, setUnmappedTotal] = useState(0);
  const [unmappedPage, setUnmappedPage] = useState(1);
  const [unmappedPageSize, setUnmappedPageSize] = useState(UNMAPPED_PAGE_SIZE);
  const [loadingUnmapped, setLoadingUnmapped] = useState(false);
  const [unmappedError, setUnmappedError] = useState<string | null>(null);

  const [systemEmployees, setSystemEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeSearchInput, setEmployeeSearchInput] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");

  const [selectedMappings, setSelectedMappings] = useState<
    Record<string, number | undefined>
  >({});
  const [mappingSubmits, setMappingSubmits] = useState<Record<string, boolean>>(
    {},
  );
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const employeeSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const data = await bioTimeApi.getConfig();
      setConfig(data);
      // The backend never returns the password: keep the input blank so an
      // untouched form preserves the stored credential on save.
      form.setFieldsValue({
        server_ip: data.server_ip ?? "",
        server_port: data.server_port ?? "",
        username: data.username ?? "",
        is_active: Boolean(data.is_active),
        password: "",
      });
      setConfigError(null);
    } catch (error) {
      setConfigError(
        resolveErrorMessage(error, t("bioTime.errors.loadConfig")),
      );
    } finally {
      setLoadingConfig(false);
    }
  }, [form, t]);

  const loadMappings = useCallback(
    async (page: number, pageSize: number) => {
      setLoadingMapped(true);
      try {
        const result = await bioTimeApi.getMappings({
          page,
          page_size: pageSize,
        });
        setMappedUsers(result.items);
        setMappedTotal(result.count);
        setMappedError(null);
      } catch (error) {
        setMappedUsers([]);
        setMappedTotal(0);
        setMappedError(
          resolveErrorMessage(error, t("bioTime.errors.loadMappings")),
        );
      } finally {
        setLoadingMapped(false);
      }
    },
    [t],
  );

  const loadUnmapped = useCallback(
    async (page: number, pageSize: number) => {
      setLoadingUnmapped(true);
      try {
        const result = await bioTimeApi.getUnmappedUsers({
          page,
          page_size: pageSize,
        });
        setUnmappedUsers(result.items);
        setUnmappedTotal(result.count);
        setUnmappedError(null);
      } catch (error) {
        setUnmappedUsers([]);
        setUnmappedTotal(0);
        setUnmappedError(
          resolveErrorMessage(error, t("bioTime.errors.loadUnmapped")),
        );
      } finally {
        setLoadingUnmapped(false);
      }
    },
    [t],
  );

  const loadEmployees = useCallback(async (search: string) => {
    setLoadingEmployees(true);
    try {
      const response = await listEmployees({
        search: search || undefined,
        page_size: EMPLOYEE_SEARCH_PAGE_SIZE,
      });
      const payload = unwrapEnvelope(response);
      setSystemEmployees(
        Array.isArray(payload?.results) ? payload.results : [],
      );
    } catch {
      setSystemEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    loadMappings(mappedPage, mappedPageSize);
  }, [loadMappings, mappedPage, mappedPageSize]);

  useEffect(() => {
    loadUnmapped(unmappedPage, unmappedPageSize);
  }, [loadUnmapped, unmappedPage, unmappedPageSize]);

  useEffect(() => {
    loadEmployees(employeeSearch);
  }, [loadEmployees, employeeSearch]);

  useEffect(() => {
    if (employeeSearchTimer.current) clearTimeout(employeeSearchTimer.current);
    employeeSearchTimer.current = setTimeout(() => {
      setEmployeeSearch(employeeSearchInput.trim());
    }, EMPLOYEE_SEARCH_DEBOUNCE_MS);
    return () => {
      if (employeeSearchTimer.current)
        clearTimeout(employeeSearchTimer.current);
    };
  }, [employeeSearchInput]);

  const refreshMappingData = useCallback(async () => {
    await Promise.all([
      loadMappings(mappedPage, mappedPageSize),
      loadUnmapped(unmappedPage, unmappedPageSize),
    ]);
  }, [
    loadMappings,
    loadUnmapped,
    mappedPage,
    mappedPageSize,
    unmappedPage,
    unmappedPageSize,
  ]);

  // ── Config actions ────────────────────────────────────────────────────────
  const handleSaveConfig = async (values: ConfigFormValues) => {
    setSavingConfig(true);
    try {
      const payload: BioTimeConfigPayload = {
        server_ip: values.server_ip,
        server_port: values.server_port,
        username: values.username,
        is_active: Boolean(values.is_active),
      };
      // Only send the password when the user typed one; an omitted password
      // preserves the stored value server-side.
      const typedPassword = (values.password || "").trim();
      if (typedPassword) payload.password = typedPassword;

      const saved = await bioTimeApi.updateConfig(payload);
      setConfig(saved);
      form.setFieldsValue({ password: "" });
      message.success(t("bioTime.success.saveConfig"));
    } catch (error) {
      message.error(resolveErrorMessage(error, t("bioTime.errors.saveConfig")));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await bioTimeApi.syncNow(
        daysBack || DEFAULT_SYNC_DAYS_BACK,
      );
      setSyncResult(result);
      message.success(result.message || t("bioTime.success.sync"));
      // last_sync_time only changes server-side, so re-read the config.
      await loadConfig();
      await refreshMappingData();
    } catch (error) {
      const msg = resolveErrorMessage(error, t("bioTime.errors.sync"));
      setSyncResult(null);
      setSyncError(msg);
      message.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  // ── Mapping actions ───────────────────────────────────────────────────────
  const handleMapEmployee = async (
    empCode: string,
    employeeProfileId: number,
  ) => {
    setMappingSubmits((prev) => ({ ...prev, [empCode]: true }));
    setMappingError(null);
    try {
      await bioTimeApi.createMapping({
        biotime_emp_code: empCode,
        employee_profile: employeeProfileId,
      });
      setSelectedMappings((prev) => ({ ...prev, [empCode]: undefined }));
      message.success(t("bioTime.success.map"));
      await refreshMappingData();
    } catch (error) {
      const msg = resolveErrorMessage(error, t("bioTime.errors.map"));
      setMappingError(msg);
      message.error(msg);
    } finally {
      setMappingSubmits((prev) => ({ ...prev, [empCode]: false }));
    }
  };

  const handleDeleteMapping = async (id: number) => {
    setUnlinkingId(id);
    setMappingError(null);
    try {
      await bioTimeApi.deleteMapping(id);
      message.success(t("bioTime.success.unmap"));
      await refreshMappingData();
    } catch (error) {
      const msg = resolveErrorMessage(error, t("bioTime.errors.unmap"));
      setMappingError(msg);
      message.error(msg);
    } finally {
      setUnlinkingId(null);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const employeeName = useCallback(
    (employee: Employee) => {
      const localized =
        language === "ar" ? employee.full_name_ar : employee.full_name_en;
      return (
        localized ||
        employee.full_name_en ||
        employee.full_name ||
        employee.email ||
        `#${employee.id}`
      );
    },
    [language],
  );

  /** Employees already mapped (current page) or picked for another device row. */
  const takenEmployeeIds = useMemo(() => {
    const taken = new Set<number>();
    mappedUsers.forEach((mapping) => {
      if (typeof mapping.employee_profile === "number")
        taken.add(mapping.employee_profile);
    });
    return taken;
  }, [mappedUsers]);

  const employeeOptions = useMemo(
    () =>
      systemEmployees.map((employee) => ({
        value: employee.id,
        label: `${employee.employee_number || employee.employee_id} - ${employeeName(employee)}`,
      })),
    [systemEmployees, employeeName],
  );

  const optionsForRow = useCallback(
    (empCode: string) => {
      const pickedElsewhere = new Set<number>();
      Object.entries(selectedMappings).forEach(([code, employeeId]) => {
        if (code !== empCode && typeof employeeId === "number")
          pickedElsewhere.add(employeeId);
      });
      return employeeOptions.map((option) => ({
        ...option,
        disabled:
          takenEmployeeIds.has(option.value) ||
          pickedElsewhere.has(option.value),
      }));
    },
    [employeeOptions, selectedMappings, takenEmployeeIds],
  );

  // ── Columns ───────────────────────────────────────────────────────────────
  const unmappedColumns: ColumnsType<UnmappedBioTimeUser> = [
    {
      title: t("bioTime.fields.empCode"),
      dataIndex: "emp_code",
      key: "emp_code",
      width: 140,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: t("common.employeeName"),
      key: "name",
      render: (_: unknown, record: UnmappedBioTimeUser) =>
        `${record.first_name || ""} ${record.last_name || ""}`.trim() || "-",
    },
    {
      title: t("common.department"),
      dataIndex: "department",
      key: "department",
      render: (value: string) => value || "-",
    },
    {
      title: t("bioTime.actions.mapTo"),
      key: "map",
      width: 380,
      render: (_: unknown, record: UnmappedBioTimeUser) => (
        <Space wrap>
          <Select
            showSearch
            allowClear
            filterOption={false}
            loading={loadingEmployees}
            notFoundContent={
              loadingEmployees ? <Spin size="small" /> : undefined
            }
            placeholder={t("bioTime.placeholders.selectEmployee")}
            aria-label={t("bioTime.actions.mapTo")}
            style={{ width: 250 }}
            value={selectedMappings[record.emp_code]}
            onSearch={setEmployeeSearchInput}
            onChange={(value) =>
              setSelectedMappings((prev) => ({
                ...prev,
                [record.emp_code]: value,
              }))
            }
            options={optionsForRow(record.emp_code)}
          />
          <Button
            type="primary"
            disabled={!selectedMappings[record.emp_code]}
            loading={mappingSubmits[record.emp_code]}
            onClick={() => {
              const employeeProfileId = selectedMappings[record.emp_code];
              if (employeeProfileId)
                handleMapEmployee(record.emp_code, employeeProfileId);
            }}
          >
            {t("common.link")}
          </Button>
        </Space>
      ),
    },
  ];

  const mappedColumns: ColumnsType<BioTimeEmployeeMap> = [
    {
      title: t("bioTime.fields.empCode"),
      dataIndex: "biotime_emp_code",
      key: "biotime_emp_code",
      width: 140,
      render: (value: string) => <Tag color="green">{value}</Tag>,
    },
    {
      title: t("common.employeeName"),
      dataIndex: "employee_name",
      key: "employee_name",
      render: (value: string) => value || "-",
    },
    {
      title: t("common.department"),
      dataIndex: "department",
      key: "department",
      render: (value: string) => value || "-",
    },
    {
      title: t("bioTime.fields.linkedAt"),
      dataIndex: "created_at",
      key: "created_at",
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 140,
      render: (_: unknown, record: BioTimeEmployeeMap) => (
        <Popconfirm
          title={t("bioTime.confirm.unlinkTitle")}
          description={t("bioTime.confirm.unlinkDescription", {
            code: record.biotime_emp_code,
          })}
          okText={t("common.unlink")}
          okButtonProps={{ danger: true }}
          cancelText={t("common.cancel")}
          onConfirm={() => handleDeleteMapping(record.id)}
        >
          <Button danger size="small" loading={unlinkingId === record.id}>
            {t("common.unlink")}
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const configTab = (
    <>
      {configError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={configError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={loadConfig}>
              {t("common.retry")}
            </Button>
          }
        />
      )}

      {loadingConfig ? (
        <Spin />
      ) : (
        <Form form={form} layout="vertical" onFinish={handleSaveConfig}>
          <Form.Item
            name="server_ip"
            label={t("bioTime.fields.serverIp")}
            rules={[
              {
                required: true,
                message: t("bioTime.validation.serverIpRequired"),
              },
            ]}
          >
            <Input placeholder="192.168.1.250" />
          </Form.Item>

          <Form.Item
            name="server_port"
            label={t("bioTime.fields.serverPort")}
            rules={[
              {
                required: true,
                message: t("bioTime.validation.serverPortRequired"),
              },
            ]}
          >
            <Input placeholder="80" />
          </Form.Item>

          <Form.Item
            name="username"
            label={t("bioTime.fields.username")}
            rules={[
              {
                required: true,
                message: t("bioTime.validation.usernameRequired"),
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="password"
            label={t("bioTime.fields.password")}
            extra={t("bioTime.hints.passwordUnchanged")}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={t("bioTime.placeholders.password")}
            />
          </Form.Item>

          <Form.Item
            name="is_active"
            label={t("bioTime.fields.isActive")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Space wrap>
            <Button type="primary" htmlType="submit" loading={savingConfig}>
              {t("common.save")}
            </Button>
          </Space>
        </Form>
      )}

      <Card
        size="small"
        style={{ marginTop: 24 }}
        title={t("bioTime.titles.manualSync")}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          The BioTime office agent performs synchronization from inside the
          office network. AWS cannot directly test or sync the private device.
        </Text>

        <Space wrap align="end" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ marginBottom: 4 }}>
              <Text>{t("bioTime.fields.daysBack")}</Text>
            </div>
            <InputNumber
              min={1}
              max={90}
              value={daysBack}
              onChange={(value) =>
                setDaysBack(
                  typeof value === "number" ? value : DEFAULT_SYNC_DAYS_BACK,
                )
              }
              aria-label={t("bioTime.fields.daysBack")}
            />
          </div>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            loading={syncing}
            onClick={handleSyncNow}
            disabled
          >
            {t("bioTime.actions.syncNow")}
          </Button>
        </Space>

        <div style={{ marginBottom: syncResult || syncError ? 12 : 0 }}>
          <Text type="secondary">
            {t("bioTime.fields.lastSyncTime")}:{" "}
            {config?.last_sync_time
              ? formatDateTime(config.last_sync_time)
              : t("bioTime.never")}
          </Text>
        </div>

        {syncError && <Alert type="error" showIcon message={syncError} />}

        {syncResult && !syncError && (
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, sm: 2, md: 3 }}
            title={t("bioTime.titles.syncResult")}
          >
            <Descriptions.Item label={t("bioTime.sync.processed")}>
              {syncResult.summary.processed}
            </Descriptions.Item>
            <Descriptions.Item label={t("bioTime.sync.created")}>
              {syncResult.summary.created}
            </Descriptions.Item>
            <Descriptions.Item label={t("bioTime.sync.updated")}>
              {syncResult.summary.updated}
            </Descriptions.Item>
            <Descriptions.Item label={t("bioTime.sync.skipped")}>
              {syncResult.summary.skipped}
            </Descriptions.Item>
            <Descriptions.Item label={t("bioTime.sync.unmapped")}>
              {syncResult.summary.unmapped}
            </Descriptions.Item>
            <Descriptions.Item label={t("bioTime.sync.invalid")}>
              {syncResult.summary.invalid}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>
    </>
  );

  const mappingsTab = (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button
          icon={<ReloadOutlined />}
          onClick={refreshMappingData}
          loading={loadingMapped || loadingUnmapped}
        >
          {t("common.refresh")}
        </Button>
        <Input.Search
          allowClear
          placeholder={t("bioTime.placeholders.searchEmployees")}
          value={employeeSearchInput}
          onChange={(event) => setEmployeeSearchInput(event.target.value)}
          onSearch={(value) => setEmployeeSearch(value.trim())}
          style={{ width: 280 }}
          loading={loadingEmployees}
        />
      </Space>

      {mappingError && (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message={t("bioTime.errors.mappingTitle")}
          description={mappingError}
          onClose={() => setMappingError(null)}
        />
      )}

      <Title level={4}>{t("bioTime.titles.unmapped")}</Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        {t("bioTime.descriptions.unmapped")}
      </Text>

      {unmappedError ? (
        <Alert
          type="error"
          showIcon
          message={unmappedError}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => loadUnmapped(unmappedPage, unmappedPageSize)}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <Table
          dataSource={unmappedUsers}
          columns={unmappedColumns}
          rowKey="emp_code"
          loading={loadingUnmapped}
          size="small"
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: <Empty description={t("bioTime.empty.unmapped")} />,
          }}
          pagination={{
            current: unmappedPage,
            pageSize: unmappedPageSize,
            total: unmappedTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setUnmappedPage(page);
              setUnmappedPageSize(pageSize);
            },
          }}
        />
      )}

      <Title level={4} style={{ marginTop: 40 }}>
        {t("bioTime.titles.mapped")}
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        {t("bioTime.descriptions.mapped")}
      </Text>

      {mappedError ? (
        <Alert
          type="error"
          showIcon
          message={mappedError}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => loadMappings(mappedPage, mappedPageSize)}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <Table
          dataSource={mappedUsers}
          columns={mappedColumns}
          rowKey="id"
          loading={loadingMapped}
          size="small"
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: <Empty description={t("bioTime.empty.mapped")} />,
          }}
          pagination={{
            current: mappedPage,
            pageSize: mappedPageSize,
            total: mappedTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setMappedPage(page);
              setMappedPageSize(pageSize);
            },
          }}
        />
      )}
    </div>
  );

  return (
    <Card title={t("bioTime.pageTitle")}>
      <Tabs
        defaultActiveKey="config"
        items={[
          {
            key: "config",
            label: t("bioTime.tabs.config"),
            children: configTab,
          },
          {
            key: "mapping",
            label: t("bioTime.tabs.mapping"),
            children: mappingsTab,
          },
        ]}
      />
    </Card>
  );
};

export default BioTimeSettingsPage;
