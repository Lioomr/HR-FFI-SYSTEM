import { ClockCircleOutlined } from "@ant-design/icons";
import { Card, Space, Tag, Typography } from "antd";

import type { WorkflowSnapshot } from "../../types/workflow";

const { Text } = Typography;

export default function ApprovalTimeline({ workflow }: { workflow?: WorkflowSnapshot }) {
  if (!workflow?.history?.length) return null;

  return (
    <Card style={{ borderRadius: 16 }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {workflow.history.map((item, index) => (
          <div key={item.id || `${item.action}-${index}`} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
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
                <Tag color="orange">{item.action}</Tag>
                {item.stage ? <Tag>{item.stage}</Tag> : null}
                <Text type="secondary">{item.at ? new Date(item.at).toLocaleString() : "-"}</Text>
              </Space>
              <div style={{ marginTop: 4 }}>
                <Text strong>{item.actor?.full_name || item.actor?.email || "System"}</Text>
              </div>
              {item.note ? (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">{item.note}</Text>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </Space>
    </Card>
  );
}
