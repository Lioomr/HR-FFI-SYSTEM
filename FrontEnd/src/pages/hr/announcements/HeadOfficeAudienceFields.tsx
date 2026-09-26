import { useEffect, useState } from "react";
import { Form, Select, message } from "antd";
import { useI18n } from "../../../i18n/useI18n";
import {
  getAnnouncementRecipientCandidates,
  type AnnouncementRecipientCandidate,
  type HeadOfficeAudience,
} from "../../../services/api/announcementApi";
import type { OrganizationNodeDto } from "../../../services/api/apiTypes";

/**
 * Audience for an announcement sent from Main Head Office: every company,
 * chosen companies, or (HR only) chosen employees from any company.
 */
export default function HeadOfficeAudienceFields({
  companies,
  canPickEmployees,
}: {
  companies: OrganizationNodeDto[];
  canPickEmployees: boolean;
}) {
  const { t, language } = useI18n();
  const form = Form.useFormInstance();
  const audience: HeadOfficeAudience =
    Form.useWatch("broadcast_audience", form) ?? "ALL_COMPANIES";
  const [candidates, setCandidates] = useState<
    AnnouncementRecipientCandidate[]
  >([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const needsCandidates = audience === "EMPLOYEES";

  useEffect(() => {
    if (!needsCandidates) return;
    let cancelled = false;
    setLoadingCandidates(true);
    getAnnouncementRecipientCandidates()
      .then((items) => {
        if (!cancelled) setCandidates(items);
      })
      .catch(() => message.error(t("hr.announcements.errorLoadEmployees")))
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsCandidates, t]);

  const employeeName = (candidate: AnnouncementRecipientCandidate) =>
    (language === "ar" ? candidate.full_name_ar : candidate.full_name_en) ||
    candidate.full_name ||
    candidate.employee_id;

  return (
    <>
      <Form.Item
        name="broadcast_audience"
        label={t("hr.announcements.targetAudienceLabel")}
        rules={[{ required: true }]}
      >
        <Select
          options={[
            {
              value: "ALL_COMPANIES",
              label: t("hr.announcements.audienceAllCompanies"),
            },
            {
              value: "COMPANIES",
              label: t("hr.announcements.audienceChosenCompanies"),
            },
            ...(canPickEmployees
              ? [
                  {
                    value: "EMPLOYEES",
                    label: t("hr.announcements.audienceChosenEmployees"),
                  },
                ]
              : []),
          ]}
        />
      </Form.Item>

      {audience === "COMPANIES" && (
        <Form.Item
          name="company_ids"
          label={t("hr.announcements.chosenCompaniesLabel")}
          rules={[
            {
              required: true,
              message: t("hr.announcements.chosenCompaniesRequired"),
            },
          ]}
        >
          <Select
            mode="multiple"
            options={companies.map((company) => ({
              value: Number(company.id),
              label: company.name,
            }))}
          />
        </Form.Item>
      )}

      {audience === "EMPLOYEES" && (
        <Form.Item
          name="target_user_ids"
          label={t("hr.announcements.selectedEmployeesLabel")}
          extra={t("hr.announcements.chosenEmployeesHelp")}
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
            loading={loadingCandidates}
            optionFilterProp="label"
            options={companies.map((company) => ({
              label: company.name,
              title: company.name,
              options: candidates
                .filter(
                  (candidate) =>
                    String(candidate.company_id) === String(company.id),
                )
                .map((candidate) => ({
                  value: candidate.user_id,
                  label: `${employeeName(candidate)} (${candidate.employee_id}) · ${candidate.company_name}`,
                })),
            }))}
          />
        </Form.Item>
      )}
    </>
  );
}
