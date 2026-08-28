import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  QRCode,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  DisconnectOutlined,
  ReloadOutlined,
  SendOutlined,
  WhatsAppOutlined,
} from "@ant-design/icons";
import {
  connectWhatsAppIntegration,
  getWhatsAppIntegrationQr,
  getWhatsAppIntegrationStatus,
  logoutWhatsAppIntegration,
  testWhatsAppIntegration,
  type WhatsAppIntegrationStatus,
  type WhatsAppQrResponse,
} from "../../services/api/whatsappIntegrationApi";
import { isApiError } from "../../services/api/apiTypes";

const { Text, Title } = Typography;

function isBase64Image(value: string) {
  return value.startsWith("data:image/");
}

function statusColor(status?: WhatsAppIntegrationStatus) {
  const state = (status?.connection_state || "").toLowerCase();
  if (!status?.configured) return "red";
  if (status?.connected || state === "open") return "green";
  if (state === "connecting" || state === "qr" || state === "close")
    return "gold";
  if (state === "unreachable") return "red";
  return "default";
}

function statusLabel(status?: WhatsAppIntegrationStatus) {
  if (!status) return "Checking";
  if (!status.configured) return "Not configured";
  if (status.connected) return "Connected";
  if (status.connection_state === "unreachable") return "Unreachable";
  return status.connection_state || "Disconnected";
}

