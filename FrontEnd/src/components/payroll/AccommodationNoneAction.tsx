import { useRef, useState } from "react";
import { Button, message } from "antd";
import dayjs from "dayjs";
import ReasonModal from "./ReasonModal";
import { useCanManagePayrollHrData } from "./payrollFormat";
import { useI18n } from "../../i18n/useI18n";
import { createAssignment } from "../../services/api/accommodationApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../services/api/payrollErrors";

export default function AccommodationNoneAction({
  employeeProfileId,
  name,
  periodStart,
  periodEnd,
  onSaved,
}: {
  employeeProfileId: number;
  name: string;
  periodStart: string;
  periodEnd: string;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const allowed = useCanManagePayrollHrData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const submit = async (reason: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await createAssignment({
        employee_profile_id: employeeProfileId,
        status: "none",
        rent_id: null,
        start_date: periodStart,
        end_date: periodEnd,
        reason,
      });
      setOpen(false);
      await onSaved();
      message.success(t("payroll.ui.assignmentSaved"));
    } catch (err) {
      const parsed = parsePayrollError(err);
      const range = parsed.items
        .flatMap((item) => {
          const p = item.params;
          return p?.start_date && p?.end_date
            ? [`${p.start_date} – ${p.end_date}`]
            : [];
        })
        .join(" · ");
      if (parsed.httpStatus === 409) await onSaved();
      setError(
        [payrollErrorSummary(parsed, t("payroll.ui.actionFailed")), range]
          .filter(Boolean)
          .join(" · "),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (!allowed) return null;
  return (
    <>
      <Button
        size="small"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        {t("payroll.ux3.setNone")}
      </Button>
      <ReasonModal
        open={open}
        title={t("payroll.ux3.setNone")}
        description={
          <>
            {t("payroll.ux3.confirmNone", { name })}{" "}
            <bdi dir="ltr">
              {dayjs(periodStart).format("YYYY-MM-DD")} –{" "}
              {dayjs(periodEnd).format("YYYY-MM-DD")}
            </bdi>
          </>
        }
        submitting={busy}
        formError={error}
        onSubmit={(reason) => void submit(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </>
  );
}
