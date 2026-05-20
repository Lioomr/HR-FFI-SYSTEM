import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { isApiError } from "../../services/api/apiTypes";
import {
  listDelegationCandidates,
  type DelegationCandidate,
} from "../../services/api/employeesApi";
import {
  createDelegationRule,
  deleteDelegationRule,
  listDelegationRules,
  updateDelegationRule,
  type DelegationRuleDto,
} from "../../services/api/delegationApi";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTime } from "../../utils/dateTime";

type FormValues = {
  from_user_id: number;
  to_user_id: number;
  start_at: dayjs.Dayjs;
  end_at?: dayjs.Dayjs;
  reason?: string;
  is_active: boolean;
};

type UiMode = "loading" | "error" | "ok";

function formatCandidate(candidate: DelegationCandidate) {
  const name =
    candidate.full_name_en || candidate.full_name || candidate.employee_id;
  const company = candidate.company_name ? ` - ${candidate.company_name}` : "";
  const disabledReason = candidate.disabled_reason
    ? ` - ${candidate.disabled_reason}`
    : "";
  return `${name} (${candidate.employee_id})${company}${disabledReason}`;
}

export default function DelegationRulesPage() {
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [mode, setMode] = useState<UiMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DelegationRuleDto[]>([]);
  const [candidates, setCandidates] = useState<DelegationCandidate[]>([]);

  const loadData = useCallback(async () => {
    setMode("loading");
    setError(null);
    setUnauthorized(false);
    try {
      const [rulesRes, candidatesRes] = await Promise.all([
        listDelegationRules(),
        listDelegationCandidates({ scope: "all" }),
      ]);
      if (isApiError(rulesRes)) {
        setError(rulesRes.message || "Failed to load delegation rules.");
        setMode("error");
        return;
      }
      if (isApiError(candidatesRes)) {
        setError(candidatesRes.message || "Failed to load users.");
        setMode("error");
        return;
      }
      setRows(rulesRes.data.items || []);
      setCandidates(candidatesRes.data || []);
      setMode("ok");
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      setError(err?.message || "Failed to load delegation rules.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const userOptions = useMemo(
    () =>
      candidates.map((candidate) => ({
        label: formatCandidate(candidate),
        value:
          candidate.id ?? `employee-profile-${candidate.employee_profile_id}`,
        disabled: !candidate.can_delegate,
      })),
    [candidates],
  );

  const columns: ColumnsType<DelegationRuleDto> = [
    {
      title: t("common.from", "From"),
      dataIndex: "from_user",
      key: "from_user",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {record.from_user.full_name || record.from_user.email}
          </div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            {record.from_user.email}
          </div>
        </div>
      ),
    },
    {
      title: t("common.to", "To"),
      dataIndex: "to_user",
      key: "to_user",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {record.to_user.full_name || record.to_user.email}
          </div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            {record.to_user.email}
          </div>
        </div>
      ),
    },
    {
      title: t("common.period", "Period"),
      key: "period",
      render: (_, record) => (
        <div>
          <div>{formatDateTime(record.start_at)}</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            {record.end_at
              ? formatDateTime(record.end_at)
              : t("common.noEndDate", "No end date")}
          </div>
        </div>
      ),
    },
    {
      title: t("common.status"),
      dataIndex: "is_active",
      key: "is_active",
      render: (isActive: boolean, record) => (
        <Space>
          <Tag color={isActive ? "green" : "default"}>
            {isActive ? t("status.active") : t("status.inactive")}
          </Tag>
          <Switch
            size="small"
            checked={isActive}
            onChange={async (checked) => {
              try {
                const res = await updateDelegationRule(record.id, {
                  is_active: checked,
                });
                if (isApiError(res)) {
                  message.error(res.message || t("error.generic"));
                  return;
                }
                setRows((prev) =>
                  prev.map((item) => (item.id === record.id ? res.data : item)),
                );
              } catch (err: any) {
                message.error(err?.message || t("error.generic"));
              }
            }}
          />
        </Space>
      ),
    },
    {
      title: t("common.reason", "Reason"),
      dataIndex: "reason",
      key: "reason",
      render: (reason?: string) =>
        reason || (
          <span style={{ color: "#94a3b8" }}>
            {t("common.notAvailable", "Not provided")}
          </span>
        ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 120,
      render: (_, record) => (
        <Popconfirm
          title={t("common.delete", "Delete")}
          description={t(
            "delegation.deleteConfirm",
            "Remove this alternative employee option?",
          )}
          onConfirm={async () => {
            try {
              const res = await deleteDelegationRule(record.id);
              if (isApiError(res)) {
                message.error(res.message || t("error.generic"));
                return;
              }
              setRows((prev) => prev.filter((item) => item.id !== record.id));
              message.success(t("common.delete", "Deleted"));
            } catch (err: any) {
              message.error(err?.message || t("error.generic"));
            }
          }}
        >
          <Button danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  async function handleCreate(values: FormValues) {
    setSaving(true);
    try {
      const res = await createDelegationRule({
        from_user_id: values.from_user_id,
        to_user_id: values.to_user_id,
        start_at: values.start_at.toISOString(),
        end_at: values.end_at?.toISOString() || null,
        reason: values.reason || "",
        is_active: values.is_active,
      });
      if (isApiError(res)) {
        message.error(res.message || t("error.generic"));
        return;
      }
      setRows((prev) => [res.data, ...prev]);
      setOpen(false);
      form.resetFields();
      message.success(
        t("delegation.createSuccess", "Alternative employee option created."),
      );
    } catch (err: any) {
      message.error(err?.message || t("error.generic"));
    } finally {
      setSaving(false);
    }
  }

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading")
    return (
      <LoadingState
        title={t("delegation.loading", "Loading alternative employee options")}
      />
    );
  if (mode === "error") {
    return (
      <ErrorState
        title={t(
          "delegation.loadFailed",
          "Alternative employee options unavailable",
        )}
        description={error || t("delegation.tryAgain", "Please try again.")}
        onRetry={loadData}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t("delegation.title", "Alternative Employee Option")}
        subtitle={t(
          "delegation.subtitle",
          "Reassign workflow responsibilities during absence or temporary coverage.",
        )}
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
          >
            {t("delegation.create", "New alternative employee")}
          </Button>
        }
      />

      <Card style={{ borderRadius: 16 }}>
        <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
          <Typography.Text strong>
            {t("delegation.summaryTitle", "Active approval handovers")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t(
              "delegation.summaryBody",
              "Options here are applied by the shared workflow engine to manager and role-based approval assignments.",
            )}
          </Typography.Text>
        </Space>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{
            emptyText: t(
              "delegation.empty",
              "No alternative employee options yet.",
            ),
          }}
          scroll={{ x: "max-content" }}
        />
      </Card>

      <Modal
        open={open}
        title={t("delegation.create", "New alternative employee")}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={t("common.save")}
        width="min(520px, 96vw)"
        style={{ top: 16 }}
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{ is_active: true, start_at: dayjs() }}
          onFinish={handleCreate}
        >
          <Form.Item
            name="from_user_id"
            label={t("common.from", "From")}
            rules={[
              {
                required: true,
                message: t(
                  "delegation.fromRequired",
                  "Choose the original approver.",
                ),
              },
            ]}
          >
            <Select showSearch options={userOptions} optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="to_user_id"
            label={t("common.to", "To")}
            rules={[
              {
                required: true,
                message: t(
                  "delegation.toRequired",
                  "Choose the alternative employee.",
                ),
              },
            ]}
          >
            <Select showSearch options={userOptions} optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="start_at"
            label={t("common.startDate", "Start")}
            rules={[
              {
                required: true,
                message: t("delegation.startRequired", "Choose a start date."),
              },
            ]}
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="end_at" label={t("common.endDate", "End")}>
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label={t("common.reason", "Reason")}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Form.Item
            name="is_active"
            valuePropName="checked"
            label={t("common.status")}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
