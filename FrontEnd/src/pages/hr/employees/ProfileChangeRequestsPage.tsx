import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  EyeOutlined,
  FileSearchOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import { useFilePreview } from "../../../components/ui/useFilePreview";
import ApprovalTimeline from "../../../components/requests/ApprovalTimeline";
import PendingActionBanner from "../../../components/requests/PendingActionBanner";
import {
  decideProfileChangeRequest,
  getHrProfileChangeRequest,
  getHrProfileChangeRequests,
  getProfileChangeAttachmentFile,
  profileChangeFieldLabelKey,
  type ProfileChangeDecision,
  type ProfileChangeItem,
  type ProfileChangeRequest,
  type ProfileChangeStatus,
} from "../../../services/api/employeeProfileChangeRequestsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../../services/api/httpErrors";
import { useI18n } from "../../../i18n/useI18n";
import { formatDateOnly, formatDateTime } from "../../../utils/dateTime";

const { Text } = Typography;
const PAGE_SIZE = 20;

const STATUS_COLORS: Record<ProfileChangeStatus, string> = {
  PENDING_HR: "orange",
  APPROVED: "green",
  PARTIALLY_APPROVED: "gold",
  REJECTED: "red",
  CANCELLED: "default",
};
const STATUS_KEYS: Record<ProfileChangeStatus, string> = {
  PENDING_HR: "status.pendingHr",
  APPROVED: "status.approved",
  PARTIALLY_APPROVED: "status.partiallyApproved",
  REJECTED: "status.rejected",
  CANCELLED: "status.cancelled",
};
type StatusFilter = ProfileChangeStatus | "ALL";
type RowDecision = { decision?: "approve" | "reject"; note: string };
const FILE_FIELDS = ["passport_file", "national_id_file"];

/**
 * HR queue for employee profile change requests. HR decides every field in
 * one submission; approved fields are applied server-side, rejected ones
 * need a reason the employee sees.
 */
