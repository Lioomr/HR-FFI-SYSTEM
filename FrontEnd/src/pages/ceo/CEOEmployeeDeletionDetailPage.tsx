import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import NotFound404Page from "../NotFound404Page";

import {
  approveEmployeeDeletionRequest,
  getEmployeeDeletionRequest,
  rejectEmployeeDeletionRequest,
  type EmployeeDeletionRequest,
  type EmployeeDeletionStatus,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { isForbidden, isNotFound } from "../../services/api/httpErrors";
import { getFirstApiErrorMessage } from "../../utils/formErrors";
import { useI18n } from "../../i18n/useI18n";

const { Text, Paragraph } = Typography;

const STATUS_COLOR: Record<EmployeeDeletionStatus, string> = {
  PENDING_CEO: "gold",
  REJECTED: "red",
  EXECUTED: "green",
};

export default function CEOEmployeeDeletionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useI18n();

  const [data, setData] = useState<EmployeeDeletionRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionFieldError, setRejectionFieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);
    try {
      const response = await getEmployeeDeletionRequest(id);
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

  const closeApprove = () => {
    if (actionLoading) return;
    setApproveOpen(false);
    setActionError(null);
  };

  const closeReject = () => {
    if (actionLoading) return;
    setRejectOpen(false);
    setRejectionReason("");
    setRejectionFieldError(null);
    setActionError(null);
  };

  const handleActionError = (err: any, fallbackKey: string) => {
    const httpStatus = err?.response?.status;
    if (httpStatus === 403 || isForbidden(err)) {
      setActionError(t("employees.removalDetail.errorForbidden"));
    } else if (httpStatus === 404 || isNotFound(err)) {
      setActionError(t("employees.removalDetail.errorNotFound"));
    } else if (httpStatus === 422) {
      const friendly = getFirstApiErrorMessage(err);
      setActionError(friendly || t("employees.removalDetail.errorValidation"));
    } else {
      const friendly = getFirstApiErrorMessage(err);
      setActionError(friendly || t(fallbackKey));
    }
  };

  const submitApprove = async () => {
    if (!data) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await approveEmployeeDeletionRequest(data.id);
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

  const submitReject = async () => {
    if (!data) return;
    const trimmed = rejectionReason.trim();
    if (!trimmed) {
      setRejectionFieldError(t("employees.removalDetail.rejectReasonRequired"));
      return;
    }
    setRejectionFieldError(null);
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await rejectEmployeeDeletionRequest(data.id, trimmed);
      if (isApiError(response)) {
        setActionError(response.message || t("employees.removalDetail.errorReject"));
        return;
      }
      message.success(t("employees.removalDetail.successRejected"));
      setRejectOpen(false);
      setRejectionReason("");
      setData(response.data);
    } catch (err: any) {
      handleActionError(err, "employees.removalDetail.errorReject");
    } finally {
      setActionLoading(false);
    }
  };

  if (forbidden) return <Unauthorized403Page />;
  if (notFound) return <NotFound404Page />;

  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <ErrorState
          title={t("common.error")}
          description={error}
          onRetry={load}
        />
      </div>
    );
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

  return (
    <div style={{ padding: "0 12px", maxWidth: 980, margin: "0 auto" }}>
      <PageHeader
        title={t("employees.removalDetail.title")}
        subtitle={displayName}
        actions={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/ceo/employees/deletion-requests")}>
            {t("employees.removalDetail.backToInbox")}
          </Button>
        }
        tags={
          <Tag color={STATUS_COLOR[data.status] || "default"}>
            {t(`employees.removalInbox.status.${data.status}`)}
          </Tag>
        }
      />

      {data.status === "EXECUTED" && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16, borderRadius: 12 }}
          message={t("employees.removalDetail.executedTitle")}
          description={t("employees.removalDetail.executedDescription", {
            at: data.executed_at ? dayjs(data.executed_at).format("MMM DD, YYYY HH:mm") : "-",
            by: data.approved_by_name || "-",
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
                  by: data.rejected_by_name || "-",
                  at: data.rejected_at ? dayjs(data.rejected_at).format("MMM DD, YYYY HH:mm") : "-",
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

      <Card
        title={t("employees.removalDetail.employeeSection")}
        bordered={false}
        style={{ borderRadius: 16, marginBottom: 16 }}
      >
        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label={t("employees.removalDetail.fullName")}>
            {displayName}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.employeeId")}>
            {snapshot.employee_id || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.email")}>
            {snapshot.email || snapshot.target_user_email || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.company")}>
            {data.company_name || snapshot.company_name || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.department")}>
            {snapshot.department_name || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.position")}>
            {snapshot.position_name || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.employmentStatus")}>
            {snapshot.employment_status || "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title={t("employees.removalDetail.requestSection")}
        bordered={false}
        style={{ borderRadius: 16, marginBottom: 16 }}
      >
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t("employees.removalDetail.requestedBy")}>
            {data.requested_by_name || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.createdAt")}>
            {data.created_at ? dayjs(data.created_at).format("MMM DD, YYYY HH:mm") : "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("employees.removalDetail.reason")}>
            <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
              {data.reason || "-"}
            </Paragraph>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {(typeof execution.open_leave_requests === "number" ||
        typeof execution.asset_assignments === "number" ||
        typeof execution.loan_requests === "number") && (
        <Card
          title={t("employees.removalDetail.linkedRecords")}
          bordered={false}
          style={{ borderRadius: 16, marginBottom: 16 }}
        >
          <Descriptions column={{ xs: 1, sm: 3 }} bordered size="small">
            <Descriptions.Item label={t("employees.removalDetail.openLeaveRequests")}>
              {execution.open_leave_requests ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("employees.removalDetail.assetAssignments")}>
              {execution.asset_assignments ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("employees.removalDetail.loanRequests")}>
              {execution.loan_requests ?? "-"}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {isPending && (
        <Card
          bordered={false}
          style={{ borderRadius: 16, marginBottom: 16 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text strong style={{ fontSize: 16 }}>
              {t("employees.removalDetail.decisionTitle")}
            </Text>
            <Text type="secondary">
              {t("employees.removalDetail.decisionHint")}
            </Text>
            <Space wrap>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!canApprove}
                onClick={() => {
                  setApproveOpen(true);
                  setActionError(null);
                }}
              >
                {t("employees.removalDetail.approveButton")}
              </Button>
              <Button
                danger
                icon={<CloseOutlined />}
                disabled={!canReject}
                onClick={() => {
                  setRejectOpen(true);
                  setActionError(null);
                  setRejectionReason("");
                  setRejectionFieldError(null);
                }}
              >
                {t("employees.removalDetail.rejectButton")}
              </Button>
            </Space>
          </div>
        </Card>
      )}

      {/* Approve confirmation */}
      <Modal
        open={approveOpen}
        title={t("employees.removalDetail.approveModalTitle")}
        okText={t("employees.removalDetail.approveConfirm")}
        okButtonProps={{ danger: true, loading: actionLoading }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: actionLoading }}
        onOk={submitApprove}
        onCancel={closeApprove}
        closable={!actionLoading}
        maskClosable={!actionLoading}
        destroyOnClose
      >
        <Paragraph>
          {t("employees.removalDetail.approveModalIntro", { name: displayName })}
        </Paragraph>
        <Alert
          type="warning"
          showIcon
          message={t("employees.removalDetail.irreversibleWarning")}
          style={{ marginTop: 8 }}
        />
        {actionError && (
          <Alert
            type="error"
            showIcon
            message={actionError}
            style={{ marginTop: 12 }}
          />
        )}
      </Modal>

      {/* Reject with reason */}
      <Modal
        open={rejectOpen}
        title={t("employees.removalDetail.rejectModalTitle")}
        okText={t("employees.removalDetail.rejectConfirm")}
        okButtonProps={{ danger: true, loading: actionLoading }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: actionLoading }}
        onOk={submitReject}
        onCancel={closeReject}
        closable={!actionLoading}
        maskClosable={!actionLoading}
        destroyOnClose
      >
        <Paragraph>
          {t("employees.removalDetail.rejectModalIntro", { name: displayName })}
        </Paragraph>
        <Form layout="vertical">
          <Form.Item
            label={t("employees.removalDetail.rejectReasonLabel")}
            required
            validateStatus={rejectionFieldError ? "error" : undefined}
            help={rejectionFieldError || undefined}
          >
            <Input.TextArea
              rows={4}
              value={rejectionReason}
              onChange={(e) => {
                setRejectionReason(e.target.value);
                if (rejectionFieldError) setRejectionFieldError(null);
              }}
              placeholder={t("employees.removalDetail.rejectReasonPlaceholder")}
              maxLength={500}
              showCount
              disabled={actionLoading}
            />
          </Form.Item>
        </Form>
        {actionError && (
          <Alert
            type="error"
            showIcon
            message={actionError}
            style={{ marginTop: 4 }}
          />
        )}
      </Modal>
    </div>
  );
}
