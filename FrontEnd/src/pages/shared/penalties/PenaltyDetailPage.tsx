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
  Spin,
  notification,
} from "antd";
import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import {
  acknowledgePenalty,
  disputePenalty,
  getPenalty,
  markPenaltyDisruption,
  resolvePenalty,
  reviewPenaltyPayroll,
  type PenaltyRecord,
} from "../../../services/api/penaltiesApi";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { useI18n } from "../../../i18n/useI18n";
import PenaltyStatusTag from "./PenaltyStatusTag";

type Decision =
  | "disrupted"
  | "not_disrupted"
  | "excused"
  | "uphold"
  | "waive"
  | "approve"
  | "hold"
  | "dispute"
  | "acknowledge";

export default function PenaltyDetailPage({
  role,
}: {
  role: "hr" | "employee";
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const [record, setRecord] = useState<PenaltyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getPenalty(id);
      if (isApiError(result)) {
        setLoadError(result.message);
        return;
      }
      setRecord(result.data);
    } catch (error) {
      setLoadError(getDetailedHttpErrorMessage(t, error));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitDecision() {
    if (!record || !decision) return;
    setSaving(true);
    setActionError(null);
    try {
      const result =
        decision === "acknowledge"
          ? await acknowledgePenalty(record.id)
          : decision === "dispute"
            ? await disputePenalty(record.id, note.trim())
            : decision === "disrupted" ||
                decision === "not_disrupted" ||
                decision === "excused"
              ? await markPenaltyDisruption(record.id, {
                  disruption: decision,
                  note: note.trim(),
                })
              : decision === "uphold" || decision === "waive"
                ? await resolvePenalty(record.id, {
                    decision,
                    note: note.trim(),
                  })
                : await reviewPenaltyPayroll(record.id, {
                    decision,
                    note: note.trim(),
                  });
      if (isApiError(result)) {
        setActionError(result.message);
        return;
      }
      setRecord(result.data);
      setDecision(null);
      setNote("");
      notification.success({ message: t("penalties.actionSaved") });
    } catch (error) {
      setActionError(getDetailedHttpErrorMessage(t, error));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spin fullscreen />;
  if (loadError || !record)
    return (
      <Alert
        type="error"
        title={loadError ?? t("penalties.notFound")}
        action={<Button onClick={load}>{t("penalties.retry")}</Button>}
      />
    );

  const isAttendance = record.source === "automatic";
  const isMonetary =
    Number(record.total_deduction_amount ?? record.amount ?? 0) > 0;
  const employeeCanRespond =
    role === "employee" &&
    !isAttendance &&
    (record.status === "issued" || record.status === "applied") &&
    record.employee_response?.decision !== "disputed";
  const hrCanMark =
    role === "hr" && isAttendance && record.status === "pending_hr_mark";
  const hrCanResolve = role === "hr" && record.status === "disputed";
  const hrCanReviewPayroll =
    role === "hr" &&
    record.status === "issued" &&
    isMonetary &&
    (record.payroll_status === "pending_review" ||
      record.payroll_status === "approved" ||
      record.payroll_status === "held" ||
      record.payroll_status === "claimed");
  const requiredNote =
    decision === "dispute" ||
    decision === "disrupted" ||
    decision === "not_disrupted" ||
    decision === "excused" ||
    decision === "uphold" ||
    decision === "waive" ||
    decision === "approve" ||
    decision === "hold";

  return (
    <div>
      <PageHeader
        title={`${t("penalties.detailTitle")} #${record.id}`}
        subtitle={
          language === "ar" ? record.employee_name_ar : record.employee_name_en
        }
        actions={
          <Button onClick={() => navigate(`/${role}/penalties`)}>
            {t("common.back")}
          </Button>
        }
      />
      {role === "employee" && record.payroll_status === "applied" && (
        <Alert
          type="info"
          showIcon
          title={t("penalties.finalizedPayrollNotice")}
          style={{ marginBottom: 16 }}
        />
      )}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label={t("common.status")}>
            <PenaltyStatusTag status={record.status} />
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.employee")}>
            {language === "ar"
              ? record.employee_name_ar
              : record.employee_name_en}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.catalogItem")}>
            {record.catalog_code}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.category")}>
            {t(
              `penalties.category.${record.category}`,
              undefined,
              record.category,
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.occurredOn")}>
            {record.occurred_on}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.occurrence")}>
            {record.occurrence_number}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.action")}>
            {t(`penalties.action.${record.action}`, undefined, record.action)}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.amount")}>
            {record.amount ?? "—"}
          </Descriptions.Item>
          {record.extra_wage_amount != null && (
            <Descriptions.Item label={t("penalties.extraWageAmount")}>
              {record.extra_wage_amount}
            </Descriptions.Item>
          )}
          {record.total_deduction_amount != null && (
            <Descriptions.Item label={t("penalties.totalDeductionAmount")}>
              {record.total_deduction_amount}
            </Descriptions.Item>
          )}
          <Descriptions.Item label={t("penalties.payrollStatus")} span={2}>
            {record.payroll_status
              ? t(
                  `penalties.payroll.${record.payroll_status}`,
                  undefined,
                  record.payroll_status,
                )
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.description")} span={2}>
            {(language === "ar"
              ? record.description_ar
              : record.description_en) ||
              record.description ||
              "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("penalties.note")} span={2}>
            {record.note || "—"}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      {(record.employee_response ||
        record.dispute_reason ||
        record.resolution) && (
        <Card
          title={t("penalties.responseAndResolution")}
          style={{ marginBottom: 16 }}
        >
          <Descriptions column={1}>
            {record.employee_response && (
              <Descriptions.Item label={t("penalties.employeeResponse")}>
                {t(
                  `penalties.response.${record.employee_response.decision}`,
                  undefined,
                  record.employee_response.decision,
                )}{" "}
                · {record.employee_response.submitted_at}
                {record.employee_response.reason
                  ? ` · ${record.employee_response.reason}`
                  : ""}
              </Descriptions.Item>
            )}
            {record.dispute_reason && (
              <Descriptions.Item label={t("penalties.disputeReason")}>
                {record.dispute_reason}
              </Descriptions.Item>
            )}
            {record.resolution && (
              <Descriptions.Item label={t("penalties.resolution")}>
                {t(
                  `penalties.decision.${record.resolution.decision}`,
                  undefined,
                  record.resolution.decision,
                )}
                {record.resolution.note ? ` · ${record.resolution.note}` : ""}
                {record.resolution.resolved_at
                  ? ` · ${record.resolution.resolved_at}`
                  : ""}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}
      {(employeeCanRespond ||
        hrCanMark ||
        hrCanResolve ||
        hrCanReviewPayroll) && (
        <Card title={t("penalties.availableActions")}>
          <Space wrap>
            {employeeCanRespond && (
              <>
                {!record.employee_response && (
                  <Button onClick={() => setDecision("acknowledge")}>
                    {t("penalties.acknowledge")}
                  </Button>
                )}
                <Button onClick={() => setDecision("dispute")}>
                  {t("penalties.dispute")}
                </Button>
              </>
            )}
            {hrCanMark && (
              <>
                <Button type="primary" onClick={() => setDecision("disrupted")}>
                  {t("penalties.disrupted")}
                </Button>
                <Button onClick={() => setDecision("not_disrupted")}>
                  {t("penalties.notDisrupted")}
                </Button>
                <Button onClick={() => setDecision("excused")}>
                  {t("penalties.excused")}
                </Button>
              </>
            )}
            {hrCanResolve && (
              <>
                <Button type="primary" onClick={() => setDecision("uphold")}>
                  {t("penalties.uphold")}
                </Button>
                <Button onClick={() => setDecision("waive")}>
                  {t("penalties.waive")}
                </Button>
              </>
            )}
            {hrCanReviewPayroll && (
              <>
                <Button type="primary" onClick={() => setDecision("approve")}>
                  {t("penalties.approvePayroll")}
                </Button>
                <Button onClick={() => setDecision("hold")}>
                  {t("penalties.holdPayroll")}
                </Button>
              </>
            )}
          </Space>
        </Card>
      )}
      <Modal
        title={decision ? t(`penalties.decision.${decision}`) : ""}
        open={!!decision}
        onCancel={() => {
          setDecision(null);
          setActionError(null);
          setNote("");
        }}
        onOk={submitDecision}
        okText={t("common.submit")}
        okButtonProps={{ disabled: !!requiredNote && !note.trim() }}
        confirmLoading={saving}
      >
        {actionError && (
          <Alert
            type="error"
            title={actionError}
            style={{ marginBottom: 12 }}
          />
        )}
        {decision === "acknowledge" ? (
          <p>{t("penalties.acknowledgeConfirm")}</p>
        ) : (
          <Form layout="vertical">
            <Form.Item
              label={t(
                decision === "dispute"
                  ? "penalties.disputeReason"
                  : "penalties.note",
              )}
              required={requiredNote}
            >
              <Input.TextArea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                maxLength={1000}
                showCount
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
