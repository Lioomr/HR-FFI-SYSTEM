import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Typography,
  notification,
} from "antd";
import { DollarOutlined } from "@ant-design/icons";

import AnnualLeavePaymentStatusTag from "../../../components/leaves/AnnualLeavePaymentStatusTag";
import {
  EMPLOYEE_PREFERENCE_LABEL_KEYS,
  formatSettlementAmount,
  formatSettlementDays,
  isActiveAnnualPayment,
} from "../../../components/leaves/annualLeaveSettlement";
import AnnualLeaveSettlementDetails from "../../../components/leaves/AnnualLeaveSettlementDetails";
import { useI18n } from "../../../i18n/useI18n";
import {
  createEmployeeAnnualLeavePaymentRequest,
  getAnnualLeaveEligibility,
  getAnnualLeavePaymentRequests,
  ANNUAL_LEAVE_EMPLOYEE_PREFERENCES,
  toDecimalNumber,
  type AnnualLeaveEmployeePreference,
  type AnnualLeaveEligibility,
  type AnnualLeavePaymentRequest,
} from "../../../services/api/annualLeavePaymentsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { getFirstApiErrorMessage } from "../../../utils/formErrors";

const PREFERENCE_HINT_KEYS: Record<AnnualLeaveEmployeePreference, string> = {
  pay: "annualPayment.preference.payHint",
  carry_forward: "annualPayment.preference.carryForwardHint",
  take_as_leave: "annualPayment.preference.takeAsLeaveHint",
};

/**
 * Employee-facing Annual Leave settlement panel.
 *
 * Eligibility, the payable day count, the year-end salary and the estimated
 * amount all come from `GET /annual-leave-payments/eligibility/`. Nothing on
 * this panel is derived in the browser: the action is offered only when the
 * backend says `can_request`, and the backend's own `reason` is shown when it
 * says otherwise.
 *
 * HR's year-end reminders are not surfaced here. The employee's own
 * "settlement window is open" notification (and the dashboard prompt) link to
 * `/employee/leave/balance?focus=settlement`; the page turns that into
 * `focusToken`, which scrolls this card into view and highlights it briefly.
 */
