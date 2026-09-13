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
import { useI18n } from "../../i18n/useI18n";

const { Text, Title } = Typography;

type Translate = (key: string, fallback?: string) => string;

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

function statusLabel(
  status: WhatsAppIntegrationStatus | undefined,
  t: Translate,
) {
  if (!status) return t("admin.whatsapp.status.checking");
  if (!status.configured) return t("admin.whatsapp.status.notConfigured");
  if (status.connected) return t("admin.whatsapp.status.connected");
  const state = (status.connection_state || "").toLowerCase();
  if (!state) return t("admin.whatsapp.status.disconnected");
  return t(`admin.whatsapp.status.${state}`, status.connection_state);
}

export default function AdminWhatsAppIntegrationPage() {
  const { t } = useI18n();
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
      message.error(err?.message || t("admin.whatsapp.loadStatusFailed"));
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
        message.info(t("admin.whatsapp.noQrReturned"));
      }
      await refreshStatus();
    } catch (err: any) {
      message.error(err?.message || t("admin.whatsapp.connectFailed"));
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
        message.info(t("admin.whatsapp.noQrAvailable"));
      }
    } catch (err: any) {
      message.error(err?.message || t("admin.whatsapp.refreshQrFailed"));
    } finally {
      setActionLoading(null);
    }
  }

  async function disconnect() {
    setActionLoading("disconnect");
    try {
      await logoutWhatsAppIntegration();
      setQr(undefined);
      message.success(t("admin.whatsapp.disconnected"));
      await refreshStatus();
    } catch (err: any) {
      message.error(err?.message || t("admin.whatsapp.disconnectFailed"));
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
        message.success(t("templates.whatsapp.testSent"));
      } else {
        message.error(res.data.error || t("templates.whatsapp.testFailed"));
      }
    } catch (err: any) {
      message.error(err?.message || t("templates.whatsapp.testFailed"));
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
              {t("layout.whatsappIntegration")}
            </Title>
            <Text type="secondary">{t("admin.whatsapp.subtitle")}</Text>
          </div>
          <Space wrap>
            <Tag
              color={statusColor(status)}
              style={{ padding: "4px 10px", fontSize: 13 }}
            >
              {statusLabel(status, t)}
            </Tag>
            <Button
              icon={<ReloadOutlined />}
              onClick={refreshStatus}
              loading={loading}
            >
              {t("common.refresh")}
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
                        <Text strong>{t("admin.whatsapp.devicePairing")}</Text>
                        <div>
                          <Text type="secondary">
                            {t("admin.whatsapp.instance", {
                              name:
                                status?.instance_name ||
                                t("admin.whatsapp.notSet"),
                            })}
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
                        {t("admin.whatsapp.generateQr")}
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={refreshQr}
                        loading={actionLoading === "qr"}
                        disabled={!status?.configured}
                      >
                        {t("admin.whatsapp.refreshQr")}
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
                          alt={t("admin.whatsapp.qrAlt")}
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
                            ? t("admin.whatsapp.deviceConnected")
                            : t("admin.whatsapp.generateQrPrompt")}
                        </Text>
                        <Text type="secondary">
                          {status?.connected
                            ? t("admin.whatsapp.canSend")
                            : t("admin.whatsapp.scanHint")}
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
                      {t("admin.whatsapp.disconnectDevice")}
                    </Button>
                  </Space>
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card
                  title={t("admin.whatsapp.configuration")}
                  style={{ borderRadius: 8 }}
                >
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
                      <Text type="secondary">{t("admin.whatsapp.apiUrl")}</Text>
                      <Tag
                        color={status?.base_url_configured ? "green" : "red"}
                      >
                        {status?.base_url_configured
                          ? t("admin.whatsapp.set")
                          : t("admin.whatsapp.missing")}
                      </Tag>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Text type="secondary">{t("admin.whatsapp.apiKey")}</Text>
                      <Tag color={status?.api_key_configured ? "green" : "red"}>
                        {status?.api_key_configured
                          ? t("admin.whatsapp.set")
                          : t("admin.whatsapp.missing")}
                      </Tag>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Text type="secondary">
                        {t("admin.whatsapp.providerStatus")}
                      </Text>
                      <Text>{status?.provider_status_code || "-"}</Text>
                    </div>
                    {status?.error ? (
                      <Text type="danger">{status.error}</Text>
                    ) : null}
                  </Space>
                </Card>

                <Card
                  title={t("admin.whatsapp.sendTestTitle")}
                  style={{ borderRadius: 8 }}
                >
                  <Form form={form} layout="vertical" onFinish={sendTest}>
                    <Form.Item
                      name="phone_number"
                      label={t("admin.invites.phoneNumber")}
                      rules={[
                        {
                          required: true,
                          message: t("admin.whatsapp.phoneRequired"),
                        },
                      ]}
                    >
                      <Input placeholder="+9665XXXXXXXX" dir="ltr" />
                    </Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SendOutlined />}
                      loading={actionLoading === "test"}
                      block
                    >
                      {t("admin.whatsapp.sendTestButton")}
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
