import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Col,
  Modal,
  Row,
  Space,
  Timeline,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  MailOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
  WhatsAppOutlined,
} from "@ant-design/icons";

import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import SARIcon from "../../../components/icons/SARIcon";
import JobOfferStatusTag from "../../../components/jobOffers/JobOfferStatusTag";
import JobOfferApprovalStatusTag from "../../../components/jobOffers/JobOfferApprovalStatusTag";
import JobOfferCeoDecision from "../../../components/jobOffers/JobOfferCeoDecision";
import JobOfferWorkflowHistory from "../../../components/jobOffers/JobOfferWorkflowHistory";
import JobOfferDocumentSection, {
  JobOfferDocumentGrid,
} from "../../../components/jobOffers/JobOfferDocumentSection";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  isConflict,
  isForbidden,
  isNotFound,
} from "../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../services/api/downloads";
import { previewBlob } from "../../../utils/download";
import {
  downloadEmployeeDocument,
  getEmployeeDocuments,
  type EmployeeDocument,
} from "../../../services/api/employeesApi";
import {
  cancelJobOffer,
  downloadJobOfferCv,
  downloadJobOfferPdf,
  getJobOffer,
  sendJobOffer,
  submitJobOffer,
  type JobOffer,
  type JobOfferChannelDelivery,
} from "../../../services/api/jobOffersApi";
import { useI18n } from "../../../i18n/useI18n";
import { formatNumber } from "../../../utils/currency";
import { formatDateTimeShort } from "../../../utils/dateTime";
import { canCancel, canEdit, canSend, canSubmit } from "./jobOfferRules";

const { Text } = Typography;

/**
 * Backend warnings arrive as English sentences. Map the known ones onto
 * translated copy and fall back to the raw sentence for anything new, so a
 * future warning still reaches the HR user instead of disappearing.
 */
const WARNING_KEYS: { match: RegExp; key: string }[] = [
  {
    match: /whatsapp delivery failed/i,
    key: "jobOffers.delivery.warning.whatsappFailed",
  },
  {
    match: /pdf attachment upload failed/i,
    key: "jobOffers.delivery.warning.attachmentFailed",
  },
  {
    match: /email delivery failed/i,
    key: "jobOffers.delivery.warning.emailFailed",
  },
  {
    match: /job offer delivery failed/i,
    key: "jobOffers.delivery.warning.generic",
  },
];

/**
 * The backend files the acknowledgment as an OTHER document under this exact
 * name. There is no acknowledgment API, so the employee's archive listing is
 * the only place its existence can be read.
 */
const ACKNOWLEDGMENT_NAME = "Starting Work Acknowledgment";

function findAcknowledgment(
  documents: EmployeeDocument[],
): EmployeeDocument | null {
  return (
    documents.find(
      (document) =>
        document.document_type === "OTHER" &&
        (document.display_name?.trim() === ACKNOWLEDGMENT_NAME ||
          document.custom_name?.trim() === ACKNOWLEDGMENT_NAME),
    ) || null
  );
}

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

function Money({ value }: { value: string | number | null | undefined }) {
  return (
    <Space size={4} style={{ whiteSpace: "nowrap" }}>
      <Text strong>{formatNumber(value)}</Text>
      <SARIcon size={13} color="#475569" />
    </Space>
  );
}

