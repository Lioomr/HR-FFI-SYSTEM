import { useState } from 'react';
import { Form, Input, Button, Select, Switch, Card, message, Space, Typography, Row, Col } from 'antd';
import { useNavigate } from 'react-router-dom';
import { createAnnouncement, type CreateAnnouncementData } from '../../../services/api/announcementApi';
import { useI18n } from '../../../i18n/useI18n';

const { Title, Text } = Typography;
const { Option } = Select;

export default function CreateAnnouncementPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);

    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            const data: CreateAnnouncementData = {
                title: values.title,
                content: values.content,
                target_roles: values.target_roles,
                publish_to_dashboard: values.publish_to_dashboard,
                publish_to_email: values.publish_to_email,
                publish_to_sms: values.publish_to_sms,
            };

            await createAnnouncement(data);
            message.success(t('hr.announcements.successCreated'));
            navigate('/hr/announcements');
        } catch (error: any) {
            message.error(error.response?.data?.message || t('hr.announcements.errorCreate'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title level={2} style={{ margin: 0 }}>{t('hr.announcements.createTitle')}</Title>
                <Button onClick={() => navigate('/hr/announcements')}>{t('common.cancel')}</Button>
            </div>

            <Card bordered={false} style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={onFinish}
                    initialValues={{
                        publish_to_dashboard: true,
                        publish_to_email: false,
                        publish_to_sms: false,
                    }}
                >
                    <Form.Item
                        name="title"
                        label={t('hr.announcements.titleLabel')}
                        rules={[{ required: true, message: t('hr.announcements.titleRequired') }]}
                    >
                        <Input placeholder={t('hr.announcements.titlePlaceholder')} size="large" />
                    </Form.Item>

                    <Form.Item
                        name="content"
                        label={t('hr.announcements.contentLabel')}
                        rules={[{ required: true, message: t('hr.announcements.contentRequired') }]}
                    >
                        <Input.TextArea
                            rows={6}
                            placeholder={t('hr.announcements.contentPlaceholder')}
                            showCount
                            maxLength={2000}
                        />
                    </Form.Item>

                    <Form.Item
                        name="target_roles"
                        label={t('hr.announcements.targetAudienceLabel')}
                        rules={[{ required: true, message: t('hr.announcements.targetAudienceRequired') }]}
                    >
                        <Select
                            mode="multiple"
                            placeholder={t('hr.announcements.placeholderSelectRoles')}
                            style={{ width: '100%' }}
                            size="large"
                        >
                            <Option value="ADMIN">{t('auth.role.admin')}</Option>
                            <Option value="HR_MANAGER">{t('auth.role.hr_manager')}</Option>
                            <Option value="MANAGER">{t('auth.role.manager')}</Option>
                            <Option value="EMPLOYEE">{t('auth.role.employee')}</Option>
                        </Select>
                    </Form.Item>

                    <div style={{ background: '#fafafa', padding: 16, borderRadius: 8, marginBottom: 24 }}>
                        <Title level={5}>{t('hr.announcements.publishingOptions')}</Title>

                        <Row gutter={[16, 16]}>
                            <Col span={24}>
                                <Form.Item name="publish_to_dashboard" valuePropName="checked" noStyle>
                                    <Switch disabled />
                                </Form.Item>
                                <Space direction="vertical" size={0} style={{ marginLeft: 8, verticalAlign: 'top' }}>
                                    <Text strong>{t('hr.announcements.dashboardLabel')}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{t('hr.announcements.dashboardDesc')}</Text>
                                </Space>
                            </Col>

                            <Col span={24}>
                                <Form.Item name="publish_to_email" valuePropName="checked" noStyle>
                                    <Switch />
                                </Form.Item>
                                <Space direction="vertical" size={0} style={{ marginLeft: 8, verticalAlign: 'top' }}>
                                    <Text strong>{t('hr.announcements.emailLabel')}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{t('hr.announcements.emailDesc')}</Text>
                                </Space>
                            </Col>

                            <Col span={24}>
                                <Form.Item name="publish_to_sms" valuePropName="checked" noStyle>
                                    <Switch />
                                </Form.Item>
                                <Space direction="vertical" size={0} style={{ marginLeft: 8, verticalAlign: 'top' }}>
                                    <Text strong>{t('hr.announcements.smsLabel')}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{t('hr.announcements.smsDesc')}</Text>
                                </Space>
                            </Col>
                        </Row>
                    </div>

                    <Form.Item>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={loading}
                            block
                            size="large"
                            style={{ background: '#FF7F3E', borderColor: '#FF7F3E', borderRadius: 12, height: 50, fontWeight: 600 }}
                        >
                            {t('hr.announcements.createButton')}
                        </Button>
                    </Form.Item>
                </Form>
            </Card>
        </div>
    );
}
