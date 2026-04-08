import { Button, Card, Space, Typography } from "antd";
import { ToolOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";

const { Paragraph, Text, Title } = Typography;

export default function AttendanceMaintenanceNotice({
  title,
  description,
  backPath,
  backLabel,
}: {
  title?: string;
  description?: string;
  backPath?: string;
  backLabel?: string;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const resolvedTitle = title || t("attendance.maintenance.title", "Attendance is temporarily unavailable");
  const resolvedDescription =
    description || t("attendance.maintenance.description", "We are fixing this part right now. Please check back soon.");
  const resolvedBackLabel = backLabel || t("attendance.maintenance.back", "Go back");

  return (
    <Card
      style={{
        borderRadius: 20,
        border: "1px solid #fde7d3",
        background: "linear-gradient(180deg, #fffaf5 0%, #ffffff 100%)",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.06)",
      }}
      bodyStyle={{ padding: 32 }}
    >
      <Space direction="vertical" size={16} style={{ width: "100%", textAlign: "center" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            margin: "0 auto",
            background: "linear-gradient(135deg, #fff4e6, #ffedd5)",
            display: "grid",
            placeItems: "center",
            color: "#f97316",
            fontSize: 30,
          }}
        >
          <ToolOutlined />
        </div>
        <div>
          <Text
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#f97316",
            }}
          >
            {t("attendance.maintenance.eyebrow", "Maintenance")}
          </Text>
          <Title level={3} style={{ marginTop: 8, marginBottom: 8 }}>
            {resolvedTitle}
          </Title>
          <Paragraph style={{ marginBottom: 0, color: "#64748b", fontSize: 15 }}>
            {resolvedDescription}
          </Paragraph>
        </div>
        {backPath ? (
          <div>
            <Button type="primary" onClick={() => navigate(backPath)} style={{ borderRadius: 10 }}>
              {resolvedBackLabel}
            </Button>
          </div>
        ) : null}
      </Space>
    </Card>
  );
}
