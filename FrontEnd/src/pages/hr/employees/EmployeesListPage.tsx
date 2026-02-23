
import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Input, Select, Table, Avatar, Dropdown, Typography, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    PlusOutlined,
    SearchOutlined,
    FilterOutlined,
    DownloadOutlined,
    EllipsisOutlined,
    UserOutlined
} from "@ant-design/icons";
import dayjs from "dayjs";
import { getCountryCode, getCountryFlag, getCountryFlagImageUrl } from "../../../utils/countries";
import { useI18n } from "../../../i18n/useI18n";

/**
 * Custom debounce hook
 */
function useDebounce<T extends (...args: any[]) => any>(
    callback: T,
    delay: number
): (...args: Parameters<T>) => void {
    const timeoutRef = useRef<number | undefined>(undefined);

    return useCallback(
        (...args: Parameters<T>) => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                callback(...args);
            }, delay);
        },
        [callback, delay]
    );
}

import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";

import { useHrEmployeeListStore } from "../../../stores/hrEmployeeListStore";
import type { Employee } from "../../../services/api/employeesApi";
import { listEmployees } from "../../../services/api/employeesApi";
import { listDepartments } from "../../../services/api/departmentsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

const { Option } = Select;
const { Title, Text } = Typography;

// Status Badge Helper
const StatusBadge = ({ status, t }: { status?: string; t: (k: string, f?: string) => string }) => {
    let color = '';
    let text = status || t("status.unknown");
    let bg = '';

    switch (status) {
        case 'ACTIVE':
            color = '#389e0d';
            bg = 'rgba(82, 196, 26, 0.1)';
            text = t("status.active");
            break;
        case 'ON_LEAVE':
            color = '#d46b08';
            bg = 'rgba(250, 140, 22, 0.1)';
            text = t("status.onLeave");
            break;
        case 'TERMINATED':
            color = '#cf1322';
            bg = 'rgba(255, 77, 79, 0.1)';
            text = t("status.terminated");
            break;
        case 'SUSPENDED':
            color = '#cf1322';
            bg = 'rgba(255, 77, 79, 0.1)';
            text = t("status.suspended");
            break;
        default:
            color = '#595959';
            bg = '#f5f5f5';
    }

    return (
        <span style={{
            color: color,
            backgroundColor: bg,
            padding: '4px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            display: 'inline-block',
            textAlign: 'center',
            minWidth: 80
        }}>
            • {text}
        </span>
    );
};

