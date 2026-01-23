import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Input, Select, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";

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

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";

import { useHrEmployeeListStore } from "../../../stores/hrEmployeeListStore";
import type { Employee } from "../../../services/api/employeesApi";
import { listEmployees } from "../../../services/api/employeesApi";
import { listDepartments } from "../../../services/api/departmentsApi";
import { listPositions } from "../../../services/api/positionsApi";
import { listTaskGroups } from "../../../services/api/taskGroupsApi";
import { listSponsors } from "../../../services/api/sponsorsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

const { Option } = Select;

/**
 * Table columns definition
 */
const columns: ColumnsType<Employee> = [
    {
        title: "Employee ID",
        dataIndex: "employee_id",
        key: "employee_id",
        width: 120,
    },
    {
        title: "Name",
        dataIndex: "full_name",
        key: "full_name",
    },
    {
        title: "Email",
        dataIndex: "email",
        key: "email",
    },
    {
        title: "Mobile",
        dataIndex: "mobile",
        key: "mobile",
        width: 140,
    },
    {
        title: "Department",
        dataIndex: "department",
        key: "department",
        width: 150,
    },
    {
        title: "Position",
        dataIndex: "position",
        key: "position",
        width: 150,
    },
    {
        title: "Status",
        dataIndex: "employment_status",
        key: "employment_status",
        width: 120,
    },
];

/**
 * HR Employees List Page
 * Supports search, filters, pagination, and state persistence
 */
export default function EmployeesListPage() {
    const navigate = useNavigate();

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
    const [positions, setPositions] = useState<{ code: string; name: string }[]>([]);
    const [taskGroups, setTaskGroups] = useState<{ code: string; name: string }[]>([]);
    const [sponsors, setSponsors] = useState<{ code: string; name: string }[]>([]);

    /**
     * Fetch filter options (reference data)
     */
    const loadFilterOptions = useCallback(async () => {
        try {
            const [deptRes, posRes, tgRes, sponsorRes] = await Promise.all([
                listDepartments(),
                listPositions(),
                listTaskGroups(),
                listSponsors(),
            ]);

            if (!isApiError(deptRes) && Array.isArray(deptRes.data)) {
                setDepartments(deptRes.data.map((d: any) => ({ code: d.code, name: d.name })));
            }
            if (!isApiError(posRes) && Array.isArray(posRes.data)) {
                setPositions(posRes.data.map((p: any) => ({ code: p.code, name: p.name })));
            }
            if (!isApiError(tgRes) && Array.isArray(tgRes.data)) {
                setTaskGroups(tgRes.data.map((t: any) => ({ code: t.code, name: t.name })));
            }
            if (!isApiError(sponsorRes) && Array.isArray(sponsorRes.data)) {
                setSponsors(sponsorRes.data.map((s: any) => ({ code: s.code, name: s.name })));
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
                task_group: filters.task_group || undefined,
                sponsor: filters.sponsor || undefined,
                status: filters.status || undefined,
            };

            const response = await listEmployees(params);

            if (isApiError(response)) {
                setError(response.message || "Failed to load employees");
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

            setError(err.message || "Failed to load employees");
            setLoading(false);
        }
    }, [page, pageSize, search, filters]);

    /**
     * Initial load
     */
    useEffect(() => {
        loadFilterOptions();
    }, [loadFilterOptions]);

    useEffect(() => {
        loadEmployees();
    }, [loadEmployees]);

    /**
     * Debounced search handler
     */
    const debouncedSearch = useDebounce((value: string) => {
        setSearch(value);
    }, 300);

    /**
     * Handle row click - navigate to employee detail
     */
    const handleRowClick = (record: Employee) => {
        navigate(`/hr/employees/${record.id}`);
    };

    // Render 403 unauthorized page
    if (forbidden) {
        return <Unauthorized403Page />;
    }

    // Render loading state
    if (loading && employees.length === 0) {
        return <LoadingState title="Loading employees..." />;
    }

    // Render error state
    if (error && employees.length === 0) {
        return (
            <ErrorState
                title="Failed to load employees"
                description={error}
                onRetry={loadEmployees}
            />
        );
    }

    // Render empty state
    if (!loading && employees.length === 0 && !search && Object.keys(filters).length === 0) {
        return (
            <EmptyState
                title="No data available"
                description="No employees found."
                actionText="Create Employee"
                onAction={() => navigate("/hr/employees/create")}
            />
        );
    }

    return (
        <div>
            <PageHeader
                title="Employees"
                actions={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate("/hr/employees/create")}
                    >
                        Create Employee
                    </Button>
                }
            />

            <Card style={{ borderRadius: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {/* Search */}
                    <Input
                        placeholder="Search by name, mobile, ID, or passport"
                        prefix={<SearchOutlined />}
                        defaultValue={search}
                        onChange={(e) => debouncedSearch(e.target.value)}
                        style={{ width: 300 }}
                        allowClear
                    />

                    {/* Department Filter */}
                    <Select
                        placeholder="Department"
                        value={filters.department || undefined}
                        onChange={(value) => setFilters({ department: value })}
                        style={{ width: 180 }}
                        allowClear
                    >
                        {departments.map((dept) => (
                            <Option key={dept.code} value={dept.code}>
                                {dept.name}
                            </Option>
                        ))}
                    </Select>

                    {/* Position Filter */}
                    <Select
                        placeholder="Position"
                        value={filters.position || undefined}
                        onChange={(value) => setFilters({ position: value })}
                        style={{ width: 180 }}
                        allowClear
                    >
                        {positions.map((pos) => (
                            <Option key={pos.code} value={pos.code}>
                                {pos.name}
                            </Option>
                        ))}
                    </Select>

                    {/* Task Group Filter */}
                    <Select
                        placeholder="Task Group"
                        value={filters.task_group || undefined}
                        onChange={(value) => setFilters({ task_group: value })}
                        style={{ width: 180 }}
                        allowClear
                    >
                        {taskGroups.map((tg) => (
                            <Option key={tg.code} value={tg.code}>
                                {tg.name}
                            </Option>
                        ))}
                    </Select>

                    {/* Sponsor Filter */}
                    <Select
                        placeholder="Sponsor"
                        value={filters.sponsor || undefined}
                        onChange={(value) => setFilters({ sponsor: value })}
                        style={{ width: 180 }}
                        allowClear
                    >
                        {sponsors.map((sponsor) => (
                            <Option key={sponsor.code} value={sponsor.code}>
                                {sponsor.name || sponsor.code}
                            </Option>
                        ))}
                    </Select>

                    {/* Status Filter */}
                    <Select
                        placeholder="Status"
                        value={filters.status || undefined}
                        onChange={(value) => setFilters({ status: value })}
                        style={{ width: 150 }}
                        allowClear
                    >
                        <Option value="ACTIVE">Active</Option>
                        <Option value="SUSPENDED">Suspended</Option>
                        <Option value="TERMINATED">Terminated</Option>
                    </Select>
                </div>
            </Card>

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={employees}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                        current: page,
                        pageSize: pageSize,
                        total: total,
                        onChange: (newPage, newPageSize) => {
                            setPage(newPage);
                            if (newPageSize !== pageSize) {
                                setPageSize(newPageSize);
                            }
                        },
                        showSizeChanger: true,
                        showTotal: (total) => `Total ${total} employees`,
                    }}
                    onRow={(record) => ({
                        onClick: () => handleRowClick(record),
                        style: { cursor: "pointer" },
                    })}
                />
            </Card>
        </div>
    );
}
