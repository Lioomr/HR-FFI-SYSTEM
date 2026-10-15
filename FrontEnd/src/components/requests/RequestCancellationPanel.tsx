import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  notification,
} from "antd";
import { RollbackOutlined, StopOutlined } from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import type { CancellationWorkflowFlags } from "../../types/workflow";
import { isApiError } from "../../services/api/apiTypes";
import {
  CANCELLATION_REASON_MAX,
  CANCELLATION_REASON_MIN,
  requestCancellation,
  withdrawCancellationRequest,
  type CancellationKind,
} from "../../services/api/cancellationRequestsApi";
import {
  getFieldApiError,
  getFirstApiErrorMessage,
} from "../../utils/formErrors";
import {
  getDetailedApiMessage,
  getDetailedHttpErrorMessage,
} from "../../services/api/userErrorMessages";
import { getHttpStatus } from "../../services/api/httpErrors";
import { formatDateTime } from "../../utils/dateTime";

const TARGET_SIZE = { minHeight: 44 } as const;

/**
 * Employee request to HR to cancel an already approved request.
 *
 * Visibility is driven only by the server flags on `workflow`
 * (`can_request_cancellation`, `can_withdraw_cancellation_request`); status
 * strings are never inspected. `onChanged` runs after any successful action so
 * the host page can reload the same data its cancel/edit actions reload.
 */
