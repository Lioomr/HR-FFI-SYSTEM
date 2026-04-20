import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, Result, Row, Space, Spin, Tabs, Tag, Typography, message } from "antd";
import { DownloadOutlined, FileTextOutlined, ReloadOutlined } from "@ant-design/icons";

import { downloadTemplate, listTemplates, type TemplateCategory, type TemplateItem } from "../../../services/api/templatesApi";
import { isForbidden } from "../../../services/api/httpErrors";
import Unauthorized403Page from "../../Unauthorized403Page";
import { useI18n } from "../../../i18n/useI18n";

const { Title, Text, Paragraph } = Typography;


type Props = Record<string, never>;


export default function TemplateLibraryPage(_: Props) {
  const { t, language } = useI18n();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateCategory>("request");
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listTemplates();
      setItems(data);
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

  async function handleDownload(template: TemplateItem) {
    if (!template.available) {
      message.warning(t("templates.unavailable", "Template is not available yet."));
      return;
    }
    setDownloadingKey(template.key);
    try {
      await downloadTemplate(template.key, template.filename);
    } catch (err) {
      message.error(t("templates.downloadFailed", "Failed to download template."));
    } finally {
      setDownloadingKey(null);
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
          onChange={(key) => setActiveTab(key as TemplateCategory)}
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
          ]}
        />
      )}
    </div>
  );
}
