import { useMemo, type ReactNode } from "react";
import { Space, Tag } from "antd";
import { useI18n } from "../../i18n/useI18n";
import MoneyText from "./MoneyText";
import type {
  Money,
  PayrollRunItemDto,
  PayrollRunSummaryDto,
  ProvisionLineType,
} from "../../services/api/payrollTypes";

type Item = PayrollRunItemDto;
export type ItemMoneyKey = {
  [K in keyof Item]: Item[K] extends Money | null ? K : never;
}[keyof Item];
export interface MoneyColumn {
  key: ItemMoneyKey;
  titleKey: string;
  total: (summary: PayrollRunSummaryDto) => ReactNode;
  strong?: boolean;
}
export const unknownCount = (
  summary: PayrollRunSummaryDto,
  type: ProvisionLineType,
) => summary.unknown_provision_counts?.[type] ?? 0;

/** Money column definitions (with their run-total renderers) per grid group. */
export function useMoneyColumnGroups() {
  const { t } = useI18n();
  return useMemo(() => {
    const salary: MoneyColumn[] = [
      {
        key: "basic_salary",
        titleKey: "payroll.line.basic_salary",
        total: (s) => s.salary_components.basic_salary,
      },
      {
        key: "accommodation_allowance",
        titleKey: "payroll.line.accommodation_allowance",
        total: (s) => s.salary_components.accommodation_allowance,
      },
      {
        key: "transportation_allowance",
        titleKey: "payroll.line.transportation_allowance",
        total: (s) => s.salary_components.transportation_allowance,
      },
      {
        key: "telephone_allowance",
        titleKey: "payroll.line.telephone_allowance",
        total: (s) => s.salary_components.telephone_allowance,
      },
      {
        key: "petrol_allowance",
        titleKey: "payroll.line.petrol_allowance",
        total: (s) => s.salary_components.petrol_allowance,
      },
      {
        key: "other_allowance",
        titleKey: "payroll.line.other_allowance",
        total: (s) => s.salary_components.other_allowance,
      },
      {
        key: "gross_salary",
        titleKey: "payroll.field.gross_salary",
        total: (s) => s.total_gross_salary,
        strong: true,
      },
    ];
    const additions: MoneyColumn[] = [
      {
        key: "overtime_normal",
        titleKey: "payroll.line.overtime_normal",
        total: (s) => s.additions.overtime_normal,
      },
      {
        key: "weekly_rest_work",
        titleKey: "payroll.line.weekly_rest_work",
        total: (s) => s.additions.weekly_rest_work,
      },
      {
        key: "official_holiday_work",
        titleKey: "payroll.line.official_holiday_work",
        total: (s) => s.additions.official_holiday_work,
      },
      {
        key: "bonus",
        titleKey: "payroll.line.bonus",
        total: (s) => s.additions.bonus,
      },
      {
        key: "incentive",
        titleKey: "payroll.line.incentive",
        total: (s) => s.additions.incentive,
      },
      {
        key: "other_addition",
        titleKey: "payroll.line.other_addition",
        total: (s) => s.additions.other_addition,
      },
    ];
    const deductions: MoneyColumn[] = [
      {
        key: "absence_deduction",
        titleKey: "payroll.line.absence",
        total: (s) => s.deductions.absence,
      },
      {
        key: "gosi_employee_deduction",
        titleKey: "payroll.line.gosi_employee",
        total: (s) => s.deductions.gosi_employee,
      },
      {
        key: "loan_deduction",
        titleKey: "payroll.line.loan",
        total: (s) => s.deductions.loan,
      },
      {
        key: "penalty_deduction",
        titleKey: "payroll.ui.penalties",
        // The summary splits penalties by source and has no combined total
        // (open contract question); show the three API values as sent.
        total: (s) => (
          <Space orientation="vertical" size={0} style={{ fontSize: 12 }}>
            {(
              [
                [
                  "payroll.line.attendance_penalty",
                  s.deductions.attendance_penalty,
                ],
                ["payroll.line.penalty_fine", s.deductions.penalty_fine],
                [
                  "payroll.line.penalty_wage_withholding",
                  s.deductions.penalty_wage_withholding,
                ],
              ] as const
            ).map(([key, amount]) => (
              <span key={key}>
                {t(key)}: <MoneyText amount={amount} size={11} />
              </span>
            ))}
          </Space>
        ),
      },
      {
        key: "other_deduction",
        titleKey: "payroll.line.other_deduction",
        total: (s) => s.deductions.other_deduction,
      },
      {
        key: "total_deductions",
        titleKey: "payroll.field.total_deductions",
        total: (s) => s.total_deductions,
        strong: true,
      },
    ];
    const provision = (
      key: ItemMoneyKey,
      titleKey: string,
      summaryKey: keyof PayrollRunSummaryDto["provisions"],
      type: ProvisionLineType,
    ): MoneyColumn => ({
      key,
      titleKey,
      total: (s) => (
        <Space orientation="vertical" size={0}>
          <MoneyText amount={s.provisions[summaryKey]} strong />
          {unknownCount(s, type) > 0 && (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              {t("payroll.ui.unknownCount", { count: unknownCount(s, type) })}
            </Tag>
          )}
        </Space>
      ),
    });
    const provisions: MoneyColumn[] = [
      provision(
        "medical_provision",
        "payroll.line.medical",
        "medical",
        "MEDICAL",
      ),
      provision(
        "id_cost_provision",
        "payroll.line.id_cost",
        "id_cost",
        "ID_COST",
      ),
      provision(
        "air_ticket_provision",
        "payroll.line.air_ticket",
        "air_ticket",
        "AIR_TICKET",
      ),
      provision(
        "leave_provision",
        "payroll.line.leave_provision",
        "leave",
        "LEAVE_PROVISION",
      ),
      provision(
        "eos_provision",
        "payroll.line.eos_provision",
        "eos",
        "EOS_PROVISION",
      ),
      provision(
        "accommodation_cost",
        "payroll.line.accommodation_cost",
        "accommodation_cost",
        "ACCOMMODATION_COST",
      ),
      provision(
        "gosi_company_provision",
        "payroll.line.gosi_company",
        "gosi_company",
        "GOSI_COMPANY",
      ),
    ];
    return { salary, additions, deductions, provisions };
  }, [t]);
}
