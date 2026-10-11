import { useState, type CSSProperties } from "react";
import {
  Alert,
  Button,
  Collapse,
  List,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";

import ApprovalTimeline from "../requests/ApprovalTimeline";
import PendingActionBanner from "../requests/PendingActionBanner";
import {
  cancelProfileChangeRequest,
  profileChangeFieldLabelKey,
  PROFILE_CHANGE_STATUS_COLORS,
  PROFILE_CHANGE_STATUS_KEYS,
  type ProfileChangeItem,
  type ProfileChangeRequest,
  type ProfileChangeStatus,
} from "../../services/api/employeeProfileChangeRequestsApi";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../services/api/httpErrors";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

const DECIDED_ALERTS = {
  APPROVED: { type: "success", key: "profileChange.decidedApproved" },
  PARTIALLY_APPROVED: { type: "warning", key: "profileChange.decidedPartial" },
  REJECTED: { type: "error", key: "profileChange.decidedRejected" },
} as const;

const decidedAlert = (status: ProfileChangeStatus) =>
  status in DECIDED_ALERTS
    ? DECIDED_ALERTS[status as keyof typeof DECIDED_ALERTS]
    : null;

const WRAP: CSSProperties = { overflowWrap: "anywhere" };

// Read by screen readers only; the visible arrow is decorative.
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function ProfileChangeStatusTag({
  status,
}: {
  status: ProfileChangeStatus;
}) {
  const { t } = useI18n();
  return (
    <Tag
      color={PROFILE_CHANGE_STATUS_COLORS[status]}
      style={{ marginInlineEnd: 0 }}
    >
      {t(PROFILE_CHANGE_STATUS_KEYS[status], status)}
    </Tag>
  );
}

/** Reference and dates of one request, on a single wrapping line. */
export function ProfileChangeRequestMeta({
  request,
  showReference = true,
}: {
  request: ProfileChangeRequest;
  showReference?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Space size={[12, 2]} wrap style={{ fontSize: 12 }}>
      {showReference ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("permissionRequests.list.reference")}:{" "}
          <bdi>{request.reference_no || `#${request.id}`}</bdi>
        </Text>
      ) : null}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("profileChange.submittedOn")}:{" "}
        <bdi>{formatDateTimeShort(request.submitted_at, "—")}</bdi>
      </Text>
      {request.decided_at && request.status !== "PENDING_HR" ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("profileChange.decidedOn")}:{" "}
          <bdi>{formatDateTimeShort(request.decided_at, "—")}</bdi>
        </Text>
      ) : null}
    </Space>
  );
}

/** Per-field old → new values with each field's source and HR decision. */
export function ProfileChangeItemList({
  items,
}: {
  items: ProfileChangeItem[];
}) {
  const { t, direction } = useI18n();
  const Arrow = direction === "rtl" ? ArrowLeftOutlined : ArrowRightOutlined;

  const renderItem = (item: ProfileChangeItem) => (
    <List.Item style={{ paddingInline: 0 }}>
      <Space orientation="vertical" size={4} style={{ width: "100%" }}>
        <Space size={6} wrap>
          <Text strong>
            {t(profileChangeFieldLabelKey(item.field), item.field)}
          </Text>
          {item.source === "ocr" ? (
            <Tag color="purple" icon={<FileSearchOutlined />}>
              {t("profileChange.readFromDocument")}
            </Tag>
          ) : null}
          {item.decision === "approved" ? (
            <Tag color="green">{t("status.approved")}</Tag>
          ) : null}
          {item.decision === "rejected" ? (
            <Tag color="red">{t("status.rejected")}</Tag>
          ) : null}
        </Space>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 8,
            background: "#fafafa",
            border: "1px solid #f0f0f0",
          }}
        >
          <Text delete={Boolean(item.old)} type="secondary" style={WRAP}>
            <bdi>{item.old || "—"}</bdi>
          </Text>
          <Arrow aria-hidden style={{ color: "#8c8c8c", fontSize: 12 }} />
          <span style={SR_ONLY}>{t("profileChange.changedTo")}</span>
          <Text
            strong
            style={{
              ...WRAP,
              color: item.decision === "rejected" ? "#8c8c8c" : undefined,
            }}
          >
            <bdi>{item.new}</bdi>
          </Text>
        </div>
        {item.decision === "rejected" && item.note ? (
          <Text type="danger" style={{ ...WRAP, fontSize: 12 }}>
            {t("profileChange.hrReason")}: {item.note}
          </Text>
        ) : null}
      </Space>
    </List.Item>
  );

  return (
    <List
      size="small"
      split={false}
      dataSource={items}
      rowKey={(item) => item.field}
      renderItem={renderItem}
    />
  );
}

