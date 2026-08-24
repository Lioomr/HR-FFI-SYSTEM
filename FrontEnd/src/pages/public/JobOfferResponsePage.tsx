import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Modal, Space, Spin, Typography } from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  InfoCircleFilled,
} from "@ant-design/icons";

import SARIcon from "../../components/icons/SARIcon";
import JobOfferStatusTag from "../../components/jobOffers/JobOfferStatusTag";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpStatus } from "../../services/api/httpErrors";
import {
  getPublicJobOffer,
  respondToJobOffer,
  type JobOfferDecisionResult,
  type JobOfferInvitationResult,
  type PublicJobOfferSummary,
} from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";
import { formatNumber } from "../../utils/currency";

const { Text, Title } = Typography;

/**
 * Screen states for the candidate page. `terminal` is the 409 case (the offer is
 * already answered or otherwise closed) and `invalid` is the 422 case (bad or
 * expired token) — the two are separated because they need different copy.
 */
type PageState = "loading" | "ready" | "accepted" | "rejected" | "terminal" | "invalid";

function OutcomePanel({
  icon,
  tone,
  title,
  body,
  extra,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  body: string;
  extra?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: "center", padding: "24px 8px" }}>
      <div style={{ fontSize: 56, color: tone, lineHeight: 1, marginBottom: 16 }}>{icon}</div>
      <Title level={3} style={{ margin: 0, fontWeight: 800, color: "#0f172a" }}>
        {title}
      </Title>
      <Text style={{ display: "block", marginTop: 10, color: "#475569", fontSize: 15 }}>{body}</Text>
      {extra && <div style={{ marginTop: 16 }}>{extra}</div>}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "12px 0",
        borderBottom: "1px solid #f1f5f9",
      }}
    >
      <Text style={{ color: "#64748b", fontSize: 14 }}>{label}</Text>
      <Text strong style={{ color: "#0f172a", fontSize: 15, textAlign: "end" }}>
        {value}
      </Text>
    </div>
  );
}

