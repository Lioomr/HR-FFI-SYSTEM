import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Space } from "antd";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { isApiError } from "../../../services/api/apiTypes";
import { apply422ToForm } from "../../../utils/formErrors";
import { notifyError } from "../../../utils/notify";
import { isForbidden } from "../../../services/api/httpErrors";
import { createEmployee } from "../../../services/api/employeesApi";
import type { CreateEmployeeDto } from "../../../services/api/employeesApi";
import { listDepartments } from "../../../services/api/departmentsApi";
import type { Department } from "../../../services/api/departmentsApi";
import { listPositions } from "../../../services/api/positionsApi";
import type { Position } from "../../../services/api/positionsApi";
import { listTaskGroups } from "../../../services/api/taskGroupsApi";
import type { TaskGroup } from "../../../services/api/taskGroupsApi";
import { listSponsors } from "../../../services/api/sponsorsApi";
import type { Sponsor } from "../../../services/api/sponsorsApi";
import { toPayload } from "./employeeFormMapper";
import EmployeeForm from "./EmployeeForm";

export default function CreateEmployeePage() {
    const navigate = useNavigate();
    const [form] = Form.useForm();

    // State
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [forbidden, setForbidden] = useState(false);

    // Reference data
    const [departments, setDepartments] = useState<Department[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
    const [sponsors, setSponsors] = useState<Sponsor[]>([]);

    /**
     * Load reference data on mount
     */
    useEffect(() => {
        const loadReferenceData = async () => {
            setLoading(true);
            setForbidden(false);

            try {
                // Fetch all reference data in parallel
                const [deptRes, posRes, tgRes, sponsorRes] = await Promise.all([
                    listDepartments(),
                    listPositions(),
                    listTaskGroups(),
                    listSponsors(),
                ]);

                // Check for errors
                if (isApiError(deptRes) || isApiError(posRes) || isApiError(tgRes) || isApiError(sponsorRes)) {
                    notifyError("Failed to load reference data");
                    setLoading(false);
                    return;
                }

                // Set reference data (handle both array and object responses)
                setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
                setPositions(Array.isArray(posRes.data) ? posRes.data : []);
                setTaskGroups(Array.isArray(tgRes.data) ? tgRes.data : []);
                setSponsors(Array.isArray(sponsorRes.data) ? sponsorRes.data : []);

                setLoading(false);
            } catch (err: any) {
                if (isForbidden(err)) {
                    setForbidden(true);
                    setLoading(false);
                    return;
                }

                notifyError(err.message || "Failed to load reference data");
                setLoading(false);
            }
        };

        loadReferenceData();
    }, []);

    /**
     * Handle form submission
     */
    const handleSubmit = async () => {
        try {
            // Validate form
            const values = await form.validateFields();

            // Transform form values to API payload
            const payload = toPayload(values) as CreateEmployeeDto;

            setSubmitting(true);
            const response = await createEmployee(payload);

            if (isApiError(response)) {
                // Apply 422 field errors
                apply422ToForm(form, response);
                notifyError(response.message || "Failed to create employee");
                setSubmitting(false);
                return;
            }

            // Success - extract ID and redirect
            const employeeId = response.data?.id || response.data?.employee_id;
            if (employeeId) {
                navigate(`/hr/employees/${employeeId}`);
            } else {
                // Fallback to list if no ID returned
                navigate("/hr/employees");
            }
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
                notifyError(err.message || "Failed to create employee");
            }
        }
    };

    /**
     * Handle cancel
     */
    const handleCancel = () => {
        navigate("/hr/employees");
    };

    // Render 403 page
    if (forbidden) {
        return <Unauthorized403Page />;
    }

    // Render loading state
    if (loading) {
        return <LoadingState title="Loading form..." />;
    }

    return (
        <div>
            <PageHeader
                title="Create Employee"
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
