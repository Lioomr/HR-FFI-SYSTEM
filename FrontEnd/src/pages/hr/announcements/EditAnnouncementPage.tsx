import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  Upload,
  message,
} from "antd";
import { UploadOutlined, VideoCameraOutlined, GoogleOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { useNavigate, useParams } from "react-router-dom";

import {
  getAnnouncement,
  updateAnnouncement,
  type Announcement,
  type CreateAnnouncementData,
} from "../../../services/api/announcementApi";
import { useI18n } from "../../../i18n/useI18n";

const { Title, Text } = Typography;
const { Option } = Select;

export default function EditAnnouncementPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentList, setAttachmentList] = useState<UploadFile[]>([]);

  const isMeeting = announcement?.announcement_type === "MEETING";

  useEffect(() => {
    const loadAnnouncement = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const response = await getAnnouncement(Number(id));
        const item: Announcement = response.data.announcement;
        setAnnouncement(item);
        form.setFieldsValue({
          title: item.title,
          content: item.content,
          target_roles: item.target_roles || [],
          publish_to_dashboard: item.publish_to_dashboard,
          publish_to_email: item.publish_to_email,
          publish_to_sms: item.publish_to_sms,
          meeting_starts_at: item.meeting_starts_at ? dayjs(item.meeting_starts_at) : null,
          meeting_duration_minutes: item.meeting_duration_minutes,
          meeting_location: item.meeting_location,
          meeting_agenda: item.meeting_agenda,
          google_meet_url: item.google_meet_url,
          microsoft_teams_url: item.microsoft_teams_url,
          zoom_url: item.zoom_url,
        });
      } catch {
        message.error(t("hr.announcements.errorLoad"));
        navigate("/hr/announcements");
      } finally {
        setLoading(false);
      }
    };

    loadAnnouncement();
  }, [form, id, navigate, t]);

  const onFinish = async (values: any) => {
    if (!id || !announcement) return;
    setSaving(true);
    try {
      const payload: Partial<CreateAnnouncementData> = {
        title: values.title,
        content: values.content,
        announcement_type: announcement.announcement_type,
        publish_to_dashboard: values.publish_to_dashboard,
        publish_to_email: values.publish_to_email,
        publish_to_sms: values.publish_to_sms,
        attachment: attachmentFile,
      };

      if (announcement.announcement_type === "MEETING") {
        payload.target_user = announcement.target_user || undefined;
        payload.meeting_starts_at = values.meeting_starts_at?.toISOString?.() || null;
        payload.meeting_duration_minutes = values.meeting_duration_minutes ?? null;
        payload.meeting_location = values.meeting_location || "";
        payload.meeting_agenda = values.meeting_agenda || "";
        payload.google_meet_url = values.google_meet_url || "";
        payload.microsoft_teams_url = values.microsoft_teams_url || "";
        payload.zoom_url = values.zoom_url || "";
      } else {
        payload.target_roles = values.target_roles || [];
      }

      await updateAnnouncement(Number(id), payload);
      message.success(t("common.saved", "Saved"));
      navigate("/hr/announcements");
    } catch (error: any) {
      message.error(error.response?.data?.message || t("hr.announcements.errorCreate"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level={2} style={{ margin: 0 }}>
          {t("common.edit", "Edit")} {t("layout.announcements", "Announcements")}
        </Title>
        <Button onClick={() => navigate("/hr/announcements")}>{t("common.cancel")}</Button>
      </div>

      <Card loading={loading} bordered={false} style={{ borderRadius: 16, border: "none" }}>
        {announcement?.attachment_name ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("hr.announcements.attachmentLabel", "PDF Attachment")}
            description={announcement.attachment_name}
          />
        ) : null}

        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="title"
            label={isMeeting ? t("hr.announcements.meetingTitleLabel") : t("hr.announcements.titleLabel")}
            rules={[{ required: true, message: t("hr.announcements.titleRequired") }]}
          >
            <Input placeholder={t("hr.announcements.titlePlaceholder")} size="large" />
          </Form.Item>

          <Form.Item
            name="content"
            label={isMeeting ? t("hr.announcements.meetingMessageLabel") : t("hr.announcements.contentLabel")}
            rules={[{ required: true, message: t("hr.announcements.contentRequired") }]}
          >
            <Input.TextArea rows={6} placeholder={t("hr.announcements.contentPlaceholder")} showCount maxLength={2000} />
          </Form.Item>

          {isMeeting ? (
            <>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="meeting_starts_at"
                    label={t("hr.announcements.meetingStartsAt")}
                    rules={[{ required: true, message: t("hr.announcements.meetingStartsAtRequired") }]}
                  >
                    <DatePicker showTime style={{ width: "100%" }} size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="meeting_duration_minutes" label={t("hr.announcements.meetingDuration")}>
                    <InputNumber min={1} max={1440} style={{ width: "100%" }} size="large" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="meeting_location" label={t("hr.announcements.meetingLocation")}>
                <Input size="large" />
              </Form.Item>

              <Form.Item name="meeting_agenda" label={t("hr.announcements.meetingAgenda")}>
                <Input.TextArea rows={4} />
              </Form.Item>

              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="google_meet_url" label={t("hr.announcements.googleMeetUrl")}>
                    <Input prefix={<GoogleOutlined />} placeholder="https://meet.google.com/..." />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="microsoft_teams_url" label={t("hr.announcements.teamsUrl")}>
                    <Input prefix={<VideoCameraOutlined />} placeholder="https://teams.microsoft.com/..." />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="zoom_url" label={t("hr.announcements.zoomUrl")}>
                    <Input prefix={<VideoCameraOutlined />} placeholder="https://zoom.us/..." />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : (
            <Form.Item
              name="target_roles"
              label={t("hr.announcements.targetAudienceLabel")}
              rules={[{ required: true, message: t("hr.announcements.targetAudienceRequired") }]}
            >
              <Select mode="multiple" placeholder={t("hr.announcements.placeholderSelectRoles")} size="large">
                <Option value="ADMIN">{t("auth.role.admin")}</Option>
                <Option value="HR_MANAGER">{t("auth.role.hr_manager")}</Option>
                <Option value="MANAGER">{t("auth.role.manager")}</Option>
                <Option value="EMPLOYEE">{t("auth.role.employee")}</Option>
              </Select>
            </Form.Item>
          )}

          <Form.Item
            label={t("hr.announcements.attachmentLabel", "PDF Attachment (Optional)")}
            extra={t("hr.announcements.attachmentHelp", "Upload one PDF file. It will be previewable in the dashboard and included in email notifications.")}
          >
            <Upload
              accept="application/pdf,.pdf"
              maxCount={1}
              beforeUpload={(file) => {
                const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
                if (!isPdf) {
                  message.error(t("hr.announcements.attachmentPdfOnly", "Only PDF files are allowed."));
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
              <Button icon={<UploadOutlined />}>{t("hr.announcements.attachmentSelect", "Select PDF")}</Button>
            </Upload>
          </Form.Item>

          <div style={{ background: "#fafafa", padding: 16, borderRadius: 8, marginBottom: 24 }}>
            <Title level={5}>{t("hr.announcements.publishingOptions")}</Title>
            <Space direction="vertical" size={12}>
              <Space>
                <Form.Item name="publish_to_dashboard" valuePropName="checked" noStyle>
                  <Switch disabled />
                </Form.Item>
                <Text strong>{t("hr.announcements.dashboardLabel")}</Text>
              </Space>
              <Space>
                <Form.Item name="publish_to_email" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <Text strong>{t("hr.announcements.emailLabel")}</Text>
              </Space>
              <Space>
                <Form.Item name="publish_to_sms" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <Text strong>{t("hr.announcements.smsLabel")}</Text>
              </Space>
            </Space>
          </div>

          <Button type="primary" htmlType="submit" loading={saving} block size="large">
            {t("common.save", "Save")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
