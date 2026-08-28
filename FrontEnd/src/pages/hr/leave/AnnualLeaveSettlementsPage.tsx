import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  notification,
} from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../../components/ui/PageHeader";
import AnnualLeavePaymentStatusTag from "../../../components/leaves/AnnualLeavePaymentStatusTag";
import {
  formatSettlementAmount,
  formatSettlementDays,
} from "../../../components/leaves/annualLeaveSettlement";
import AnnualLeaveSettlementDetails from "../../../components/leaves/AnnualLeaveSettlementDetails";
import { useI18n } from "../../../i18n/useI18n";
import {
  createHRAnnualLeaveSettlement,
  getAnnualLeavePaymentRequests,
  reviewAnnualLeavePaymentRequest,
  type AnnualLeavePaymentRequest,
  type AnnualLeavePaymentReviewDecision,
  type AnnualLeavePaymentResolution,
  type AnnualLeavePaymentStatus,
} from "../../../services/api/annualLeavePaymentsApi";
import { isApiError } from "../../../services/api/apiTypes";
import {
  listEmployees,
  type Employee,
} from "../../../services/api/employeesApi";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { getFirstApiErrorMessage } from "../../../utils/formErrors";

const PAGE_SIZE = 20;

/**
 * HR review queue for Annual Leave settlements.
 *
 * HR only ever decides how the days are resolved — `forward` (pay) or
 * `carry_forward` — and both send the request on to the CEO
 * (`pending_hr` -> `pending_ceo`). Approve and reject belong to the CEO and are
 * deliberately absent here.
 *
 * HR can also open a settlement for an employee who never submitted one; that
 * request is created directly at `pending_ceo` by the backend.
 */
export default function AnnualLeaveSettlementsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<AnnualLeavePaymentRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<
    AnnualLeavePaymentStatus | undefined
  >("pending_hr");
  const [error, setError] = useState<string | null>(null);

  const [reviewing, setReviewing] = useState<AnnualLeavePaymentRequest | null>(
    null,
  );
  const [reviewDecision, setReviewDecision] =
    useState<AnnualLeavePaymentReviewDecision>("forward");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm] = Form.useForm<{
    employee_id: number;
    decision: AnnualLeavePaymentResolution;
  }>();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAnnualLeavePaymentRequests({
        page,
        page_size: PAGE_SIZE,
        status: statusFilter,
        ordering: "-submitted_at",
      });
      if (isApiError(res)) {
        setError(res.message);
        return;
      }
      setRequests(res.data?.items ?? []);
      setTotal(res.data?.count ?? 0);
    } catch (err) {
      setError(getDetailedHttpErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    listEmployees({ page: 1, page_size: 300 })
      .then((res) => {
        if (cancelled || isApiError(res)) return;
        setEmployees(res.data.results || []);
      })
      .catch(() => {
        /* The picker stays empty; the queue itself is unaffected. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link from the HR year-end notification: /hr/annual-leave-payments/:id
  const deepLinked = useMemo(
    () =>
      routeId
        ? requests.find((request) => String(request.id) === routeId)
        : undefined,
    [routeId, requests],
  );

  const openReview = (request: AnnualLeavePaymentRequest) => {
    setReviewing(request);
    setReviewDecision("forward");
    setReviewComment("");
    setReviewError(null);
  };

  const submitReview = async () => {
    if (!reviewing) return;
    setProcessing(true);
    setReviewError(null);
    try {
      const res = await reviewAnnualLeavePaymentRequest(reviewing.id, {
        decision: reviewDecision,
        comment: reviewComment.trim(),
      });
      if (isApiError(res)) {
        setReviewError(getFirstApiErrorMessage(res) || res.message);
        return;
      }
      notification.success({
        message:
          reviewDecision === "carry_forward"
            ? t("annualPayment.carryForwardSuccess")
            : t("annualPayment.forwardSuccess"),
      });
      setReviewing(null);
      await loadData();
    } catch (err) {
      setReviewError(
        getFirstApiErrorMessage(err) || getDetailedHttpErrorMessage(t, err),
      );
    } finally {
      setProcessing(false);
    }
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setProcessing(true);
    setCreateError(null);
    try {
      const res = await createHRAnnualLeaveSettlement({
        employee_id: values.employee_id,
        decision: values.decision,
      });
      if (isApiError(res)) {
        setCreateError(getFirstApiErrorMessage(res) || res.message);
        return;
      }
      notification.success({ message: t("annualPayment.hrSettlementCreated") });
      setCreateOpen(false);
      createForm.resetFields();
      await loadData();
    } catch (err) {
      // A pending Annual Leave request, a duplicate settlement and a missing
      // contract date all come back as 422s — show the backend wording as-is.
      setCreateError(
        getFirstApiErrorMessage(err) || getDetailedHttpErrorMessage(t, err),
      );
    } finally {
      setProcessing(false);
    }
  };

  const columns: ColumnsType<AnnualLeavePaymentRequest> = [
    {
      title: t("annualPayment.employee"),
      key: "employee",
      render: (_, record) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {record.employee_name || `#${record.employee_id ?? "—"}`}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>#{record.id}</div>
        </div>
      ),
    },
    {
      title: t("annualPayment.contractYear"),
      key: "cycle",
      render: (_, record) => (
        <span className="tabular-nums">
          {record.cycle_start} → {record.cycle_end}
        </span>
      ),
    },
    {
      title: t("annualPayment.eligibleDays"),
      key: "eligible_unused_days",
      align: "center",
      render: (_, record) => formatSettlementDays(record.eligible_unused_days),
    },
    {
      title: t("annualPayment.yearEndSalary"),
      key: "salary_at_year_end",
      align: "right",
      render: (_, record) => formatSettlementAmount(record.salary_at_year_end),
    },
    {
      title: t("annualPayment.paymentAmount"),
      key: "payment_amount",
      align: "right",
      render: (_, record) => formatSettlementAmount(record.payment_amount),
    },
    {
      title: t("common.status"),
      key: "status",
      width: 180,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <AnnualLeavePaymentStatusTag status={record.status} />
          {/* Server-owned flag; never inferred from the leave-request API. */}
          {record.has_pending_annual_leave && (
            <Tooltip title={t("annualPayment.hrPendingLeaveWarning")}>
              <Tag
                color="warning"
                icon={<WarningOutlined aria-hidden />}
                style={{ marginInlineEnd: 0 }}
              >
                {t("annualPayment.pendingAnnualLeave")}
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 180,
      render: (_, record) =>
        record.status === "pending_hr" ? (
          <Space size={8} wrap>
            <Button
              type="primary"
              size="small"
              disabled={processing}
              onClick={() => openReview(record)}
              aria-label={`${t("annualPayment.review")}: ${record.employee_name || record.id}`}
            >
              {t("annualPayment.review")}
            </Button>
          </Space>
        ) : (
          <span style={{ color: "#94a3b8" }}>—</span>
        ),
    },
  ];

  return (
    <div style={{ maxWidth: 1500, margin: "0 auto", paddingBottom: 24 }}>
      <PageHeader
        title={t("annualPayment.hrTitle")}
        subtitle={t("annualPayment.hrSubtitle")}
        actions={
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                createForm.resetFields();
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              {t("annualPayment.hrCreateButton")}
            </Button>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={loading}
              onClick={() => void loadData()}
            >
              {t("common.refresh")}
            </Button>
          </Space>
        }
      />

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => void loadData()}>
              {t("common.retry")}
            </Button>
          }
          style={{ marginBottom: 16, borderRadius: 10 }}
        />
      )}

      <Card style={{ borderRadius: 16, marginBottom: 16 }}>
        <Space wrap>
          <span style={{ fontWeight: 500 }}>{t("common.status")}</span>
          <Select<AnnualLeavePaymentStatus | undefined>
            allowClear
            style={{ minWidth: 220 }}
            value={statusFilter}
            placeholder={t("annualPayment.allStatuses")}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={[
              {
                value: "pending_hr",
                label: t("annualPayment.status.pendingHr"),
              },
              {
                value: "pending_ceo",
                label: t("annualPayment.status.pendingCeo"),
              },
              { value: "approved", label: t("annualPayment.status.approved") },
              {
                value: "carried_forward",
                label: t("annualPayment.status.carriedForward"),
              },
              { value: "rejected", label: t("annualPayment.status.rejected") },
            ]}
          />
        </Space>
      </Card>

      {deepLinked && (
        <Card
          style={{ borderRadius: 16, marginBottom: 16 }}
          title={`${t("annualPayment.requestNumber", { id: String(deepLinked.id) })}`}
          extra={
            <Button
              size="small"
              onClick={() => navigate("/hr/annual-leave-payments")}
            >
              {t("common.close")}
            </Button>
          }
        >
          <AnnualLeaveSettlementDetails request={deepLinked} showEmployee />
        </Card>
      )}

      <Card style={{ borderRadius: 16 }}>
        <Table
          columns={columns}
          dataSource={requests}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1080 }}
          locale={{ emptyText: t("annualPayment.hrEmpty") }}
          expandable={{
            expandedRowRender: (record) => (
              <AnnualLeaveSettlementDetails request={record} showEmployee />
            ),
          }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            hideOnSinglePage: true,
            onChange: (nextPage) => setPage(nextPage),
          }}
        />
      </Card>

      <Modal
        open={Boolean(reviewing)}
        title={t("annualPayment.reviewTitle")}
        okText={t("common.submit")}
        cancelText={t("common.cancel")}
        confirmLoading={processing}
        onOk={submitReview}
        onCancel={() => {
          if (processing) return;
          setReviewing(null);
        }}
        destroyOnHidden
        width="min(720px, 96vw)"
      >
        {reviewing && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <AnnualLeaveSettlementDetails request={reviewing} showEmployee />

            {reviewing.has_pending_annual_leave && (
              <Alert
                type="warning"
                showIcon
                message={t("annualPayment.hrPendingLeaveWarning")}
                style={{ borderRadius: 10 }}
              />
            )}

            <Form layout="vertical">
              <Form.Item
                label={t("annualPayment.hrDecision")}
                required
                style={{ marginBottom: 12 }}
              >
                <Select<AnnualLeavePaymentReviewDecision>
                  value={reviewDecision}
                  onChange={setReviewDecision}
                  aria-label={t("annualPayment.hrDecision")}
                  options={[
                    {
                      value: "forward",
                      label: t("annualPayment.forwardToCeo"),
                    },
                    {
                      value: "carry_forward",
                      label: t("annualPayment.carryForward"),
                    },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label={t("annualPayment.hrComment")}
                style={{ marginBottom: 0 }}
              >
                <Input.TextArea
                  rows={3}
                  maxLength={500}
                  showCount
                  value={reviewComment}
                  disabled={processing}
                  aria-label={t("annualPayment.hrComment")}
                  onChange={(event) => setReviewComment(event.target.value)}
                />
              </Form.Item>
            </Form>

            <Typography.Text type="secondary">
              {t("annualPayment.reviewHint")}
            </Typography.Text>

            {reviewError && (
              <Alert
                type="error"
                showIcon
                message={reviewError}
                style={{ borderRadius: 10 }}
              />
            )}
          </Space>
        )}
      </Modal>

      <Modal
        open={createOpen}
        title={t("annualPayment.hrCreateTitle")}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        confirmLoading={processing}
        onOk={submitCreate}
        onCancel={() => {
          if (processing) return;
          setCreateOpen(false);
        }}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message={t("annualPayment.hrCreateNotice")}
          style={{ marginBottom: 16, borderRadius: 10 }}
        />
        {createError && (
          <Alert
            type="error"
            showIcon
            message={createError}
            style={{ marginBottom: 16, borderRadius: 10 }}
          />
        )}
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ decision: "carry_forward" }}
        >
          <Form.Item
            label={t("common.employee")}
            name="employee_id"
            rules={[{ required: true, message: t("common.required") }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={employees.map((employee) => ({
                value: employee.id,
                label: `${employee.full_name_en || employee.full_name || employee.employee_id} (${employee.employee_id})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("annualPayment.hrDecision")}
            name="decision"
            rules={[{ required: true, message: t("common.required") }]}
          >
            <Select
              options={[
                {
                  value: "carry_forward",
                  label: t("annualPayment.carryForward"),
                },
                { value: "pay", label: t("annualPayment.pay") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
