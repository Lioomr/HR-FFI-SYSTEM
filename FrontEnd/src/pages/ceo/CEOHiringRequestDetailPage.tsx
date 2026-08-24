import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Col, Descriptions, Row, Space, Typography, message } from "antd";
import { ArrowLeftOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";

import ApprovalActions from "../../components/ceo/ApprovalActions";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import SARIcon from "../../components/icons/SARIcon";
import HiringRequestStatusTag from "../../components/hiringRequests/HiringRequestStatusTag";
import Unauthorized403Page from "../Unauthorized403Page";

import { isApiError } from "../../services/api/apiTypes";
import { isForbidden, isNotFound } from "../../services/api/httpErrors";
import { triggerBlobDownload } from "../../services/api/downloads";
import {
  approveHiringRequest,
  downloadHiringRequestCv,
  getHiringRequest,
  rejectHiringRequest,
  type HiringRequest,
} from "../../services/api/hiringRequestsApi";
import { useI18n } from "../../i18n/useI18n";
import { formatNumber } from "../../utils/currency";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

function Surface({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
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

export default function CEOHiringRequestDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [messageApi, messageContext] = message.useMessage();

  const [request, setRequest] = useState<HiringRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await getHiringRequest(id!);
        if (isApiError(response)) {
          setError(response.message || t("hiringRequests.detail.loadFailed"));
          return;
        }
        setRequest(response.data);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError(
          isNotFound(err)
            ? t("hiringRequests.detail.notFound")
            : (err as Error)?.message || t("hiringRequests.detail.loadFailed"),
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

  const handleApprove = useCallback(async () => {
    setDeciding(true);
    try {
      const response = await approveHiringRequest(id!, {});
      if (isApiError(response)) {
        messageApi.error(response.message || t("hiringRequests.decision.approveFailed"));
        return;
      }
      setRequest(response.data);
      messageApi.success(t("hiringRequests.decision.approveSuccess"));
    } catch (err: unknown) {
      messageApi.error((err as Error)?.message || t("hiringRequests.decision.approveFailed"));
    } finally {
      setDeciding(false);
    }
  }, [id, messageApi, t]);

  const handleReject = useCallback(
    async (note: string) => {
      setDeciding(true);
      setRejectError(null);
      try {
        const response = await rejectHiringRequest(id!, { note });
        if (isApiError(response)) {
          setRejectError(response.message || t("hiringRequests.decision.rejectFailed"));
          return;
        }
        setRequest(response.data);
        setRejectOpen(false);
        messageApi.success(t("hiringRequests.decision.rejectSuccess"));
      } catch (err: unknown) {
        setRejectError((err as Error)?.message || t("hiringRequests.decision.rejectFailed"));
      } finally {
        setDeciding(false);
      }
    },
    [id, messageApi, t],
  );

  const handleCvDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await downloadHiringRequestCv(id!);
      triggerBlobDownload(blob, `hiring_request_${id}_cv`);
    } catch (err: unknown) {
      messageApi.error((err as Error)?.message || t("hiringRequests.cv.failed"));
    } finally {
      setDownloading(false);
    }
  }, [id, messageApi, t]);

  if (forbidden) return <Unauthorized403Page />;

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <LoadingState title={t("loading.generic")} lines={8} />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <ErrorState
          title={t("common.error")}
          description={error || t("hiringRequests.detail.notFound")}
          onRetry={() => load()}
        />
      </div>
    );
  }

  // The backend decides who may act; role alone is not enough because company
  // scope and workflow stage both weigh in.
  const canApprove = Boolean(request.workflow?.can_approve) && request.status === "submitted";
  const canReject = Boolean(request.workflow?.can_reject) && request.status === "submitted";
  const decided = Boolean(request.ceo_decision_at);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 32 }}>
      {messageContext}

      <PageHeader
        title={request.candidate_full_name}
        subtitle={request.company_name}
        secondarySubtitle={t("hiringRequests.detail.reference", { reference: request.reference_number })}
        breadcrumb={t("hiringRequests.ceo.title")}
        tags={
          <HiringRequestStatusTag
            status={request.status}
            fallbackLabel={request.status_label}
            size="large"
          />
        }
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => navigate("/ceo/hiring-requests")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("hiringRequests.ceo.backToInbox")}
            </Button>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={refreshing}
              onClick={() => load({ isRefresh: true })}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("hiringRequests.action.refresh")}
            </Button>
          </div>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Surface>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small" colon={false}>
              <Descriptions.Item label={t("hiringRequests.field.candidateFullName")}>
                {request.candidate_full_name || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.joiningCompany")}>
                {request.company_name || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.nationality")}>
                {request.nationality || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.dateOfBirth")}>
                {formatDateOnly(request.date_of_birth, "—")}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.candidateEmail")}>
                {request.candidate_email || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.candidatePhone")}>
                {request.candidate_phone_number || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.proposedSalary")}>
                <Space size={4}>
                  <Text strong>{formatNumber(request.proposed_salary)}</Text>
                  <SARIcon size={13} color="#475569" />
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.requestedBy")}>
                {request.requested_by_name || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.col.submittedAt")}>
                {formatDateTimeShort(request.submitted_at, "—")}
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
              {request.has_cv ? (
                <Button
                  icon={<DownloadOutlined aria-hidden />}
                  loading={downloading}
                  onClick={handleCvDownload}
                  style={{ borderRadius: 10 }}
                >
                  {t("hiringRequests.action.downloadCv")}
                </Button>
              ) : (
                <Text type="secondary">{t("hiringRequests.detail.noCv")}</Text>
              )}
            </div>
          </Surface>
        </Col>

        <Col xs={24} lg={9}>
          <Surface>
            <Typography.Title level={5} style={{ marginTop: 0, fontWeight: 700 }}>
              {t("hiringRequests.ceo.decisionTitle")}
            </Typography.Title>

            {decided ? (
              <Alert
                type={request.status === "rejected" ? "error" : "success"}
                showIcon
                style={{ borderRadius: 12 }}
                message={
                  request.status === "rejected"
                    ? t("hiringRequests.decision.rejectedBy", {
                        name: request.ceo_decision_by_name || "—",
                      })
                    : t("hiringRequests.decision.approvedBy", {
                        name: request.ceo_decision_by_name || "—",
                      })
                }
                description={
                  <>
                    <div>{formatDateTimeShort(request.ceo_decision_at)}</div>
                    {request.ceo_decision_note && (
                      <div style={{ marginTop: 8 }}>{request.ceo_decision_note}</div>
                    )}
                  </>
                }
              />
            ) : canApprove || canReject ? (
              <>
                <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                  {t("hiringRequests.ceo.decisionHint")}
                </Text>
                <ApprovalActions
                  size="middle"
                  block
                  onApprove={handleApprove}
                  onReject={() => {
                    setRejectError(null);
                    setRejectOpen(true);
                  }}
                  approveLoading={deciding}
                  approveDisabled={!canApprove}
                  rejectDisabled={!canReject}
                  subjectLabel={request.candidate_full_name}
                />
              </>
            ) : (
              <Alert
                type="info"
                showIcon
                style={{ borderRadius: 12 }}
                message={t("hiringRequests.ceo.noActionAvailable")}
              />
            )}
          </Surface>
        </Col>
      </Row>

      <RejectReasonModal
        open={rejectOpen}
        title={t("hiringRequests.decision.rejectTitle")}
        subject={request.candidate_full_name}
        loading={deciding}
        errorMessage={rejectError}
        onCancel={() => setRejectOpen(false)}
        onSubmit={handleReject}
      />
    </div>
  );
}
