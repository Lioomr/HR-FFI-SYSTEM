import { useEffect, useState } from 'react';
import { Card, List, Typography, Modal, Button, Tag, Empty, Spin, Space } from 'antd';
import { getAnnouncements, getAnnouncement, type AnnouncementListItem, type Announcement } from '../../services/api/announcementApi';
import { BellOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';

const { Text, Paragraph } = Typography;

export default function AnnouncementWidget({ role }: { role?: string }) {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>([]);
    const [modalVisible, setModalVisible] = useState(false);

    // State for selected announcement full details
    const [detailLoading, setDetailLoading] = useState(false);
    const [detail, setDetail] = useState<Announcement | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            // Fetch latest 5 announcements
            const response = await getAnnouncements(1, 5);
            if (response.status === 'success') {
                const announcements = response.data.items || [];
                setAnnouncements(announcements);
            }
        } catch (error) {
            console.error("Failed to load announcements widget", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpen = async (item: AnnouncementListItem) => {
        setModalVisible(true);
        setDetailLoading(true);
        setDetail(null); // Reset previous detail

        try {
            const response = await getAnnouncement(item.id);
            if (response.status === 'success') {
                setDetail(response.data.announcement);
            }
        } catch (error) {
            console.error("Failed to load announcement details", error);
        } finally {
            setDetailLoading(false);
        }
    };

    const handleClose = () => {
        setModalVisible(false);
        setDetail(null);
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
    };

    const isImportant = (title: string, content: string) => {
        const text = `${title} ${content}`.toLowerCase();
        const importantKeywords = ["urgent", "important", "expiry", "expir", "reminder", "action required"];
        return importantKeywords.some((keyword) => text.includes(keyword));
    };

    return (
        <>
            <Card
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BellOutlined style={{ color: '#FF7F3E' }} />
                        <span>{t("announcements.widget.title")}</span>
                    </div>
                }
                extra={
                    <Button type="link" onClick={() => navigate(role ? `/${role.toLowerCase()}/announcements` : '/employee/announcements')} style={{ padding: 0 }}>
                        {t("announcements.widget.viewAll")}
                    </Button>
                }
                bordered={false}
                style={{ borderRadius: 12, height: '100%' }}
                bodyStyle={{ padding: '0 12px' }}
            >
                {loading ? (
                    <div style={{ padding: 24, textAlign: 'center' }}>
                        <Spin />
                    </div>
                ) : announcements.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("announcements.noAnnouncements")} />
                ) : (
                    <List
                        itemLayout="horizontal"
                        dataSource={announcements}
                        renderItem={(item) => (
                            <List.Item
                                actions={[
                                    <Button type="link" size="small" icon={<ArrowRightOutlined />} onClick={() => handleOpen(item)} />
                                ]}
                                style={{ padding: '12px 0', cursor: 'pointer' }}
                                onClick={() => handleOpen(item)}
                            >
                                <List.Item.Meta
                                    title={
                                        <Space size={8}>
                                            <Text strong style={{ fontSize: 14 }}>{item.title}</Text>
                                            <Tag color={isImportant(item.title, item.content_preview) ? "red" : "green"}>
                                                {isImportant(item.title, item.content_preview) ? t("announcements.widget.important") : t("announcements.widget.normal")}
                                            </Tag>
                                        </Space>
                                    }
                                    description={
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                            <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{item.content_preview}</Text>
                                            <Tag style={{ marginInlineStart: 8, marginInlineEnd: 0 }}>{formatDate(item.created_at)}</Tag>
                                        </div>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                )}
            </Card>

            <Modal
                title={detail?.title || t("common.loading")}
                open={modalVisible}
                onCancel={handleClose}
                footer={[
                    <Button key="close" onClick={handleClose}>
                        {t("common.close")}
                    </Button>
                ]}
            >
                {detailLoading ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                        <Spin />
                    </div>
                ) : detail ? (
                    <div>
                        <div style={{ marginBottom: 16 }}>
                            <Tag color="blue">{t("announcements.widget.from")}{detail.created_by_name}</Tag>
                            <Tag color={isImportant(detail.title, detail.content) ? "red" : "green"}>
                                {isImportant(detail.title, detail.content) ? t("announcements.widget.important") : t("announcements.widget.normal")}
                            </Tag>
                            <Tag>{new Date(detail.created_at).toLocaleString()}</Tag>
                        </div>
                        <Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                            {detail.content}
                        </Paragraph>
                    </div>
                ) : (
                    <div style={{ padding: 24, textAlign: 'center' }}>{t("announcements.widget.failedLoad")}</div>
                )}
            </Modal>
        </>
    );
}