export default function AdminWhatsAppIntegrationPage() {
  const [status, setStatus] = useState<WhatsAppIntegrationStatus>();
  const [qr, setQr] = useState<WhatsAppQrResponse>();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [form] = Form.useForm<{ phone_number: string }>();

  const qrCode = qr?.qr_code || "";
  const hasQr = Boolean(qrCode);
  const qrAsImage = useMemo(() => isBase64Image(qrCode), [qrCode]);

  async function refreshStatus() {
    setLoading(true);
    try {
      const res = await getWhatsAppIntegrationStatus();
      if (isApiError(res)) throw new Error(res.message);
      setStatus(res.data);
    } catch (err: any) {
      message.error(err?.message || "Could not load WhatsApp status.");
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    setActionLoading("connect");
    try {
      const res = await connectWhatsAppIntegration();
      if (isApiError(res)) throw new Error(res.message);
      setQr(res.data);
      if (!res.data.qr_available) {
        message.info("No QR code returned. Refresh status in a few seconds.");
      }
      await refreshStatus();
    } catch (err: any) {
      message.error(err?.message || "Could not start WhatsApp connection.");
    } finally {
      setActionLoading(null);
    }
  }

  async function refreshQr() {
    setActionLoading("qr");
    try {
      const res = await getWhatsAppIntegrationQr();
      if (isApiError(res)) throw new Error(res.message);
      setQr(res.data);
      if (!res.data.qr_available) {
        message.info("No QR code is available right now.");
      }
    } catch (err: any) {
      message.error(err?.message || "Could not refresh QR code.");
    } finally {
      setActionLoading(null);
    }
  }

  async function disconnect() {
    setActionLoading("disconnect");
    try {
      await logoutWhatsAppIntegration();
      setQr(undefined);
      message.success("WhatsApp device disconnected.");
      await refreshStatus();
    } catch (err: any) {
      message.error(err?.message || "Could not disconnect WhatsApp device.");
    } finally {
      setActionLoading(null);
    }
  }

  async function sendTest(values: { phone_number: string }) {
    setActionLoading("test");
    try {
      const res = await testWhatsAppIntegration(values.phone_number);
      if (isApiError(res)) throw new Error(res.message);
      if (res.data.success || res.data.sent) {
        message.success("Test WhatsApp message submitted.");
      } else {
        message.error(res.data.error || "Test WhatsApp message failed.");
      }
    } catch (err: any) {
      message.error(err?.message || "Test WhatsApp message failed.");
    } finally {
      setActionLoading(null);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Title level={3} style={{ margin: 0 }}>
              WhatsApp Integration
            </Title>
            <Text type="secondary">
              Evolution API device pairing and delivery test
            </Text>
          </div>
          <Space wrap>
            <Tag
              color={statusColor(status)}
              style={{ padding: "4px 10px", fontSize: 13 }}
            >
              {statusLabel(status)}
            </Tag>
            <Button
              icon={<ReloadOutlined />}
              onClick={refreshStatus}
              loading={loading}
            >
              Refresh
            </Button>
          </Space>
        </div>

        <Spin spinning={loading}>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card style={{ borderRadius: 8 }}>
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <Space>
                      <WhatsAppOutlined
                        style={{ color: "#16a34a", fontSize: 22 }}
                      />
                      <div>
                        <Text strong>Device pairing</Text>
                        <div>
                          <Text type="secondary">
                            Instance: {status?.instance_name || "Not set"}
                          </Text>
                        </div>
                      </div>
                    </Space>
                    <Space wrap>
                      <Button
                        type="primary"
                        icon={<WhatsAppOutlined />}
                        onClick={connect}
                        loading={actionLoading === "connect"}
                        disabled={!status?.configured}
                      >
                        Generate QR
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={refreshQr}
                        loading={actionLoading === "qr"}
                        disabled={!status?.configured}
                      >
                        Refresh QR
                      </Button>
                    </Space>
                  </div>

                  <div
                    style={{
                      minHeight: 340,
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#ffffff",
                      padding: 24,
                    }}
                  >
                    {hasQr ? (
                      qrAsImage ? (
                        <img
                          src={qrCode}
                          alt="WhatsApp pairing QR"
                          style={{
                            width: 280,
                            height: 280,
                            objectFit: "contain",
                          }}
                        />
                      ) : (
                        <QRCode value={qrCode} size={280} bordered={false} />
                      )
                    ) : (
                      <Space direction="vertical" align="center" size={8}>
                        <WhatsAppOutlined
                          style={{ color: "#16a34a", fontSize: 44 }}
                        />
                        <Text strong>
                          {status?.connected
                            ? "Device is connected"
                            : "Generate a QR code"}
                        </Text>
                        <Text type="secondary">
                          {status?.connected
                            ? "WhatsApp notifications can be sent."
                            : "Scan the QR code from WhatsApp Linked devices."}
                        </Text>
                      </Space>
                    )}
                  </div>

                  <Space wrap>
                    <Button
                      danger
                      icon={<DisconnectOutlined />}
                      onClick={disconnect}
                      loading={actionLoading === "disconnect"}
                      disabled={!status?.configured}
                    >
                      Disconnect device
                    </Button>
                  </Space>
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card title="Configuration" style={{ borderRadius: 8 }}>
                  <Space
                    direction="vertical"
                    size={10}
                    style={{ width: "100%" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Text type="secondary">API URL</Text>
                      <Tag
                        color={status?.base_url_configured ? "green" : "red"}
                      >
                        {status?.base_url_configured ? "Set" : "Missing"}
                      </Tag>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Text type="secondary">API key</Text>
                      <Tag color={status?.api_key_configured ? "green" : "red"}>
                        {status?.api_key_configured ? "Set" : "Missing"}
                      </Tag>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Text type="secondary">Provider status</Text>
                      <Text>{status?.provider_status_code || "-"}</Text>
                    </div>
                    {status?.error ? (
                      <Text type="danger">{status.error}</Text>
                    ) : null}
                  </Space>
                </Card>

                <Card title="Send test" style={{ borderRadius: 8 }}>
                  <Form form={form} layout="vertical" onFinish={sendTest}>
                    <Form.Item
                      name="phone_number"
                      label="Phone number"
                      rules={[
                        {
                          required: true,
                          message: "Enter a phone number in E.164 format.",
                        },
                      ]}
                    >
                      <Input placeholder="+9665XXXXXXXX" />
                    </Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SendOutlined />}
                      loading={actionLoading === "test"}
                      block
                    >
                      Send test WhatsApp
                    </Button>
                  </Form>
                </Card>
              </Space>
            </Col>
          </Row>
        </Spin>
      </Space>
    </div>
  );
}
