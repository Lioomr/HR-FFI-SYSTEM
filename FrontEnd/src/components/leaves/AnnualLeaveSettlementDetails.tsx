import { Descriptions, Tag } from "antd";

import { useI18n } from "../../i18n/useI18n";
import type { AnnualLeavePaymentRequest } from "../../services/api/annualLeavePaymentsApi";
import {
  formatSettlementAmount,
  formatSettlementDays,
} from "./annualLeaveSettlement";
import { toDecimalNumber } from "../../services/api/annualLeavePaymentsApi";

/**
 * The settlement figures, exactly as the backend calculated them. Nothing here
 * is derived in the browser — every value is read straight off the request.
 */
export default function AnnualLeaveSettlementDetails({
  request,
  showEmployee = false,
}: {
  request: AnnualLeavePaymentRequest;
  /** HR and CEO screens name the employee; the employee's own view does not. */
  showEmployee?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Descriptions
      size="small"
      bordered
      styles={{ content: { overflowWrap: "anywhere" } }}
      column={{ xs: 1, sm: 1, md: 2 }}
      items={[
        ...(showEmployee
          ? [
              {
                key: "employee",
                label: t("annualPayment.employee"),
                children:
                  request.employee_name || `#${request.employee_id ?? "—"}`,
                span: 2,
              },
            ]
          : []),
        {
          key: "cycle",
          label: t("annualPayment.contractYear"),
          children: `${request.cycle_start} → ${request.cycle_end}`,
        },
        {
          key: "eligible",
          label: t("annualPayment.eligibleDays"),
          children: `${formatSettlementDays(request.eligible_unused_days)} ${t("leave.days")}`,
        },
        ...(toDecimalNumber(request.locked_unused_days) > 0
          ? [
              {
                key: "locked",
                label: request.include_locked_days_in_termination_payout
                  ? t("annualPayment.lockedDaysPaidOnTermination")
                  : t("annualPayment.lockedDays"),
                children: `${formatSettlementDays(request.locked_unused_days)} ${t("leave.days")}`,
              },
            ]
          : []),
        {
          key: "fractional",
          label: t("annualPayment.fractionalDays"),
          children: `${formatSettlementDays(request.fractional_days)} ${t("leave.days")}`,
        },
        {
          key: "salary",
          label: t("annualPayment.yearEndSalary"),
          children: formatSettlementAmount(request.salary_at_year_end),
        },
        {
          key: "amount",
          label: t("annualPayment.paymentAmount"),
          children: formatSettlementAmount(request.payment_amount),
        },
        {
          key: "carry",
          label: t("annualPayment.carryForwardDays"),
          children: `${formatSettlementDays(request.carry_forward_days)} ${t("leave.days")}`,
        },
        {
          key: "resolution",
          label: t("annualPayment.resolution"),
          children: (
            <Tag
              color={request.resolution === "carry_forward" ? "blue" : "green"}
            >
              {request.resolution === "carry_forward"
                ? t("annualPayment.resolution.carryForward")
                : t("annualPayment.resolution.pay")}
            </Tag>
          ),
        },
        ...(showEmployee
          ? [
              {
                key: "pending_annual_leave",
                label: t("annualPayment.pendingAnnualLeave"),
                // Read straight off the record; never inferred elsewhere.
                children: request.has_pending_annual_leave ? (
                  <Tag color="warning">{t("common.yes")}</Tag>
                ) : (
                  <Tag>{t("common.no")}</Tag>
                ),
              },
            ]
          : []),
        ...(request.is_termination_settlement
          ? [
              {
                key: "termination",
                label: t("annualPayment.settlementType"),
                children: (
                  <Tag color="volcano">
                    {t("annualPayment.terminationSettlement")}
                  </Tag>
                ),
              },
            ]
          : []),
        ...(request.employee_note
          ? [
              {
                key: "employee_note",
                label: t("annualPayment.employeeNote"),
                children: request.employee_note,
                span: 2,
              },
            ]
          : []),
        ...(request.hr_review_note
          ? [
              {
                key: "hr_note",
                label: t("annualPayment.hrComment"),
                children: request.hr_review_note,
                span: 2,
              },
            ]
          : []),
        ...(request.ceo_decision_note
          ? [
              {
                key: "ceo_note",
                label: t("annualPayment.ceoComment"),
                children: request.ceo_decision_note,
                span: 2,
              },
            ]
          : []),
      ]}
    />
  );
}
