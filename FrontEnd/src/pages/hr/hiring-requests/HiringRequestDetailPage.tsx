import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Col, Descriptions, Modal, Row, Space, Timeline, Typography, message } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DownloadOutlined,
  EditOutlined,
  FileAddOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";

import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import SARIcon from "../../../components/icons/SARIcon";
import HiringRequestStatusTag from "../../../components/hiringRequests/HiringRequestStatusTag";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden, isNotFound } from "../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../services/api/downloads";
import {
  cancelHiringRequest,
  downloadHiringRequestCv,
  getHiringRequest,
  submitHiringRequest,
  type HiringRequest,
} from "../../../services/api/hiringRequestsApi";
import { useI18n } from "../../../i18n/useI18n";
import { formatNumber } from "../../../utils/currency";
import { formatDateOnly, formatDateTimeShort } from "../../../utils/dateTime";

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <span
        style={{
          width: 4,
          height: 20,
          borderRadius: 4,
          background: "linear-gradient(180deg, #f97316, #fb923c)",
        }}
      />
      <Typography.Title level={5} style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>
        {children}
      </Typography.Title>
    </div>
  );
}

export default function HiringRequestDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();

  const [request, setRequest] = useState<HiringRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [acting, setActing] = useState<"submit" | "cancel" | "cv" | null>(null);

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

  const handleSubmit = useCallback(() => {
    modal.confirm({
      title: t("hiringRequests.submit.confirmTitle"),
      content: t("hiringRequests.submit.confirmBody"),
      okText: t("hiringRequests.form.submitToCeo"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        setActing("submit");
        try {
          const response = await submitHiringRequest(id!);
          if (isApiError(response)) {
            messageApi.error(response.message || t("hiringRequests.submit.failed"));
            return;
          }
          setRequest(response.data.hiring_request);
          messageApi.success(t("hiringRequests.submit.success"));
        } catch (err: unknown) {
          messageApi.error((err as Error)?.message || t("hiringRequests.submit.failed"));
        } finally {
          setActing(null);
        }
      },
    });
  }, [modal, id, messageApi, t]);

  const handleCancel = useCallback(() => {
    modal.confirm({
      title: t("hiringRequests.cancel.confirmTitle"),
      content: t("hiringRequests.cancel.confirmBody"),
      okText: t("hiringRequests.action.cancelRequest"),
      okButtonProps: { danger: true },
      cancelText: t("hiringRequests.cancel.keep"),
      onOk: async () => {
        setActing("cancel");
        try {
          const response = await cancelHiringRequest(id!);
          if (isApiError(response)) {
            messageApi.error(response.message || t("hiringRequests.cancel.failed"));
            return;
          }
          setRequest(response.data);
          messageApi.success(t("hiringRequests.cancel.success"));
        } catch (err: unknown) {
          messageApi.error((err as Error)?.message || t("hiringRequests.cancel.failed"));
        } finally {
          setActing(null);
        }
      },
    });
  }, [modal, id, messageApi, t]);

  const handleCvDownload = useCallback(async () => {
    setActing("cv");
    try {
      const blob = await downloadHiringRequestCv(id!);
      triggerBlobDownload(blob, `hiring_request_${id}_cv`);
      messageApi.success(t("hiringRequests.cv.downloaded"));
    } catch (err: unknown) {
      messageApi.error((err as Error)?.message || t("hiringRequests.cv.failed"));
    } finally {
      setActing(null);
    }
  }, [id, messageApi, t]);

  const timelineItems = useMemo(() => {
    if (!request) return [];
    const items: { color: string; children: React.ReactNode }[] = [
      {
        color: "gray",
        children: (
          <>
            <div style={{ fontWeight: 600 }}>{t("hiringRequests.timeline.created")}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(request.created_at)}
              {request.requested_by_name ? ` · ${request.requested_by_name}` : ""}
            </Text>
          </>
        ),
      },
    ];
    if (request.submitted_at) {
      items.push({
        color: "orange",
        children: (
          <>
            <div style={{ fontWeight: 600 }}>{t("hiringRequests.timeline.submitted")}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(request.submitted_at)}
            </Text>
          </>
        ),
      });
    }
    if (request.ceo_decision_at) {
      items.push({
        color: request.status === "rejected" ? "red" : "green",
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {request.status === "rejected"
                ? t("hiringRequests.timeline.rejected")
                : t("hiringRequests.timeline.approved")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(request.ceo_decision_at)}
              {request.ceo_decision_by_name ? ` · ${request.ceo_decision_by_name}` : ""}
            </Text>
          </>
        ),
      });
    }
    if (request.status === "converted") {
      items.push({
        color: "blue",
        children: <div style={{ fontWeight: 600 }}>{t("hiringRequests.timeline.converted")}</div>,
      });
    }
    if (request.status === "cancelled") {
      items.push({
        color: "gray",
        children: <div style={{ fontWeight: 600 }}>{t("hiringRequests.timeline.cancelled")}</div>,
      });
    }
    return items;
  }, [request, t]);

  if (forbidden) return <Unauthorized403Page />;

  if (loading) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <LoadingState title={t("loading.generic")} lines={8} />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <ErrorState
          title={t("common.error")}
          description={error || t("hiringRequests.detail.notFound")}
          onRetry={() => load()}
        />
      </div>
    );
  }

  const workflow = request.workflow;
  const canCreateOffer = request.status === "approved" && request.job_offer_id === null;
  const canOpenOffer = request.status === "converted" && request.job_offer_id !== null;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 32 }}>
      {messageContext}
      {modalContext}

      <PageHeader
        title={request.candidate_full_name}
        subtitle={request.company_name}
        secondarySubtitle={t("hiringRequests.detail.reference", { reference: request.reference_number })}
        breadcrumb={t("hiringRequests.title")}
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
              onClick={() => navigate("/hr/hiring-requests")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("hiringRequests.action.backToList")}
            </Button>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={refreshing}
              onClick={() => load({ isRefresh: true })}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("hiringRequests.action.refresh")}
            </Button>
            {workflow?.can_edit && (
              <Button
                icon={<EditOutlined aria-hidden />}
                onClick={() => navigate(`/hr/hiring-requests/${request.id}/edit`)}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("hiringRequests.action.edit")}
              </Button>
            )}
            {workflow?.can_cancel && (
              <Button
                danger
                icon={<StopOutlined aria-hidden />}
                loading={acting === "cancel"}
                onClick={handleCancel}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("hiringRequests.action.cancelRequest")}
              </Button>
            )}
            {workflow?.can_submit && (
              <Button
                type="primary"
                icon={<SendOutlined aria-hidden />}
                loading={acting === "submit"}
                onClick={handleSubmit}
                style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
              >
                {t("hiringRequests.form.submitToCeo")}
              </Button>
            )}
            {canCreateOffer && (
              <Button
                type="primary"
                icon={<FileAddOutlined aria-hidden />}
                onClick={() => navigate(`/hr/job-offers/new?hiring_request_id=${request.id}`)}
                style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
              >
                {t("hiringRequests.action.createJobOffer")}
              </Button>
            )}
            {canOpenOffer && (
              <Button
                icon={<ArrowRightOutlined aria-hidden />}
                onClick={() => navigate(`/hr/job-offers/${request.job_offer_id}`)}
                style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
              >
                {t("hiringRequests.action.openJobOffer")}
              </Button>
            )}
          </div>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>{t("hiringRequests.detail.section.candidate")}</SectionTitle>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small" colon={false}>
              <Descriptions.Item label={t("hiringRequests.field.candidateFullName")}>
                {request.candidate_full_name || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.joiningCompany")}>
                {request.company_name || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.candidateEmail")}>
                {request.candidate_email || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.candidatePhone")}>
                {request.candidate_phone_number || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.nationality")}>
                {request.nationality || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("hiringRequests.field.dateOfBirth")}>
                {formatDateOnly(request.date_of_birth, "—")}
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
            </Descriptions>

            <div style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
              {request.has_cv ? (
                <Button
                  icon={<DownloadOutlined aria-hidden />}
                  loading={acting === "cv"}
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

          {request.ceo_decision_at && (
            <Surface>
              <SectionTitle>{t("hiringRequests.detail.section.ceoDecision")}</SectionTitle>
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
                      <div style={{ marginTop: 8 }}>
                        <Text strong>{t("hiringRequests.detail.decisionNote")}: </Text>
                        {request.ceo_decision_note}
                      </div>
                    )}
                  </>
                }
              />
            </Surface>
          )}
        </Col>

        <Col xs={24} xl={8}>
          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>{t("hiringRequests.detail.section.status")}</SectionTitle>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                  {t("hiringRequests.detail.currentStage")}
                </Text>
                <Text strong>
                  {workflow?.current_approver_role ||
                    workflow?.current_stage ||
                    t("hiringRequests.detail.noStage")}
                </Text>
              </div>
              {workflow?.current_actor?.full_name && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                    {t("hiringRequests.detail.currentActor")}
                  </Text>
                  <Text>{workflow.current_actor.full_name}</Text>
                </div>
              )}
              {canCreateOffer && (
                <Alert
                  type="success"
                  showIcon
                  style={{ borderRadius: 12 }}
                  message={t("hiringRequests.detail.readyForOffer")}
                />
              )}
            </Space>
          </Surface>

          <Surface>
            <SectionTitle>{t("hiringRequests.detail.section.timeline")}</SectionTitle>
            <Timeline items={timelineItems} />
          </Surface>
        </Col>
      </Row>
    </div>
  );
}
