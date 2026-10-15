import { useRef, useState } from "react";
import { Button, Modal, Tooltip, notification } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import type { WorkflowSnapshot } from "../../types/workflow";
import { isApiError, type ApiResponse } from "../../services/api/apiTypes";
import { getHttpStatus } from "../../services/api/httpErrors";
import { getFirstApiErrorMessage } from "../../utils/formErrors";
import {
  getDetailedApiMessage,
  getDetailedHttpErrorMessage,
} from "../../services/api/userErrorMessages";

/** Server permission flags govern visibility; the endpoint enforces ownership. */
export default function EmployeeCancelButton<
  T extends {
    id: number;
    workflow?: WorkflowSnapshot;
    can_cancel?: boolean;
  },
>({
  request,
  cancelRequest,
  onCancelled,
  iconOnly = true,
}: {
  request: T;
  cancelRequest: (id: number) => Promise<ApiResponse<T>>;
  onCancelled: () => void | Promise<void>;
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  if ((request.workflow?.can_cancel ?? request.can_cancel) !== true)
    return null;

  const cancel = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await cancelRequest(request.id);
      if (isApiError(response)) {
        notification.error({
          message: t("requests.cancel.failed"),
          description: getDetailedApiMessage(t, response.message),
        });
        return;
      }
      notification.success({ message: t("requests.cancel.success") });
      setOpen(false);
      await onCancelled();
    } catch (error: unknown) {
      const status = getHttpStatus(error);
      const serverMessage = [403, 404, 422].includes(status ?? 0)
        ? getFirstApiErrorMessage(error)
        : undefined;
      notification.error({
        message: t("requests.cancel.failed"),
        description: serverMessage
          ? getDetailedApiMessage(t, serverMessage)
          : getDetailedHttpErrorMessage(t, error),
      });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <span onClick={(event) => event.stopPropagation()}>
      <Tooltip title={iconOnly ? t("requests.cancel.button") : undefined}>
        <Button
          danger
          size={iconOnly ? "small" : "middle"}
          icon={<CloseCircleOutlined aria-hidden />}
          aria-label={t("requests.cancel.button")}
          loading={loading}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          {iconOnly ? null : t("requests.cancel.button")}
        </Button>
      </Tooltip>
      <Modal
        title={t("requests.cancel.title")}
        open={open}
        onOk={cancel}
        onCancel={() => {
          if (!inFlight.current) setOpen(false);
        }}
        okText={t("requests.cancel.button")}
        cancelText={t("requests.cancel.keep")}
        okType="danger"
        confirmLoading={loading}
        cancelButtonProps={{ disabled: loading, style: { minHeight: 44 } }}
        okButtonProps={{ style: { minHeight: 44 } }}
        closable={!loading}
        maskClosable={!loading}
        keyboard={!loading}
      >
        {t("requests.cancel.confirm")}
      </Modal>
    </span>
  );
}
