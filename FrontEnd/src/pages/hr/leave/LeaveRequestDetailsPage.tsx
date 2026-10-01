import BackButton from "../../../components/ui/BackButton";
import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Descriptions,
  Alert,
  Tag,
  Modal,
  Input,
  Space,
  Typography,
  notification,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  DownloadOutlined,
  ExportOutlined,
  FilePdfOutlined,
} from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import {
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  sendLeaveRequestToCEO,
  hrCancelLeaveRequest,
  getCEOLeaveRequest,
  approveCEOLeaveRequest,
  rejectCEOLeaveRequest,
  getCEOLeaveRequestDocumentBlob,
  getCEOLeaveRequestPdfBlob,
  getLeaveRequestDocumentBlob,
  getLeaveRequestPdfBlob,
  type LeaveRequest,
} from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";
import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";
import RequestObligationsPanel from "../../../components/requests/RequestObligationsPanel";
import ApprovalActions from "../../../components/ceo/ApprovalActions";
import RejectReasonModal from "../../../components/ceo/RejectReasonModal";
import StickyDecisionBar from "../../../components/ceo/StickyDecisionBar";
import { useFilePreview } from "../../../components/ui/useFilePreview";
import { downloadBlob } from "../../../utils/download";

const { confirm } = Modal;
const { TextArea } = Input;

type LeaveRequestDetailsPageProps = {
  audience?: "hr" | "ceo";
};

