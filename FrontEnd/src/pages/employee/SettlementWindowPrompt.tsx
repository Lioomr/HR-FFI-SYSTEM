import { useEffect, useState } from "react";
import { Alert, Button } from "antd";
import { DollarOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { formatSettlementDays } from "../../components/leaves/annualLeaveSettlement";
import { useI18n } from "../../i18n/useI18n";
import {
  getAnnualLeaveEligibility,
  type AnnualLeaveEligibility,
} from "../../services/api/annualLeavePaymentsApi";
import { isApiError } from "../../services/api/apiTypes";

export const SETTLEMENT_FOCUS_PATH = "/employee/leave/balance?focus=settlement";

/**
 * Dashboard prompt shown while the employee can request their Annual Leave
 * settlement. It mirrors the backend's `can_request` flag from
 * `GET /annual-leave-payments/eligibility/` and nothing else, so it appears and
 * disappears with the same rules as the Leave Balance card. Any failure (for
 * example a role the endpoint does not serve) simply hides it.
 */
export default function SettlementWindowPrompt() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [eligibility, setEligibility] = useState<AnnualLeaveEligibility | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    getAnnualLeaveEligibility()
      .then((res) => {
        if (!active || isApiError(res)) return;
        setEligibility(res.data);
      })
      .catch(() => {
        // Optional prompt: never surface an error on the dashboard for it.
      });
    return () => {
      active = false;
    };
  }, []);

  if (eligibility?.can_request !== true) return null;

  return (
    <Alert
      type="info"
      showIcon
      icon={<DollarOutlined />}
      role="region"
      aria-label={t("employee.dashboard.settlementOpenTitle")}
      style={{ borderRadius: 12, marginBottom: 24 }}
      title={t("employee.dashboard.settlementOpenTitle")}
      description={t("employee.dashboard.settlementOpenBody", {
        date: eligibility.cycle_end ?? "—",
        days: formatSettlementDays(eligibility.eligible_unused_days),
      })}
      action={
        <Button
          type="primary"
          size="small"
          onClick={() => navigate(SETTLEMENT_FOCUS_PATH)}
        >
          {t("employee.dashboard.settlementOpenAction")}
        </Button>
      }
    />
  );
}
