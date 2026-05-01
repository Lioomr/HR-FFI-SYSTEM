import { useEffect, useState } from "react";
import { Table, Avatar, Tag, Card, Input, Select, DatePicker, Button, Space, Typography } from "antd";
import { UserOutlined, SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import { useI18n } from "../../../i18n/useI18n";
import { getHrRecentActivity } from "../../../services/api/hrSummaryApi";
import type { HrRecentActivityItem } from "../../../services/api/hrSummaryApi";
import ErrorState from "../../../components/ui/ErrorState";
import dayjs from "dayjs";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function RecentActivityPage() {
    const { t } = useI18n();
    const user = useAuthStore((state) => state.user);
    const isHeadOffice = isHeadOfficeOrganization(user);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [data, setData] = useState<HrRecentActivityItem[]>([]);
    const [total, setTotal] = useState(0);

    // Filters
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [search, setSearch] = useState("");
    const [action, setAction] = useState<string | undefined>(undefined);
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

    const loadData = async (
        currentPage: number = page,
        size: number = pageSize,
        currentSearch: string = search,
        currentAction: string | undefined = action,
        currentDateRange: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null = dateRange
    ) => {
        setLoading(true);
        setError(null);
        try {
            const params: any = {
                page: currentPage,
                page_size: size,
            };

            if (currentSearch) params.search = currentSearch;
            if (currentAction) params.action = currentAction;
            if (currentDateRange && currentDateRange[0] && currentDateRange[1]) {
                params.from = currentDateRange[0].toISOString();
                params.to = currentDateRange[1].toISOString();
            }

            const response = await getHrRecentActivity(params);
            if (response.status === "error") {
                setError(response.message || t("error.loadData"));
            } else {
                setData(response.data.items || []);
                setTotal(response.data.count || 0);
            }
        } catch (err: any) {
            setError(err?.message || t("error.loadData"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData(1, pageSize, search, action, dateRange);
    }, []);

    const handleTableChange = (pagination: any) => {
        setPage(pagination.current);
        setPageSize(pagination.pageSize);
        loadData(pagination.current, pagination.pageSize, search, action, dateRange);
    };

    const handleSearch = () => {
        setPage(1);
        loadData(1, pageSize, search, action, dateRange);
    };

    const handleReset = () => {
        setSearch("");
        setAction(undefined);
        setDateRange(null);
        setPage(1);
        loadData(1, pageSize, "", undefined, null);
    };

    if (error) {
        return <ErrorState title={t("error.loadData")} description={error} onRetry={handleReset} />;
    }

    // Pre-defined action options mapping available system actions
    const actionOptions = [
        { label: t("common.all", "All"), value: "" },
        { label: t("audit.action.check_in", "Check In"), value: "attendance.check_in" },
        { label: t("audit.action.check_out", "Check Out"), value: "attendance.check_out" },
        { label: t("audit.action.employee_profile_created", "Create Employee"), value: "employee_profile_created" },
        { label: t("audit.action.employee_profile_updated", "Update Employee"), value: "employee_profile_updated" },
        { label: t("audit.action.leave_request_submitted", "Leave Request"), value: "leave_request_submitted" },
    ];

    const columns = [
        {
            title: t("hr.dashboard.actor", "Actor"),
            dataIndex: "employee",
            key: "employee",
            render: (text: string) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar
                        size={36}
                        icon={<UserOutlined />}
                        style={{
                            background: `hsl(${(text?.charCodeAt(0) || 0) * 13 % 360}, 65%, 55%)`,
                            fontWeight: 700,
                            fontSize: 14,
                            flexShrink: 0,
                        }}
                    >
                    </Avatar>
                    <span style={{ fontWeight: 600, color: "#0f172a" }}>{text}</span>
                </div>
            ),
        },
        {
            title: t("hr.dashboard.actionType", "Action Type"),
            dataIndex: "action",
            key: "action",
            render: (text: string) => <span style={{ color: "#64748b", fontWeight: 500 }}>{t(`audit.action.${text}`, text.replace(/_/g, ' '))}</span>,
        },
        {
            title: t("hr.dashboard.dateTime", "Date & Time"),
            dataIndex: "date",
            key: "date",
            render: (text: string) => <span style={{ color: "#94a3b8" }}>{text}</span>,
        },
        ...(isHeadOffice
            ? [{
                title: t("common.company", "Company"),
                dataIndex: "company_name",
                key: "company_name",
                render: (value?: string | null) => value ? <Tag color="blue">{value}</Tag> : "-",
            }]
            : []),
        {
            title: t("common.details", "Details"),
            dataIndex: "status",
            key: "status",
            render: (text: string, record: HrRecentActivityItem) => {
                let display = text;
                const match = text.match(/^(.*?)( \(#.*\))?$/);
                if (match) {
                    const entity = match[1];
                    const suffix = match[2] || '';
                    display = t(`audit.entity.${entity}`, entity) + suffix;
                }
                return (
                    <Tag color={record.statusColor || "default"} style={{ borderRadius: 20, padding: "4px 12px", border: 0, fontWeight: 600, fontSize: 13 }}>
                        {display}
                    </Tag>
                );
            },
        },
    ];

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 40 }}>
            <div style={{ marginBottom: 24 }}>
                <Title level={3} style={{ margin: 0 }}>{t("hr.dashboard.recentActivity", "Recent Activity")}</Title>
                <Text type="secondary">{t("hr.dashboard.recentActivityDesc", "View and filter all recent activity in the system")}</Text>
            </div>

            <Card bordered={false} style={{ borderRadius: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 24 }}>
                <Space size="middle" wrap style={{ marginBottom: 20 }}>
                    <Input
                        placeholder={t("hr.dashboard.filterByActor", "Search by Actor Name/Email")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onPressEnter={handleSearch}
                        prefix={<SearchOutlined />}
                        style={{ width: 250, borderRadius: 8 }}
                    />
                    <Select
                        placeholder={t("hr.dashboard.filterByAction", "Filter by Action Type")}
                        value={action}
                        onChange={(val) => setAction(val || undefined)}
                        options={actionOptions}
                        style={{ width: 200 }}
                        allowClear
                    />
                    <RangePicker
                        value={dateRange}
                        onChange={(val: any) => setDateRange(val)}
                        style={{ borderRadius: 8 }}
                    />
                    <Button type="primary" onClick={handleSearch} icon={<SearchOutlined />} style={{ borderRadius: 8 }}>
                        {t("common.search", "Search")}
                    </Button>
                    <Button onClick={handleReset} icon={<ReloadOutlined />} style={{ borderRadius: 8 }}>
                        {t("common.reset", "Reset")}
                    </Button>
                </Space>

                <Table
                    columns={columns}
                    dataSource={data}
                    loading={loading}
                    onChange={handleTableChange}
                    pagination={{
                        current: page,
                        pageSize: pageSize,
                        total: total,
                        showSizeChanger: true,
                        showTotal: (total) => t("common.totalItems", { total: total.toString() }),
                    }}
                    scroll={{ x: 800 }}
                />
            </Card>
        </div>
    );
}