export default function JobOfferResponsePage() {
  const { t, direction } = useI18n();
  const [params] = useSearchParams();
  const token = (params.get("token") || "").trim();

  const [state, setState] = useState<PageState>("loading");
  const [offer, setOffer] = useState<PublicJobOfferSummary | null>(null);
  const [invitation, setInvitation] = useState<JobOfferInvitationResult | null>(null);
  const [outcome, setOutcome] = useState<JobOfferDecisionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    const run = async () => {
      setState("loading");
      try {
        const response = await getPublicJobOffer(token);
        if (isApiError(response)) {
          setState("invalid");
          return;
        }
        setOffer(response.data);
        setState("ready");
      } catch (err: unknown) {
        // 409 = the offer is closed (already answered, cancelled, ...).
        // 422 = the token itself is unusable.
        setState(getHttpStatus(err) === 409 ? "terminal" : "invalid");
      }
    };
    void run();
  }, [token]);

  const submitDecision = useCallback(
    async (decision: "accepted" | "rejected", decisionReason?: string) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const response = await respondToJobOffer({
          token,
          decision,
          ...(decisionReason ? { reason: decisionReason } : {}),
        });
        if (isApiError(response)) {
          setSubmitError(response.message || t("publicJobOffer.submitFailed"));
          return;
        }
        setInvitation(response.data.invitation || null);
        setOutcome(response.data);
        setRejectOpen(false);
        setState(decision === "accepted" ? "accepted" : "rejected");
      } catch (err: unknown) {
        const status = getHttpStatus(err);
        if (status === 409) {
          setRejectOpen(false);
          setState("terminal");
          return;
        }
        if (status === 422) {
          setRejectOpen(false);
          setState("invalid");
          return;
        }
        setSubmitError((err as Error)?.message || t("publicJobOffer.submitFailed"));
      } finally {
        setSubmitting(false);
      }
    },
    [token, t],
  );

  const [confirmModal, confirmContext] = Modal.useModal();

  const handleAccept = useCallback(() => {
    confirmModal.confirm({
      title: t("publicJobOffer.acceptConfirmTitle"),
      content: t("publicJobOffer.acceptConfirmBody"),
      okText: t("publicJobOffer.acceptConfirmOk"),
      cancelText: t("publicJobOffer.cancel"),
      onOk: () => submitDecision("accepted"),
    });
  }, [confirmModal, submitDecision, t]);

  const handleRejectSubmit = useCallback(() => {
    if (!reason.trim()) {
      setReasonError(t("publicJobOffer.reasonRequired"));
      return;
    }
    setReasonError(null);
    void submitDecision("rejected", reason.trim());
  }, [reason, submitDecision, t]);

  /**
   * What the candidate is told after accepting. Only outcomes they can act on
   * or reasonably expect — never the provider that carried the message, and
   * never an internal identifier.
   */
  const acceptanceNotes = useMemo(() => {
    const notes: React.ReactNode[] = [];

    if (invitation) {
      const sent = invitation.created && invitation.delivery?.sent;
      notes.push(
        <Alert
          key="invitation"
          type={sent ? "success" : "info"}
          showIcon
          style={{ borderRadius: 12, textAlign: "start" }}
          message={sent ? t("publicJobOffer.invitationSent") : t("publicJobOffer.invitationPending")}
        />,
      );
    }

    if (outcome?.employee_profile_id) {
      notes.push(
        <Alert
          key="onboarding"
          type="success"
          showIcon
          style={{ borderRadius: 12, textAlign: "start" }}
          message={t("publicJobOffer.onboardingReady")}
        />,
      );
    }

    // An unmapped device is HR's remaining task, not a problem the candidate
    // caused or has to solve, so it is stated neutrally.
    if (outcome && outcome.biotime && outcome.biotime.is_mapped === false) {
      notes.push(
        <Alert
          key="biotime"
          type="info"
          showIcon
          style={{ borderRadius: 12, textAlign: "start" }}
          message={t("publicJobOffer.attendanceSetupPending")}
        />,
      );
    }

    if (notes.length === 0) return null;
    return (
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {notes}
      </Space>
    );
  }, [invitation, outcome, t]);

  return (
    <div
      dir={direction}
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0f172a 0%, #1e293b 45%, #f8fafc 45%, #f8fafc 100%)",
        padding: "48px 16px",
      }}
    >
      {confirmContext}

      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              color: "white",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.01em",
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(135deg, #f97316, #fb923c)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
              }}
            >
              FFI
            </span>
            {t("publicJobOffer.brand")}
          </div>
        </div>

        <div
          style={{
            background: "white",
            borderRadius: 20,
            padding: "32px 28px",
            boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
          }}
        >
          {state === "loading" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <Spin size="large" />
              <div style={{ marginTop: 16, color: "#64748b" }}>{t("publicJobOffer.loading")}</div>
            </div>
          )}

          {state === "invalid" && (
            <OutcomePanel
              icon={<ExclamationCircleFilled aria-hidden />}
              tone="#f97316"
              title={t("publicJobOffer.invalidTitle")}
              body={token ? t("publicJobOffer.invalidBody") : t("publicJobOffer.missingToken")}
            />
          )}

          {state === "terminal" && (
            <OutcomePanel
              icon={<InfoCircleFilled aria-hidden />}
              tone="#3b82f6"
              title={t("publicJobOffer.alreadyRespondedTitle")}
              body={t("publicJobOffer.alreadyRespondedBody")}
            />
          )}

          {state === "accepted" && (
            <OutcomePanel
              icon={<CheckCircleFilled aria-hidden />}
              tone="#059669"
              title={t("publicJobOffer.acceptedTitle")}
              body={t("publicJobOffer.acceptedBody")}
              extra={acceptanceNotes}
            />
          )}

          {state === "rejected" && (
            <OutcomePanel
              icon={<CloseCircleFilled aria-hidden />}
              tone="#64748b"
              title={t("publicJobOffer.rejectedTitle")}
              body={t("publicJobOffer.rejectedBody")}
            />
          )}

          {state === "ready" && offer && (
            <>
              <Title level={3} style={{ margin: 0, fontWeight: 800, color: "#0f172a" }}>
                {t("publicJobOffer.title")}
              </Title>
              <Text style={{ display: "block", marginTop: 6, color: "#475569", fontSize: 15 }}>
                {t("publicJobOffer.greeting", { name: offer.candidate_full_name })}
              </Text>
              <Text style={{ display: "block", marginTop: 2, color: "#64748b" }}>
                {t("publicJobOffer.intro")}
              </Text>

              <div style={{ marginTop: 24 }}>
                <DetailRow label={t("publicJobOffer.position")} value={offer.position_title || "—"} />
                <DetailRow label={t("publicJobOffer.department")} value={offer.department || "—"} />
                <DetailRow label={t("publicJobOffer.location")} value={offer.location || "—"} />
                <DetailRow
                  label={t("publicJobOffer.package")}
                  value={
                    <Space size={5}>
                      <span>{formatNumber(offer.total_salary_package)}</span>
                      <SARIcon size={14} color="#0f172a" />
                    </Space>
                  }
                />
                <DetailRow label={t("publicJobOffer.offerDate")} value={offer.offer_date || "—"} />
                <DetailRow label={t("publicJobOffer.expiryDate")} value={offer.expiry_date || "—"} />
                <DetailRow
                  label={t("publicJobOffer.status")}
                  value={
                    <JobOfferStatusTag status={offer.status} fallbackLabel={offer.status_label} />
                  }
                />
              </div>

              {submitError && (
                <Alert
                  type="error"
                  showIcon
                  message={submitError}
                  style={{ borderRadius: 12, marginTop: 20 }}
                />
              )}

              {offer.can_respond && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 28,
                    flexWrap: "wrap",
                  }}
                >
                  <Button
                    type="primary"
                    size="large"
                    loading={submitting}
                    onClick={handleAccept}
                    style={{ flex: "1 1 200px", borderRadius: 12, fontWeight: 700, minHeight: 48 }}
                  >
                    {t("publicJobOffer.accept")}
                  </Button>
                  <Button
                    danger
                    size="large"
                    disabled={submitting}
                    onClick={() => {
                      setReasonError(null);
                      setRejectOpen(true);
                    }}
                    style={{ flex: "1 1 200px", borderRadius: 12, fontWeight: 700, minHeight: 48 }}
                  >
                    {t("publicJobOffer.reject")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={rejectOpen}
        title={t("publicJobOffer.rejectTitle")}
        okText={t("publicJobOffer.rejectSubmit")}
        cancelText={t("publicJobOffer.cancel")}
        okButtonProps={{ danger: true, loading: submitting }}
        onOk={handleRejectSubmit}
        onCancel={() => setRejectOpen(false)}
      >
        <Text style={{ display: "block", marginBottom: 12, color: "#475569" }}>
          {t("publicJobOffer.rejectPrompt")}
        </Text>
        <Input.TextArea
          rows={4}
          value={reason}
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("publicJobOffer.reasonPlaceholder")}
          aria-label={t("publicJobOffer.reasonLabel")}
          status={reasonError ? "error" : undefined}
        />
        {reasonError && (
          <div style={{ color: "#dc2626", marginTop: 8, fontSize: 13 }}>{reasonError}</div>
        )}
      </Modal>
    </div>
  );
}
