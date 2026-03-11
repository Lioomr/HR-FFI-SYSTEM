import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeftOutlined, DownloadOutlined, EyeOutlined, FilePdfOutlined } from "@ant-design/icons";
import { Button, Card, Descriptions, Space, Tag, Typography, notification } from "antd";

import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import {
  getLeaveRequest,
  getLeaveRequestDocumentBlob,
  getLeaveRequestPdfBlob,
  type LeaveRequest,
} from "../../../services/api/leaveApi";
import { useI18n } from "../../../i18n/useI18n";

const { Text } = Typography;

export default function EmployeeLeaveRequestDetailsPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);

  const translateLeaveType = (name?: string): string => {
    if (!name) return "-";
    const key = `leave.type.${name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "")}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const loadRequest = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getLeaveRequest(id);
      if (isApiError(res)) {
        setError(res.message);
        return;
      }
      setRequest(res.data);
    } catch (err: any) {
      setError(err?.message || t("leave.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  const statusColor = (status?: string) => {
    switch ((status || "").toLowerCase()) {
      case "approved":
        return "green";
      case "rejected":
        return "red";
      case "pending_manager":
        return "orange";
      case "pending_hr":
        return "purple";
      case "pending_ceo":
        return "volcano";
      case "cancelled":
        return "default";
      default:
        return "blue";
    }
  };

  const statusLabel = (status?: string) => {
    const statusKey = `leave.status.${(status || "").toLowerCase()}`;
    const translated = t(statusKey);
    return translated === statusKey ? (status || "").replace(/_/g, " ") : translated;
  };

  const handlePdfDownload = async () => {
    if (!request) return;
    setPdfLoading(true);
    try {
      const blob = await getLeaveRequestPdfBlob(request.id, true);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `leave_request_${request.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch {
      notification.error({ message: t("common.error"), description: t("leave.pdfDownloadFailed") });
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDocumentAction = async (download: boolean) => {
    if (!request) return;
    setDocumentLoading(true);
    try {
      const blob = await getLeaveRequestDocumentBlob(request.id, download);
      const url = window.URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = `leave_document_${request.id}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch {
      notification.error({ message: t("common.error"), description: t("leave.docErrorDesc") });
    } finally {
      setDocumentLoading(false);
    }
  };

  if (loading) return <LoadingState title={t("leave.requestDetailsTitle", { id })} />;
  if (error) return <ErrorState title={t("common.error")} description={error} onRetry={loadRequest} />;
  if (!request) return <ErrorState title={t("common.error")} description={t("leave.loadFail")} />;

  const rejectionNote = request.ceo_decision_note || request.hr_decision_note || request.manager_decision_note || request.rejection_reason || "-";

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate("/employee/leave/requests")} style={{ paddingInlineStart: 0 }}>
        {t("leave.backToRequests")}
      </Button>

      <PageHeader
        title={t("leave.requestDetailsTitle", { id: request.id })}
        subtitle={t("leave.employeeDetailsSubtitle")}
        tags={<Tag color={statusColor(request.status)}>{statusLabel(request.status)}</Tag>}
        actions={
          <Space wrap>
            <Button icon={<FilePdfOutlined />} onClick={handlePdfDownload} loading={pdfLoading}>
              {t("leave.downloadRequestPdf")}
            </Button>
            {request.document ? (
              <>
                <Button icon={<EyeOutlined />} onClick={() => handleDocumentAction(false)} loading={documentLoading}>
                  {t("leave.previewAttachment")}
                </Button>
                <Button icon={<DownloadOutlined />} onClick={() => handleDocumentAction(true)} loading={documentLoading}>
                  {t("leave.downloadAttachment")}
                </Button>
              </>
            ) : null}
          </Space>
        }
      />

      <div style={{ display: "grid", gap: 18 }}>
        <LeaveApprovalMap request={request} t={t} />

        <Card style={{ borderRadius: 20, border: "1px solid #e5e7eb" }}>
          <Descriptions column={{ xs: 1, md: 2 }} layout="vertical" bordered>
            <Descriptions.Item label={t("leave.leaveType")}>{translateLeaveType(request.leave_type?.name)}</Descriptions.Item>
            <Descriptions.Item label={t("common.status")}>
              <Tag color={statusColor(request.status)}>{statusLabel(request.status)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("leave.period")}>
              {request.start_date} {t("common.to")} {request.end_date}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.duration")}>
              {request.days} {t("leaves.days")}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.submittedOn")}>
              {request.created_at ? new Date(request.created_at).toLocaleString() : "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("leave.requestSource")}>
              {request.source === "hr_manual" ? t("leave.manual.badge") : t("leave.approvalMap.employeeRequest")}
            </Descriptions.Item>
            <Descriptions.Item label={t("common.reason")} span={2}>
              <Text style={{ whiteSpace: "pre-wrap" }}>{request.reason || "-"}</Text>
            </Descriptions.Item>
            {request.status === "rejected" ? (
              <Descriptions.Item label={t("leave.rejectionReason")} span={2}>
                <Text style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>{rejectionNote}</Text>
              </Descriptions.Item>
            ) : null}
            {request.source === "hr_manual" ? (
              <Descriptions.Item label={t("leave.manual.entryReason")} span={2}>
                {request.manual_entry_reason || "-"}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        </Card>
      </div>
    </div>
  );
}
