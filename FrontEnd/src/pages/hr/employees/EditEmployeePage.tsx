import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Form, Space } from "antd";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { isApiError } from "../../../services/api/apiTypes";
import { apply422ToForm } from "../../../utils/formErrors";
import { notifyError, notifySuccess } from "../../../utils/notify";
import { isForbidden } from "../../../services/api/httpErrors";
import { getEmployee, updateEmployee } from "../../../services/api/employeesApi";
import type { CreateEmployeeDto } from "../../../services/api/employeesApi";
import { listDepartments } from "../../../services/api/departmentsApi";
import type { Department } from "../../../services/api/departmentsApi";
import { listPositions } from "../../../services/api/positionsApi";
import type { Position } from "../../../services/api/positionsApi";
import { listTaskGroups } from "../../../services/api/taskGroupsApi";
import type { TaskGroup } from "../../../services/api/taskGroupsApi";
import { listSponsors } from "../../../services/api/sponsorsApi";
import type { Sponsor } from "../../../services/api/sponsorsApi";
import { toPayload, fromEmployeeToFormValues } from "./employeeFormMapper";
import EmployeeForm from "./EmployeeForm";

export default function EditEmployeePage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [form] = Form.useForm();

    // State
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [forbidden, setForbidden] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reference data
    const [departments, setDepartments] = useState<Department[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
    const [sponsors, setSponsors] = useState<Sponsor[]>([]);

    /**
     * Load employee data and reference data
     */
    useEffect(() => {
        const loadData = async () => {
            if (!id) {
                setError("No employee ID provided");
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);
            setForbidden(false);

            try {
                // Fetch employee and reference data in parallel
                const [employeeRes, deptRes, posRes, tgRes, sponsorRes] = await Promise.all([
                    getEmployee(id),
                    listDepartments(),
                    listPositions(),
                    listTaskGroups(),
                    listSponsors(),
                ]);

                // Check for errors
                if (isApiError(employeeRes)) {
                    setError(employeeRes.message || "Failed to load employee");
                    setLoading(false);
                    return;
                }

                if (isApiError(deptRes) || isApiError(posRes) || isApiError(tgRes) || isApiError(sponsorRes)) {
                    notifyError("Failed to load reference data");
                    setLoading(false);
                    return;
                }

                // Set reference data
                setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
                setPositions(Array.isArray(posRes.data) ? posRes.data : []);
                setTaskGroups(Array.isArray(tgRes.data) ? tgRes.data : []);
                setSponsors(Array.isArray(sponsorRes.data) ? sponsorRes.data : []);

                // Prefill form with employee data
                const formValues = fromEmployeeToFormValues(employeeRes.data);
                form.setFieldsValue(formValues);

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

        loadData();
    }, [id, form]);

    /**
     * Handle form submission
     */
    const handleSubmit = async () => {
        if (!id) return;

        try {
            // Validate form
            const values = await form.validateFields();

            // Transform form values to API payload
            const payload = toPayload(values) as CreateEmployeeDto;

            setSubmitting(true);
            const response = await updateEmployee(id, payload);

            if (isApiError(response)) {
                // Apply 422 field errors
                apply422ToForm(form, response);
                notifyError(response.message || "Failed to update employee");
                setSubmitting(false);
                return;
            }

            // Success
            notifySuccess("Employee updated successfully");
            navigate(`/hr/employees/${id}`);
        } catch (err: any) {
            setSubmitting(false);

            // Handle form validation errors
            if (err.errorFields) {
                return;
            }

            // Apply backend 422 errors
            apply422ToForm(form, err);

            if (isForbidden(err)) {
                setForbidden(true);
                return;
            }

            if (!err.response || err.response.status !== 422) {
                notifyError(err.message || "Failed to update employee");
            }
        }
    };

    /**
     * Handle cancel
     */
    const handleCancel = () => {
        navigate(`/hr/employees/${id}`);
    };

    // Render 403 page
    if (forbidden) {
        return <Unauthorized403Page />;
    }

    // Render loading state
    if (loading) {
        return <LoadingState title="Loading employee data..." />;
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

    return (
        <div>
            <PageHeader
                title="Edit Employee"
                actions={
                    <Space>
                        <Button onClick={handleCancel}>Cancel</Button>
                        <Button type="primary" onClick={handleSubmit} loading={submitting}>
                            Save
                        </Button>
                    </Space>
                }
            />

            <Card style={{ borderRadius: 16 }}>
                <EmployeeForm
                    form={form}
                    refOptions={{
                        departments,
                        positions,
                        taskGroups,
                        sponsors,
                    }}
                />
            </Card>
        </div>
    );
}
