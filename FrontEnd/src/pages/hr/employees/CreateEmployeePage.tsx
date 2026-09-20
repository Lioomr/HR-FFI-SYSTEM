import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form, Space } from "antd";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { isApiError } from "../../../services/api/apiTypes";
import { apply422ToForm, getFieldApiError } from "../../../utils/formErrors";
import { notifyError } from "../../../utils/notify";
import { isForbidden } from "../../../services/api/httpErrors";
import {
  createEmployee,
  listEmployees,
} from "../../../services/api/employeesApi";
import type { CreateEmployeeDto } from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
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
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";
import dayjs from "dayjs";
import { createCrossCompanyManagerAssignment, listOrganizationScopes } from "../../../services/api/managerAssignmentsApi";
import type { OrganizationScope } from "../../../services/api/managerAssignmentsApi";

export default function CreateEmployeePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [form] = Form.useForm();
  const isHeadOffice = isHeadOfficeOrganization(user);

  // State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [managerAssignmentError, setManagerAssignmentError] = useState<
    string | null
  >(null);

  // Reference data
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [organizationScopes, setOrganizationScopes] = useState<OrganizationScope[]>([]);

  /**
   * Load reference data on mount
   */
  useEffect(() => {
    const loadReferenceData = async () => {
      setLoading(true);
      setForbidden(false);

      try {
        // Fetch all reference data in parallel
        const [deptRes, posRes, tgRes, sponsorRes, employeesRes, scopesRes] =
          await Promise.all([
            listDepartments(),
            listPositions(),
            listTaskGroups(),
            listSponsors(),
            listEmployees({ scope: "all", page: 1, page_size: 1000 }),
            listOrganizationScopes(),
          ]);

        // Check for errors
        if (
          isApiError(deptRes) ||
          isApiError(posRes) ||
          isApiError(tgRes) ||
          isApiError(sponsorRes) ||
          isApiError(employeesRes) ||
          isApiError(scopesRes)
        ) {
          notifyError(t("hr.employees.fetchRefDataFailed"));
          setLoading(false);
          return;
        }

        // Set reference data (handle both array and object responses)
        setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
        setPositions(Array.isArray(posRes.data) ? posRes.data : []);
        setTaskGroups(Array.isArray(tgRes.data) ? tgRes.data : []);
        setSponsors(Array.isArray(sponsorRes.data) ? sponsorRes.data : []);
        const managerCandidates =
          (employeesRes.data as any)?.results ||
          (employeesRes.data as any)?.items ||
          [];
        setEmployees(Array.isArray(managerCandidates) ? managerCandidates : []);
        setOrganizationScopes(scopesRes.data?.items ?? []);

        setLoading(false);
      } catch (err: any) {
        if (isForbidden(err)) {
          setForbidden(true);
          setLoading(false);
          return;
        }

        notifyError(err.message || t("hr.employees.fetchRefDataFailed"));
        setLoading(false);
      }
    };

    loadReferenceData();
  }, []);

  /**
   * Handle form submission
   */
  const handleSubmit = async () => {
    if (isHeadOffice) {
      notifyError(t("organization.headOffice.switchToCreateEmployees"));
      return;
    }
    setManagerAssignmentError(null);
    try {
      // Validate form
      const values = await form.validateFields();

      // Transform form values to API payload
      const payload = toPayload(values) as CreateEmployeeDto;
      const crossCompany = values.manager_profile_id && values.cross_company_scope_id && values.cross_company_end_at;
      if (crossCompany) delete (payload as any).manager_profile_id;
      delete (payload as any).cross_company_scope_id;
      delete (payload as any).cross_company_end_at;

      setSubmitting(true);
      const response = await createEmployee(payload, { scope: "all" });

      if (isApiError(response)) {
        // Apply 422 field errors
        apply422ToForm(form, response);
        setManagerAssignmentError(
          getFieldApiError(response, "manager_profile_id") ?? null,
        );
        notifyError(response.message || t("hr.employees.createFailed"));
        setSubmitting(false);
        return;
      }

      // Success - extract ID and redirect
      const employeeId = response.data?.id || response.data?.employee_id;
      if (employeeId) {
        if (crossCompany) {
          await createCrossCompanyManagerAssignment({
            employee_id: Number(employeeId),
            manager_profile_id: Number(values.manager_profile_id),
            scope_id: Number(values.cross_company_scope_id),
            start_at: new Date().toISOString(),
            end_at: dayjs(values.cross_company_end_at).toISOString(),
            capabilities: ["employees.view", "leaves.approve", "attendance.approve"],
          });
        }
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
      setManagerAssignmentError(
        getFieldApiError(err, "manager_profile_id") ?? null,
      );

      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }

      if (!err.response || err.response.status !== 422) {
        notifyError(err.message || t("hr.employees.createFailed"));
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
    return <LoadingState title={t("loading.generic")} />;
  }

  return (
    <div>
      <PageHeader
        title={t("hr.employees.create")}
        actions={
          <Space>
            <Button onClick={handleCancel}>{t("common.cancel")}</Button>
            <Button type="primary" onClick={handleSubmit} loading={submitting}>
              {t("common.save")}
            </Button>
          </Space>
        }
      />

      {isHeadOffice && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 14 }}
          message={t("organization.headOffice.readOnlyTitle")}
          description={t("organization.headOffice.createEmployeeDescription")}
        />
      )}

      <Card style={{ borderRadius: 16 }}>
        <EmployeeForm
          form={form}
          managerAssignmentError={managerAssignmentError}
          refOptions={{
            departments,
            positions,
            taskGroups,
            sponsors,
            employees,
            organizationScopes,
          }}
          employeeCompanyId={Number(user?.active_organization_id ?? user?.default_organization_id) || null}
        />
      </Card>
    </div>
  );
}
