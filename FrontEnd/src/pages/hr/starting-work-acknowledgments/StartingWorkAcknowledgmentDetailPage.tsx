import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import StartingWorkStatusTag from "../../../components/hr/StartingWorkStatusTag";
import StartingWorkWorkflowHistory from "../../../components/hr/StartingWorkWorkflowHistory";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  isConflict,
  isForbidden,
  isNotFound,
} from "../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../services/api/downloads";
import {
  acknowledgmentPdfFilename,
  approveStartingWorkAcknowledgment,
  downloadStartingWorkAcknowledgmentPdf,
  getStartingWorkAcknowledgment,
  rejectStartingWorkAcknowledgment,
  workflowActorName,
  type StartingWorkAcknowledgment,
  type StartingWorkReviewer,
} from "../../../services/api/startingWorkAcknowledgmentsApi";
import { useI18n } from "../../../i18n/useI18n";
import { formatDateOnly, formatDateTimeShort } from "../../../utils/dateTime";

const { Text } = Typography;

function Surface({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
      }}
    >
      <span
        style={{
          width: 4,
          height: 20,
          borderRadius: 4,
          background: "linear-gradient(180deg, #f97316, #fb923c)",
        }}
      />
      <Typography.Title
        level={5}
        style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}
      >
        {children}
      </Typography.Title>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
        {label}
      </Text>
      <div style={{ fontSize: 14, color: "#0f172a", fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

/** Reviewer display: the name the backend recorded, with the email beneath. */
function Reviewer({ reviewer }: { reviewer: StartingWorkReviewer | null }) {
  if (!reviewer) return <>—</>;
  return (
    <div>
      <div>{reviewer.name || reviewer.email || "—"}</div>
      {reviewer.name && reviewer.email ? (
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
          {reviewer.email}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * HR review screen for one BioTime verification.
 *
 * Every action button is gated on the backend `actions.can_*` flags rather
 * than on the status: the backend also weighs company scope, the role and
 * whether the PDF exists, and it deliberately re-opens approval on a rejected
 * acknowledgement once HR has corrected the attendance.
 */
export default function StartingWorkAcknowledgmentDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [messageApi, messageContext] = message.useMessage();

  const [record, setRecord] = useState<StartingWorkAcknowledgment | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [deciding, setDeciding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await getStartingWorkAcknowledgment(id!);
        if (isApiError(response)) {
          setError(response.message || t("startingWork.detail.loadFailed"));
          return;
        }
        setRecord(response.data);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError(
          isNotFound(err)
            ? t("startingWork.detail.notFound")
            : (err as Error)?.message || t("startingWork.detail.loadFailed"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Surfaces what the API said, and treats a 409 as a stale view.
   *
   * The decision endpoints answer 409 when the acknowledgement moved on under
   * the user - another HR user approved it, or it was already rejected - so
   * the record is reloaded rather than leaving buttons the API has refused.
   */
  const reportActionError = useCallback(
    (err: unknown, fallbackKey: string): string => {
      const detail = getHttpErrorMessage(err) || t(fallbackKey);
      if (isConflict(err)) void load({ isRefresh: true });
      return detail;
    },
    [load, t],
  );

  const handleApprove = useCallback(async () => {
    setDeciding(true);
    try {
      const response = await approveStartingWorkAcknowledgment(id!);
      if (isApiError(response)) {
        messageApi.error(response.message || t("startingWork.approve.failed"));
        return;
      }
      messageApi.success(response.message || t("startingWork.approve.success"));
      await load({ isRefresh: true });
    } catch (err: unknown) {
      messageApi.error(reportActionError(err, "startingWork.approve.failed"));
    } finally {
      setDeciding(false);
    }
  }, [id, messageApi, t, load, reportActionError]);

  const openReject = useCallback(() => {
    setReason("");
    setReasonError(null);
    setDecisionError(null);
    setRejectOpen(true);
  }, []);

  const handleReject = useCallback(async () => {
    const trimmed = reason.trim();
    // The backend refuses a blank reason with a 422; catch it in the dialog so
    // the rejection is never sent without one.
    if (!trimmed) {
      setReasonError(t("startingWork.reject.reasonRequired"));
      return;
    }
    setReasonError(null);
    setDecisionError(null);
    setDeciding(true);
    try {
      const response = await rejectStartingWorkAcknowledgment(id!, {
        reason: trimmed,
      });
      if (isApiError(response)) {
        setDecisionError(response.message || t("startingWork.reject.failed"));
        return;
      }
      setRejectOpen(false);
      messageApi.success(response.message || t("startingWork.reject.success"));
      await load({ isRefresh: true });
    } catch (err: unknown) {
      setDecisionError(reportActionError(err, "startingWork.reject.failed"));
    } finally {
      setDeciding(false);
    }
  }, [id, reason, messageApi, t, load, reportActionError]);

  const handleDownload = useCallback(async () => {
    if (!record) return;
    setDownloading(true);
    try {
      const blob = await downloadStartingWorkAcknowledgmentPdf(record);
      triggerBlobDownload(blob, acknowledgmentPdfFilename(record));
      messageApi.success(t("startingWork.pdf.success"));
    } catch (err: unknown) {
      messageApi.error(reportActionError(err, "startingWork.pdf.failed"));
    } finally {
      setDownloading(false);
    }
  }, [record, messageApi, t, reportActionError]);

  if (forbidden) return <Unauthorized403Page />;

  if (loading) return <LoadingState title={t("loading.generic")} />;

  if (error || !record) {
    return (
      <ErrorState
        title={t("common.error")}
        description={error || t("startingWork.detail.loadFailed")}
        onRetry={() => load()}
      />
    );
  }

  const actions = record.actions || {
    can_approve: false,
    can_reject: false,
    can_download: false,
  };
  const currentApprover = workflowActorName(record.workflow?.current_actor);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 24 }}>
      {messageContext}

      <PageHeader
        breadcrumb={t("startingWork.title")}
        title={record.employee?.name || record.reference_number}
        subtitle={record.reference_number}
        tags={
          <StartingWorkStatusTag
            status={record.status}
            fallbackLabel={record.status_label}
            size="large"
          />
        }
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => navigate("/hr/starting-work-acknowledgments")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("startingWork.action.back")}
            </Button>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={refreshing}
              onClick={() => load({ isRefresh: true })}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("startingWork.action.refresh")}
            </Button>
            {actions.can_download && (
              <Button
                icon={<DownloadOutlined aria-hidden />}
                loading={downloading}
                onClick={handleDownload}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("startingWork.action.download")}
              </Button>
            )}
            {actions.can_reject && (
              <Button
                danger
                icon={<CloseCircleOutlined aria-hidden />}
                disabled={deciding}
                onClick={openReject}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("startingWork.action.reject")}
              </Button>
            )}
            {actions.can_approve && (
              <Button
                type="primary"
                icon={<CheckCircleOutlined aria-hidden />}
                loading={deciding && !rejectOpen}
                onClick={handleApprove}
                style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
              >
                {t("startingWork.action.approve")}
              </Button>
            )}
          </div>
        }
      />

      {record.status === "pending_hr" && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 12, marginBottom: 16 }}
          message={t("startingWork.pendingExplanation")}
        />
      )}
      {record.status === "rejected" && (
        <Alert
          type="error"
          showIcon
          style={{ borderRadius: 12, marginBottom: 16 }}
          message={t("startingWork.rejectedExplanation")}
        />
      )}
      {record.status === "rejected" && actions.can_approve && (
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 12, marginBottom: 16 }}
          message={t("startingWork.approvalAfterRejectionExplanation")}
        />
      )}
      {record.status === "approved" && actions.can_download && (
        <Alert
          type="success"
          showIcon
          style={{ borderRadius: 12, marginBottom: 16 }}
          message={t("startingWork.pdf.approvedNote")}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Surface>
            <SectionTitle>{t("startingWork.section.employee")}</SectionTitle>
            <Field
              label={t("startingWork.field.employee")}
              value={record.employee?.name || "—"}
            />
            <Field
              label={t("startingWork.field.employeeId")}
              value={record.employee?.employee_id || "—"}
            />
            <Field
              label={t("startingWork.field.company")}
              value={
                record.company
                  ? `${record.company.name} (${record.company.code})`
                  : "—"
              }
            />
          </Surface>
        </Col>

        <Col xs={24} lg={12}>
          <Surface>
            <SectionTitle>{t("startingWork.section.record")}</SectionTitle>
            <Field
              label={t("startingWork.field.referenceNumber")}
              value={record.reference_number || "—"}
            />
            <Field
              label={t("startingWork.field.firstBiotimeDate")}
              value={formatDateOnly(record.first_biotime_attendance_date, "—")}
            />
            <Field
              label={t("startingWork.field.affectedAttendance")}
              value={record.affected_attendance_count ?? 0}
            />
            <Field
              label={t("startingWork.field.generatedAt")}
              value={formatDateTimeShort(record.generated_at, "—")}
            />
          </Surface>
        </Col>

        <Col xs={24}>
          <Surface>
            <SectionTitle>{t("startingWork.section.decision")}</SectionTitle>
            {!record.approved_at && !record.rejected_at ? (
              <Text type="secondary">{t("startingWork.decision.none")}</Text>
            ) : (
              <Row gutter={[16, 0]}>
                {record.approved_at && (
                  <>
                    <Col xs={24} md={12}>
                      <Field
                        label={t("startingWork.field.approvedBy")}
                        value={<Reviewer reviewer={record.approved_by} />}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Field
                        label={t("startingWork.field.approvedAt")}
                        value={formatDateTimeShort(record.approved_at, "—")}
                      />
                    </Col>
                  </>
                )}
                {record.rejected_at && (
                  <>
                    <Col xs={24} md={12}>
                      <Field
                        label={t("startingWork.field.rejectedBy")}
                        value={<Reviewer reviewer={record.rejected_by} />}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Field
                        label={t("startingWork.field.rejectedAt")}
                        value={formatDateTimeShort(record.rejected_at, "—")}
                      />
                    </Col>
                  </>
                )}
              </Row>
            )}
            {record.rejection_reason && (
              <Field
                label={t("startingWork.field.rejectionReason")}
                value={record.rejection_reason}
              />
            )}
          </Surface>
        </Col>

        <Col xs={24}>
          <Surface>
            <SectionTitle>{t("startingWork.section.history")}</SectionTitle>
            <Space size={16} wrap style={{ marginBottom: 16, display: "flex" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {`${t("startingWork.workflow.currentStage")}: ${record.workflow?.current_stage || "—"}`}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {`${t("startingWork.workflow.currentActor")}: ${currentApprover || "—"}`}
              </Text>
            </Space>
            <StartingWorkWorkflowHistory history={record.workflow?.history} />
          </Surface>
        </Col>
      </Row>

      <Modal
        open={rejectOpen}
        title={t("startingWork.action.reject")}
        okText={t("startingWork.action.reject")}
        okButtonProps={{
          danger: true,
          loading: deciding,
          "aria-label": t("startingWork.action.reject"),
        }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: deciding }}
        onOk={handleReject}
        onCancel={() => {
          if (deciding) return;
          setRejectOpen(false);
        }}
        closable={!deciding}
        maskClosable={!deciding}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 12, marginBottom: 16 }}
          message={t("startingWork.rejectedExplanation")}
        />
        <Form layout="vertical">
          <Form.Item
            label={t("startingWork.reject.reason")}
            required
            validateStatus={reasonError ? "error" : undefined}
            help={reasonError || undefined}
          >
            <Input.TextArea
              rows={3}
              value={reason}
              disabled={deciding}
              placeholder={t("startingWork.reject.reasonPlaceholder")}
              onChange={(event) => setReason(event.target.value)}
              aria-label={t("startingWork.reject.reason")}
            />
          </Form.Item>
        </Form>
        {decisionError && (
          <Alert
            type="error"
            showIcon
            style={{ borderRadius: 12 }}
            message={decisionError}
          />
        )}
      </Modal>
    </div>
  );
}
