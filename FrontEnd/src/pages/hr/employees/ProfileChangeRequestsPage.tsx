import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Grid,
  Input,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  CloseOutlined,
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

const { Text, Title } = Typography;
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

// Long names, e-mails and ids must wrap instead of widening the drawer.
const WRAP: CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  minWidth: 0,
};

/**
 * HR queue for employee profile change requests. HR decides every field in
 * one submission; approved fields are applied server-side, rejected ones
 * need a reason the employee sees.
 */
export default function ProfileChangeRequestsPage() {
  const { t, language } = useI18n();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  // Current/requested sit side by side unless the screen is phone-narrow.
  const stackValues = screens.sm === false;
  const isPhone = screens.md === false;
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
  const decidedCount = (selected?.items ?? []).filter(
    (item) => decisions[item.field]?.decision,
  ).length;
  const allDecided = Boolean(
    selected?.items.length && decidedCount === selected.items.length,
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
    <Tag color={STATUS_COLORS[value]} style={{ marginInlineEnd: 0 }}>
      {t(STATUS_KEYS[value], value)}
    </Tag>
  );

  const requestedValue = (
    request: ProfileChangeRequest,
    item: ProfileChangeItem,
  ) => {
    const attachment = FILE_FIELDS.includes(item.field)
      ? request.attachments?.find((entry) => entry.field === item.field)
      : undefined;
    if (!attachment) {
      return (
        <Text strong style={{ ...WRAP, fontSize: 15 }}>
          {item.new}
        </Text>
      );
    }
    return (
      <Button
        icon={<EyeOutlined />}
        style={{
          ...WRAP,
          maxWidth: "100%",
          minHeight: 44,
          height: "auto",
          whiteSpace: "normal",
          textAlign: "start",
          alignSelf: "flex-start",
        }}
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

  const decisionControl = (item: ProfileChangeItem) => {
    const row = decisions[item.field];
    const noteId = `profile-change-note-${item.field}`;
    const noteMissing = row?.decision === "reject" && !row.note.trim();
    return (
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        {/* The selected option takes the colour of the decision it records. */}
        <ConfigProvider
          theme={{
            token: {
              controlHeightLG: 44,
              colorPrimary:
                row?.decision === "reject"
                  ? token.colorError
                  : token.colorSuccess,
            },
          }}
        >
          <div
            role="radiogroup"
            aria-label={t("profileChange.hr.decisionFor", {
              field: fieldLabel(item.field),
            })}
          >
            <Radio.Group
              block
              optionType="button"
              buttonStyle="solid"
              size="large"
              value={row?.decision}
              onChange={(event) =>
                setRow(item.field, { decision: event.target.value })
              }
              options={[
                {
                  value: "approve",
                  label: (
                    <span>
                      <CheckOutlined aria-hidden />{" "}
                      {t("profileChange.hr.approve")}
                    </span>
                  ),
                },
                {
                  value: "reject",
                  label: (
                    <span>
                      <CloseOutlined aria-hidden />{" "}
                      {t("profileChange.hr.reject")}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </ConfigProvider>
        {row?.decision === "reject" ? (
          <div>
            <label
              htmlFor={noteId}
              style={{ display: "block", marginBottom: 4, fontWeight: 500 }}
            >
              {t("profileChange.hr.rejectReasonLabel")}{" "}
              <Text type="danger" aria-hidden>
                *
              </Text>
            </label>
            <Input.TextArea
              id={noteId}
              aria-label={t("profileChange.hr.rejectReasonFor", {
                field: fieldLabel(item.field),
              })}
              aria-required
              aria-invalid={noteMissing}
              aria-describedby={`${noteId}-help`}
              placeholder={t("profileChange.hr.rejectReason")}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={500}
              status={noteMissing ? "error" : undefined}
              value={row.note}
              onChange={(event) =>
                setRow(item.field, { note: event.target.value })
              }
            />
            <Text
              id={`${noteId}-help`}
              type={noteMissing ? "danger" : "secondary"}
              style={{ fontSize: 12 }}
            >
              {t("profileChange.hr.rejectReasonHelp")}
            </Text>
          </div>
        ) : null}
      </Space>
    );
  };

  const decidedResult = (item: ProfileChangeItem) => (
    <Space orientation="vertical" size={2} style={{ width: "100%" }}>
      {item.decision === "approved" ? (
        <Tag color="green" style={{ marginInlineEnd: 0 }}>
          {t("status.approved")}
        </Tag>
      ) : item.decision === "rejected" ? (
        <Tag color="red" style={{ marginInlineEnd: 0 }}>
          {t("status.rejected")}
        </Tag>
      ) : (
        <Tag style={{ marginInlineEnd: 0 }}>{t("status.pending")}</Tag>
      )}
      {item.note ? (
        <Text type="secondary" style={WRAP}>
          {item.note}
        </Text>
      ) : null}
    </Space>
  );

  const fieldCard = (
    request: ProfileChangeRequest,
    item: ProfileChangeItem,
  ) => {
    const choice = canAct
      ? decisions[item.field]?.decision
      : item.decision === "approved"
        ? "approve"
        : item.decision === "rejected"
          ? "reject"
          : undefined;
    const accent =
      choice === "approve"
        ? token.colorSuccess
        : choice === "reject"
          ? token.colorError
          : token.colorBorder;
    const headingId = `profile-change-field-${item.field}`;
    const valueBox: CSSProperties = {
      ...WRAP,
      padding: "8px 12px",
      borderRadius: token.borderRadius,
      display: "flex",
      flexDirection: "column",
      gap: 2,
    };
    return (
      <section
        key={item.field}
        aria-labelledby={headingId}
        style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderInlineStart: `4px solid ${accent}`,
          borderRadius: token.borderRadiusLG,
          padding: 12,
          background: token.colorBgContainer,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Text strong id={headingId} style={{ ...WRAP, fontSize: 15 }}>
            {fieldLabel(item.field)}
          </Text>
          {item.source === "ocr" ? (
            <Tag
              color="purple"
              icon={<FileSearchOutlined />}
              style={{ marginInlineEnd: 0 }}
            >
              {t("profileChange.readFromDocument")}
            </Tag>
          ) : null}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: stackValues
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) auto minmax(0, 1fr)",
            gap: stackValues ? 6 : 10,
          }}
        >
          <div style={{ ...valueBox, background: token.colorFillQuaternary }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("profileChange.hr.current")}
            </Text>
            {item.old ? (
              <Text type="secondary" delete={choice !== "reject"} style={WRAP}>
                {item.old}
              </Text>
            ) : (
              <Text type="secondary" italic style={WRAP}>
                {t("profileChange.hr.noCurrentValue")}
              </Text>
            )}
          </div>
          {stackValues ? null : (
            <Text
              type="secondary"
              aria-hidden
              style={{ alignSelf: "center", fontSize: 16 }}
            >
              {language === "ar" ? (
                <ArrowLeftOutlined />
              ) : (
                <ArrowRightOutlined />
              )}
            </Text>
          )}
          <div
            style={{
              ...valueBox,
              background: token.colorPrimaryBg,
              border: `1px solid ${token.colorPrimaryBorder}`,
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("profileChange.hr.requested")}
            </Text>
            {requestedValue(request, item)}
          </div>
        </div>
        {canAct ? decisionControl(item) : decidedResult(item)}
      </section>
    );
  };

  const columns = [
    {
      title: t("permissionRequests.list.reference"),
      key: "reference_no",
      render: (_: unknown, row: ProfileChangeRequest) =>
        row.reference_no || `#${row.id}`,
    },
    {
      title: t("common.employee"),
      key: "employee",
      render: (_: unknown, row: ProfileChangeRequest) => (
        <div style={WRAP}>
          <Link
            to={`/hr/employees/${row.employee.id}`}
            style={{ color: "var(--brand-primary)", fontWeight: 500 }}
          >
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
      render: (_: unknown, row: ProfileChangeRequest) => (
        <span style={WRAP}>
          {row.items
            .map((item) => fieldLabel(item.field))
            .join(language === "ar" ? "، " : ", ") || "—"}
        </span>
      ),
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
        <Button
          size={isPhone ? "middle" : "small"}
          block={isPhone}
          onClick={() => void openDetail(row)}
        >
          {t("profileChange.hr.review")}
        </Button>
      ),
    },
  ];

  const drawerFooter =
    selected && canAct ? (
      <div
        style={{
          display: "flex",
          flexDirection: isPhone ? "column" : "row",
          alignItems: isPhone ? "stretch" : "center",
          justifyContent: "space-between",
          gap: isPhone ? 8 : 16,
        }}
      >
        <div role="status" aria-live="polite" style={WRAP}>
          <Text strong>
            {t("profileChange.hr.progress", {
              done: decidedCount,
              total: selected.items.length,
            })}
          </Text>
          {missingNote ? (
            <div>
              <Text type="danger" style={{ fontSize: 12 }}>
                {t("profileChange.hr.rejectNoteRequired")}
              </Text>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="large"
            style={{ flex: isPhone ? "1 1 0" : undefined }}
            onClick={approveAll}
          >
            {t("profileChange.hr.approveAll")}
          </Button>
          <Button
            type="primary"
            size="large"
            style={{ flex: isPhone ? "1 1 0" : undefined }}
            loading={submitting}
            disabled={!allDecided || missingNote}
            onClick={() => void submitDecisions()}
          >
            {t("profileChange.hr.submitDecisions")}
          </Button>
        </div>
      </div>
    ) : null;

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
          mobileCard={{ titleKey: "employee", extraKey: "status" }}
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          size="small"
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
        title={
          selected ? (
            <div style={WRAP}>
              <div>{selected.employee.full_name}</div>
              <Space size={8} wrap style={{ marginTop: 2 }}>
                <Text type="secondary" style={{ fontWeight: 400 }}>
                  {selected.reference_no || `#${selected.id}`}
                </Text>
                {statusTag(selected.status)}
              </Space>
            </div>
          ) : (
            ""
          )
        }
        width={isPhone ? "100vw" : "min(900px, 100vw)"}
        footer={drawerFooter}
        styles={{
          body: { padding: isPhone ? 16 : 24 },
          footer: {
            paddingBlock: 12,
            paddingInline: isPhone ? 16 : 24,
            paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
          },
        }}
        destroyOnHidden
      >
        {selected ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <PendingActionBanner workflow={selected.workflow} />
            <Descriptions column={1} bordered size="small">
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
                  <span style={WRAP}>{selected.decision_note}</span>
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
            <div>
              <Title level={5} style={{ marginTop: 0 }}>
                {t("profileChange.hr.changes")} ({selected.items.length})
              </Title>
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                {selected.items.map((item) => fieldCard(selected, item))}
              </Space>
            </div>
            <ApprovalTimeline workflow={selected.workflow} />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