/** One delivery channel row: outcome only — never the provider behind it. */
function DeliveryChannel({
  icon,
  label,
  delivery,
}: {
  icon: React.ReactNode;
  label: string;
  delivery?: JobOfferChannelDelivery;
}) {
  const { t } = useI18n();
  const used = Boolean(delivery);
  const sent = Boolean(delivery?.sent);
  // A skipped leg is not a failure: the channel was never attempted because the
  // recipient had no number or address on file.
  const skipped = Boolean(delivery?.skipped) && !sent;
  const tone = !used || skipped ? "#94a3b8" : sent ? "#047857" : "#b91c1c";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        background: "#f8fafc",
      }}
    >
      <span style={{ fontSize: 18, color: tone, lineHeight: 1.4 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "#0f172a" }}>{label}</div>
        <div style={{ color: tone, fontWeight: 600, fontSize: 13 }}>
          {!used
            ? t("jobOffers.delivery.notUsed")
            : sent
              ? t("jobOffers.delivery.sent")
              : skipped
                ? t("jobOffers.delivery.skipped")
                : t("jobOffers.delivery.failed")}
        </div>
        {delivery?.attachment && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {delivery.attachment === "attached"
              ? t("jobOffers.delivery.attachmentAttached")
              : t("jobOffers.delivery.attachmentLinkOnly")}
          </Text>
        )}
        {delivery?.attempted_at && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("jobOffers.delivery.attemptedAt", {
                time: formatDateTimeShort(delivery.attempted_at),
              })}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

