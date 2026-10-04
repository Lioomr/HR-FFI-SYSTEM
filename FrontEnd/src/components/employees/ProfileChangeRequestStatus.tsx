import { useState } from "react";
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
import { FileSearchOutlined } from "@ant-design/icons";

import ApprovalTimeline from "../requests/ApprovalTimeline";
import PendingActionBanner from "../requests/PendingActionBanner";
import {
  cancelProfileChangeRequest,
  profileChangeFieldLabelKey,
  type ProfileChangeItem,
  type ProfileChangeRequest,
} from "../../services/api/employeeProfileChangeRequestsApi";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../services/api/httpErrors";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

const DECIDED_ALERTS = {
  APPROVED: { type: "success", key: "profileChange.decidedApproved" },
  PARTIALLY_APPROVED: { type: "warning", key: "profileChange.decidedPartial" },
  REJECTED: { type: "error", key: "profileChange.decidedRejected" },
} as const;

/**
 * The employee's latest profile change request: pending state with the
 * approval trail and cancel, or the per-field outcome after HR decided.
 */
export default function ProfileChangeRequestStatus({
  request,
  onChanged,
}: {
  request: ProfileChangeRequest;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();
  const [cancelling, setCancelling] = useState(false);
  const pending = request.status === "PENDING_HR";
  const decided =
    request.status in DECIDED_ALERTS
      ? DECIDED_ALERTS[request.status as keyof typeof DECIDED_ALERTS]
      : null;

  if (!pending && !decided) return null;

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

  const renderItem = (item: ProfileChangeItem) => (
    <List.Item>
      <Space direction="vertical" size={2} style={{ width: "100%" }}>
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
        <Space size={4} wrap>
          <Text delete type="secondary">
            {item.old || "—"}
          </Text>
          <span aria-hidden>→</span>
          <Text>{item.new}</Text>
        </Space>
        {item.decision === "rejected" && item.note ? (
          <Text type="danger" style={{ fontSize: 12 }}>
            {t("profileChange.hrReason")}: {item.note}
          </Text>
        ) : null}
      </Space>
    </List.Item>
  );

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {messageContext}
      {modalContext}
      {pending ? (
        request.workflow?.status === "in_review" ? (
          <PendingActionBanner workflow={request.workflow} />
        ) : (
          <Alert type="info" showIcon title={t("profileChange.pending")} />
        )
      ) : decided ? (
        <Alert
          type={decided.type}
          showIcon
          title={t(decided.key)}
          description={request.decision_note || undefined}
        />
      ) : null}
      <List size="small" dataSource={request.items} renderItem={renderItem} />
      {request.workflow?.history?.length ? (
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
      ) : null}
      {pending ? (
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
      ) : null}
    </Space>
  );
}
