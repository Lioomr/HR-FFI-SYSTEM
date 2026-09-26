import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Space, Tag, message, Tooltip, Popconfirm } from "antd";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  getAllAnnouncements,
  deleteAnnouncement,
  type AnnouncementListItem,
} from "../../../services/api/announcementApi";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";
import { formatDateOnly } from "../../../utils/dateTime";

export default function AnnouncementsManagementPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  // In Main Head Office this page lists and sends announcements that go to
  // every company; company-only announcements live under each company.
  const isHeadOffice = isHeadOfficeOrganization(user);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnnouncementListItem[]>([]);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const loadData = useCallback(
    async (page = 1, pageSize = 10) => {
      setLoading(true);
      try {
        const response = await getAllAnnouncements(page, pageSize);
        if (response.status === "success") {
          const announcements = response.data.items || [];
          setData(announcements);
          setPagination({
            current: page,
            pageSize: pageSize,
            total: response.data.count || 0,
          });
        }
      } catch {
        message.error(t("hr.announcements.errorLoad"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    loadData(1, 10);
  }, [loadData]);

  const handleDelete = async (id: number) => {
    try {
      await deleteAnnouncement(id);
      message.success(t("hr.announcements.successDeleted"));
      loadData(pagination.current, pagination.pageSize);
    } catch {
      message.error(t("hr.announcements.errorDelete"));
    }
  };

  const handleTableChange = (newPagination: any) => {
    loadData(newPagination.current, newPagination.pageSize);
  };

  const columns = [
    {
      title: t("hr.announcements.tableTitle"),
      dataIndex: "title",
      key: "title",
      render: (text: string, record: AnnouncementListItem) => (
        <Space>
          <strong>{text}</strong>
          {record.has_attachment && <Tag color="red">PDF</Tag>}
          {record.announcement_type === "MEETING" && (
            <Tag color="blue">{t("announcements.meeting.tag")}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: t("hr.announcements.tableTargetRoles"),
      dataIndex: "target_roles",
      key: "target_roles",
      render: (roles: string[], record: AnnouncementListItem) => (
        <>
          {record.target_user_email && (
            <Tag color="cyan">{record.target_user_email}</Tag>
          )}
          {record.whole_company && (
            <Tag color="green">
              {t("hr.announcements.wholeCompany", "Whole company")}
            </Tag>
          )}
          {record.whatsapp_group_id && (
            <Tag color="cyan">
              {t("hr.announcements.groupLabel")}:{" "}
              {record.whatsapp_group_name ||
                t("hr.announcements.groupUnavailableSelection")}
            </Tag>
          )}
          {record.whatsapp_group_status && (
            <Tag>
              {t(
                `hr.announcements.groupStatus.${record.whatsapp_group_status}`,
              )}
            </Tag>
          )}
          {roles.includes("CEO") && <Tag color="purple">CEO</Tag>}
        </>
      ),
    },
    {
      title: t("hr.announcements.tableCreatedBy"),
      dataIndex: "created_by_name",
      key: "created_by",
    },
    ...(isHeadOffice
      ? [
          {
            title: t("hr.announcements.companiesColumn"),
            dataIndex: "broadcast_company_names",
            key: "broadcast_company_names",
            render: (names?: string[]) =>
              names?.length
                ? names.map((name) => (
                    <Tag color="blue" key={name}>
                      {name}
                    </Tag>
                  ))
                : "-",
          },
        ]
      : []),
    {
      title: t("common.date"),
      dataIndex: "created_at",
      key: "created_at",
      render: (date: string) => formatDateOnly(date),
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_: any, record: AnnouncementListItem) => (
        <Space size="middle">
          <Tooltip title={t("common.edit")}>
            <Button
              type="text"
              icon={<EditOutlined style={{ color: "#faad14" }} />}
              onClick={() => navigate(`/hr/announcements/${record.id}/edit`)}
            />
          </Tooltip>
          <Popconfirm
            title={t("hr.announcements.deletePopconfirmTitle")}
            description={
              isHeadOffice
                ? t("hr.announcements.deleteBroadcastDesc")
                : t("hr.announcements.deletePopconfirmDesc")
            }
            onConfirm={() => handleDelete(record.id)}
            okText={t("common.yes")}
            cancelText={t("common.no")}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>
          {t("hr.announcements.managementTitle")}
        </h1>
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadData(pagination.current, pagination.pageSize)}
          >
            {t("common.refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate("/hr/announcements/create")}
            style={{ background: "#FF7F3E", borderColor: "#FF7F3E" }}
          >
            {isHeadOffice
              ? t("hr.announcements.broadcastCreateButton")
              : t("hr.announcements.createButton")}
          </Button>
        </Space>
      </div>

      {isHeadOffice && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("hr.announcements.broadcastTitle")}
          description={t("hr.announcements.broadcastListDescription")}
        />
      )}

      <ResponsiveTable
        mobileCard={{ titleKey: "title" }}
        columns={columns}
        dataSource={data}
        rowKey="id"
        pagination={pagination}
        loading={loading}
        onChange={handleTableChange}
        size="small"
        scroll={{ x: "max-content" }}
        bordered
      />
    </div>
  );
}