/** Collapsible approval trail; nothing when the workflow has no history. */
export function ProfileChangeApprovalTrail({
  request,
}: {
  request: ProfileChangeRequest;
}) {
  const { t } = useI18n();
  if (!request.workflow?.history?.length) return null;
  return (
    <Collapse
      size="small"
      items={[
        {
          key: "trail",
          label: t("profileChange.approvalTrail"),
          children: <ApprovalTimeline workflow={request.workflow} />,
        },
      ]}
    />
  );
}

/** HR's overall decision, the per-field outcomes and the trail. */
export function ProfileChangeRequestDetails({
  request,
  showReference = true,
}: {
  request: ProfileChangeRequest;
  showReference?: boolean;
}) {
  const { t } = useI18n();
  const decided = decidedAlert(request.status);
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <ProfileChangeRequestMeta
        request={request}
        showReference={showReference}
      />
      {decided ? (
        <Alert
          type={decided.type}
          showIcon
          title={t(decided.key)}
          description={
            request.decision_note ? (
              <span style={WRAP}>{request.decision_note}</span>
            ) : undefined
          }
        />
      ) : null}
      <ProfileChangeItemList items={request.items} />
      <ProfileChangeApprovalTrail request={request} />
    </Space>
  );
}

/**
 * The employee's latest profile change request. Pending: the full view with
 * the approval progress and cancel. Decided: a one-line banner whose details
 * open in a modal, and which the employee can dismiss.
 */
export default function ProfileChangeRequestStatus({
  request,
  onChanged,
  onDismiss,
}: {
  request: ProfileChangeRequest;
  onChanged: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();
  const [cancelling, setCancelling] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pending = request.status === "PENDING_HR";
  const decided = decidedAlert(request.status);

  if (!pending && !decided) return null;

  if (decided) {
    return (
      <>
        <Alert
          type={decided.type}
          showIcon
          style={{ alignItems: "center" }}
          title={
            <span style={WRAP}>
              {t(decided.key)}
              {request.decided_at ? (
                <Text
                  type="secondary"
                  style={{ fontSize: 12, marginInlineStart: 8 }}
                >
                  <bdi>{formatDateTimeShort(request.decided_at)}</bdi>
                </Text>
              ) : null}
            </span>
          }
          action={
            <Space size={4}>
              <Button
                type="link"
                size="small"
                aria-haspopup="dialog"
                onClick={() => setDetailsOpen(true)}
              >
                {t("profileChange.viewDetails")}
              </Button>
              {onDismiss ? (
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={t("profileChange.dismiss")}
                  title={t("profileChange.dismiss")}
                  onClick={onDismiss}
                />
              ) : null}
            </Space>
          }
        />
        <Modal
          open={detailsOpen}
          onCancel={() => setDetailsOpen(false)}
          title={
            <Space size={8} wrap>
              <span>{t("profileChange.detailsTitle")}</span>
              <ProfileChangeStatusTag status={request.status} />
            </Space>
          }
          footer={
            <Button onClick={() => setDetailsOpen(false)}>
              {t("common.close")}
            </Button>
          }
          width={640}
          destroyOnHidden
        >
          <ProfileChangeRequestDetails request={request} />
        </Modal>
      </>
    );
  }

  const cancel = async () => {
    setCancelling(true);
    try {
      const response = await cancelProfileChangeRequest(request.id);
      if (isApiError(response)) {
        messageApi.error(response.message || t("profileChange.cancelFailed"));
        return;
      }
      messageApi.success(t("profileChange.cancelled"));
      onChanged();
    } catch (error) {
      messageApi.error(
        getHttpErrorMessage(error) || t("profileChange.cancelFailed"),
      );
    } finally {
      setCancelling(false);
    }
  };

  const confirmCancel = () =>
    void modal.confirm({
      title: t("profileChange.cancelConfirm"),
      okText: t("common.yes"),
      cancelText: t("common.no"),
      okButtonProps: { danger: true },
      onOk: cancel,
    });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {messageContext}
      {modalContext}
      <ProfileChangeRequestMeta request={request} />
      {request.workflow?.status === "in_review" ? (
        <PendingActionBanner workflow={request.workflow} />
      ) : (
        <Alert type="info" showIcon title={t("profileChange.pending")} />
      )}
      <ProfileChangeItemList items={request.items} />
      <ProfileChangeApprovalTrail request={request} />
      <div>
        <Button
          size="small"
          danger
          loading={cancelling}
          onClick={confirmCancel}
        >
          {t("profileChange.cancelRequest")}
        </Button>
      </div>
    </Space>
  );
}
