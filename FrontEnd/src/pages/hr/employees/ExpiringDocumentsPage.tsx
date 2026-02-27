import { useEffect, useState } from "react";
import { Button, Card, InputNumber, message, Space, Table, Tag, Typography } from "antd";
import { BellOutlined, MailOutlined, MessageOutlined, ReloadOutlined } from "@ant-design/icons";
import { getExpiringEmployees, notifyExpiringEmployee, type ExpiringEmployee } from "../../../services/api/employeesApi";
import { useI18n } from "../../../i18n/useI18n";

const { Title, Text } = Typography;

export default function ExpiringDocumentsPage() {
  const { t } = useI18n();
  const [days, setDays] = useState<number | null>(30);
  const [loading, setLoading] = useState(false);
  const [notifyingId, setNotifyingId] = useState<number | null>(null);
  const [items, setItems] = useState<ExpiringEmployee[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const loadData = async (nextPage = page, nextPageSize = pageSize, nextDays = days) => {
    setLoading(true);
    try {
      const response = await getExpiringEmployees(nextDays || 30, nextPage, nextPageSize);
      if (response.status === "success") {
        setItems(response.data.items || []);
        setTotal(response.data.count || 0);
      } else {
        message.error(response.message || t("hr.expiringDocs.errorLoad"));
      }
    } catch (err: any) {
      message.error(err.message || t("hr.expiringDocs.errorLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(1, pageSize, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifyOne = async (employeeId: number, channels: Array<"email" | "whatsapp" | "announcement">) => {
    setNotifyingId(employeeId);
    try {
      const response = await notifyExpiringEmployee(employeeId, { channels, days: days || 30 });
      if (response.status === "success") {
        const delivery = response.data.delivery || {};
        const sentChannels = Object.entries(delivery)
          .filter(([, v]: any) => v?.sent)
          .map(([k]) => k);
        if (sentChannels.length > 0) {
          const displayChannels = sentChannels.map((ch) => (ch === "whatsapp" ? "WhatsApp" : ch));
          const annId = delivery?.announcement?.announcement_id;
          const extra = annId ? ` (announcement #${annId})` : "";
          message.success(t("hr.expiringDocs.successNotify", { channels: displayChannels.join(", ") }) + extra);
        } else {
          const reasons = Object.entries(delivery)
            .map(([k, v]: any) => (v?.reason ? `${k}: ${v.reason}` : null))
            .filter(Boolean)
            .join(" | ");
          message.warning(reasons ? `Not delivered. ${reasons}` : "No notification channel was delivered");
        }
      } else {
        message.error(response.message || t("hr.expiringDocs.errorNotify"));
      }
    } catch (err: any) {
      message.error(err.message || t("hr.expiringDocs.errorNotify"));
    } finally {
      setNotifyingId(null);
    }
  };

  const columns = [
    {
      title: t("hr.expiringDocs.colEmployee"),
      key: "employee",
      render: (_: unknown, record: ExpiringEmployee) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.full_name || record.employee_id}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.employee_id}
          </Text>
        </div>
      ),
    },
    {
      title: t("hr.expiringDocs.colContact"),
      key: "contact",
      render: (_: unknown, record: ExpiringEmployee) => (
        <div>
          <div>{record.linked_email || <Text type="secondary">{t("hr.expiringDocs.noEmail")}</Text>}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.mobile || t("hr.expiringDocs.noMobile")}
          </Text>
        </div>
      ),
    },
    {
      title: t("hr.expiringDocs.colExpiringDocs"),
      dataIndex: "documents",
      key: "documents",
      render: (docs: ExpiringEmployee["documents"]) => (
        <Space direction="vertical" size={4}>
          {docs.map((doc) => (
            <Tag key={`${doc.doc_type}-${doc.expiry_date}`} color={doc.days_left <= 7 ? "red" : "orange"}>
              {doc.label}: {doc.expiry_date} ({doc.days_left}d)
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t("hr.expiringDocs.colActions"),
      key: "actions",
      render: (_: unknown, record: ExpiringEmployee) => (
        <Space wrap>
          <Button
            size="small"
            icon={<MailOutlined />}
            disabled={!record.linked_email}
            loading={notifyingId === record.id}
            onClick={() => notifyOne(record.id, ["email"])}
          >
            {t("hr.expiringDocs.notifyEmail")}
          </Button>
          <Button
            size="small"
            icon={<MessageOutlined />}
            disabled={!record.mobile}
            loading={notifyingId === record.id}
            onClick={() => notifyOne(record.id, ["whatsapp"])}
          >
            {t("hr.expiringDocs.notifySms")}
          </Button>
          <Button
            size="small"
            icon={<BellOutlined />}
            disabled={!record.linked_email}
            loading={notifyingId === record.id}
            onClick={() => notifyOne(record.id, ["announcement"])}
          >
            {t("hr.expiringDocs.notifyAnnouncement")}
          </Button>
          <Button
            type="primary"
            size="small"
            loading={notifyingId === record.id}
            onClick={() => notifyOne(record.id, ["email", "whatsapp", "announcement"])}
          >
            {t("hr.expiringDocs.notifyAll")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>
          {t("hr.expiringDocs.title")}
        </Title>
        <Space>
          <Text>{t("hr.expiringDocs.windowDays")}</Text>
          <InputNumber min={1} max={365} value={days} onChange={(v) => setDays(v)} />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setPage(1);
              loadData(1, pageSize, days);
            }}
          >
            {t("common.refresh")}
          </Button>
        </Space>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
              loadData(nextPage, nextPageSize, days);
            },
          }}
        />
      </Card>
    </div>
  );
}
