import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Space } from "antd";
import { ArrowLeftOutlined, EditOutlined } from "@ant-design/icons";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getEmployee } from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

/**
 * Format value for display (show "—" for missing values)
 */
const formatValue = (value: any): string => {
    if (value === null || value === undefined || value === "") {
        return "—";
    }
    return String(value);
};

/**
 * Format currency value
 */
const formatCurrency = (value: any): string => {
    if (value === null || value === undefined || value === "") {
        return "—";
    }
    const num = Number(value);
    if (isNaN(num)) {
        return "—";
    }
    return num.toFixed(2);
};

/**
 * Format date value (YYYY-MM-DD)
 */
const formatDate = (value: any): string => {
    if (!value) {
        return "—";
    }
    // If already in YYYY-MM-DD format, return as is
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.split("T")[0]; // Remove time component if present
    }
    return formatValue(value);
};

export default function ViewEmployeePage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [employee, setEmployee] = useState<Employee | null>(null);

    /**
     * Load employee data
     */
    useEffect(() => {
        const loadEmployee = async () => {
            if (!id) {
                setError("No employee ID provided");
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);
            setForbidden(false);

            try {
                const response = await getEmployee(id);

                if (isApiError(response)) {
                    setError(response.message || "Failed to load employee");
                    setLoading(false);
                    return;
                }

                setEmployee(response.data);
                setLoading(false);
            } catch (err: any) {
                if (isForbidden(err)) {
                    setForbidden(true);
                    setLoading(false);
                    return;
                }

                setError(err.message || "Failed to load employee");
                setLoading(false);
            }
        };

        loadEmployee();
    }, [id]);

    /**
     * Handle back navigation
     */
    const handleBack = () => {
        navigate("/hr/employees");
    };

    /**
     * Handle edit navigation
     */
    const handleEdit = () => {
        navigate(`/hr/employees/${id}/edit`);
    };

    // Render 403 page
    if (forbidden) {
        return <Unauthorized403Page />;
    }

    // Render loading state
    if (loading) {
        return <LoadingState title="Loading employee details..." />;
    }

    // Render error state
    if (error) {
        return (
            <ErrorState
                title="Failed to load employee"
                description={error}
                onRetry={() => window.location.reload()}
            />
        );
    }

    // Render empty state
    if (!employee) {
        return (
            <EmptyState
                title="No data available"
                description="Employee not found"
                actionText="Back to List"
                onAction={handleBack}
            />
        );
    }

    // Build subtitle with key identifiers
    const subtitle = [
        employee.full_name,
        employee.mobile ? `Mobile: ${employee.mobile}` : null,
    ]
        .filter(Boolean)
        .join(" • ");

    return (
        <div>
            <PageHeader
                title="Employee Details"
                subtitle={subtitle || undefined}
                actions={
                    <Space>
                        <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                            Back
                        </Button>
                        <Button type="primary" icon={<EditOutlined />} onClick={handleEdit}>
                            Edit
                        </Button>
                    </Space>
                }
            />

            {/* Personal Info Section */}
            <Card title="Personal Info" style={{ borderRadius: 16, marginBottom: 16 }}>
                <Descriptions column={2} bordered>
                    <Descriptions.Item label="Emp Full Name">
                        {formatValue(employee.full_name)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Employee number">
                        {formatValue((employee as any).employee_number)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Nationality">
                        {formatValue((employee as any).nationality)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Date Of Birth">
                        {formatDate((employee as any).date_of_birth)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Mobile Number">
                        {formatValue(employee.mobile)}
                    </Descriptions.Item>
                </Descriptions>
            </Card>

            {/* Employment Info Section */}
            <Card title="Employment Info" style={{ borderRadius: 16, marginBottom: 16 }}>
                <Descriptions column={2} bordered>
                    <Descriptions.Item label="department">
                        {formatValue(employee.department)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Position Name">
                        {formatValue(employee.position)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Task Group Name">
                        {formatValue(employee.task_group)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Sponsor Code">
                        {formatValue(employee.sponsor)}
                    </Descriptions.Item>
                    <Descriptions.Item label="JOB OFFER">
                        {formatValue((employee as any).job_offer)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Joining Date">
                        {formatDate((employee as any).join_date || employee.hire_date)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Contract date">
                        {formatDate((employee as any).contract_date)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Contract Expiry Date">
                        {formatDate((employee as any).contract_expiry)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Allowed Overtime">
                        {formatValue((employee as any).allowed_overtime)}
                    </Descriptions.Item>
                </Descriptions>
            </Card>

            {/* Documents Section */}
            <Card title="Documents" style={{ borderRadius: 16, marginBottom: 16 }}>
                <Descriptions column={2} bordered>
                    <Descriptions.Item label="Passport Number">
                        {formatValue(employee.passport || (employee as any).passport_no)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Passport Expiry">
                        {formatDate((employee as any).passport_expiry)}
                    </Descriptions.Item>
                    <Descriptions.Item label="ID">
                        {formatValue((employee as any).national_id)}
                    </Descriptions.Item>
                    <Descriptions.Item label="ID Expiry">
                        {formatDate((employee as any).id_expiry)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Health Card">
                        {formatValue((employee as any).health_card)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Health Card Expiry">
                        {formatDate((employee as any).health_card_expiry)}
                    </Descriptions.Item>
                </Descriptions>
            </Card>

            {/* Salary & Allowances Section */}
            <Card title="Salary & Allowances" style={{ borderRadius: 16, marginBottom: 16 }}>
                <Descriptions column={2} bordered>
                    <Descriptions.Item label="Basic Salary">
                        {formatCurrency((employee as any).basic_salary)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Transportation Allowance">
                        {formatCurrency((employee as any).transportation_allowance)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Accommodation Allowance">
                        {formatCurrency((employee as any).accommodation_allowance)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Telephone Allowance">
                        {formatCurrency((employee as any).telephone_allowance)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Petrol Allowance">
                        {formatCurrency((employee as any).petrol_allowance)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Other Allowance">
                        {formatCurrency((employee as any).other_allowance)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Total Salary" span={2}>
                        <strong>{formatCurrency((employee as any).total_salary)}</strong>
                    </Descriptions.Item>
                </Descriptions>
            </Card>
        </div>
    );
}
