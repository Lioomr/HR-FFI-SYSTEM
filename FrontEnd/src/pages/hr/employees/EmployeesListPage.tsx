
import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Input, Select, Table, Dropdown, Typography, Tooltip, Popover } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    PlusOutlined,
    SearchOutlined,
    FilterOutlined,
    DownloadOutlined,
    EllipsisOutlined,
    SortAscendingOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { getCountryCode } from "../../../utils/countries";
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

const AVATAR_BG_COLORS = ["#f56a00", "#1677ff", "#389e0d", "#722ed1", "#d46b08", "#08979c"];

function getInitials(name?: string) {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function getAvatarColor(name?: string) {
    const source = name || "";
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = source.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_BG_COLORS.length;
    return AVATAR_BG_COLORS[index];
}

function FlagBadge({ nationality }: { nationality?: string }) {
    const code = getCountryCode(nationality);

    if (!code) {
        return (
            <span style={{ minWidth: 24, textAlign: "center", color: "#8c8c8c", fontWeight: 600 }}>--</span>
        );
    }

    return (
        <span
            className={`fi fi-${code.toLowerCase()}`}
            aria-label={`${code} flag`}
            title={code}
            style={{
                width: 24,
                height: 18,
                borderRadius: 3,
                display: "inline-flex",
                backgroundSize: "cover",
                backgroundPosition: "center",
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
            }}
        />
    );
}

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
    const [nationalities, setNationalities] = useState<string[]>([]);
    const [filtersOpen, setFiltersOpen] = useState(false);

    /**
     * Fetch filter options
     */
    const loadFilterOptions = useCallback(async () => {
        try {
            const [deptRes, employeeRes] = await Promise.all([
                listDepartments(),
                listEmployees({ page: 1, page_size: 1000 }),
            ]);

            if (!isApiError(deptRes) && Array.isArray(deptRes.data)) {
                setDepartments(deptRes.data.map((d: any) => ({ code: d.code, name: d.name })));
            }
            if (!isApiError(employeeRes)) {
                const uniqueNationalities = Array.from(
                    new Set(
                        (employeeRes.data.results || [])
                            .map((employee) => employee.nationality || employee.nationality_en || employee.nationality_ar)
                            .filter((value): value is string => Boolean(value?.trim()))
                    )
                ).sort((a, b) => a.localeCompare(b));
                setNationalities(uniqueNationalities);
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
                nationality: filters.nationality || undefined,
                join_date_order: filters.joinDateOrder || undefined,
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

    const toggleJoinDateOrder = () => {
        const nextOrder = filters.joinDateOrder === "desc" ? "asc" : "desc";
        setFilters({ joinDateOrder: nextOrder });
    };

    const clearExtraFilters = () => {
        setFilters({ nationality: undefined, joinDateOrder: undefined });
    };

    const joinDateSortLabel =
        filters.joinDateOrder === "asc"
            ? t("employees.list.joinDateOldestFirst", "Joining Date: Oldest First")
            : filters.joinDateOrder === "desc"
              ? t("employees.list.joinDateNewestFirst", "Joining Date: Newest First")
              : t("employees.list.joinDateDefault", "Joining Date: Default");

    const moreFiltersContent = (
        <div style={{ width: 260, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>
                    {t("common.moreFilters")}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("employees.list.moreFiltersHelp", "Filter by nationality or sort by joining date.")}
                </Text>
            </div>

            <Select
                placeholder={t("employees.list.nationalityPlaceholder", "Nationality")}
                value={filters.nationality || undefined}
                onChange={(value) => setFilters({ nationality: value })}
                allowClear
                showSearch
                optionFilterProp="label"
                options={nationalities.map((nationality) => ({
                    value: nationality,
                    label: nationality,
                }))}
            />

            <Button icon={<SortAscendingOutlined />} onClick={toggleJoinDateOrder}>
                {joinDateSortLabel}
            </Button>

            <Button onClick={clearExtraFilters}>
                {t("common.clear", "Clear")}
            </Button>
        </div>
    );

    const columns: ColumnsType<Employee> = [
        {
            title: t("employees.list.colName"),
            key: "full_name",
            width: 250,
            render: (_, record) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                        style={{
                            width: 48,
                            height: 48,
                            minWidth: 48,
                            borderRadius: "50%",
                            backgroundColor: getAvatarColor(record.full_name),
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 24,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            lineHeight: 1,
                            boxSizing: "border-box",
                        }}
                    >
                        {getInitials(record.full_name)}
                    </div>
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
                    <FlagBadge nationality={record.nationality} />
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
            key: "hire_date",
            width: 140,
            render: (_, record) => {
                const joiningDate = record.hire_date;
                return joiningDate ? dayjs(joiningDate).format("MMM DD, YYYY") : "-";
            }
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
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
                    <div style={{ flex: 1, minWidth: 200 }}>
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

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <Select
                            placeholder={t("employees.list.departmentPlaceholder")}
                            value={filters.department || undefined}
                            onChange={(value) => setFilters({ department: value })}
                            size="large"
                            style={{ flex: '0 1 160px', minWidth: 120 }}
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
                            style={{ flex: '0 1 140px', minWidth: 110 }}
                            allowClear
                            bordered={false}
                            className="custom-select-filter"
                        >
                            <Option value="ACTIVE">{t("status.active")}</Option>
                            <Option value="SUSPENDED">{t("status.suspended")}</Option>
                            <Option value="TERMINATED">{t("status.terminated")}</Option>
                        </Select>

                        <Popover
                            content={moreFiltersContent}
                            trigger="click"
                            open={filtersOpen}
                            onOpenChange={setFiltersOpen}
                            placement="bottomRight"
                        >
                            <Tooltip title={t("common.moreFilters")}>
                                <Button
                                    size="large"
                                    icon={<FilterOutlined />}
                                    style={{
                                        borderRadius: 8,
                                        borderColor: filters.nationality || filters.joinDateOrder ? "#fa8c16" : undefined,
                                        color: filters.nationality || filters.joinDateOrder ? "#fa8c16" : undefined,
                                    }}
                                />
                            </Tooltip>
                        </Popover>

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
