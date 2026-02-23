import { useEffect, useState } from "react";
import { Form, Input, Button, Select, Switch, Card, message, Typography, Radio } from "antd";
import { useNavigate } from "react-router-dom";
import { createAnnouncement, type CreateAnnouncementData } from "../../services/api/announcementApi";
import { getManagerTeam, type ManagerTeamMember } from "../../services/api/managerApi";
import { isApiError } from "../../services/api/apiTypes";
import { useAuthStore } from "../../auth/authStore";

const { Title } = Typography;

export default function CreateTeamAnnouncementPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const announcementsPath = role === "CEO" ? "/ceo/announcements" : "/manager/announcements";
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [team, setTeam] = useState<ManagerTeamMember[]>([]);
  const [targetMode, setTargetMode] = useState<"all" | "single">("all");

  useEffect(() => {
    const loadTeam = async () => {
      try {
        const res = await getManagerTeam();
        if (!isApiError(res) && res.data) {
          setTeam(res.data);
        } else {
          setTeam([]);
        }
      } catch {
        message.error("Failed to load team members");
      }
    };
    loadTeam();
  }, []);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const data: CreateAnnouncementData = {
        title: values.title,
        content: values.content,
        target_roles: [],
        publish_to_dashboard: true,
        publish_to_email: values.publish_to_email,
        publish_to_sms: values.publish_to_sms,
      };

      if (targetMode === "single") {
        data.target_user = values.target_user;
      }

      await createAnnouncement(data);
      message.success("Announcement sent to team successfully");
      navigate(announcementsPath);
    } catch (e: any) {
      message.error(e?.response?.data?.message || "Failed to create announcement");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level={2} style={{ margin: 0 }}>
          {role === "CEO" ? "CEO Team Announcement" : "Team Announcement"}
        </Title>
        <Button onClick={() => navigate(announcementsPath)}>Cancel</Button>
      </div>

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            publish_to_email: false,
            publish_to_sms: false,
          }}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true, message: "Please enter a title" }]}>
            <Input placeholder="Enter announcement title" size="large" />
          </Form.Item>

          <Form.Item name="content" label="Content" rules={[{ required: true, message: "Please enter content" }]}>
            <Input.TextArea rows={6} placeholder="Enter announcement content" showCount maxLength={2000} />
          </Form.Item>

          <Form.Item label="Audience">
            <Radio.Group value={targetMode} onChange={(e) => setTargetMode(e.target.value)}>
              <Radio.Button value="all">All My Team</Radio.Button>
              <Radio.Button value="single">Single Team Member</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {targetMode === "single" && (
            <Form.Item
              name="target_user"
              label="Team Member"
              rules={[{ required: true, message: "Please select a team member" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={team.map((m) => ({
                  value: m.user_id ?? m.id,
                  label: `${m.full_name_en || m.full_name || m.employee_id} (${m.employee_id})`,
                }))}
                placeholder="Select team member"
              />
            </Form.Item>
          )}

          <div style={{ background: "#fafafa", padding: 16, borderRadius: 8, marginBottom: 24 }}>
            <Form.Item name="publish_to_email" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Switch /> Email Notification
            </Form.Item>
            <Form.Item name="publish_to_sms" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch /> SMS/WhatsApp Notification
            </Form.Item>
          </div>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Send to Team
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