export default function LeaveRequestDetailsPage({
  audience = "hr",
}: LeaveRequestDetailsPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const isCEO = audience === "ceo";

  // Translate leave type names from the API
  const translateLeaveType = (name?: string): string => {
    if (!name) return "-";
    const key = `leave.type.${name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z_]/g, "")}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Action States
  const [processing, setProcessing] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [ceoApproveOpen, setCeoApproveOpen] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [ceoRejectOpen, setCeoRejectOpen] = useState(false);
  const { openPreview, previewModal } = useFilePreview();

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = isCEO
        ? await getCEOLeaveRequest(id)
        : await getLeaveRequest(id);
      if (isApiError(res)) {
        setError(res.message);
      } else {
        setRequest(res.data);
      }
    } catch (e: any) {
      setError(e.message || t("leave.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [id, isCEO, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = () => {
    if (!request) return;
    confirm({
      title: t("leave.approveTitle"),
      content: t("leave.approveConfirm", {
        name: request.employee?.full_name || "",
        days: request.days,
      }),
      okText: t("common.approve"),
      okType: "primary",
      cancelText: t("common.cancel"),
      onOk: async () => {
        setProcessing(true);
        try {
          const res = await approveLeaveRequest(request.id);
          if (isApiError(res)) {
            notification.error({
              message: t("leave.approveFail"),
              description: res.message,
            });
          } else {
            notification.success({ message: t("leave.approveSuccess") });
            loadData();
          }
        } catch (e) {
          notification.error({
            message: t("common.error"),
            description: t("leave.approveError"),
          });
        } finally {
          setProcessing(false);
        }
      },
    });
  };

  const handleSendToCEO = () => {
    if (!request) return;
    confirm({
      title: t("leave.sendToCeoTitle"),
      content: t("leave.sendToCeoDesc"),
      okText: t("leave.sendToCeoBtn"),
      okType: "primary",
      cancelText: t("common.cancel"),
      onOk: async () => {
        setProcessing(true);
        try {
          const res = await sendLeaveRequestToCEO(request.id);
          if (isApiError(res)) {
            notification.error({
              message: t("leave.sendFail"),
              description: res.message,
            });
          } else {
            notification.success({ message: t("leave.sendSuccess") });
            loadData();
          }
        } catch {
          notification.error({
            message: t("common.error"),
            description: t("leave.sendError"),
          });
        } finally {
          setProcessing(false);
        }
      },
    });
  };

  const loadDocument = (id: number, download: boolean) =>
    isCEO
      ? getCEOLeaveRequestDocumentBlob(id, download)
      : getLeaveRequestDocumentBlob(id, download);

  const previewDocument = () => {
    if (!request) return;
    openPreview({
      title: t("common.document"),
      filename: `leave_request_${request.id}_document`,
      load: () => loadDocument(request.id, false),
    });
  };

  const downloadDocument = async () => {
    if (!request) return;
    setDocumentLoading(true);
    try {
      downloadBlob(
        await loadDocument(request.id, true),
        `leave_request_${request.id}_document`,
      );
    } catch {
      notification.error({
        message: t("leave.docErrorTitle"),
        description: t("leave.docErrorDesc"),
      });
    } finally {
      setDocumentLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (!request) return;
    setPdfLoading(true);
    try {
      const blob = isCEO
        ? await getCEOLeaveRequestPdfBlob(request.id, true)
        : await getLeaveRequestPdfBlob(request.id, true);
      downloadBlob(blob, `leave_request_${request.id}.pdf`);
    } catch {
      notification.error({
        message: t("common.error"),
        description: t("leave.pdfDownloadFailed"),
      });
    } finally {
      setPdfLoading(false);
    }
  };

  const previewPdf = () => {
    if (!request) return;
    openPreview({
      title: t("leave.requestDetailsTitle", { id: request.id }),
      filename: `leave_request_${request.id}.pdf`,
      load: () =>
        isCEO
          ? getCEOLeaveRequestPdfBlob(request.id, false)
          : getLeaveRequestPdfBlob(request.id, false),
    });
  };

  // ── CEO decision ──────────────────────────────────────────────────────────
  // Once decided, the request leaves the CEO queue (and this endpoint), so a
  // successful decision returns to the inbox instead of reloading.
  const blockerCount = request?.obligations_summary?.blocking_open || 0;

  const closeCeoApprove = () => {
    if (processing) return;
    setCeoApproveOpen(false);
    setWaiverReason("");
    setWaiverError(null);
  };

  const submitCeoApprove = async () => {
    if (!request) return;
    const trimmedWaiver = waiverReason.trim();
    if (blockerCount > 0 && !trimmedWaiver) {
      setWaiverError(
        t("obligations.waiverRequired", "Waiver reason is required."),
      );
      return;
    }
    setProcessing(true);
    try {
      const res = await approveCEOLeaveRequest(
        request.id,
        undefined,
        trimmedWaiver || undefined,
      );
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
        return;
      }
      notification.success({
        message: t(
          "leave.ceoApproveSuccess",
          "Approved and sent to HR for completion.",
        ),
      });
      setCeoApproveOpen(false);
      navigate("/ceo/leave/requests");
    } catch {
      notification.error({
        message: t("common.error"),
        description: t("common.tryAgain"),
      });
    } finally {
      setProcessing(false);
    }
  };

  const submitCeoReject = async (reason: string) => {
    if (!request) return;
    setProcessing(true);
    try {
      const res = await rejectCEOLeaveRequest(request.id, reason);
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
        return;
      }
      notification.success({ message: t("leave.rejected") });
      setCeoRejectOpen(false);
      navigate("/ceo/leave/requests");
    } catch {
      notification.error({
        message: t("common.error"),
        description: t("common.tryAgain"),
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!request || !rejectionReason.trim()) {
      notification.error({
        message: t("leave.reasonReqTitle"),
        description: t("leave.reasonReqDesc"),
      });
      return;
    }

    setProcessing(true);
    try {
      const res = await rejectLeaveRequest(request.id, rejectionReason);
      if (isApiError(res)) {
        notification.error({
          message: t("leave.rejectFail"),
          description: res.message,
        });
      } else {
        notification.success({ message: t("leave.rejectSuccess") });
        setRejectModalVisible(false);
        setRejectionReason("");
        loadData();
      }
    } catch (e) {
      notification.error({
        message: t("common.error"),
        description: t("leave.rejectError"),
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleHrCancel = async () => {
    const reason = cancelReason.trim();
    if (!request || !reason) {
      notification.error({
        message: t("leave.hrCancelFail"),
        description: t("leave.hrCancelReasonRequired"),
      });
      return;
    }

    setProcessing(true);
    try {
      const res = await hrCancelLeaveRequest(request.id, reason);
      if (isApiError(res)) {
        notification.error({
          message: t("leave.hrCancelFail"),
          description: res.message,
        });
      } else {
        notification.success({ message: t("leave.hrCancelSuccess") });
        setCancelModalVisible(false);
        setCancelReason("");
        loadData();
      }
    } catch {
      notification.error({
        message: t("common.error"),
        description: t("leave.hrCancelFail"),
      });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <LoadingState title={t("leave.loadingDetails")} />;
  if (error)
    return (
      <ErrorState
        title={t("common.error")}
        description={error}
        onRetry={loadData}
      />
    );
  if (!request)
    return (
      <ErrorState
        title={t("leave.notFound")}
        description={t("leave.notFoundDesc")}
      />
    );

  // HR can only action submitted or pending_hr requests.
  // pending_ceo requests must go to the CEO portal.
  const canAction =
    !isCEO &&
    ["submitted", "pending_hr"].includes(request.status?.toLowerCase() ?? "");
  const canSendToCEO = !isCEO && canAction;
  const canCeoDecide = isCEO && request.status?.toLowerCase() === "pending_ceo";
  const employeeName =
    request.employee?.full_name || `ID: ${request.employee?.id}`;
  // Employees cannot cancel their own leave; HR cancels any request in progress or already approved.
  const canHrCancel =
    [
      "submitted",
      "pending_delegate",
      "pending_manager",
      "pending_hr",
      "pending_ceo",
      "pending_hr_completion",
      "approved",
    ].includes(request.status?.toLowerCase() ?? "") && !isCEO;

  const statusLabel = (() => {
    const statusKey = `leave.status.${(request.status || "").toLowerCase()}`;
    const translated = t(statusKey);
    return translated === statusKey
      ? (request.status || "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : translated;
  })();

  const statusColor = () => {
    const s = request.status?.toLowerCase();
    if (s === "approved") return "green";
    if (s === "rejected") return "red";
    if (s === "pending_ceo") return "volcano";
    if (s === "pending_hr") return "purple";
    if (s === "pending_delegate") return "gold";
    if (s === "pending_manager") return "orange";
    return "blue";
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <PageHeader
        title={t("leave.requestDetailsTitle", { id: request.id })}
        tags={<Tag color={statusColor()}>{statusLabel}</Tag>}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button icon={<EyeOutlined />} onClick={previewPdf}>
              {t("common.preview")}
            </Button>
            <Button
              icon={<FilePdfOutlined />}
              onClick={downloadPdf}
              loading={pdfLoading}
            >
              {t("leave.downloadRequestPdf")}
            </Button>
            <BackButton
              onClick={() =>
                navigate(isCEO ? "/ceo/leave/requests" : "/hr/leave/requests")
              }
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("leave.backToInbox")}
            </BackButton>
          </div>
        }
      />

      <div style={{ display: "grid", gap: 18 }}>
        <LeaveApprovalMap request={request} t={t} />
        {!isCEO && (
          <RequestObligationsPanel
            parentType="leave_request"
            parentId={request.id}
            leaveRequest={request}
            onChanged={loadData}
          />
        )}

        <Card style={{ borderRadius: 16 }} title={t("common.details")}>
          <Descriptions bordered column={1}>
            <Descriptions.Item label={t("permissionRequests.list.reference")}>
              {request.reference_no || `#${request.id}`}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.employee")}>
              {employeeName}
            </Descriptions.Item>
            <Descriptions.Item label={t("leave.type")}>
              {translateLeaveType(request.leave_type?.name)}
            </Descriptions.Item>
            <Descriptions.Item label={t("leave.period")}>
              {request.start_date} {t("common.to")} {request.end_date}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.duration")}>
              {request.days} {t("leaves.days")}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.reason")}>
              {request.reason}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.document")}>
              {request.document ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button icon={<EyeOutlined />} onClick={previewDocument}>
                    {t("common.preview")}
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={downloadDocument}
                    loading={documentLoading}
                  >
                    {t("common.download")}
                  </Button>
                </div>
              ) : (
                "-"
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.submittedOn")}>
              {request.created_at
                ? new Date(request.created_at).toLocaleDateString()
                : "-"}
            </Descriptions.Item>
            {request.source === "hr_manual" && (
              <Descriptions.Item label={t("leave.manual.recordSource")}>
                <Tag color="cyan">{t("leave.manual.badge")}</Tag>
              </Descriptions.Item>
            )}
            {request.source === "hr_manual" && (
              <Descriptions.Item label={t("leave.manual.entryReason")}>
                {request.manual_entry_reason || "-"}
              </Descriptions.Item>
            )}
            {request.source === "hr_manual" && (
              <Descriptions.Item label={t("leave.manual.sourceDocumentRef")}>
                {request.source_document_ref || "-"}
              </Descriptions.Item>
            )}

            {request.status === "rejected" && (
              <Descriptions.Item
                label={t("leave.rejectionReason")}
                contentStyle={{ color: "red" }}
              >
                {request.ceo_decision_note ||
                  request.hr_decision_note ||
                  request.manager_decision_note ||
                  request.delegate_decision_note ||
                  request.rejection_reason ||
                  "-"}
              </Descriptions.Item>
            )}
            {request.status === "pending_ceo" && !isCEO && (
              <Descriptions.Item
                label={t("leave.statusNote")}
                contentStyle={{ color: "#d4380d" }}
              >
                {t("leave.ceoApprovalWait")}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      </div>

      {canCeoDecide && (
        <StickyDecisionBar>
          <ApprovalActions
            size="large"
            subjectLabel={employeeName}
            approveLoading={processing && ceoApproveOpen}
            disabled={processing}
            onApprove={() => setCeoApproveOpen(true)}
            onReject={() => setCeoRejectOpen(true)}
          />
        </StickyDecisionBar>
      )}

      {(canAction || canHrCancel) && (
        <StickyDecisionBar hint={canAction ? undefined : null}>
          <Space size={8} wrap>
            {canHrCancel && (
              <Button
                danger
                type="text"
                onClick={() => setCancelModalVisible(true)}
                disabled={processing}
              >
                {t("leave.cancel")}
              </Button>
            )}
            {canSendToCEO && (
              <Button
                icon={<ExportOutlined />}
                onClick={handleSendToCEO}
                disabled={processing}
              >
                {t("leave.sendToCeoBtn")}
              </Button>
            )}
            {canAction && (
              <>
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => setRejectModalVisible(true)}
                  disabled={processing}
                >
                  {t("leave.reject")}
                </Button>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={handleApprove}
                  loading={processing}
                >
                  {t("leave.approve")}
                </Button>
              </>
            )}
          </Space>
        </StickyDecisionBar>
      )}

      {previewModal}

      {/* CEO approve — carries the blocking-obligation waiver when required */}
      <Modal
        open={ceoApproveOpen}
        title={t("ceo.leaveApprovals.approveTitle")}
        okText={t("common.approve")}
        okButtonProps={{ loading: processing }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: processing }}
        onOk={submitCeoApprove}
        onCancel={closeCeoApprove}
        closable={!processing}
        maskClosable={!processing}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text strong>
            {employeeName} — {request.days} {t("leave.days")}
          </Typography.Text>
          {blockerCount > 0 && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ borderRadius: 10 }}
                message={t(
                  "obligations.ceoWaiverRequired",
                  { count: blockerCount },
                  "{count} blocking obligation(s) remain. Enter a CEO waiver reason to approve.",
                )}
              />
              <TextArea
                rows={3}
                autoFocus
                value={waiverReason}
                disabled={processing}
                status={waiverError ? "error" : undefined}
                placeholder={t("obligations.waiverReason", "Waiver reason")}
                aria-label={t("obligations.waiverReason", "Waiver reason")}
                onChange={(event) => {
                  setWaiverReason(event.target.value);
                  if (waiverError) setWaiverError(null);
                }}
              />
              {waiverError && (
                <Typography.Text type="danger">{waiverError}</Typography.Text>
              )}
            </>
          )}
        </Space>
      </Modal>

      <RejectReasonModal
        open={ceoRejectOpen}
        title={t("ceo.leaveApprovals.rejectTitle")}
        subject={employeeName}
        confirmText={t("ceo.leaveApprovals.rejectConfirm")}
        loading={processing}
        onCancel={() => setCeoRejectOpen(false)}
        onSubmit={submitCeoReject}
      />

      {/* Reject Modal */}
      <Modal
        title={t("leave.rejectTitle")}
        open={rejectModalVisible}
        onOk={handleReject}
        onCancel={() => setRejectModalVisible(false)}
        okText={t("leave.rejectBtn")}
        okType="danger"
        confirmLoading={processing}
      >
        <Alert
          type="warning"
          message={t("leave.rejectWarning")}
          showIcon
          style={{ marginBottom: 16 }}
        />
        <TextArea
          rows={4}
          placeholder={t("leave.rejectPlaceholder")}
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
        />
      </Modal>

      {/* HR Cancel Modal */}
      <Modal
        title={t("leave.hrCancelTitle")}
        open={cancelModalVisible}
        onOk={handleHrCancel}
        onCancel={() => setCancelModalVisible(false)}
        okText={t("leave.cancel")}
        cancelText={t("common.no")}
        okType="danger"
        confirmLoading={processing}
      >
        <Alert
          type="warning"
          message={t("leave.hrCancelDesc")}
          showIcon
          style={{ marginBottom: 16 }}
        />
        <TextArea
          rows={4}
          placeholder={t("leave.hrCancelReasonPlaceholder")}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
