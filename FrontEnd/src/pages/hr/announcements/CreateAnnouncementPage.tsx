import { useEffect, useState } from 'react';
import { Form, Input, Button, Select, Switch, Card, message, Space, Typography, Row, Col, Upload, Alert, DatePicker, InputNumber, Segmented } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { useNavigate } from 'react-router-dom';
import { createAnnouncement, type CreateAnnouncementData } from '../../../services/api/announcementApi';
import { listDelegationCandidates, type DelegationCandidate } from '../../../services/api/employeesApi';
import { useI18n } from '../../../i18n/useI18n';
import { UploadOutlined, GoogleOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../../auth/authStore';
import { isHeadOfficeOrganization } from '../../../utils/organizationContext';

const { Title, Text } = Typography;
const { Option } = Select;

export default function CreateAnnouncementPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const user = useAuthStore((state) => state.user);
    const isHeadOffice = isHeadOfficeOrganization(user);
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
    const [attachmentList, setAttachmentList] = useState<UploadFile[]>([]);
    const [employees, setEmployees] = useState<DelegationCandidate[]>([]);
    const announcementType = Form.useWatch('announcement_type', form) || 'GENERAL';
    const isMeeting = announcementType === 'MEETING';

    useEffect(() => {
        if (isHeadOffice) {
            message.info(t('organization.headOffice.switchToCreateRecords'));
        }
    }, [isHeadOffice, t]);

    useEffect(() => {
        listDelegationCandidates()
            .then((response) => {
                if (response.status === 'success') {
                    setEmployees(response.data || []);
                }
            })
            .catch(() => message.error(t('hr.announcements.errorLoadEmployees')));
    }, [t]);

    const onFinish = async (values: any) => {
        if (isHeadOffice) return;
        setLoading(true);
        try {
            const data: CreateAnnouncementData = {
                title: values.title,
                content: values.content,
                announcement_type: values.announcement_type || 'GENERAL',
                target_roles: isMeeting ? [] : values.target_roles,
                target_user_ids: isMeeting ? values.target_user_ids : undefined,
                publish_to_dashboard: values.publish_to_dashboard,
                publish_to_email: values.publish_to_email,
                publish_to_sms: values.publish_to_sms,
                meeting_starts_at: values.meeting_starts_at?.toISOString?.() || null,
                meeting_duration_minutes: values.meeting_duration_minutes ?? null,
                meeting_location: values.meeting_location || '',
                meeting_agenda: values.meeting_agenda || '',
                google_meet_url: values.google_meet_url || '',
                microsoft_teams_url: values.microsoft_teams_url || '',
                zoom_url: values.zoom_url || '',
                attachment: attachmentFile,
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
                {isHeadOffice ? (
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={t('organization.headOffice.readOnlyTitle')}
                        description={t('organization.headOffice.switchToCreateRecords')}
                    />
                ) : null}
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={onFinish}
                    initialValues={{
                        announcement_type: 'GENERAL',
                        publish_to_dashboard: true,
                        publish_to_email: false,
                        publish_to_sms: false,
                    }}
                >
                    <Form.Item name="announcement_type" label={t('hr.announcements.typeLabel')}>
                        <Segmented
                            block
                            options={[
                                { label: t('hr.announcements.typeGeneral'), value: 'GENERAL' },
                                { label: t('hr.announcements.typeMeeting'), value: 'MEETING' },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        name="title"
                        label={isMeeting ? t('hr.announcements.meetingTitleLabel') : t('hr.announcements.titleLabel')}
                        rules={[{ required: true, message: t('hr.announcements.titleRequired') }]}
                    >
                        <Input placeholder={t('hr.announcements.titlePlaceholder')} size="large" />
                    </Form.Item>

                    <Form.Item
                        name="content"
                        label={isMeeting ? t('hr.announcements.meetingMessageLabel') : t('hr.announcements.contentLabel')}
                        rules={[{ required: true, message: t('hr.announcements.contentRequired') }]}
                    >
                        <Input.TextArea
                            rows={6}
                            placeholder={t('hr.announcements.contentPlaceholder')}
                            showCount
                            maxLength={2000}
                        />
                    </Form.Item>

                    {isMeeting ? (
                        <>
                            <Form.Item
                                name="target_user_ids"
                                label={t('hr.announcements.selectedEmployeesLabel')}
                                rules={[{ required: true, message: t('hr.announcements.selectedEmployeesRequired') }]}
                            >
                                <Select
                                    mode="multiple"
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder={t('hr.announcements.selectedEmployeesPlaceholder')}
                                    size="large"
                                    options={employees.map((employee) => ({
                                        value: employee.id,
                                        label: `${employee.full_name_en || employee.full_name || employee.employee_id} (${employee.employee_id})`,
                                    }))}
                                />
                            </Form.Item>

                            <Row gutter={16}>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name="meeting_starts_at"
                                        label={t('hr.announcements.meetingStartsAt')}
                                        rules={[{ required: true, message: t('hr.announcements.meetingStartsAtRequired') }]}
                                    >
                                        <DatePicker showTime style={{ width: '100%' }} size="large" />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="meeting_duration_minutes" label={t('hr.announcements.meetingDuration')}>
                                        <InputNumber min={1} max={1440} style={{ width: '100%' }} size="large" />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item name="meeting_location" label={t('hr.announcements.meetingLocation')}>
                                <Input size="large" />
                            </Form.Item>

                            <Form.Item name="meeting_agenda" label={t('hr.announcements.meetingAgenda')}>
                                <Input.TextArea rows={4} />
                            </Form.Item>

                            <Row gutter={16}>
                                <Col xs={24} md={8}>
                                    <Form.Item name="google_meet_url" label={t('hr.announcements.googleMeetUrl')}>
                                        <Input prefix={<GoogleOutlined />} placeholder="https://meet.google.com/..." />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                    <Form.Item name="microsoft_teams_url" label={t('hr.announcements.teamsUrl')}>
                                        <Input prefix={<VideoCameraOutlined />} placeholder="https://teams.microsoft.com/..." />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                    <Form.Item name="zoom_url" label={t('hr.announcements.zoomUrl')}>
                                        <Input prefix={<VideoCameraOutlined />} placeholder="https://zoom.us/..." />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </>
                    ) : (
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
                    )}

                    <Form.Item
                        label={t('hr.announcements.attachmentLabel', 'PDF Attachment (Optional)')}
                        extra={t('hr.announcements.attachmentHelp', 'Upload one PDF file. It will be previewable in the dashboard and included in email notifications.')}
                    >
                        <Upload
                            accept="application/pdf,.pdf"
                            maxCount={1}
                            beforeUpload={(file) => {
                                const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                                if (!isPdf) {
                                    message.error(t('hr.announcements.attachmentPdfOnly', 'Only PDF files are allowed.'));
                                    return Upload.LIST_IGNORE;
                                }
                                setAttachmentFile(file);
                                setAttachmentList([file]);
                                return false;
                            }}
                            onRemove={() => {
                                setAttachmentFile(null);
                                setAttachmentList([]);
                            }}
                            fileList={attachmentList}
                        >
                            <Button icon={<UploadOutlined />}>
                                {t('hr.announcements.attachmentSelect', 'Select PDF')}
                            </Button>
                        </Upload>
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
                            disabled={isHeadOffice}
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
