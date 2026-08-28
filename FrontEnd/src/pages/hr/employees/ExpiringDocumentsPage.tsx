import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  message,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  BellOutlined,
  MailOutlined,
  MessageOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  getExpiringEmployees,
  notifyExpiringEmployee,
  type ExpiringDocumentItem,
  type ExpiringEmployee,
} from "../../../services/api/employeesApi";
import { useI18n } from "../../../i18n/useI18n";
import { STORAGE_KEYS } from "../../../utils/storageKeys";

const { Title, Text } = Typography;
const DEFAULT_WINDOW_DAYS = 30;
const EXPIRING_DOCS_DAYS_STORAGE_KEY = STORAGE_KEYS.expiringDocumentsWindowDays;

function getStoredWindowDays(): number {
  if (typeof window === "undefined") {
    return DEFAULT_WINDOW_DAYS;
  }

  const raw = window.localStorage.getItem(EXPIRING_DOCS_DAYS_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return DEFAULT_WINDOW_DAYS;
  }

  return parsed;
}

/**
 * The endpoint identifies work licences via `document_type: "WORK_LICENSE"` and the
 * older document families via `doc_type`. Returns null when neither is present, so an
 * unrecognised document falls back to the server-supplied label instead of being
 * mislabelled as a work licence.
 */
function getDocumentTypeKey(document: ExpiringDocumentItem): string | null {
  if (document.document_type === "WORK_LICENSE") return "work_license";
  return document.doc_type || null;
}

function ExpiryDocumentTag({
  document,
  employeeId,
}: {
  document: ExpiringDocumentItem;
  employeeId: number;
}) {
  const { t } = useI18n();
  const documentType = getDocumentTypeKey(document);
  const documentLabel = documentType
    ? t(`hr.expiringDocs.docType.${documentType}`)
    : document.label;
  const hasExpiryDate = Boolean(document.expiry_date);
  const isExpired = hasExpiryDate && document.days_left < 0;
  const statusLabel = !hasExpiryDate
    ? t("hr.expiringDocs.statusUnknown")
    : isExpired
      ? t("hr.expiringDocs.statusExpired")
      : t("hr.expiringDocs.statusExpiring");
  const daysLabel = isExpired
    ? t("hr.expiringDocs.daysOverdue", { days: Math.abs(document.days_left) })
    : t("hr.expiringDocs.daysRemaining", { days: document.days_left });

  return (
    <Tag
      data-testid={`expiry-document-${employeeId}-${documentType ?? "unknown"}`}
      color={
        !hasExpiryDate
          ? "default"
          : isExpired || document.days_left <= 7
            ? "red"
            : "orange"
      }
    >
      {documentLabel}:{" "}
      {document.expiry_date || t("hr.expiringDocs.missingExpiryDate")}
      {hasExpiryDate ? ` · ${daysLabel}` : ""} · {statusLabel}
    </Tag>
  );
}

export default function ExpiringDocumentsPage() {
  const { t } = useI18n();
  const [days, setDays] = useState<number | null>(() => getStoredWindowDays());
  const [loading, setLoading] = useState(false);
  const [notifyingId, setNotifyingId] = useState<number | null>(null);
  const [items, setItems] = useState<ExpiringEmployee[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const updateDays = (value: number | null) => {
    setDays(value);

    if (typeof window === "undefined") {
      return;
    }

    if (value === null) {
      window.localStorage.removeItem(EXPIRING_DOCS_DAYS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(EXPIRING_DOCS_DAYS_STORAGE_KEY, String(value));
  };

  const loadData = async (
    nextPage = page,
    nextPageSize = pageSize,
    nextDays = days,
  ) => {
    setLoading(true);
    try {
      const response = await getExpiringEmployees(
        nextDays || DEFAULT_WINDOW_DAYS,
        nextPage,
        nextPageSize,
      );
      if (response.status === "success") {
        const responseItems = response.data.items || [];
        const visibleItems = responseItems.filter((item) => !item.is_archived);
        setItems(visibleItems);
        setTotal(
          Math.max(
            0,
            (response.data.count || 0) -
              (responseItems.length - visibleItems.length),
          ),
        );
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

  const notifyOne = async (
    employeeId: number,
    channels: Array<"email" | "whatsapp" | "announcement">,
  ) => {
    setNotifyingId(employeeId);
    try {
      const response = await notifyExpiringEmployee(employeeId, {
        channels,
        days: days || DEFAULT_WINDOW_DAYS,
      });
      if (response.status === "success") {
        const delivery = response.data.delivery || {};
        const sentChannels = Object.entries(delivery)
          .filter(([, v]: any) => v?.sent)
          .map(([k]) => k);
        if (sentChannels.length > 0) {
          const displayChannels = sentChannels.map((ch) => {
            if (ch === "email") return t("hr.expiringDocs.notifyEmail");
            if (ch === "whatsapp") return t("hr.expiringDocs.notifySms");
            return t("hr.expiringDocs.notifyAnnouncement");
          });
          const annId = delivery?.announcement?.announcement_id;
          const extra = annId
            ? ` (${t("hr.expiringDocs.announcementRef", { id: annId })})`
            : "";
          message.success(
            t("hr.expiringDocs.successNotify", {
              channels: displayChannels.join(", "),
            }) + extra,
          );
        } else {
          const reasons = Object.entries(delivery)
            .map(([k, v]: any) => (v?.reason ? `${k}: ${v.reason}` : null))
            .filter(Boolean)
            .join(" | ");
          message.warning(
            reasons
              ? `${t("hr.expiringDocs.notDelivered")} ${reasons}`
              : t("hr.expiringDocs.noDeliveredChannels"),
          );
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
          <div style={{ fontWeight: 600 }}>
            <Link
              to={`/hr/employees/${record.id}`}
              style={{
                color: "var(--ant-color-primary)",
                textDecoration: "none",
              }}
            >
              {record.full_name || record.employee_id}
            </Link>
          </div>
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
          <div>
            {record.linked_email || (
              <Text type="secondary">{t("hr.expiringDocs.noEmail")}</Text>
            )}
          </div>
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
      render: (
        docs: ExpiringEmployee["documents"],
        record: ExpiringEmployee,
      ) => (
        <Space direction="vertical" size={4}>
          {docs.map((doc, index) => (
            <ExpiryDocumentTag
              key={`${getDocumentTypeKey(doc) ?? "unknown"}-${doc.expiry_date || index}`}
              document={doc}
              employeeId={record.id}
            />
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
            onClick={() =>
              notifyOne(record.id, ["email", "whatsapp", "announcement"])
            }
          >
            {t("hr.expiringDocs.notifyAll")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          {t("hr.expiringDocs.title")}
        </Title>
        <Space>
          <Text>{t("hr.expiringDocs.windowDays")}</Text>
          <InputNumber min={1} max={365} value={days} onChange={updateDays} />
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

      <Alert
        type="info"
        showIcon
        title={t("hr.expiringDocs.automaticReminderInfo")}
        style={{ marginBottom: 16, borderRadius: 12 }}
      />

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          size="small"
          scroll={{ x: "max-content" }}
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
