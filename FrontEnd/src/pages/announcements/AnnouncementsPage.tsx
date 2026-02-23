import { useEffect, useState } from 'react';
import { List, Card, Tag, Typography, Space, Empty, Spin, Button } from 'antd';
import { getAnnouncements, type AnnouncementListItem } from '../../services/api/announcementApi';
import { useAuthStore } from '../../auth/authStore';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';

const { Title, Paragraph, Text } = Typography;

export default function AnnouncementsPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const role = useAuthStore((s) => s.user?.role);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<AnnouncementListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);

    const loadData = async (page = 1) => {
        setLoading(true);
        try {
            const response = await getAnnouncements(page, 9); // 9 items per page for 3x3 grid
            if (response.status === 'success') {
                const announcements = response.data.items || [];
                setData(announcements);
                setTotal(response.data.count || 0);
                setCurrentPage(page);
            }
        } catch (error) {
            console.error('Error loading announcements:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const isImportant = (title: string, content: string) => {
        const text = `${title} ${content}`.toLowerCase();
        const importantKeywords = ["urgent", "important", "expiry", "expir", "reminder", "action required"];
        return importantKeywords.some((keyword) => text.includes(keyword));
    };

    return (
        <div style={{ padding: 24, paddingBottom: 48, maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
                <Title level={2} style={{ color: '#FF7F3E' }}>📢 {t("announcements.title")}</Title>
                <Text type="secondary">{t("announcements.noAnnouncements", "Stay updated with the latest company news")}</Text>
                {(role === "Manager" || role === "CEO") && (
                    <div style={{ marginTop: 12 }}>
                        <Button
                            type="primary"
                            onClick={() =>
                                navigate(role === "CEO" ? "/ceo/announcements/create" : "/manager/announcements/create")
                            }
                        >
                            {t("announcements.create")}
                        </Button>
                    </div>
                )}
            </div>

            {loading && data.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 50 }}>
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
                        total: total,
                        current: currentPage,
                        align: 'center',
                        showSizeChanger: false
                    }}
                    locale={{
                        emptyText: <Empty description={t("announcements.noAnnouncements")} />
                    }}
                    renderItem={(item) => (
                        <List.Item>
                            <Card
                                hoverable
                                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                                bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                                title={
                                    <Space size={8}>
                                        <span style={{ color: '#1a1a1a' }}>{item.title}</span>
                                        <Tag color={isImportant(item.title, item.content_preview) ? "red" : "green"}>
                                            {isImportant(item.title, item.content_preview) ? t("status.critical", "Important") : t("status.info", "Normal")}
                                        </Tag>
                                    </Space>
                                }
                                extra={<Text type="secondary" style={{ fontSize: 12 }}>{formatDate(item.created_at)}</Text>}
                            >
                                <div style={{ marginBottom: 16, flex: 1 }}>
                                    <Paragraph
                                        ellipsis={{ rows: 4, expandable: true, symbol: t("announcements.readMore") }}
                                        style={{ color: '#595959' }}
                                    >
                                        {item.content_preview}
                                    </Paragraph>
                                </div>

                                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 'auto' }}>
                                    <Space split={<div style={{ width: 1, height: 10, background: '#d9d9d9' }} />}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>{t("announcements.author", "By")} {item.created_by_name}</Text>
                                    </Space>
                                </div>
                            </Card>
                        </List.Item>
                    )}
                />
            )}
        </div>
    );
}
