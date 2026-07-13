import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, Input, Result, Row, Space, Spin, Tabs, Tag, Typography, message } from "antd";
import { DownloadOutlined, FileTextOutlined, ReloadOutlined, SendOutlined, WhatsAppOutlined } from "@ant-design/icons";

import { downloadTemplate, listTemplates, type TemplateCategory, type TemplateItem } from "../../../services/api/templatesApi";
import {
  listWhatsAppTemplates,
  previewWhatsAppTemplate,
  resetWhatsAppTemplate,
  saveWhatsAppTemplate,
  testWhatsAppTemplate,
  type WhatsAppTemplateItem,
} from "../../../services/api/whatsappTemplatesApi";
import { isForbidden } from "../../../services/api/httpErrors";
import Unauthorized403Page from "../../Unauthorized403Page";
import { useI18n } from "../../../i18n/useI18n";

const { Title, Text, Paragraph } = Typography;


export default function TemplateLibraryPage() {
  const { t, language } = useI18n();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateCategory | "whatsapp">("request");
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplateItem[]>([]);
  const [selectedWhatsAppKey, setSelectedWhatsAppKey] = useState<string>("");
  const [whatsappBody, setWhatsappBody] = useState("");
  const [whatsappPreview, setWhatsappPreview] = useState("");
  const [whatsappBusy, setWhatsappBusy] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [data, whatsappData] = await Promise.all([listTemplates(), listWhatsAppTemplates()]);
      setItems(data);
      setWhatsappTemplates(whatsappData);
      if (!selectedWhatsAppKey && whatsappData.length > 0) {
        setSelectedWhatsAppKey(whatsappData[0].key);
        setWhatsappBody(whatsappData[0].body);
      }
    } catch (err) {
      if (isForbidden(err)) {
        setForbidden(true);
      } else {
        setError(String((err as Error)?.message || err));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const categorized = useMemo(() => {
    const map: Record<TemplateCategory, TemplateItem[]> = {
      request: [],
      letter: [],
      report: [],
    };
    for (const item of items) {
      map[item.category].push(item);
    }
    return map;
  }, [items]);

  const selectedWhatsAppTemplate = useMemo(
    () => whatsappTemplates.find((item) => item.key === selectedWhatsAppKey) || whatsappTemplates[0],
    [selectedWhatsAppKey, whatsappTemplates]
  );

  useEffect(() => {
    if (!selectedWhatsAppTemplate) return;
    setWhatsappBody(selectedWhatsAppTemplate.body);
    void handlePreview(selectedWhatsAppTemplate.key, selectedWhatsAppTemplate.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWhatsAppTemplate?.key]);

  async function handleDownload(template: TemplateItem) {
    if (!template.available) {
      message.warning(t("templates.unavailable", "Template is not available yet."));
      return;
    }
    setDownloadingKey(template.key);
    try {
      await downloadTemplate(template.key, template.filename);
    } catch {
      message.error(t("templates.downloadFailed", "Failed to download template."));
    } finally {
      setDownloadingKey(null);
    }
  }

  async function handlePreview(key = selectedWhatsAppTemplate?.key, body = whatsappBody) {
    if (!key) return;
    setWhatsappBusy("preview");
    try {
      const data = await previewWhatsAppTemplate(key, body);
      setWhatsappPreview(data.preview);
    } catch {
      message.error(t("templates.whatsapp.previewFailed", "Failed to preview WhatsApp message."));
    } finally {
      setWhatsappBusy(null);
    }
  }

  async function handleSaveWhatsApp() {
    if (!selectedWhatsAppTemplate) return;
    setWhatsappBusy("save");
    try {
      const updated = await saveWhatsAppTemplate(selectedWhatsAppTemplate.key, whatsappBody);
      setWhatsappTemplates((prev) => prev.map((item) => (item.key === updated.key ? updated : item)));
      setWhatsappBody(updated.body);
      message.success(t("templates.whatsapp.saved", "WhatsApp template saved."));
      await handlePreview(updated.key, updated.body);
    } catch {
      message.error(t("templates.whatsapp.saveFailed", "Failed to save WhatsApp template."));
    } finally {
      setWhatsappBusy(null);
    }
  }

  async function handleResetWhatsApp() {
    if (!selectedWhatsAppTemplate) return;
    setWhatsappBusy("reset");
    try {
      const updated = await resetWhatsAppTemplate(selectedWhatsAppTemplate.key);
      setWhatsappTemplates((prev) => prev.map((item) => (item.key === updated.key ? updated : item)));
      setWhatsappBody(updated.body);
      message.success(t("templates.whatsapp.resetDone", "WhatsApp template reset."));
      await handlePreview(updated.key, updated.body);
    } catch {
      message.error(t("templates.whatsapp.resetFailed", "Failed to reset WhatsApp template."));
    } finally {
      setWhatsappBusy(null);
    }
  }

  async function handleTestWhatsApp() {
    if (!selectedWhatsAppTemplate) return;
    const phone = testPhone.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      message.warning(t("templates.whatsapp.phoneInvalid", "Enter a phone number in E.164 format, for example +201013530963."));
      return;
    }
    setWhatsappBusy("test");
    try {
      const result = await testWhatsAppTemplate(selectedWhatsAppTemplate.key, phone, whatsappBody);
      if (result.success) {
        message.success(t("templates.whatsapp.testSent", "Test WhatsApp message submitted."));
      } else {
        message.error(result.error || t("templates.whatsapp.testFailed", "Test WhatsApp message failed."));
      }
    } catch (err: any) {
      message.error(err?.message || t("templates.whatsapp.testFailed", "Test WhatsApp message failed."));
    } finally {
      setWhatsappBusy(null);
    }
  }

  if (forbidden) {
    return <Unauthorized403Page />;
  }

  const renderTile = (template: TemplateItem) => {
    const title = language === "ar" ? template.title_ar : template.title_en;
    const description = language === "ar" ? template.description_ar : template.description_en;
    return (
      <Col xs={24} sm={12} md={8} lg={8} xl={6} key={template.key}>
        <Card
          hoverable
          style={{ height: "100%" }}
          actions={[
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloadingKey === template.key}
              disabled={!template.available}
              onClick={() => handleDownload(template)}
            >
              {t("templates.download", "Download")}
            </Button>,
          ]}
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Space align="center">
              <FileTextOutlined style={{ fontSize: 22, color: "#f97316" }} />
              <Title level={5} style={{ margin: 0 }}>
                {title}
              </Title>
            </Space>
            <Text type="secondary">{language === "ar" ? template.title_en : template.title_ar}</Text>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {description}
            </Paragraph>
            {!template.available && (
              <Tag color="warning">{t("templates.notGenerated", "Not generated yet")}</Tag>
            )}
          </Space>
        </Card>
      </Col>
    );
  };

  const renderSection = (category: TemplateCategory) => {
    const list = categorized[category];
    if (loading) {
      return (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin />
        </div>
      );
    }
    if (list.length === 0) {
      return <Empty description={t("templates.emptyCategory", "No templates in this category.")} />;
    }
    return (
      <Row gutter={[16, 16]}>
        {list.map(renderTile)}
      </Row>
    );
  };

  const renderWhatsAppTemplates = () => {
    if (loading) {
      return (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin />
        </div>
      );
    }
    if (whatsappTemplates.length === 0) {
      return <Empty description={t("templates.whatsapp.empty", "No WhatsApp templates found.")} />;
    }

    return (
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {whatsappTemplates.map((item) => (
              <Card
                key={item.key}
                hoverable
                onClick={() => setSelectedWhatsAppKey(item.key)}
                style={{
                  borderRadius: 8,
                  borderColor: item.key === selectedWhatsAppTemplate?.key ? "#f97316" : undefined,
                }}
                bodyStyle={{ padding: 14 }}
              >
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                    <Space>
                      <WhatsAppOutlined style={{ color: "#16a34a" }} />
                      <Text strong>{item.title}</Text>
                    </Space>
                    {item.customized ? <Tag color="orange">{t("templates.whatsapp.custom", "Custom")}</Tag> : <Tag>{t("templates.whatsapp.default", "Default")}</Tag>}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.description}
                  </Text>
                </Space>
              </Card>
            ))}
          </Space>
        </Col>
        <Col xs={24} lg={17}>
          <Card style={{ borderRadius: 8 }}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>
                    {selectedWhatsAppTemplate?.title}
                  </Title>
                  <Text type="secondary">{selectedWhatsAppTemplate?.description}</Text>
                </div>
                <Space wrap>
                  <Button onClick={() => handlePreview()} loading={whatsappBusy === "preview"} icon={<ReloadOutlined />}>
                    {t("templates.whatsapp.preview", "Preview")}
                  </Button>
                  <Button onClick={handleResetWhatsApp} loading={whatsappBusy === "reset"}>
                    {t("templates.whatsapp.reset", "Reset")}
                  </Button>
                  <Button type="primary" onClick={handleSaveWhatsApp} loading={whatsappBusy === "save"}>
                    {t("common.save", "Save")}
                  </Button>
                </Space>
              </div>

              <Space wrap size={[8, 8]}>
                {selectedWhatsAppTemplate?.variables.map((variable) => (
                  <Tag key={variable} color="blue">{`{{ ${variable} }}`}</Tag>
                ))}
              </Space>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={13}>
                  <Text strong>{t("templates.whatsapp.body", "Message Body")}</Text>
                  <Input.TextArea
                    value={whatsappBody}
                    onChange={(event) => setWhatsappBody(event.target.value)}
                    autoSize={{ minRows: 18, maxRows: 28 }}
                    style={{ marginTop: 8, fontFamily: "monospace", direction: "ltr" }}
                  />
                </Col>
                <Col xs={24} xl={11}>
                  <Text strong>{t("templates.whatsapp.previewTitle", "Preview")}</Text>
                  <div
                    style={{
                      marginTop: 8,
                      minHeight: 360,
                      whiteSpace: "pre-wrap",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: "#f8fafc",
                      padding: 14,
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    {whatsappPreview || t("templates.whatsapp.previewEmpty", "Click Preview to render a sample message.")}
                  </div>
                </Col>
              </Row>

              <Card size="small" style={{ borderRadius: 8, background: "#fcfcfd" }}>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={testPhone}
                    onChange={(event) => setTestPhone(event.target.value)}
                    placeholder="+201013530963"
                  />
                  <Button icon={<SendOutlined />} onClick={handleTestWhatsApp} loading={whatsappBusy === "test"}>
                    {t("templates.whatsapp.sendTest", "Send Test")}
                  </Button>
                </Space.Compact>
              </Card>
            </Space>
          </Card>
        </Col>
      </Row>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Space direction="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}>
            {t("templates.title", "Template Library")}
          </Title>
          <Text type="secondary">
            {t("templates.subtitle", "Download blank HR forms and letters to print or fill offline.")}
          </Text>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          {t("common.refresh", "Refresh")}
        </Button>
      </div>

      {error && (
        <Alert style={{ marginBottom: 16 }} type="error" showIcon message={error} closable onClose={() => setError(null)} />
      )}

      {!loading && items.length === 0 && !error ? (
        <Result
          icon={<FileTextOutlined />}
          title={t("templates.empty.title", "No templates found")}
          subTitle={t("templates.empty.subtitle", "Run generate_blank_templates to populate the library.")}
        />
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TemplateCategory | "whatsapp")}
          items={[
            {
              key: "request",
              label: t("templates.category.requests", "Request Forms"),
              children: renderSection("request"),
            },
            {
              key: "letter",
              label: t("templates.category.letters", "HR Letters"),
              children: renderSection("letter"),
            },
            {
              key: "whatsapp",
              label: t("templates.category.whatsapp", "WhatsApp Messages"),
              children: renderWhatsAppTemplates(),
            },
          ]}
        />
      )}
    </div>
  );
}
