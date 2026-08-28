import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Typography,
  notification,
} from "antd";
import { DollarOutlined } from "@ant-design/icons";

import AnnualLeavePaymentStatusTag from "../../../components/leaves/AnnualLeavePaymentStatusTag";
import {
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
  type AnnualLeaveEligibility,
  type AnnualLeavePaymentRequest,
} from "../../../services/api/annualLeavePaymentsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { getFirstApiErrorMessage } from "../../../utils/formErrors";

/**
 * Employee-facing Annual Leave settlement panel.
 *
 * Eligibility, the payable day count, the year-end salary and the estimated
 * amount all come from `GET /annual-leave-payments/eligibility/`. Nothing on
 * this panel is derived in the browser: the action is offered only when the
 * backend says `can_request`, and the backend's own `reason` is shown when it
 * says otherwise.
 *
 * Year-end reminders are an HR-only notification and are deliberately not
 * surfaced here.
 */
export default function AnnualLeavePaymentCard({
  onSubmitted,
  refreshToken = 0,
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
}) {
  const { t } = useI18n();
  const [form] = Form.useForm<{ employee_note?: string }>();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<AnnualLeavePaymentRequest[]>([]);
  const [eligibility, setEligibility] = useState<AnnualLeaveEligibility | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // The list is scoped by the backend to the caller's own records for
      // anyone who is not HR, SystemAdmin or CEO.
      const [listRes, eligibilityRes] = await Promise.all([
        getAnnualLeavePaymentRequests({
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

  const latest = requests[0];
  // A settlement already in flight blocks a new one for the same cycle; the
  // eligibility payload does not cover that case, so it stays a separate guard.
  const hasActiveRequest = isActiveAnnualPayment(latest);
  const canRequest = eligibility?.can_request === true;
  const showRequestAction = !hasActiveRequest && canRequest;

  const openModal = () => {
    form.resetFields();
    setSubmitError(null);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!canRequest) return;
    const values = await form.validateFields();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createEmployeeAnnualLeavePaymentRequest({
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
      style={{ borderRadius: 16, marginTop: 16 }}
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
                    eligibility.reason || t("annualPayment.notAvailable")
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
            message={eligibility?.reason || t("annualPayment.notAvailable")}
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
