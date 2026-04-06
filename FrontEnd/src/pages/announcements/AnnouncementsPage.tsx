import { useEffect, useState } from "react";
import { List, Card, Tag, Typography, Space, Empty, Spin, Button, Modal } from "antd";
import {
  getAnnouncements,
  getAnnouncement,
  getAnnouncementAttachment,
  type AnnouncementListItem,
  type Announcement,
} from "../../services/api/announcementApi";
import { useAuthStore } from "../../auth/authStore";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";
import { DownloadOutlined, EyeOutlined, FilePdfOutlined } from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

export default function AnnouncementsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const role = useAuthStore((s) => s.user?.role);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnnouncementListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

  const loadData = async (page = 1) => {
    setLoading(true);
    try {
      const response = await getAnnouncements(page, 9);
      if (response.status === "success") {
        setData(response.data.items || []);
        setTotal(response.data.count || 0);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Error loading announcements:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const isImportant = (title: string, content: string) => {
    const text = `${title} ${content}`.toLowerCase();
    const importantKeywords = ["urgent", "important", "expiry", "expir", "reminder", "action required"];
    return importantKeywords.some((keyword) => text.includes(keyword));
  };

  const handleOpen = async (item: AnnouncementListItem) => {
    setModalVisible(true);
    setDetailLoading(true);
    setDetail(null);
    setAttachmentLoading(false);

    try {
      const response = await getAnnouncement(item.id);
      if (response.status === "success") {
        setDetail(response.data.announcement);
      }
    } catch (error) {
      console.error("Error loading announcement details:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleClose = () => {
    setModalVisible(false);
    setDetail(null);
    setAttachmentLoading(false);
  };

  const openAttachment = async (download: boolean) => {
    if (!detail?.has_attachment) return;

    try {
      setAttachmentLoading(true);
      const blob = await getAnnouncementAttachment(detail.id, download);
      const objectUrl = URL.createObjectURL(blob);

      if (download) {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = detail.attachment_name || "announcement.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
      }

      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch (error) {
      console.error("Failed to open announcement attachment", error);
    } finally {
      setAttachmentLoading(false);
    }
  };

  return (
    <>
      <div style={{ padding: 24, paddingBottom: 48, maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Title level={2} style={{ color: "#FF7F3E" }}>
            {t("announcements.title")}
          </Title>
          <Text type="secondary">{t("announcements.subtitle")}</Text>
          {(role === "Manager" || role === "CEO") && (
            <div style={{ marginTop: 12 }}>
              <Button
                type="primary"
                onClick={() => navigate(role === "CEO" ? "/ceo/announcements/create" : "/manager/announcements/create")}
              >
                {t("announcements.create")}
              </Button>
            </div>
          )}
        </div>

        {loading && data.length === 0 ? (
          <div style={{ textAlign: "center", padding: 50 }}>
            <Spin size="large" />
          </div>
        ) : (
          <List
            grid={{
              gutter: 16,
              xs: 1,
              sm: 1,
              md: 2,
              lg: 3,
              xl: 3,
              xxl: 3,
            }}
            dataSource={data}
            pagination={{
              onChange: (page) => loadData(page),
              pageSize: 9,
              total,
              current: currentPage,
              align: "center",
              showSizeChanger: false,
            }}
            locale={{
              emptyText: <Empty description={t("announcements.noAnnouncements")} />,
            }}
            renderItem={(item) => (
              <List.Item>
                <Card
                  hoverable
                  onClick={() => handleOpen(item)}
                  style={{ height: "100%", display: "flex", flexDirection: "column", cursor: "pointer" }}
                  bodyStyle={{ flex: 1, display: "flex", flexDirection: "column" }}
                  title={
                    <Space size={8}>
                      <span style={{ color: "#1a1a1a" }}>{item.title}</span>
                      <Tag color={isImportant(item.title, item.content_preview) ? "red" : "green"}>
                        {isImportant(item.title, item.content_preview)
                          ? t("status.critical", "Important")
                          : t("status.info", "Normal")}
                      </Tag>
                      {item.has_attachment && <Tag color="red">PDF</Tag>}
                    </Space>
                  }
                  extra={<Text type="secondary" style={{ fontSize: 12 }}>{formatDate(item.created_at)}</Text>}
                >
                  <div style={{ marginBottom: 16, flex: 1 }}>
                    <Paragraph
                      ellipsis={{ rows: 4, expandable: true, symbol: t("announcements.readMore") }}
                      style={{ color: "#595959" }}
                    >
                      {item.content_preview}
                    </Paragraph>
                  </div>

                  <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12, marginTop: "auto" }}>
                    <Space split={<div style={{ width: 1, height: 10, background: "#d9d9d9" }} />}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t("announcements.author", "By")} {item.created_by_name}
                      </Text>
                    </Space>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        )}
      </div>

      <Modal
        title={detail?.title || t("common.loading")}
        open={modalVisible}
        onCancel={handleClose}
        footer={[
          <Button key="close" onClick={handleClose}>
            {t("common.close")}
          </Button>,
        ]}
      >
        {detailLoading ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <Spin />
          </div>
        ) : detail ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Tag color="blue">
                {t("announcements.widget.from")}
                {detail.created_by_name}
              </Tag>
              <Tag color={isImportant(detail.title, detail.content) ? "red" : "green"}>
                {isImportant(detail.title, detail.content)
                  ? t("announcements.widget.important")
                  : t("announcements.widget.normal")}
              </Tag>
              <Tag>{new Date(detail.created_at).toLocaleString()}</Tag>
            </div>
            <Paragraph style={{ whiteSpace: "pre-wrap" }}>{detail.content}</Paragraph>
            {detail.has_attachment && (
              <div style={{ marginTop: 16 }}>
                <Space wrap size={10}>
                  <Tag icon={<FilePdfOutlined />} color="red">
                    {detail.attachment_name || t("hr.announcements.attachmentLabel", "PDF Attachment")}
                  </Tag>
                  <Button size="small" icon={<EyeOutlined />} loading={attachmentLoading} onClick={() => openAttachment(false)}>
                    {t("common.preview")}
                  </Button>
                  <Button size="small" icon={<DownloadOutlined />} loading={attachmentLoading} onClick={() => openAttachment(true)}>
                    {t("common.download")}
                  </Button>
                </Space>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: "center" }}>{t("announcements.widget.failedLoad")}</div>
        )}
      </Modal>
    </>
  );
}