export default function ProfileChangeRequestsPage() {
  const { t } = useI18n();
  const [messageApi, messageContext] = message.useMessage();
  const { openPreview, previewModal } = useFilePreview();
  const [status, setStatus] = useState<StatusFilter>("PENDING_HR");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProfileChangeRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProfileChangeRequest | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [submitting, setSubmitting] = useState(false);

  const fieldLabel = (field: string) =>
    t(profileChangeFieldLabelKey(field), field);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getHrProfileChangeRequests({
        status: status === "ALL" ? undefined : status,
        search: search || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      if (isApiError(response)) {
        messageApi.error(response.message || t("profileChange.hr.loadFailed"));
        return;
      }
      setItems(response.data.items ?? []);
      setTotal(response.data.count ?? response.data.items?.length ?? 0);
    } catch (error) {
      messageApi.error(
        getHttpErrorMessage(error) || t("profileChange.hr.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [messageApi, page, search, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row: ProfileChangeRequest) => {
    setSelected(row);
    setDecisions({});
    try {
      const response = await getHrProfileChangeRequest(row.id);
      if (!isApiError(response)) {
        setSelected((current) =>
          current?.id === row.id ? response.data : current,
        );
      }
    } catch {
      // The list row is enough to review; the drawer keeps showing it.
    }
  };

  const setRow = (field: string, patch: Partial<RowDecision>) =>
    setDecisions((current) => ({
      ...current,
      [field]: { ...(current[field] ?? { note: "" }), ...patch },
    }));

  const approveAll = () =>
    setDecisions((current) =>
      Object.fromEntries(
        (selected?.items ?? []).map((item) => [
          item.field,
          { note: current[item.field]?.note ?? "", decision: "approve" },
        ]),
      ),
    );

  const canAct = Boolean(selected?.can_act && selected.status === "PENDING_HR");
  const allDecided = Boolean(
    selected?.items.length &&
    selected.items.every((item) => decisions[item.field]?.decision),
  );
  const missingNote = Boolean(
    selected?.items.some(
      (item) =>
        decisions[item.field]?.decision === "reject" &&
        !decisions[item.field]?.note.trim(),
    ),
  );

  const submitDecisions = async () => {
    if (!selected) return;
    if (!allDecided) {
      messageApi.error(t("profileChange.hr.decideAll"));
      return;
    }
    if (missingNote) {
      messageApi.error(t("profileChange.hr.rejectNoteRequired"));
      return;
    }
    const payload: ProfileChangeDecision[] = selected.items.map((item) => {
      const row = decisions[item.field];
      const note = row.note.trim();
      return note
        ? { field: item.field, decision: row.decision!, note }
        : { field: item.field, decision: row.decision! };
    });
    const row = selected;
    const snapshot = items;
    const removeFromView = status === "PENDING_HR";
    setSubmitting(true);
    // Optimistic: the decided request leaves the pending queue immediately.
    if (removeFromView) {
      setItems((current) => current.filter((item) => item.id !== row.id));
      setTotal((value) => Math.max(0, value - 1));
      setSelected(null);
    }
    try {
      const response = await decideProfileChangeRequest(row.id, payload);
      if (isApiError(response)) throw new Error(response.message);
      messageApi.success(t("profileChange.hr.decided"));
      if (!removeFromView) {
        setItems((current) =>
          current.map((item) => (item.id === row.id ? response.data : item)),
        );
        setSelected(response.data);
      }
    } catch (error) {
      if (removeFromView) {
        setItems(snapshot);
        setTotal((value) => value + 1);
        setSelected(row);
      }
      messageApi.error(
        getHttpErrorMessage(error) || t("profileChange.hr.actionFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const statusTag = (value: ProfileChangeStatus) => (
    <Tag color={STATUS_COLORS[value]}>{t(STATUS_KEYS[value], value)}</Tag>
  );

  const requestedValue = (
    request: ProfileChangeRequest,
    item: ProfileChangeItem,
  ) => {
    const attachment = FILE_FIELDS.includes(item.field)
      ? request.attachments?.find((entry) => entry.field === item.field)
      : undefined;
    if (!attachment) return <Text strong>{item.new}</Text>;
    return (
      <Button
        size="small"
        icon={<EyeOutlined />}
        onClick={() =>
          openPreview({
            title: fieldLabel(item.field),
            filename:
              attachment.original_filename ||
              `profile-change-${request.id}-${attachment.id}`,
            load: () =>
              getProfileChangeAttachmentFile(request.id, attachment.id, "hr"),
          })
        }
      >
        {attachment.original_filename || item.new || t("common.view")}
      </Button>
    );
  };

  const decisionCell = (item: ProfileChangeItem) => {
    if (!canAct) {
      return (
        <Space direction="vertical" size={2}>
          {item.decision === "approved" ? (
            <Tag color="green">{t("status.approved")}</Tag>
          ) : item.decision === "rejected" ? (
            <Tag color="red">{t("status.rejected")}</Tag>
          ) : (
            <Tag>{t("status.pending")}</Tag>
          )}
          {item.note ? <Text type="secondary">{item.note}</Text> : null}
        </Space>
      );
    }
    const row = decisions[item.field];
    return (
      <Space direction="vertical" size={6} style={{ minWidth: 180 }}>
        <div role="radiogroup" aria-label={fieldLabel(item.field)}>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={row?.decision}
            onChange={(event) =>
              setRow(item.field, { decision: event.target.value })
            }
            options={[
              { value: "approve", label: t("profileChange.hr.approve") },
              { value: "reject", label: t("profileChange.hr.reject") },
            ]}
          />
        </div>
        {row?.decision === "reject" ? (
          <Input.TextArea
            aria-label={t("profileChange.hr.rejectReasonFor", {
              field: fieldLabel(item.field),
            })}
            placeholder={t("profileChange.hr.rejectReason")}
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={500}
            status={row.note.trim() ? undefined : "error"}
            value={row.note}
            onChange={(event) =>
              setRow(item.field, { note: event.target.value })
            }
          />
        ) : null}
      </Space>
    );
  };

  const columns = [
    {
      title: t("permissionRequests.list.reference"),
      key: "reference_no",
      render: (_: unknown, row: ProfileChangeRequest) => row.reference_no || `#${row.id}`,
    },
    {
      title: t("common.employee"),
      key: "employee",
      render: (_: unknown, row: ProfileChangeRequest) => (
        <div>
          <Link to={`/hr/employees/${row.employee.id}`}>
            {row.employee.full_name}
          </Link>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.employee.employee_number || "—"}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: t("profileChange.hr.changes"),
      key: "changes",
      render: (_: unknown, row: ProfileChangeRequest) =>
        row.items.map((item) => fieldLabel(item.field)).join(", ") || "—",
    },
    {
      title: t("profileChange.hr.submittedAt"),
      key: "submitted_at",
      render: (_: unknown, row: ProfileChangeRequest) =>
        formatDateOnly(row.submitted_at),
    },
    {
      title: t("common.status"),
      key: "status",
      render: (_: unknown, row: ProfileChangeRequest) => statusTag(row.status),
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_: unknown, row: ProfileChangeRequest) => (
        <Button size="small" onClick={() => void openDetail(row)}>
          {t("profileChange.hr.review")}
        </Button>
      ),
    },
  ];

  const itemColumns = selected
    ? [
        {
          title: t("profileChange.hr.field"),
          key: "field",
          render: (_: unknown, item: ProfileChangeItem) => (
            <Space direction="vertical" size={2}>
              <Text strong>{fieldLabel(item.field)}</Text>
              {item.source === "ocr" ? (
                <Tag color="purple" icon={<FileSearchOutlined />}>
                  {t("profileChange.readFromDocument")}
                </Tag>
              ) : null}
            </Space>
          ),
        },
        {
          title: t("profileChange.hr.current"),
          key: "old",
          render: (_: unknown, item: ProfileChangeItem) => (
            <Text type="secondary">{item.old || "—"}</Text>
          ),
        },
        {
          title: t("profileChange.hr.requested"),
          key: "new",
          render: (_: unknown, item: ProfileChangeItem) =>
            requestedValue(selected, item),
        },
        {
          title: t("profileChange.hr.decision"),
          key: "decision",
          render: (_: unknown, item: ProfileChangeItem) => decisionCell(item),
        },
      ]
    : [];

  return (
    <div>
      {messageContext}
      {previewModal}
      <PageHeader
        title={t("profileChange.hr.title")}
        subtitle={t("profileChange.hr.subtitle")}
        actions={
          <Space wrap>
            <Input.Search
              aria-label={t("permissionRequests.list.reference")}
              placeholder={t("permissionRequests.list.reference")}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onSearch={(value) => {
                setSearch(value.trim());
                setPage(1);
              }}
              allowClear
            />
            <Select<StatusFilter>
              aria-label={t("common.status")}
              value={status}
              style={{ minWidth: 180 }}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={[
                { value: "PENDING_HR", label: t("status.pendingHr") },
                { value: "APPROVED", label: t("status.approved") },
                {
                  value: "PARTIALLY_APPROVED",
                  label: t("status.partiallyApproved"),
                },
                { value: "REJECTED", label: t("status.rejected") },
                { value: "CANCELLED", label: t("status.cancelled") },
                { value: "ALL", label: t("common.all") },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
          </Space>
        }
      />

      <Card variant="borderless" style={{ borderRadius: 12 }}>
        <ResponsiveTable<ProfileChangeRequest>
          mobileCard={{ titleKey: "employee" }}
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          size="small"
          scroll={{ x: "max-content" }}
          locale={{ emptyText: t("profileChange.hr.empty") }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
        />
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? selected.employee.full_name : ""}
        width="min(760px, 100vw)"
        destroyOnHidden
      >
        {selected ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <PendingActionBanner workflow={selected.workflow} />
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t("permissionRequests.list.reference")}>
                {selected.reference_no || `#${selected.id}`}
              </Descriptions.Item>
              <Descriptions.Item label={t("common.status")}>
                {statusTag(selected.status)}
              </Descriptions.Item>
              <Descriptions.Item label={t("profileChange.hr.submittedAt")}>
                {formatDateTime(selected.submitted_at)}
              </Descriptions.Item>
              {selected.decided_at ? (
                <Descriptions.Item label={t("profileChange.hr.decidedBy")}>
                  {selected.decided_by_name || "—"} ·{" "}
                  {formatDateTime(selected.decided_at)}
                </Descriptions.Item>
              ) : null}
              {selected.decision_note ? (
                <Descriptions.Item label={t("profileChange.hr.decisionNote")}>
                  {selected.decision_note}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
            {canAct ? (
              <Alert
                type="info"
                showIcon
                title={t("profileChange.hr.decideHint")}
              />
            ) : null}
            <Table<ProfileChangeItem>
              rowKey="field"
              size="small"
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={itemColumns}
              dataSource={selected.items}
            />
            {canAct ? (
              <Space wrap>
                <Button onClick={approveAll}>
                  {t("profileChange.hr.approveAll")}
                </Button>
                <Button
                  type="primary"
                  loading={submitting}
                  disabled={!allDecided || missingNote}
                  onClick={() => void submitDecisions()}
                >
                  {t("profileChange.hr.submitDecisions")}
                </Button>
              </Space>
            ) : null}
            <ApprovalTimeline workflow={selected.workflow} />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
