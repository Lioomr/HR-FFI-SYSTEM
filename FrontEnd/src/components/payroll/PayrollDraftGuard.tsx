import { useContext, useEffect } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import { Button, Modal, Space } from "antd";
import { useI18n } from "../../i18n/useI18n";

function RouterGuard({ dirty, saving }: { dirty: boolean; saving: boolean }) {
  const { t } = useI18n();
  const blocker = useBlocker(dirty || saving);
  return (
    <Modal
      open={blocker.state === "blocked"}
      title={t("payroll.ui.discardChanges")}
      onCancel={() => blocker.state === "blocked" && blocker.reset()}
      footer={
        <Space>
          <Button
            onClick={() => blocker.state === "blocked" && blocker.reset()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            danger
            disabled={saving}
            onClick={() => blocker.state === "blocked" && blocker.proceed()}
          >
            {t("payroll.ui.discardChanges")}
          </Button>
        </Space>
      }
    />
  );
}
export default function PayrollDraftGuard({
  dirty,
  saving,
}: {
  dirty: boolean;
  saving: boolean;
}) {
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving]);
  return router ? <RouterGuard dirty={dirty} saving={saving} /> : null;
}
