import { ClockCircleOutlined } from "@ant-design/icons";
import { Card, Space, Tag, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";
import type { WorkflowSnapshot } from "../../types/workflow";
import { formatDateTime } from "../../utils/dateTime";

const { Text } = Typography;

/**
 * System-generated workflow notes arrive as fixed English sentences. People's
 * comments never match these and are shown verbatim.
 */
const SYSTEM_NOTE_KEYS: Record<string, string> = {
  "Contract expiry workflow created": "workflow.note.contractExpiryCreated",
  "Automatically renewed because HR took no action":
    "workflow.note.autoRenewedNoHrAction",
};

export default function ApprovalTimeline({
  workflow,
}: {
  workflow?: WorkflowSnapshot;
}) {
  const { t } = useI18n();
  if (!workflow?.history?.length) return null;

  return (
    <Card style={{ borderRadius: 16 }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {workflow.history.map((item, index) => (
          <div
            key={item.id || `${item.action}-${index}`}
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: "#fff7ed",
                color: "#f97316",
                border: "1px solid #fdba74",
                flexShrink: 0,
              }}
            >
              <ClockCircleOutlined />
            </div>
            <div style={{ flex: 1 }}>
              <Space size={8} wrap>
                <Tag color="orange">
                  {t(`workflow.action.${item.action}`, item.action)}
                </Tag>
                {item.stage ? (
                  <Tag>{t(`workflow.role.${item.stage}`, item.stage)}</Tag>
                ) : null}
                <Text type="secondary">{formatDateTime(item.at)}</Text>
              </Space>
              <div style={{ marginTop: 4 }}>
                <Text strong>
                  {item.actor?.full_name ||
                    item.actor?.email ||
                    t("workflow.systemActor")}
                </Text>
              </div>
              {item.note ? (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">
                    {SYSTEM_NOTE_KEYS[item.note]
                      ? t(SYSTEM_NOTE_KEYS[item.note])
                      : item.note}
                  </Text>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </Space>
    </Card>
  );
}