export default function EmployeesListPage() {
    const navigate = useNavigate();
    const { t } = useI18n();

    // State from Zustand store (persisted)
    const {
        search,
        filters,
        page,
        pageSize,
        setSearch,
        setFilters,
        setPage,
        setPageSize,
    } = useHrEmployeeListStore();

    // Local state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [total, setTotal] = useState(0);

    // Filter options state
    const [departments, setDepartments] = useState<{ code: string; name: string }[]>([]);

    /**
     * Fetch filter options
     */
    const loadFilterOptions = useCallback(async () => {
        try {
            const [deptRes] = await Promise.all([
                listDepartments(),
            ]);

            if (!isApiError(deptRes) && Array.isArray(deptRes.data)) {
                setDepartments(deptRes.data.map((d: any) => ({ code: d.code, name: d.name })));
            }
        } catch (err) {
            console.error("Failed to load filter options:", err);
        }
    }, []);

    /**
     * Fetch employees list
     */
    const loadEmployees = useCallback(async () => {
        setLoading(true);
        setError(null);
        setForbidden(false);

        try {
            const params = {
                page,
                page_size: pageSize,
                search: search || undefined,
                department: filters.department || undefined,
                position: filters.position || undefined,
                status: filters.status || undefined,
            };

            const response = await listEmployees(params);

            if (isApiError(response)) {
                setError(response.message || t("error.generic"));
                setLoading(false);
                return;
            }

            setEmployees(response.data.results || []);
            setTotal(response.data.count || 0);
            setLoading(false);
        } catch (err: any) {
            if (isForbidden(err)) {
                setForbidden(true);
                setLoading(false);
                return;
            }

            setError(err.message || t("error.generic"));
            setLoading(false);
        }
    }, [page, pageSize, search, filters]);

    useEffect(() => {
        loadFilterOptions();
    }, [loadFilterOptions]);

    useEffect(() => {
        loadEmployees();
    }, [loadEmployees]);

    const debouncedSearch = useDebounce((value: string) => {
        setSearch(value);
    }, 300);

    const handleRowClick = (record: Employee) => {
        navigate(`/hr/employees/${record.id}`);
    };

    const getActionItems = (record: Employee): MenuProps['items'] => [
        {
            key: 'view',
            label: t("employees.list.actionView"),
            onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                navigate(`/hr/employees/${record.id}`);
            }
        },
        {
            key: 'edit',
            label: t("employees.list.actionEdit"),
            onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                navigate(`/hr/employees/${record.id}/edit`);
            }
        },
        {
            key: 'delete',
            label: t("employees.list.actionDelete"),
            danger: true,
            onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                // delete logic here
            }
        },
    ];

    const columns: ColumnsType<Employee> = [
        {
            title: t("employees.list.colName"),
            key: "full_name",
            width: 250,
            render: (_, record) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar size={40} src={`https://ui-avatars.com/api/?name=${record.full_name}&background=random`} icon={<UserOutlined />} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <Text strong style={{ fontSize: 14 }}>{record.full_name}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{record.email}</Text>
                    </div>
                </div>
            )
        },
        {
            title: t("employees.list.colNationality"),
            key: "nationality",
            width: 150,
            render: (_, record) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getCountryFlagImageUrl(record.nationality) ? (
                        <img
                            src={getCountryFlagImageUrl(record.nationality)!}
                            alt={`${getCountryCode(record.nationality) || "country"} flag`}
                            width={20}
                            height={15}
                            style={{ objectFit: "cover", borderRadius: 2, border: "1px solid #f0f0f0" }}
                            loading="lazy"
                        />
                    ) : (
                        <span
                            style={{
                                fontSize: 18,
                                fontFamily: "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif",
                                lineHeight: 1,
                            }}
                        >
                            {getCountryFlag(record.nationality)}
                        </span>
                    )}
                    <Text>{record.nationality || t("employees.list.saudiArabia")}</Text>
                </div>
            )
        },
        {
            title: t("employees.list.colPosition"),
            dataIndex: "position",
            key: "position",
            width: 180,
            render: (text) => <Text strong>{text || "-"}</Text>
        },
        {
            title: t("employees.list.colDepartment"),
            dataIndex: "department",
            key: "department",
            width: 160,
            render: (text) => <Text>{text || "-"}</Text>
        },
        {
            title: t("employees.list.colManager"),
            key: "manager",
            width: 220,
            render: (_, record) => <Text>{record.manager_profile_name || record.manager_name || "-"}</Text>
        },
        {
            title: t("employees.list.colJoiningDate"),
            dataIndex: "hire_date",
            key: "hire_date",
            width: 140,
            render: (text) => text ? dayjs(text).format("MMM DD, YYYY") : "-"
        },
        {
            title: t("employees.list.colStatus"),
            dataIndex: "employment_status",
            key: "employment_status",
            width: 120,
            render: (status) => <StatusBadge status={status} t={t} />
        },
        {
            title: t("employees.list.colAction"),
            key: "action",
            width: 80,
            align: 'center',
            render: (_, record) => (
                <div onClick={(e) => e.stopPropagation()}>
                    <Dropdown menu={{ items: getActionItems(record) }} trigger={['click']}>
                        <Button type="text" icon={<EllipsisOutlined style={{ fontSize: 20, color: '#8c8c8c' }} />} />
                    </Dropdown>
                </div>
            )
        }
    ];

    if (forbidden) return <Unauthorized403Page />;

    return (
        <div style={{ padding: '0 12px' }}>
            {/* Header Section */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <Title level={2} style={{ margin: 0, fontWeight: 700 }}>{t("employees.list.title")}</Title>
                    <Text type="secondary">{t("employees.list.subtitle")}</Text>
                </div>
                <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined />}
                    onClick={() => navigate("/hr/employees/create")}
                    style={{
                        backgroundColor: '#fa8c16',
                        borderColor: '#fa8c16',
                        borderRadius: 8,
                        height: 44,
                        paddingLeft: 24,
                        paddingRight: 24,
                        boxShadow: '0 4px 10px rgba(250, 140, 22, 0.2)'
                    }}
                >
                    {t("employees.list.createEmployee")}
                </Button>
            </div>

            {/* Filter Section */}
            <Card bordered={false} style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }} bodyStyle={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 300 }}>
                        <Input
                            placeholder={t("employees.list.searchPlaceholder")}
                            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                            defaultValue={search}
                            onChange={(e) => debouncedSearch(e.target.value)}
                            size="large"
                            style={{
                                borderRadius: 8,
                                backgroundColor: '#f9f9f9',
                                border: '1px solid #f0f0f0',
                                width: '100%',
                                maxWidth: 400
                            }}
                            bordered={false}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: 12 }}>
                        <Select
                            placeholder={t("employees.list.departmentPlaceholder")}
                            value={filters.department || undefined}
                            onChange={(value) => setFilters({ department: value })}
                            size="large"
                            style={{ width: 160 }}
                            allowClear
                            bordered={false}
                            className="custom-select-filter"
                            dropdownStyle={{ borderRadius: 8 }}
                        >
                            {departments.map((dept) => (
                                <Option key={dept.code} value={dept.code}>{dept.name}</Option>
                            ))}
                        </Select>

                        <Select
                            placeholder={t("employees.list.statusPlaceholder")}
                            value={filters.status || undefined}
                            onChange={(value) => setFilters({ status: value })}
                            size="large"
                            style={{ width: 140 }}
                            allowClear
                            bordered={false}
                            className="custom-select-filter"
                        >
                            <Option value="ACTIVE">{t("status.active")}</Option>
                            <Option value="ON_LEAVE">{t("status.onLeave")}</Option>
                            <Option value="SUSPENDED">{t("status.suspended")}</Option>
                            <Option value="TERMINATED">{t("status.terminated")}</Option>
                        </Select>

                        <Tooltip title={t("common.moreFilters")}>
                            <Button size="large" icon={<FilterOutlined />} style={{ borderRadius: 8 }} />
                        </Tooltip>

                        <Tooltip title={t("common.export")}>
                            <Button size="large" icon={<DownloadOutlined />} style={{ borderRadius: 8 }} />
                        </Tooltip>
                    </div>
                </div>
            </Card>

            {/* Table Section */}
            <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.02)' }} bodyStyle={{ padding: 0 }}>
                {loading && employees.length === 0 ? (
                    <div style={{ padding: 40 }}><LoadingState /></div>
                ) : error ? (
                    <div style={{ padding: 40 }}><ErrorState title={t("common.error")} description={error} onRetry={loadEmployees} /></div>
                ) : (
                    <Table
                        dataSource={employees}
                        columns={columns}
                        rowKey="id"
                        pagination={{
                            current: page,
                            pageSize: pageSize,
                            total: total,
                            onChange: (newPage, newPageSize) => {
                                setPage(newPage);
                                setPageSize(newPageSize);
                            },
                            showTotal: (total, range) => `${t("common.showing")} ${range[0]} ${t("common.to")} ${range[1]} ${t("common.of")} ${total} ${t("common.entries")}`,
                            style: { padding: '24px' }
                        }}
                        onRow={(record) => ({
                            onClick: () => handleRowClick(record),
                            style: { cursor: 'pointer' }
                        })}
                        scroll={{ x: 1000 }}
                    />
                )}
            </Card>

            <style>{`
                .custom-select-filter .ant-select-selector {
                    background-color: #fff !important;
                    border: 1px solid #d9d9d9 !important;
                    border-radius: 8px !important;
                }
                .ant-table-thead > tr > th {
                    background: #fff !important;
                    color: #8c8c8c !important;
                    font-weight: 600 !important;
                    font-size: 12px !important;
                    text-transform: uppercase !important;
                    border-bottom: 1px solid #f0f0f0 !important;
                }
                .ant-table-tbody > tr > td {
                    padding: 16px 16px !important;
                }
                .ant-table-tbody > tr:hover > td {
                    background: #fafafa !important;
                }
            `}</style>
        </div>
    );
}