export default function JobOfferDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();

  const [offer, setOffer] = useState<JobOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [acting, setActing] = useState<
    | "send"
    | "cancel"
    | "pdf"
    | "pdfPreview"
    | "submit"
    | "cv"
    | "cvPreview"
    | null
  >(null);
  const [acknowledgment, setAcknowledgment] = useState<EmployeeDocument | null>(
    null,
  );
  const [downloadingAcknowledgment, setDownloadingAcknowledgment] =
    useState(false);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await getJobOffer(id!);
        if (isApiError(response)) {
          setError(response.message || t("jobOffers.detail.loadFailed"));
          return;
        }
        setOffer(response.data);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError(
          isNotFound(err)
            ? t("jobOffers.detail.notFound")
            : (err as Error)?.message || t("jobOffers.detail.loadFailed"),
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

  // The acknowledgment is only ever visible through the employee's document
  // archive, so without a linked profile there is nothing to look up.
  const employeeProfileId = offer?.employee_profile_id ?? null;
  useEffect(() => {
    if (!employeeProfileId) {
      setAcknowledgment(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const response = await getEmployeeDocuments(employeeProfileId);
        if (cancelled || isApiError(response)) return;
        setAcknowledgment(findAcknowledgment(response.data || []));
      } catch {
        // The offer itself still renders; the panel just falls back to pending.
        if (!cancelled) setAcknowledgment(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [employeeProfileId]);

  const handleAcknowledgmentDownload = useCallback(async () => {
    if (!employeeProfileId || !acknowledgment) return;
    setDownloadingAcknowledgment(true);
    try {
      const blob = await downloadEmployeeDocument(
        employeeProfileId,
        acknowledgment.id,
      );
      triggerBlobDownload(
        blob,
        acknowledgment.original_filename || "starting-work-acknowledgment.pdf",
      );
    } catch (err: unknown) {
      messageApi.error(
        (err as Error)?.message ||
          t("jobOffers.onboarding.acknowledgmentDownloadFailed"),
      );
    } finally {
      setDownloadingAcknowledgment(false);
    }
  }, [employeeProfileId, acknowledgment, messageApi, t]);

  /**
   * Surfaces what the API actually said, and treats a 409 as a stale view.
   *
   * The approval endpoints answer 409 when the offer moved on under the user —
   * already decided, already sent, no longer editable. Reloading shows the real
   * state instead of leaving a screen whose buttons no longer match the record.
   */
  const reportActionError = useCallback(
    (err: unknown, fallbackKey: string) => {
      const detail = getHttpErrorMessage(err) || t(fallbackKey);
      if (isConflict(err)) {
        messageApi.warning(detail);
        void load({ isRefresh: true });
        return;
      }
      messageApi.error(detail);
    },
    [messageApi, load, t],
  );

  const handleSubmitToCeo = useCallback(() => {
    modal.confirm({
      title: t("jobOffers.submit.confirmTitle"),
      content: t("jobOffers.submit.confirmBody"),
      okText: t("jobOffers.form.submitToCeo"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        setActing("submit");
        try {
          const response = await submitJobOffer(id!);
          if (isApiError(response)) {
            messageApi.error(response.message || t("jobOffers.submit.failed"));
            return;
          }
          setOffer(response.data.job_offer);
          messageApi.success(t("jobOffers.submit.success"));
        } catch (err: unknown) {
          reportActionError(err, "jobOffers.submit.failed");
        } finally {
          setActing(null);
        }
      },
    });
  }, [modal, id, messageApi, t, reportActionError]);

  const handleCvDownload = useCallback(async () => {
    setActing("cv");
    try {
      const blob = await downloadJobOfferCv(id!);
      triggerBlobDownload(blob, `job_offer_${id}_cv`);
      messageApi.success(t("jobOffers.cv.downloaded"));
    } catch (err: unknown) {
      reportActionError(err, "jobOffers.cv.failed");
    } finally {
      setActing(null);
    }
  }, [id, messageApi, t, reportActionError]);

  /**
   * Opens the CV in a new tab. A Word document cannot render there, so it falls
   * back to a download rather than leaving the user on a blank viewer. The tab
   * is opened synchronously so the browser does not treat it as a popup once
   * the bytes have been fetched.
   */
  const handleCvPreview = useCallback(async () => {
    const tab = window.open("about:blank", "_blank");
    setActing("cvPreview");
    try {
      const blob = await downloadJobOfferCv(id!);
      if (!(await previewBlob(blob, tab))) {
        triggerBlobDownload(blob, `job_offer_${id}_cv`);
        messageApi.info(t("jobOffers.cv.previewUnavailable"));
      }
    } catch (err: unknown) {
      tab?.close();
      reportActionError(err, "jobOffers.cv.failed");
    } finally {
      setActing(null);
    }
  }, [id, messageApi, t, reportActionError]);

  const handleSend = useCallback(() => {
    modal.confirm({
      title: t("jobOffers.send.confirmTitle"),
      content: t("jobOffers.send.confirmBody"),
      okText: t("jobOffers.send.confirmOk"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        setActing("send");
        try {
          const response = await sendJobOffer(id!);
          if (isApiError(response)) {
            messageApi.error(response.message || t("jobOffers.send.failed"));
            return;
          }
          // The offer is out even when a channel complains; show the offer and
          // its warnings rather than treating a partial delivery as a failure.
          setOffer(response.data.offer);
          const warnings = response.data.delivery?.warnings || [];
          if (warnings.length > 0)
            messageApi.warning(t("jobOffers.send.successWithWarnings"));
          else messageApi.success(t("jobOffers.send.success"));
        } catch (err: unknown) {
          reportActionError(err, "jobOffers.send.failed");
        } finally {
          setActing(null);
        }
      },
    });
  }, [modal, id, messageApi, t, reportActionError]);

  const handleCancel = useCallback(() => {
    modal.confirm({
      title: t("jobOffers.cancel.confirmTitle"),
      content: t("jobOffers.cancel.confirmBody"),
      okText: t("jobOffers.cancel.confirmOk"),
      okButtonProps: { danger: true },
      cancelText: t("jobOffers.cancel.keep"),
      onOk: async () => {
        setActing("cancel");
        try {
          const response = await cancelJobOffer(id!);
          if (isApiError(response)) {
            messageApi.error(response.message || t("jobOffers.cancel.failed"));
            return;
          }
          setOffer(response.data);
          messageApi.success(t("jobOffers.cancel.success"));
        } catch (err: unknown) {
          reportActionError(err, "jobOffers.cancel.failed");
        } finally {
          setActing(null);
        }
      },
    });
  }, [modal, id, messageApi, t, reportActionError]);

  const handlePdf = useCallback(async () => {
    setActing("pdf");
    try {
      const blob = await downloadJobOfferPdf(id!);
      triggerBlobDownload(blob, `job_offer_${id}.pdf`);
      messageApi.success(t("jobOffers.pdf.success"));
    } catch (err: unknown) {
      messageApi.error((err as Error)?.message || t("jobOffers.pdf.failed"));
    } finally {
      setActing(null);
    }
  }, [id, messageApi, t]);

  /**
   * Opens the offer PDF in a new tab for a quick look instead of saving it.
   * The tab is opened synchronously so it is not blocked as a popup, and
   * `previewBlob` normalises the MIME type so it renders inline even when the
   * backend labels the stream as a generic attachment.
   */
  const handlePdfPreview = useCallback(async () => {
    const tab = window.open("about:blank", "_blank");
    setActing("pdfPreview");
    try {
      const blob = await downloadJobOfferPdf(id!);
      if (!(await previewBlob(blob, tab))) {
        messageApi.error(t("jobOffers.pdf.previewFailed"));
      }
    } catch (err: unknown) {
      tab?.close();
      messageApi.error(
        (err as Error)?.message || t("jobOffers.pdf.previewFailed"),
      );
    } finally {
      setActing(null);
    }
  }, [id, messageApi, t]);

  const translateWarning = useCallback(
    (warning: string) => {
      const hit = WARNING_KEYS.find((entry) => entry.match.test(warning));
      return hit ? t(hit.key, warning) : warning;
    },
    [t],
  );

  const timelineItems = useMemo(() => {
    if (!offer) return [];
    const items: {
      color: string;
      dot?: React.ReactNode;
      children: React.ReactNode;
    }[] = [
      {
        color: "gray",
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.created")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(offer.created_at)}
            </Text>
          </>
        ),
      },
    ];
    if (offer.sent_at) {
      items.push({
        color: "blue",
        dot: <SendOutlined aria-hidden />,
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.sent")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(offer.sent_at)}
            </Text>
          </>
        ),
      });
    } else if (offer.status === "draft") {
      items.push({
        color: "gray",
        dot: <ClockCircleOutlined aria-hidden />,
        children: (
          <div style={{ fontWeight: 600 }}>
            {t("jobOffers.timeline.awaitingSend")}
          </div>
        ),
      });
    }
    if (offer.accepted_at) {
      items.push({
        color: "green",
        dot: <CheckCircleOutlined aria-hidden />,
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.accepted")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(offer.accepted_at)}
            </Text>
          </>
        ),
      });
    }
    if (offer.rejected_at) {
      items.push({
        color: "red",
        dot: <CloseCircleOutlined aria-hidden />,
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.rejected")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(offer.rejected_at)}
            </Text>
            {offer.rejection_reason && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("jobOffers.detail.rejectionReason")}:{" "}
                  {offer.rejection_reason}
                </Text>
              </div>
            )}
          </>
        ),
      });
    }
    if (offer.cancelled_at) {
      items.push({
        color: "gray",
        dot: <StopOutlined aria-hidden />,
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.cancelled")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTimeShort(offer.cancelled_at)}
            </Text>
          </>
        ),
      });
    }
    if (offer.status === "sent") {
      items.push({
        color: "orange",
        dot: <ClockCircleOutlined aria-hidden />,
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.awaitingResponse")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("jobOffers.timeline.expires")}: {offer.expiry_date}
            </Text>
          </>
        ),
      });
    }
    if (offer.status === "expired") {
      items.push({
        color: "orange",
        children: (
          <>
            <div style={{ fontWeight: 600 }}>
              {t("jobOffers.timeline.expired")}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {offer.expiry_date}
            </Text>
          </>
        ),
      });
    }
    return items;
  }, [offer, t]);

  if (forbidden) return <Unauthorized403Page />;

  if (loading) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <LoadingState title={t("loading.generic")} lines={8} />
      </div>
    );
  }

  if (error || !offer) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <ErrorState
          title={t("common.error")}
          description={error || t("jobOffers.detail.notFound")}
          onRetry={() => load()}
        />
      </div>
    );
  }

  const editable = canEdit(offer);
  const sendable = canSend(offer);
  const cancellable = canCancel(offer);
  const submittable = canSubmit(offer);
  const delivery = offer.delivery_metadata;
  const warnings = delivery?.warnings || [];
  // Older cached responses predate the field, and unmapped is the safe reading.
  const biotimeMapped = Boolean(offer.biotime?.is_mapped);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 32 }}>
      {messageContext}
      {modalContext}

      <PageHeader
        title={offer.candidate_full_name}
        subtitle={offer.position_title}
        secondarySubtitle={t("jobOffers.detail.reference", {
          reference: offer.reference_number,
        })}
        breadcrumb={t("jobOffers.title")}
        tags={
          <Space size={8} wrap>
            <JobOfferStatusTag
              status={offer.status}
              fallbackLabel={offer.status_label}
              size="large"
            />
            {/* Two separate tracks: the CEO approval gate and the delivery
                lifecycle. Showing both stops "Approved" from being read as
                "Accepted by the candidate". */}
            <JobOfferApprovalStatusTag
              status={offer.approval_status}
              fallbackLabel={offer.approval_status_label}
              size="large"
            />
          </Space>
        }
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => navigate("/hr/job-offers")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("jobOffers.action.backToList")}
            </Button>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={refreshing}
              onClick={() => load({ isRefresh: true })}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("jobOffers.action.refresh")}
            </Button>
            {editable && (
              <Button
                icon={<EditOutlined aria-hidden />}
                onClick={() => navigate(`/hr/job-offers/${offer.id}/edit`)}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("jobOffers.action.edit")}
              </Button>
            )}
            {offer.has_cv && (
              <>
                <Button
                  icon={<EyeOutlined aria-hidden />}
                  loading={acting === "cvPreview"}
                  onClick={handleCvPreview}
                  style={{ borderRadius: 10, minHeight: 40 }}
                >
                  {t("jobOffers.action.previewCv")}
                </Button>
                <Button
                  icon={<DownloadOutlined aria-hidden />}
                  loading={acting === "cv"}
                  onClick={handleCvDownload}
                  style={{ borderRadius: 10, minHeight: 40 }}
                >
                  {t("jobOffers.action.downloadCv")}
                </Button>
              </>
            )}
            <Button
              icon={<EyeOutlined aria-hidden />}
              loading={acting === "pdfPreview"}
              onClick={handlePdfPreview}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("jobOffers.action.previewPdf")}
            </Button>
            <Button
              icon={<FilePdfOutlined aria-hidden />}
              loading={acting === "pdf"}
              onClick={handlePdf}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("jobOffers.action.downloadPdf")}
            </Button>
            {cancellable && (
              <Button
                danger
                icon={<StopOutlined aria-hidden />}
                loading={acting === "cancel"}
                onClick={handleCancel}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("jobOffers.action.cancelOffer")}
              </Button>
            )}
            {submittable && (
              <Button
                type="primary"
                icon={<AuditOutlined aria-hidden />}
                loading={acting === "submit"}
                onClick={handleSubmitToCeo}
                style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
              >
                {offer.approval_status === "changes_requested"
                  ? t("jobOffers.action.resubmitToCeo")
                  : t("jobOffers.form.submitToCeo")}
              </Button>
            )}
            {/* Delivery is gated on the CEO decision, so the button appears
                only while the backend says the offer may go out. */}
            {sendable && (
              <Button
                type="primary"
                icon={<SendOutlined aria-hidden />}
                loading={acting === "send"}
                onClick={handleSend}
                style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
              >
                {t("jobOffers.action.sendOffer")}
              </Button>
            )}
          </div>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <JobOfferDocumentSection
            title={t("jobOffers.detail.section.applicant")}
            style={{ marginBottom: 16 }}
          >
            <JobOfferDocumentGrid
              fields={[
                {
                  label: t("jobOffers.field.candidateFullName"),
                  value: offer.candidate_full_name || "—",
                  emphasis: true,
                },
                {
                  label: t("jobOffers.field.nationality"),
                  value: offer.nationality || "—",
                },
                {
                  label: t("jobOffers.field.idNumber"),
                  value: offer.id_passport_iqama_number || "—",
                },
                {
                  label: t("jobOffers.field.candidateEmail"),
                  value: offer.candidate_email || "—",
                },
                {
                  label: t("jobOffers.field.candidatePhone"),
                  value: offer.candidate_phone_number || "—",
                },
              ]}
            />
          </JobOfferDocumentSection>

          <JobOfferDocumentSection
            title={t("jobOffers.detail.section.job")}
            style={{ marginBottom: 16 }}
          >
            <JobOfferDocumentGrid
              fields={[
                {
                  label: t("jobOffers.field.positionTitle"),
                  value: offer.position_title || "—",
                  emphasis: true,
                },
                {
                  label: t("jobOffers.field.classification"),
                  value: offer.classification || "—",
                },
                {
                  label: t("jobOffers.field.department"),
                  value: offer.department || "—",
                },
                {
                  label: t("jobOffers.field.location"),
                  value: offer.location || "—",
                },
                {
                  label: t("jobOffers.field.offerDate"),
                  value: offer.offer_date || "—",
                },
                {
                  label: t("jobOffers.field.expiryDate"),
                  value: offer.expiry_date || "—",
                },
                {
                  label: t("jobOffers.field.hrSignerName"),
                  value: offer.hr_signer_name || "—",
                },
                {
                  label: t("jobOffers.field.hrSignerTitle"),
                  value: offer.hr_signer_title || "—",
                },
              ]}
            />
          </JobOfferDocumentSection>

          <JobOfferDocumentSection
            title={t("jobOffers.detail.section.compensation")}
            style={{ marginBottom: 16 }}
          >
            <JobOfferDocumentGrid
              fields={[
                {
                  label: t("jobOffers.field.basicSalary"),
                  value: <Money value={offer.basic_salary} />,
                  emphasis: true,
                },
                {
                  label: t("jobOffers.field.housingAllowance"),
                  value: <Money value={offer.housing_allowance} />,
                },
                {
                  label: t("jobOffers.field.transportationAllowance"),
                  value: <Money value={offer.transportation_allowance} />,
                },
                {
                  label: t("jobOffers.field.otherAllowance"),
                  value: <Money value={offer.other_allowance} />,
                },
              ]}
            />
            <div
              style={{
                marginTop: 12,
                padding: "16px 20px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #fff7ed, #fffbf5)",
                border: "1px solid #fed7aa",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 700, color: "#0f172a" }}>
                {t("jobOffers.field.totalPackage")}
              </span>
              <Space size={6}>
                <span
                  style={{ fontSize: 22, fontWeight: 800, color: "#c2410c" }}
                >
                  {formatNumber(offer.total_salary_package)}
                </span>
                <SARIcon size={18} color="#c2410c" />
              </Space>
            </div>
          </JobOfferDocumentSection>

          <JobOfferDocumentSection
            title={t("jobOffers.detail.section.benefits")}
          >
            <JobOfferDocumentGrid
              fields={[
                {
                  label: t("jobOffers.field.vacation"),
                  value: offer.vacation || "—",
                },
                {
                  label: t("jobOffers.field.tickets"),
                  value: offer.tickets || "—",
                },
                {
                  label: t("jobOffers.field.contractStatus"),
                  value: offer.contract_status || "—",
                },
                {
                  label: t("jobOffers.field.contractType"),
                  value: offer.contract_type || "—",
                },
                {
                  label: t("jobOffers.field.contractDuration"),
                  value: offer.contract_duration || "—",
                },
                {
                  label: t("jobOffers.field.medicalInsurance"),
                  value: offer.medical_insurance || "—",
                },
              ]}
            />
          </JobOfferDocumentSection>
        </Col>

        <Col xs={24} xl={8}>
          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>
              {t("jobOffers.detail.section.ceoReview")}
            </SectionTitle>
            <JobOfferCeoDecision offer={offer} />
            {/* Nothing reaches the candidate before the CEO approves, so say
                why the send button is absent rather than leaving a gap. */}
            {offer.status === "draft" &&
              offer.approval_status !== "approved" && (
                <Alert
                  type="info"
                  showIcon
                  style={{ borderRadius: 12, marginTop: 12 }}
                  message={t("jobOffers.approval.sendBlocked")}
                />
              )}
          </Surface>

          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>
              {t("jobOffers.detail.section.workflow")}
            </SectionTitle>
            <JobOfferWorkflowHistory history={offer.workflow?.history} />
          </Surface>

          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>
              {t("jobOffers.detail.section.timeline")}
            </SectionTitle>
            <Timeline items={timelineItems} />
          </Surface>

          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>
              {t("jobOffers.detail.section.delivery")}
            </SectionTitle>
            {!offer.sent_at ? (
              <Text type="secondary">{t("jobOffers.delivery.notSentYet")}</Text>
            ) : (
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 700 }}
                >
                  {t("jobOffers.delivery.candidateGroup")}
                </Text>
                {/* `channels` is the pre-split shape older offers still carry,
                    so fall back to it when `candidate` is absent. */}
                <DeliveryChannel
                  icon={<WhatsAppOutlined aria-hidden />}
                  label={t("jobOffers.delivery.candidateText")}
                  delivery={
                    delivery?.candidate?.text ?? delivery?.channels?.whatsapp
                  }
                />
                {delivery?.candidate?.whatsapp_pdf && (
                  <DeliveryChannel
                    icon={<WhatsAppOutlined aria-hidden />}
                    label={t("jobOffers.delivery.candidateWhatsappPdf")}
                    delivery={delivery.candidate.whatsapp_pdf}
                  />
                )}
                <DeliveryChannel
                  icon={<MailOutlined aria-hidden />}
                  label={t("jobOffers.delivery.candidateEmailPdf")}
                  delivery={
                    delivery?.candidate?.email_pdf ?? delivery?.channels?.email
                  }
                />

                {(delivery?.ceo?.recipients?.length ?? 0) > 0 && (
                  <>
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, fontWeight: 700 }}
                    >
                      {t("jobOffers.delivery.ceoGroup")}
                    </Text>
                    {delivery!.ceo!.recipients.map((recipient) => (
                      <div key={recipient.user_id}>
                        <Text style={{ fontSize: 13, fontWeight: 600 }}>
                          {recipient.display_name}
                        </Text>
                        <Space
                          direction="vertical"
                          size={10}
                          style={{ width: "100%", marginTop: 6 }}
                        >
                          <DeliveryChannel
                            icon={<WhatsAppOutlined aria-hidden />}
                            label={t("jobOffers.delivery.ceoWhatsappPdf")}
                            delivery={recipient.whatsapp_pdf}
                          />
                          <DeliveryChannel
                            icon={<MailOutlined aria-hidden />}
                            label={t("jobOffers.delivery.ceoEmailPdf")}
                            delivery={recipient.email_pdf}
                          />
                        </Space>
                      </div>
                    ))}
                  </>
                )}
                {warnings.length > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ borderRadius: 12 }}
                    message={t("jobOffers.delivery.warningsTitle")}
                    description={
                      <div>
                        <ul
                          style={{
                            margin: "4px 0 8px",
                            paddingInlineStart: 18,
                          }}
                        >
                          {warnings.map((warning) => (
                            <li key={warning}>{translateWarning(warning)}</li>
                          ))}
                        </ul>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t("jobOffers.delivery.warningsHint")}
                        </Text>
                      </div>
                    }
                  />
                )}
              </Space>
            )}
          </Surface>

          <Surface>
            <SectionTitle>
              {t("jobOffers.detail.section.onboarding")}
            </SectionTitle>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {offer.status === "accepted" ? (
                  <CheckCircleOutlined
                    aria-hidden
                    style={{ color: "#047857" }}
                  />
                ) : (
                  <ClockCircleOutlined
                    aria-hidden
                    style={{ color: "#94a3b8" }}
                  />
                )}
                <Text strong>
                  {offer.status === "accepted"
                    ? t("jobOffers.onboarding.offerAccepted")
                    : t("jobOffers.onboarding.awaitingResponse")}
                </Text>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {offer.account_invite_id ? (
                  <CheckCircleOutlined
                    aria-hidden
                    style={{ color: "#047857" }}
                  />
                ) : (
                  <ClockCircleOutlined
                    aria-hidden
                    style={{ color: "#94a3b8" }}
                  />
                )}
                <Text>
                  {offer.account_invite_id
                    ? t("jobOffers.onboarding.invitationSent")
                    : t("jobOffers.onboarding.invitationPending")}
                </Text>
              </div>

              {acknowledgment ? (
                <>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <CheckCircleOutlined
                      aria-hidden
                      style={{ color: "#047857" }}
                    />
                    <Text strong>
                      {t("jobOffers.onboarding.acknowledgmentGenerated")}
                    </Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {acknowledgment.display_name || ACKNOWLEDGMENT_NAME}
                  </Text>
                  <Space size={8} wrap>
                    <Button
                      size="small"
                      icon={<DownloadOutlined aria-hidden />}
                      loading={downloadingAcknowledgment}
                      onClick={handleAcknowledgmentDownload}
                      style={{ borderRadius: 8 }}
                    >
                      {t("jobOffers.onboarding.downloadAcknowledgment")}
                    </Button>
                    <Button
                      size="small"
                      type="link"
                      style={{ padding: 0 }}
                      onClick={() =>
                        navigate(`/hr/employees/${employeeProfileId}`)
                      }
                    >
                      {t("jobOffers.onboarding.openDocumentArchive")}
                    </Button>
                  </Space>
                </>
              ) : (
                <>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <ClockCircleOutlined
                      aria-hidden
                      style={{ color: "#94a3b8" }}
                    />
                    <Text>
                      {t("jobOffers.onboarding.acknowledgmentPending")}
                    </Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("jobOffers.onboarding.acknowledgmentHint")}
                  </Text>
                </>
              )}

              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {offer.employee_profile_id ? (
                    <CheckCircleOutlined
                      aria-hidden
                      style={{ color: "#047857" }}
                    />
                  ) : (
                    <ClockCircleOutlined
                      aria-hidden
                      style={{ color: "#94a3b8" }}
                    />
                  )}
                  <Text strong>
                    {offer.employee_profile_id
                      ? t("jobOffers.onboarding.prehireProfileCreated")
                      : t("jobOffers.onboarding.noLinkedProfile")}
                  </Text>
                </div>
                {offer.employee_profile_id ? (
                  <>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t("jobOffers.onboarding.profileId", {
                        id: String(offer.employee_profile_id),
                      })}
                    </Text>
                    <div>
                      <Button
                        type="link"
                        style={{ padding: 0 }}
                        onClick={() =>
                          navigate(`/hr/employees/${offer.employee_profile_id}`)
                        }
                      >
                        {t("jobOffers.onboarding.openEmployeeProfile")}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>

              {/* Attendance-device mapping. Missing is a follow-up for HR, not
                  a failed acceptance, so it never reads as an error. */}
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {biotimeMapped ? (
                    <CheckCircleOutlined
                      aria-hidden
                      style={{ color: "#047857" }}
                    />
                  ) : (
                    <ClockCircleOutlined
                      aria-hidden
                      style={{ color: "#94a3b8" }}
                    />
                  )}
                  <Text strong>
                    {biotimeMapped
                      ? t("jobOffers.biotime.connected")
                      : t("jobOffers.biotime.notConnected")}
                  </Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {biotimeMapped
                    ? t("jobOffers.biotime.employeeCode", {
                        code: offer.biotime?.biotime_emp_code || "—",
                      })
                    : t("jobOffers.biotime.notConnectedHint")}
                </Text>
              </div>

              {offer.status === "rejected" && offer.rejection_reason && (
                <Alert
                  type="error"
                  showIcon
                  style={{ borderRadius: 12 }}
                  message={t("jobOffers.detail.rejectionReason")}
                  description={offer.rejection_reason}
                />
              )}
            </Space>
          </Surface>
        </Col>
      </Row>
    </div>
  );
}