export default function RequestCancellationPanel({
  kind,
  request,
  onChanged,
  compact = false,
}: {
  kind: CancellationKind;
  request: { id: number; workflow?: CancellationWorkflowFlags };
  onChanged: () => void | Promise<void>;
  /** Table-row layout: buttons and tags only, no alert blocks. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [requestOpen, setRequestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const workflow = request.workflow;
  const canRequest = workflow?.can_request_cancellation === true;
  const canWithdraw = workflow?.can_withdraw_cancellation_request === true;
  const cancellation = workflow?.cancellation_request ?? null;

  const refresh = async () => {
    try {
      await onChanged();
    } catch {
      // The host page reports its own load failures.
    }
  };

  const reportFailure = async (error: unknown, fallbackKey: string) => {
    const status = getHttpStatus(error);
    notification.error({
      message: t(fallbackKey),
      description: getDetailedHttpErrorMessage(t, error),
    });
    // The request may no longer be eligible: reload the server state.
    if (status === 404 || status === 422) await refresh();
  };

  const validate = (): string | null => {
    const trimmed = reason.trim();
    if (!trimmed) return t("requests.cancellationRequest.reasonRequired");
    if (trimmed.length < CANCELLATION_REASON_MIN)
      return t("requests.cancellationRequest.reasonTooShort", {
        min: CANCELLATION_REASON_MIN,
      });
    if (trimmed.length > CANCELLATION_REASON_MAX)
      return t("requests.cancellationRequest.reasonTooLong", {
        max: CANCELLATION_REASON_MAX,
      });
    return null;
  };

  const closeRequest = () => {
    if (inFlight.current) return;
    setRequestOpen(false);
    setReason("");
    setReasonError(null);
  };

  const submit = async () => {
    if (inFlight.current) return;
    const problem = validate();
    if (problem) {
      setReasonError(problem);
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setReasonError(null);
    try {
      const response = await requestCancellation(
        kind,
        request.id,
        reason.trim(),
      );
      if (isApiError(response)) {
        const fieldMessage = getFieldApiError(response, "reason");
        if (fieldMessage) {
          setReasonError(fieldMessage);
        } else {
          notification.error({
            message: t("requests.cancellationRequest.failed"),
            description: getDetailedApiMessage(
              t,
              getFirstApiErrorMessage(response) || response.message,
            ),
          });
          setRequestOpen(false);
          await refresh();
        }
        return;
      }
      notification.success({
        message: t("requests.cancellationRequest.success"),
      });
      setRequestOpen(false);
      setReason("");
      await refresh();
    } catch (error: unknown) {
      const fieldMessage =
        getHttpStatus(error) === 422
          ? getFieldApiError(error, "reason")
          : undefined;
      if (fieldMessage) {
        setReasonError(fieldMessage);
      } else {
        setRequestOpen(false);
        await reportFailure(error, "requests.cancellationRequest.failed");
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const withdraw = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await withdrawCancellationRequest(kind, request.id);
      if (isApiError(response)) {
        notification.error({
          message: t("requests.cancellationRequest.withdrawFailed"),
          description: getDetailedApiMessage(
            t,
            getFirstApiErrorMessage(response) || response.message,
          ),
        });
        setWithdrawOpen(false);
        await refresh();
        return;
      }
      notification.success({
        message: t("requests.cancellationRequest.withdrawSuccess"),
      });
      setWithdrawOpen(false);
      await refresh();
    } catch (error: unknown) {
      setWithdrawOpen(false);
      await reportFailure(error, "requests.cancellationRequest.withdrawFailed");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const hasOutcome =
    cancellation !== null && cancellation.status !== "withdrawn";
  if (!canRequest && !canWithdraw && !hasOutcome) return null;

  const requestButton = canRequest ? (
    <Button
      danger
      size={compact ? "small" : "middle"}
      icon={<StopOutlined aria-hidden />}
      aria-label={t("requests.cancellationRequest.button")}
      style={compact ? undefined : TARGET_SIZE}
      onClick={(event) => {
        event.stopPropagation();
        setRequestOpen(true);
      }}
    >
      {t("requests.cancellationRequest.button")}
    </Button>
  ) : null;

  const withdrawButton = canWithdraw ? (
    <Button
      size={compact ? "small" : "middle"}
      icon={<RollbackOutlined aria-hidden />}
      aria-label={t("requests.cancellationRequest.withdraw")}
      style={compact ? undefined : TARGET_SIZE}
      onClick={(event) => {
        event.stopPropagation();
        setWithdrawOpen(true);
      }}
    >
      {t("requests.cancellationRequest.withdraw")}
    </Button>
  ) : null;

  const decidedBy = cancellation?.decided_by_name || "";
  const outcome = (() => {
    if (!cancellation) return null;
    if (cancellation.status === "pending") {
      return {
        type: "info" as const,
        message: t("requests.cancellationRequest.pendingTitle"),
        tag: t("requests.cancellationRequest.pendingTag"),
        tagColor: "orange",
      };
    }
    if (cancellation.status === "confirmed") {
      return {
        type: "success" as const,
        message: t("requests.cancellationRequest.confirmedTitle"),
        tag: t("requests.cancellationRequest.confirmedTag"),
        tagColor: "green",
      };
    }
    if (cancellation.status === "declined") {
      return {
        type: "warning" as const,
        message: t("requests.cancellationRequest.declinedTitle"),
        tag: t("requests.cancellationRequest.declinedTag"),
        tagColor: "red",
      };
    }
    return null;
  })();

  const reasonValue = reason;
  const modals = (
    <>
      <Modal
        title={t("requests.cancellationRequest.modalTitle")}
        open={requestOpen}
        onOk={() => void submit()}
        onCancel={closeRequest}
        okText={t("requests.cancellationRequest.submit")}
        cancelText={t("common.cancel")}
        okType="danger"
        confirmLoading={loading}
        cancelButtonProps={{ disabled: loading, style: TARGET_SIZE }}
        okButtonProps={{
          style: TARGET_SIZE,
          "aria-label": t("requests.cancellationRequest.submit"),
        }}
        closable={!loading}
        maskClosable={!loading}
        keyboard={!loading}
        destroyOnClose
      >
        <Typography.Paragraph>
          {t("requests.cancellationRequest.modalHint")}
        </Typography.Paragraph>
        <label htmlFor={`cancellation-reason-${kind}-${request.id}`}>
          <Typography.Text strong>
            {t("requests.cancellationRequest.reasonLabel")}
          </Typography.Text>
        </label>
        <Input.TextArea
          id={`cancellation-reason-${kind}-${request.id}`}
          aria-label={t("requests.cancellationRequest.reasonLabel")}
          aria-required
          aria-invalid={reasonError ? true : undefined}
          value={reasonValue}
          rows={4}
          maxLength={CANCELLATION_REASON_MAX}
          showCount
          disabled={loading}
          status={reasonError ? "error" : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            if (reasonError) setReasonError(null);
          }}
          style={{ marginTop: 8 }}
        />
        {reasonError ? (
          <Typography.Text type="danger" role="alert">
            {reasonError}
          </Typography.Text>
        ) : null}
      </Modal>
      <Modal
        title={t("requests.cancellationRequest.withdrawTitle")}
        open={withdrawOpen}
        onOk={() => void withdraw()}
        onCancel={() => {
          if (!inFlight.current) setWithdrawOpen(false);
        }}
        okText={t("requests.cancellationRequest.withdraw")}
        cancelText={t("requests.cancellationRequest.keep")}
        confirmLoading={loading}
        cancelButtonProps={{ disabled: loading, style: TARGET_SIZE }}
        okButtonProps={{
          style: TARGET_SIZE,
          "aria-label": t("requests.cancellationRequest.withdraw"),
        }}
        closable={!loading}
        maskClosable={!loading}
        keyboard={!loading}
      >
        {t("requests.cancellationRequest.withdrawConfirm")}
      </Modal>
    </>
  );

  if (compact) {
    return (
      <span onClick={(event) => event.stopPropagation()}>
        <Space size={4} wrap>
          {outcome && cancellation?.status !== "confirmed" ? (
            <Tag color={outcome.tagColor} style={{ marginInlineEnd: 0 }}>
              {outcome.tag}
            </Tag>
          ) : null}
          {requestButton}
          {withdrawButton}
        </Space>
        {modals}
      </span>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {outcome && cancellation ? (
        <Alert
          showIcon
          type={outcome.type}
          message={outcome.message}
          description={
            <Space direction="vertical" size={4}>
              <Typography.Text>
                {t("requests.cancellationRequest.reasonPrefix")}{" "}
                {cancellation.reason}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("requests.cancellationRequest.requestedAt", {
                  date: formatDateTime(cancellation.requested_at),
                })}
              </Typography.Text>
              {cancellation.decided_at ? (
                <Typography.Text type="secondary">
                  {t("requests.cancellationRequest.decidedAt", {
                    date: formatDateTime(cancellation.decided_at),
                    name: decidedBy || t("workflow.systemActor"),
                  })}
                </Typography.Text>
              ) : null}
              {cancellation.decision_note ? (
                <Typography.Text>
                  {t("requests.cancellationRequest.hrNote")}{" "}
                  {cancellation.decision_note}
                </Typography.Text>
              ) : null}
            </Space>
          }
          action={withdrawButton}
        />
      ) : null}
      {requestButton ? <div>{requestButton}</div> : null}
      {!outcome && withdrawButton ? <div>{withdrawButton}</div> : null}
      {modals}
    </div>
  );
}