export default function AnnualLeavePaymentCard({
  onSubmitted,
  refreshToken = 0,
  focusToken,
}: {
  /**
   * Called after a successful submission so the page can re-read the balance.
   * Eligibility and the request list are refreshed by this component itself.
   */
  onSubmitted?: () => void;
  /**
   * Bumped by the page whenever leave state may have moved (a manual refresh,
   * a cancelled or decided request). Any change re-reads eligibility, because
   * a pending Annual Leave request is one of the things that blocks it.
   */
  refreshToken?: number;
  /**
   * Set when the page was opened to focus the settlement (for example from the
   * window-open notification). Each new value scrolls the card into view once,
   * after its data has loaded, and highlights it briefly.
   */
  focusToken?: string;
}) {
  const { t } = useI18n();

  const translateEligibilityReason = (reason?: string | null) => {
    if (!reason) return "";
    const reasons: Record<string, string> = {
      "Employee profile is required.": t(
        "annualPayment.reason.profileRequired",
      ),
      "Employee does not belong to the active company.": t(
        "annualPayment.reason.companyMismatch",
      ),
      "Employee contract date is required for Annual Leave payment.": t(
        "annualPayment.reason.contractDateRequired",
      ),
      "Annual Leave payment is available after completing 6 months of service.":
        t("annualPayment.reason.minimumService"),
      "The Annual Leave payment window opens only during the final 5 days of the contract year.":
        t("annualPayment.reason.windowClosed"),
      "Annual Leave payment cannot be requested while Annual Leave requests are pending.":
        t("annualPayment.reason.pendingLeave"),
      "An annual leave settlement already exists for this contract year.": t(
        "annualPayment.activeRequestNotice",
      ),
      "There are no eligible whole Annual Leave days available for payment.": t(
        "annualPayment.reason.noEligibleDays",
      ),
    };
    return Object.entries(reasons)
      .sort(([left], [right]) => right.length - left.length)
      .reduce(
        (translated, [english, arabic]) =>
          translated.replaceAll(english, arabic),
        reason,
      );
  };
  const [form] = Form.useForm<{
    employee_preference: AnnualLeaveEmployeePreference;
    employee_note?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<AnnualLeavePaymentRequest[]>([]);
  const [eligibility, setEligibility] = useState<AnnualLeaveEligibility | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const handledFocusToken = useRef<string | undefined>(undefined);
  const [highlighted, setHighlighted] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // `mine` keeps HR, SystemAdmin and CEO callers to their own records
      // too; everyone else is already scoped to them by the backend.
      const [listRes, eligibilityRes] = await Promise.all([
        getAnnualLeavePaymentRequests({
          mine: true,
          page: 1,
          page_size: 5,
          ordering: "-submitted_at",
        }),
        getAnnualLeaveEligibility(),
      ]);
      if (isApiError(listRes)) {
        setLoadError(listRes.message);
      } else {
        setRequests(listRes.data?.items ?? []);
      }
      if (isApiError(eligibilityRes)) {
        setLoadError((current) => current ?? eligibilityRes.message);
        setEligibility(null);
      } else {
        setEligibility(eligibilityRes.data);
      }
    } catch (err) {
      setLoadError(getDetailedHttpErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshToken]);

  useEffect(() => {
    if (!focusToken || loading || handledFocusToken.current === focusToken) {
      return;
    }
    handledFocusToken.current = focusToken;
    // jsdom and some older browsers lack scrollIntoView; the highlight still shows.
    cardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    setHighlighted(true);
    const timer = window.setTimeout(() => setHighlighted(false), 2500);
    return () => window.clearTimeout(timer);
  }, [focusToken, loading]);

  const latest = requests[0];
  // A settlement already in flight blocks a new one for the same cycle; the
  // eligibility payload does not cover that case, so it stays a separate guard.
  // Only a settlement for the cycle being offered blocks a new one; a carry-forward
  // from an earlier cycle must not hide the request action for the current cycle.
  const hasActiveRequest =
    isActiveAnnualPayment(latest) &&
    (!eligibility?.cycle_start ||
      latest?.cycle_start === eligibility.cycle_start);
  const canRequest = eligibility?.can_request === true;
  const showRequestAction = !hasActiveRequest && canRequest;

  const openModal = () => {
    form.resetFields();
    setSubmitError(null);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!canRequest) return;
    let values;
    try {
      values = await form.validateFields();
    } catch {
      // The form shows the missing preference inline.
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createEmployeeAnnualLeavePaymentRequest({
        employee_preference: values.employee_preference,
        employee_note: values.employee_note || "",
      });
      if (isApiError(res)) {
        setSubmitError(getFirstApiErrorMessage(res) || res.message);
        return;
      }
      notification.success({ message: t("annualPayment.submitSuccess") });
      setModalOpen(false);
      // Re-reads both the settlement list and eligibility, so a request that
      // has just consumed the cycle stops being offered.
      await loadData();
      onSubmitted?.();
    } catch (err) {
      // A duplicate settlement or a race against the window closing comes back
      // as a 422; show the backend wording as-is.
      setSubmitError(
        getFirstApiErrorMessage(err) || getDetailedHttpErrorMessage(t, err),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const eligibilityItems = eligibility
    ? [
        {
          key: "cycle",
          label: t("annualPayment.contractYear"),
          children:
            eligibility.cycle_start && eligibility.cycle_end
              ? `${eligibility.cycle_start} → ${eligibility.cycle_end}`
              : "—",
        },
        {
          key: "eligible",
          label: t("annualPayment.eligibleWholeDays"),
          children: `${formatSettlementDays(eligibility.eligible_unused_days)} ${t("leave.days")}`,
        },
        // Leave-only days: part of the balance to take as leave, never paid.
        ...(toDecimalNumber(eligibility.locked_unused_days) > 0
          ? [
              {
                key: "locked",
                label: t("annualPayment.lockedDays"),
                children: `${formatSettlementDays(eligibility.locked_unused_days)} ${t("leave.days")}`,
              },
            ]
          : []),
        {
          key: "fractional",
          label: t("annualPayment.fractionalDays"),
          children: `${formatSettlementDays(eligibility.fractional_days)} ${t("leave.days")}`,
        },
        {
          key: "salary",
          label: t("annualPayment.yearEndSalary"),
          children: formatSettlementAmount(eligibility.salary_at_year_end),
        },
        {
          key: "estimate",
          label: t("annualPayment.estimatedPaymentAmount"),
          children: formatSettlementAmount(
            eligibility.estimated_payment_amount,
          ),
        },
      ]
    : [];

  return (
    <Card
      ref={cardRef}
      id="annual-leave-settlement"
      data-highlighted={highlighted ? "true" : undefined}
      style={{
        borderRadius: 16,
        marginTop: 16,
        scrollMarginTop: 80,
        transition: "box-shadow 0.4s ease",
        boxShadow: highlighted
          ? "0 0 0 3px rgba(22, 119, 255, 0.45)"
          : undefined,
      }}
      title={t("annualPayment.title")}
      extra={
        showRequestAction && (
          <Button
            type="primary"
            icon={<DollarOutlined />}
            onClick={openModal}
            disabled={loading}
          >
            {t("annualPayment.requestButton")}
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("annualPayment.description")}
      </Typography.Paragraph>

      {loadError && (
        <Alert
          type="error"
          showIcon
          message={loadError}
          action={
            <Button size="small" onClick={() => void loadData()}>
              {t("common.retry")}
            </Button>
          }
          style={{ marginBottom: 16, borderRadius: 10 }}
        />
      )}

      {loading ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {eligibility && (
            <>
              <Descriptions
                size="small"
                bordered
                column={{ xs: 1, sm: 1, md: 2 }}
                items={eligibilityItems}
              />
              {!canRequest && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ borderRadius: 10 }}
                  // The backend owns this wording; blank `reason` should not
                  // leave the employee without an explanation.
                  message={
                    translateEligibilityReason(eligibility.reason) ||
                    t("annualPayment.notAvailable")
                  }
                />
              )}
              {eligibility.has_pending_annual_leave && (
                <Alert
                  type="info"
                  showIcon
                  style={{ borderRadius: 10 }}
                  message={t("annualPayment.employeePendingLeaveNotice")}
                />
              )}
            </>
          )}

          {hasActiveRequest && (
            <Alert
              type="info"
              showIcon
              message={t("annualPayment.activeRequestNotice")}
              style={{ borderRadius: 10 }}
            />
          )}

          {requests.length === 0 ? (
            <Typography.Text type="secondary">
              {t("annualPayment.employeeEmpty")}
            </Typography.Text>
          ) : (
            requests.map((request) => (
              <div key={request.id}>
                <Space size={8} style={{ marginBottom: 8 }} wrap>
                  <Typography.Text strong>#{request.id}</Typography.Text>
                  <AnnualLeavePaymentStatusTag status={request.status} />
                </Space>
                <AnnualLeaveSettlementDetails request={request} />
              </div>
            ))
          )}
        </Space>
      )}

      <Modal
        open={modalOpen}
        title={t("annualPayment.requestTitle")}
        okText={t("common.submit")}
        okButtonProps={{ disabled: !canRequest }}
        cancelText={t("common.cancel")}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => {
          if (submitting) return;
          setModalOpen(false);
        }}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message={t("annualPayment.windowNotice")}
          style={{ marginBottom: 16, borderRadius: 10 }}
        />

        {eligibility && (
          <Descriptions
            size="small"
            bordered
            column={1}
            style={{ marginBottom: 16 }}
            items={eligibilityItems}
          />
        )}

        {!canRequest && (
          <Alert
            type="warning"
            showIcon
            message={
              translateEligibilityReason(eligibility?.reason) ||
              t("annualPayment.notAvailable")
            }
            style={{ marginBottom: 16, borderRadius: 10 }}
          />
        )}

        {submitError && (
          <Alert
            type="error"
            showIcon
            message={submitError}
            style={{ marginBottom: 16, borderRadius: 10 }}
          />
        )}

        <Form form={form} layout="vertical">
          {/* A preference only: HR decides and the CEO approves. Locked
              (leave-only) days are never part of it. */}
          <Form.Item
            label={t("annualPayment.preference")}
            name="employee_preference"
            extra={t("annualPayment.preference.help")}
            rules={[
              {
                required: true,
                message: t("annualPayment.preference.required"),
              },
            ]}
          >
            <Radio.Group
              disabled={!canRequest}
              aria-label={t("annualPayment.preference")}
            >
              <Space direction="vertical" size={8}>
                {ANNUAL_LEAVE_EMPLOYEE_PREFERENCES.map((preference) => (
                  <Radio key={preference} value={preference}>
                    <Typography.Text strong>
                      {t(EMPLOYEE_PREFERENCE_LABEL_KEYS[preference])}
                    </Typography.Text>
                    <br />
                    <Typography.Text type="secondary">
                      {t(PREFERENCE_HINT_KEYS[preference])}
                    </Typography.Text>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label={t("annualPayment.employeeNote")}
            name="employee_note"
          >
            <Input.TextArea
              rows={3}
              maxLength={500}
              showCount
              disabled={!canRequest}
              aria-label={t("annualPayment.employeeNote")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
