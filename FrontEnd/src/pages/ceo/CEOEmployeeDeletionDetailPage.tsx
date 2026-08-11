import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Descriptions, Modal, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import ApprovalActions from "../../components/ceo/ApprovalActions";
import ApprovalStatusTag, { type ApprovalStatusTone } from "../../components/ceo/ApprovalStatusTag";
import ApprovalSurface from "../../components/ceo/ApprovalSurface";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import Unauthorized403Page from "../Unauthorized403Page";
import NotFound404Page from "../NotFound404Page";

import {
  approveEmployeeArchiveRequest,
  getEmployeeArchiveRequest,
  rejectEmployeeArchiveRequest,
  type EmployeeArchiveRequest,
  type EmployeeArchiveStatus,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { isForbidden, isNotFound } from "../../services/api/httpErrors";
import { getFirstApiErrorMessage } from "../../utils/formErrors";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text, Paragraph } = Typography;

const STATUS_TONE: Record<EmployeeArchiveStatus, ApprovalStatusTone> = {
  PENDING_CEO: "pending",
  REJECTED: "rejected",
  EXECUTED: "approved",
};

/** Section heading shared by the detail blocks, so all three read alike. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "0 0 12px",
        fontSize: 15,
        fontWeight: 700,
        color: "#0f172a",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </h2>
  );
}

export default function CEOEmployeeDeletionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useI18n();

  const [data, setData] = useState<EmployeeArchiveRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);
    try {
      const response = await getEmployeeArchiveRequest(id);
      if (isApiError(response)) {
        setError(response.message || t("employees.removalDetail.errorGeneric"));
        return;
      }
      setData(response.data);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }
      if (isNotFound(err)) {
        setNotFound(true);
        return;
      }
      setError(err?.message || t("employees.removalDetail.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleActionError = (err: any, fallbackKey: string) => {
    const httpStatus = err?.response?.status;
    if (httpStatus === 403 || isForbidden(err)) {
      setActionError(t("employees.removalDetail.errorForbidden"));
    } else if (httpStatus === 404 || isNotFound(err)) {
      setActionError(t("employees.removalDetail.errorNotFound"));
    } else if (httpStatus === 422) {
      setActionError(getFirstApiErrorMessage(err) || t("employees.removalDetail.errorValidation"));
    } else {
      setActionError(getFirstApiErrorMessage(err) || t(fallbackKey));
    }
  };

  const submitApprove = async () => {
    if (!data) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await approveEmployeeArchiveRequest(data.id);
      if (isApiError(response)) {
        setActionError(response.message || t("employees.removalDetail.errorApprove"));
        return;
      }
      message.success(t("employees.removalDetail.successApproved"));
      setApproveOpen(false);
      setData(response.data);
    } catch (err: any) {
      handleActionError(err, "employees.removalDetail.errorApprove");
    } finally {
      setActionLoading(false);
    }
  };

  const submitReject = async (reason: string) => {
    if (!data) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await rejectEmployeeArchiveRequest(data.id, reason);
      if (isApiError(response)) {
        setActionError(response.message || t("employees.removalDetail.errorReject"));
        return;
      }
      message.success(t("employees.removalDetail.successRejected"));
      setRejectOpen(false);
      setData(response.data);
    } catch (err: any) {
      handleActionError(err, "employees.removalDetail.errorReject");
    } finally {
      setActionLoading(false);
    }
  };

  if (forbidden) return <Unauthorized403Page />;
  if (notFound) return <NotFound404Page />;
  if (loading) return <LoadingState title={t("loading.generic")} />;
  if (error) {
    return <ErrorState title={t("common.error")} description={error} onRetry={load} />;
  }
  if (!data) return null;

  const snapshot = data.request_snapshot || {};
  const execution = data.execution_snapshot || {};
  const localizedName =
    language === "ar"
      ? snapshot.full_name_ar || snapshot.full_name || snapshot.full_name_en
      : snapshot.full_name_en || snapshot.full_name || snapshot.full_name_ar;
  const displayName = localizedName || snapshot.employee_id || `#${data.id}`;
  const isPending = data.status === "PENDING_CEO";
  const canApprove = isPending && (data.workflow?.can_approve ?? true);
  const canReject = isPending && (data.workflow?.can_reject ?? true);
  const hasLinkedRecords =
    typeof execution.open_leave_requests === "number" ||
    typeof execution.asset_assignments === "number" ||
    typeof execution.loan_requests === "number";

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", paddingBottom: 24 }}>
      <PageHeader
        title={t("employees.removalDetail.title")}
        subtitle={displayName}
        actions={
          <Button
            icon={<ArrowLeftOutlined aria-hidden />}
            onClick={() => navigate("/ceo/employees/deletion-requests")}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {t("employees.removalDetail.backToInbox")}
          </Button>
        }
        tags={
          <ApprovalStatusTag
            label={t(`employees.removalInbox.status.${data.status}`)}
            tone={STATUS_TONE[data.status] || "neutral"}
          />
        }
      />

      {/* ─── Decision first: the reason this page was opened ─────────────── */}
      {isPending && (
        <ApprovalSurface padding={18} style={{ marginBottom: 16 }}>
          <SectionTitle>{t("employees.removalDetail.decisionTitle")}</SectionTitle>
          <Paragraph type="secondary" style={{ marginBottom: 14 }}>
            {t("employees.removalDetail.decisionHint")}
          </Paragraph>
          <ApprovalActions
            size="middle"
            subjectLabel={displayName}
            approveDisabled={!canApprove}
            rejectDisabled={!canReject}
            approveLabel={t("employees.removalDetail.approveButton")}
            rejectLabel={t("employees.removalDetail.rejectButton")}
            onApprove={() => {
              setApproveOpen(true);
              setActionError(null);
            }}
            onReject={() => {
              setRejectOpen(true);
              setActionError(null);
            }}
          />
        </ApprovalSurface>
      )}

      {data.status === "EXECUTED" && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16, borderRadius: 12 }}
          message={t("employees.removalDetail.executedTitle")}
          description={t("employees.removalDetail.executedDescription", {
            at: formatDateTimeShort(data.executed_at),
            by: data.approved_by_name || "—",
          })}
        />
      )}

      {data.status === "REJECTED" && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16, borderRadius: 12 }}
          message={t("employees.removalDetail.rejectedTitle")}
          description={
            <div>
              <div>
                {t("employees.removalDetail.rejectedBy", {
                  by: data.rejected_by_name || "—",
                  at: formatDateTimeShort(data.rejected_at),
                })}
              </div>
              {data.rejection_reason && (
                <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                  <Text strong>{t("employees.removalDetail.rejectionReasonLabel")}: </Text>
                  {data.rejection_reason}
                </Paragraph>
              )}
            </div>
          }
        />
      )}

      <ApprovalSurface padding={18} style={{ marginBottom: 16 }}>
        <SectionTitle>{t("employees.removalDetail.employeeSection")}</SectionTitle>
        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small" bordered>
          <Descriptions.Item label={t("employees.removalDetail.fullName")}>{displayName}</Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.employeeId")}>
            {snapshot.employee_id || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.email")}>
            {snapshot.email || snapshot.target_user_email || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.company")}>
            {data.company_name || snapshot.company_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.department")}>
            {snapshot.department_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.position")}>
            {snapshot.position_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.employmentStatus")}>
            {snapshot.employment_status || "—"}
          </Descriptions.Item>
        </Descriptions>
      </ApprovalSurface>

      <ApprovalSurface padding={18} style={{ marginBottom: 16 }}>
        <SectionTitle>{t("employees.removalDetail.requestSection")}</SectionTitle>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t("employees.removalDetail.requestedBy")}>
            {data.requested_by_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.createdAt")}>
            {formatDateTimeShort(data.created_at)}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removal.archiveReasonLabel")}>
            {t(`employees.removal.archiveReason.${data.archive_reason}`)}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.reason")}>
            <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{data.reason || "—"}</Paragraph>
          </Descriptions.Item>
        </Descriptions>
      </ApprovalSurface>

      {hasLinkedRecords && (
        <ApprovalSurface padding={18}>
          <SectionTitle>{t("employees.removalDetail.linkedRecords")}</SectionTitle>
          <Descriptions column={{ xs: 1, sm: 3 }} size="small" bordered>
            <Descriptions.Item label={t("employees.removalDetail.openLeaveRequests")}>
              {execution.open_leave_requests ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("employees.removalDetail.assetAssignments")}>
              {execution.asset_assignments ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label={t("employees.removalDetail.loanRequests")}>
              {execution.loan_requests ?? "—"}
            </Descriptions.Item>
          </Descriptions>
        </ApprovalSurface>
      )}

      {/* Approve confirmation */}
      <Modal
        open={approveOpen}
        title={t("employees.removalDetail.approveModalTitle")}
        okText={t("employees.removalDetail.approveConfirm")}
        okButtonProps={{
          loading: actionLoading,
          "aria-label": t("employees.removalDetail.approveConfirm"),
        }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: actionLoading }}
        onOk={submitApprove}
        onCancel={() => {
          if (actionLoading) return;
          setApproveOpen(false);
          setActionError(null);
        }}
        closable={!actionLoading}
        maskClosable={!actionLoading}
        destroyOnHidden
      >
        <Paragraph>{t("employees.removalDetail.approveModalIntro", { name: displayName })}</Paragraph>
        <Alert
          type="info"
          showIcon
          message={t("employees.removalDetail.preservationNotice")}
          style={{ marginTop: 8, borderRadius: 10 }}
        />
        {actionError && (
          <Alert type="error" showIcon message={actionError} style={{ marginTop: 12, borderRadius: 10 }} />
        )}
      </Modal>

      {/* Reject with reason */}
      <RejectReasonModal
        open={rejectOpen}
        title={t("employees.removalDetail.rejectModalTitle")}
        subject={t("employees.removalDetail.rejectModalIntro", { name: displayName })}
        confirmText={t("employees.removalDetail.rejectConfirm")}
        loading={actionLoading}
        errorMessage={actionError}
        onCancel={() => {
          setRejectOpen(false);
          setActionError(null);
        }}
        onSubmit={submitReject}
      />
    </div>
  );
}
