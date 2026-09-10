import { useEffect, useState } from "react";
import { Form, Select, message } from "antd";
import {
  listDelegationCandidates,
  type DelegationCandidate,
} from "../../../services/api/employeesApi";
import { useI18n } from "../../../i18n/useI18n";

export default function AnnouncementAudienceFields() {
  const { t } = useI18n();
  const form = Form.useFormInstance();
  const audience = Form.useWatch("audience", form);
  const [employees, setEmployees] = useState<DelegationCandidate[]>([]);
  useEffect(() => {
    listDelegationCandidates()
      .then((response) => {
        if (response.status === "success") setEmployees(response.data || []);
      })
      .catch(() => message.error(t("hr.announcements.errorLoadEmployees")));
  }, [t]);
  return (
    <>
      <Form.Item
        name="audience"
        label={t("hr.announcements.targetAudienceLabel")}
        rules={[{ required: true }]}
      >
        <Select
          options={[
            {
              value: "COMPANY",
              label: t("hr.announcements.wholeCompany", "Whole company"),
            },
            {
              value: "SELECTED",
              label: t("hr.announcements.selectedEmployeesLabel"),
            },
            { value: "CEO", label: "CEO" },
          ]}
        />
      </Form.Item>
      {audience === "SELECTED" && (
        <Form.Item
          name="target_user_ids"
          label={t("hr.announcements.selectedEmployeesLabel")}
          rules={[
            {
              required: true,
              message: t("hr.announcements.selectedEmployeesRequired"),
            },
          ]}
        >
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.full_name_en || employee.full_name || employee.employee_id} (${employee.employee_id})`,
            }))}
          />
        </Form.Item>
      )}
    </>
  );
}
