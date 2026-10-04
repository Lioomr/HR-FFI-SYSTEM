import BackButton from "../../../components/ui/BackButton";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  notification,
  theme,
  type TimelineProps,
} from "antd";
import {
  CheckOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import { getEmployee } from "../../../services/api/employeesApi";
import {
  acknowledgePenalty,
  disputePenalty,
  downloadPenaltyWarningNotice,
  getPenalty,
  getPenaltyCatalog,
  markPenaltyDisruption,
  resolvePenalty,
  reviewPenaltyPayroll,
  type PenaltyMarkDecision,
  type PenaltyCatalogItem,
  type PenaltyRecord,
} from "../../../services/api/penaltiesApi";
import { formatDateOnly, formatDateTimeShort } from "../../../utils/dateTime";
import { useI18n } from "../../../i18n/useI18n";
import PenaltyStatusTag from "./PenaltyStatusTag";
import PenaltyCategoryTag from "./PenaltyCategoryTag";
import PenaltyAmount from "./PenaltyAmount";
import { isStalePenaltyError, penaltyErrorMessage } from "./penaltyErrors";

type Decision =
  | PenaltyMarkDecision
  | "uphold"
  | "waive"
  | "reopen"
  | "rerate"
  | "approve"
  | "hold"
  | "dispute"
  | "acknowledge";
type TimelineItemType = NonNullable<TimelineProps["items"]>[number];

export default function PenaltyDetailPage({
  role,
}: {
  role: "hr" | "employee";
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const { token } = theme.useToken();
  const [record, setRecord] = useState<PenaltyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [catalogItem, setCatalogItem] = useState<PenaltyCatalogItem | null>(
    null,
  );
  // Employee route: respond buttons only for the signed-in user's own record.
  const [myProfileId, setMyProfileId] = useState<number | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      setLoadError(null);
      try {
        const result = await getPenalty(id);
        if (isApiError(result)) {
          setLoadError(penaltyErrorMessage(t, result.message));
          return;
        }
        setRecord(result.data);
      } catch (error) {
        setLoadError(penaltyErrorMessage(t, error));
      } finally {
        setLoading(false);
      }
    },
    [id, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const catalogCode = record?.catalog_code;
  useEffect(() => {
    if (!catalogCode) return;
    let active = true;
    void getPenaltyCatalog()
      .then((result) => {
        if (active && !isApiError(result))
          setCatalogItem(
            result.data.find((item) => item.code === catalogCode) ?? null,
          );
      })
      .catch(() => undefined); // Fall back to the code alone.
    return () => {
      active = false;
    };
  }, [catalogCode]);

  useEffect(() => {
    if (role !== "employee") return;
    let active = true;
    void getEmployee("me")
      .then((result) => {
        if (active && !isApiError(result)) setMyProfileId(result.data.id);
      })
      .catch(() => undefined); // No profile: no employee actions.
    return () => {
      active = false;
    };
  }, [role]);

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
                decision === "confirmed" ||
                decision === "excused"
              ? await markPenaltyDisruption(record.id, {
                  disruption: decision,
                  note: note.trim(),
                })
              : decision === "uphold" ||
                  decision === "waive" ||
                  decision === "reopen" ||
                  decision === "rerate"
                ? await resolvePenalty(record.id, {
                    decision,
                    note: note.trim(),
                  })
                : await reviewPenaltyPayroll(record.id, {
                    decision,
                    note: note.trim(),
                  });
      if (isApiError(result)) {
        setActionError(penaltyErrorMessage(t, result.message));
        return;
      }
      setRecord(result.data);
      setDecision(null);
      setNote("");
      setStaleNotice(null);
      notification.success({ message: t("penalties.actionSaved") });
    } catch (error) {
      const message = penaltyErrorMessage(t, error);
      if (isStalePenaltyError(error)) {
        // The record changed elsewhere: close the dialog and reload it so the
        // offered actions match its current status.
        setDecision(null);
        setNote("");
        setStaleNotice(message);
        void load(true);
      } else {
        setActionError(message);
      }
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
        action={
          <Button onClick={() => void load()}>{t("penalties.retry")}</Button>
        }
      />
    );

  const isAttendance = record.source === "automatic";
  // System-issued warnings: the employee can respond, and never sees a count.
  const isAutomated = !!record.automation;
  const isAutoWarning = record.automation === "warning_issued";
  const warningNotice = record.warning_notice;
  const isMonetary =
    Number(record.total_deduction_amount ?? record.amount ?? 0) > 0;
  const isPendingMark = record.status === "pending_hr_mark";
  const catalogLabel = catalogItem
    ? `${language === "ar" ? catalogItem.title_ar : catalogItem.title_en} (${record.catalog_code})`
    : record.catalog_code;
  const employeeCanRespond =
    role === "employee" &&
    myProfileId === record.employee_profile_id &&
    (!isAttendance || isAutoWarning) &&
    (record.status === "issued" || record.status === "applied") &&
    record.employee_response?.decision !== "disputed";
  const hrCanMark =
    role === "hr" && isAttendance && record.status === "pending_hr_mark";
  const hasDisruptionBranches = /^W0[1-6]$/.test(record.catalog_code);
  const needsCorrectionReview = record.resolution?.decision === "manual_review";
  const hrCanResolve =
    role === "hr" && (record.status === "disputed" || needsCorrectionReview);
  const proposal = record.resolution?.proposed_evidence;
  // The server recomputes the replacement from current attendance evidence.
  const hrCanReopen =
    hrCanResolve &&
    needsCorrectionReview &&
    isAttendance &&
    record.status !== "applied" &&
    record.payroll_status !== "applied";
  // Recurrence-only reviews (no replacement catalog row) can be re-rated.
  const hrCanRerate =
    hrCanResolve &&
    needsCorrectionReview &&
    proposal?.expected_occurrence != null &&
    !proposal.catalog_code &&
    record.status !== "applied" &&
    record.payroll_status !== "applied";
  const hrCanReviewPayroll =
    role === "hr" &&
    !needsCorrectionReview &&
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
    decision === "confirmed" ||
    decision === "excused" ||
    decision === "uphold" ||
    decision === "waive" ||
    decision === "reopen" ||
    decision === "rerate" ||
    decision === "approve" ||
    decision === "hold";

  const catalogTitle = catalogItem
    ? language === "ar"
      ? catalogItem.title_ar
      : catalogItem.title_en
    : null;
  const employeeName =
    language === "ar"
      ? record.employee_name_ar || record.employee_name_en
      : record.employee_name_en || record.employee_name_ar;
  const description =
    (language === "ar" ? record.description_ar : record.description_en) ||
    record.description;
  const payrollLabel = record.payroll_status
    ? t(
        `penalties.payroll.${record.payroll_status}`,
        undefined,
        record.payroll_status,
      )
    : null;
  const muted: CSSProperties = { color: token.colorTextSecondary };
  const hasActions =
    employeeCanRespond || hrCanMark || hrCanResolve || hrCanReviewPayroll;
  const heroAmount = record.total_deduction_amount ?? record.amount;

  // What happened so far, in order. Only recorded facts are shown as done;
  // the next expected step is shown as pending.
  const markDecision =
    record.resolution &&
    ["disrupted", "not_disrupted", "confirmed", "excused"].includes(
      record.resolution.decision,
    )
      ? record.resolution
      : null;
  const hrResolution =
    record.resolution &&
    (record.resolution.decision === "uphold" ||
      record.resolution.decision === "waive")
      ? record.resolution
      : null;
  const step = (
    key: string,
    title: string,
    body: ReactNode,
    state: "done" | "pending" | "warning",
  ): TimelineItemType => ({
    key,
    color: state === "done" ? "green" : state === "warning" ? "orange" : "gray",
    icon:
      state === "pending" ? (
        <ClockCircleOutlined aria-hidden />
      ) : state === "warning" ? (
        <ExclamationCircleOutlined aria-hidden />
      ) : undefined,
    content: (
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {body && <div style={{ ...muted, fontSize: 13 }}>{body}</div>}
      </div>
    ),
  });
  const timeline: TimelineItemType[] = [
    step(
      "recorded",
      t("penalties.timeline.recorded"),
      `${formatDateOnly(record.occurred_on, "—")} · ${t(
        isAttendance
          ? "penalties.timeline.fromAttendance"
          : "penalties.timeline.fromHr",
      )}`,
      "done",
    ),
  ];
  if (warningNotice) {
    timeline.push(
      step(
        "mark",
        t("penalties.timeline.autoIssued"),
        `${t("penalties.decision.auto_warning")} · ${formatDateTimeShort(warningNotice.issued_at, "—")}`,
        "done",
      ),
    );
  } else if (isAttendance) {
    timeline.push(
      markDecision
        ? step(
            "mark",
            t("penalties.timeline.hrMark"),
            [
              t(
                `penalties.decision.${markDecision.decision}`,
                undefined,
                markDecision.decision,
              ),
              markDecision.note,
              markDecision.resolved_at &&
                formatDateTimeShort(markDecision.resolved_at, "—"),
            ]
              .filter(Boolean)
              .join(" · "),
            "done",
          )
        : step(
            "mark",
            t("penalties.timeline.hrMark"),
            isPendingMark ? t("penalties.timeline.hrMarkPending") : null,
            isPendingMark ? "pending" : "done",
          ),
    );
  }
  if (!isPendingMark && (!isAttendance || isAutoWarning)) {
    timeline.push(
      record.employee_response
        ? step(
            "response",
            t("penalties.employeeResponse"),
            `${t(
              `penalties.response.${record.employee_response.decision}`,
              undefined,
              record.employee_response.decision,
            )} · ${formatDateTimeShort(record.employee_response.submitted_at, "—")}`,
            record.employee_response.decision === "disputed"
              ? "warning"
              : "done",
          )
        : step(
            "response",
            t("penalties.employeeResponse"),
            t("penalties.timeline.responsePending"),
            "pending",
          ),
    );
  }
  if (record.dispute_reason || record.status === "disputed") {
    timeline.push(
      step(
        "dispute",
        t("penalties.disputeReason"),
        record.dispute_reason,
        "warning",
      ),
    );
    timeline.push(
      hrResolution
        ? step(
            "resolution",
            t("penalties.resolution"),
            [
              t(
                `penalties.decision.${hrResolution.decision}`,
                undefined,
                hrResolution.decision,
              ),
              hrResolution.note,
              hrResolution.resolved_at &&
                formatDateTimeShort(hrResolution.resolved_at, "—"),
            ]
              .filter(Boolean)
              .join(" · "),
            "done",
          )
        : step(
            "resolution",
            t("penalties.resolution"),
            t("penalties.timeline.resolutionPending"),
            "pending",
          ),
    );
  }
  if (record.payroll_status) {
    timeline.push(
      step(
        "payroll",
        t("penalties.payrollStatus"),
        record.status === "disputed"
          ? `${payrollLabel} · ${t("penalties.holdWhileDisputed")}`
          : payrollLabel,
        record.status === "disputed" || record.payroll_status === "held"
          ? "warning"
          : record.payroll_status === "applied" ||
              record.payroll_status === "void"
            ? "done"
            : "pending",
      ),
    );
  }

  const actionHelp = employeeCanRespond
    ? record.employee_response
      ? "penalties.help.employeeDisputeOnly"
      : "penalties.help.employee"
    : hrCanResolve && record.status === "disputed"
      ? "penalties.help.resolve"
      : hrCanReviewPayroll
        ? "penalties.help.payroll"
        : null;
  const idleHelp =
    role === "employee" && record.status === "disputed"
      ? "penalties.help.disputedEmployee"
      : "penalties.help.none";
  const decisionHelp: Partial<Record<Decision, string>> = {
    acknowledge: "penalties.acknowledgeConfirm",
    dispute: "penalties.help.decision.dispute",
    uphold: "penalties.help.decision.uphold",
    waive: "penalties.help.decision.waive",
    rerate: "penalties.help.decision.rerate",
    approve: "penalties.help.decision.approve",
    hold: "penalties.help.decision.hold",
    excused: "penalties.help.decision.excused",
  };

  return (
    <div>
      <PageHeader
        title={`${t("penalties.detailTitle")} #${record.id}`}
        subtitle={employeeName}
        actions={
          <BackButton onClick={() => navigate(`/${role}/penalties`)}>
            {t("common.back")}
          </BackButton>
        }
      />
      {staleNotice && (
        <Alert
          type="warning"
          showIcon
          closable
          title={staleNotice}
          onClose={() => setStaleNotice(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {role === "employee" && record.payroll_status === "applied" && (
        <Alert
          type="info"
          showIcon
          title={t("penalties.finalizedPayrollNotice")}
          style={{ marginBottom: 16 }}
        />
      )}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={16}>
            <Space size={[8, 8]} wrap style={{ marginBottom: 8 }}>
              <PenaltyStatusTag status={record.status} />
              <PenaltyCategoryTag category={record.category} />
              <Tag bordered={false}>{record.catalog_code}</Tag>
              {isAutomated && (
                <Tag bordered={false} color="processing">
                  {t("penalties.autoWarning")}
                </Tag>
              )}
            </Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {catalogTitle ?? record.catalog_code}
            </Typography.Title>
            <div style={{ ...muted, marginTop: 4 }}>
              {employeeName} · {formatDateOnly(record.occurred_on, "—")}
            </div>
            {warningNotice && (
              <Button
                icon={<DownloadOutlined aria-hidden />}
                style={{ marginTop: 12 }}
                onClick={() =>
                  void downloadPenaltyWarningNotice({
                    id: record.id,
                    warning_notice: warningNotice,
                  }).catch(() =>
                    notification.error({
                      message: t("penalties.downloadFailed"),
                    }),
                  )
                }
              >
                {t("penalties.downloadWarningLetter")}
              </Button>
            )}
          </Col>
          <Col xs={24} md={8}>
            <div
              style={{
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadiusLG,
                padding: "12px 16px",
                textAlign: "end",
              }}
            >
              <div style={{ ...muted, fontSize: 12 }}>
                {t("penalties.totalDeductionAmount")}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color:
                    !isPendingMark && Number(heroAmount)
                      ? token.colorError
                      : token.colorText,
                }}
              >
                {isPendingMark ? (
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {t("penalties.pendingAmount")}
                  </span>
                ) : Number(heroAmount) ? (
                  <PenaltyAmount
                    value={heroAmount}
                    size={20}
                    fontWeight={700}
                  />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {t("penalties.noDeduction")}
                  </span>
                )}
              </div>
              {payrollLabel && (
                <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
                  {t("penalties.payrollStatus")}: {payrollLabel}
                </div>
              )}
            </div>
          </Col>
        </Row>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card title={t("penalties.facts")} style={{ marginBottom: 16 }}>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small">
              <Descriptions.Item label={t("penalties.employee")}>
                {employeeName}
              </Descriptions.Item>
              <Descriptions.Item label={t("penalties.catalogItem")}>
                {catalogLabel}
              </Descriptions.Item>
              <Descriptions.Item label={t("penalties.occurredOn")}>
                {formatDateOnly(record.occurred_on, "—")}
              </Descriptions.Item>
              {!isPendingMark &&
                record.occurrence_number != null &&
                !(role === "employee" && isAutomated) && (
                  <Descriptions.Item label={t("penalties.occurrence")}>
                    {record.occurrence_number}
                  </Descriptions.Item>
                )}
              <Descriptions.Item label={t("penalties.action")}>
                {t(
                  `penalties.action.${record.action}`,
                  undefined,
                  record.action,
                )}
              </Descriptions.Item>
              <Descriptions.Item label={t("penalties.countPeriod")}>
                {t(
                  `penalties.period.${record.count_period}`,
                  undefined,
                  record.count_period,
                )}
              </Descriptions.Item>
              {!isPendingMark && (
                <Descriptions.Item label={t("penalties.amount")}>
                  <PenaltyAmount value={record.amount} />
                </Descriptions.Item>
              )}
              {!isPendingMark && record.extra_wage_amount != null && (
                <Descriptions.Item label={t("penalties.extraWageAmount")}>
                  <PenaltyAmount value={record.extra_wage_amount} />
                </Descriptions.Item>
              )}
              <Descriptions.Item label={t("penalties.description")} span={2}>
                {description || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("penalties.note")} span={2}>
                {record.note || "—"}
              </Descriptions.Item>
            </Descriptions>
          </Card>
          <Card title={t("penalties.timeline.title")}>
            <Timeline items={timeline} />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            title={t("penalties.availableActions")}
            style={{
              borderColor: hasActions ? token.colorPrimaryBorder : undefined,
            }}
          >
            {hasActions ? (
              <>
                {needsCorrectionReview && (
                  <Alert
                    type="warning"
                    showIcon
                    title={t("penalties.correctionReviewHint")}
                    description={
                      <>
                        {!!proposal?.released_wage_dates?.length && (
                          <p>
                            <strong>
                              {t("penalties.releasedAbsenceDates")}:{" "}
                            </strong>
                            {proposal.released_wage_dates
                              .map((day) => formatDateOnly(day, "—"))
                              .join(", ")}
                          </p>
                        )}
                        {!!proposal?.proposed_wage_absence_dates?.length && (
                          <p>
                            <strong>
                              {t("penalties.proposedAbsenceDates")}:{" "}
                            </strong>
                            {proposal.proposed_wage_absence_dates
                              .map((day) => formatDateOnly(day, "—"))
                              .join(", ")}
                          </p>
                        )}
                      </>
                    }
                    style={{ marginBottom: 16 }}
                  />
                )}
                {hrCanMark && (
                  <Alert
                    type="info"
                    showIcon
                    title={t(
                      hasDisruptionBranches
                        ? "penalties.markBranchHint"
                        : "penalties.markConfirmHint",
                    )}
                    style={{ marginBottom: 16 }}
                  />
                )}
                {actionHelp && (
                  <p style={{ ...muted, marginTop: 0 }}>{t(actionHelp)}</p>
                )}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {employeeCanRespond && (
                    <>
                      {!record.employee_response && (
                        <Button
                          type="primary"
                          block
                          icon={<CheckOutlined aria-hidden />}
                          onClick={() => setDecision("acknowledge")}
                        >
                          {t("penalties.acknowledge")}
                        </Button>
                      )}
                      <Button
                        block
                        icon={<MessageOutlined aria-hidden />}
                        onClick={() => setDecision("dispute")}
                      >
                        {t("penalties.dispute")}
                      </Button>
                    </>
                  )}
                  {hrCanMark && (
                    <>
                      {hasDisruptionBranches ? (
                        <>
                          <Button
                            type="primary"
                            block
                            onClick={() => setDecision("disrupted")}
                          >
                            {t("penalties.disrupted")}
                          </Button>
                          <Button
                            block
                            onClick={() => setDecision("not_disrupted")}
                          >
                            {t("penalties.notDisrupted")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="primary"
                          block
                          onClick={() => setDecision("confirmed")}
                        >
                          {t("penalties.confirmed")}
                        </Button>
                      )}
                      <Button block onClick={() => setDecision("excused")}>
                        {t("penalties.excused")}
                      </Button>
                    </>
                  )}
                  {hrCanResolve && (
                    <>
                      {record.status === "disputed" &&
                        !needsCorrectionReview && (
                          <Button
                            type="primary"
                            block
                            onClick={() => setDecision("uphold")}
                          >
                            {t("penalties.uphold")}
                          </Button>
                        )}
                      <Button block onClick={() => setDecision("waive")}>
                        {t("penalties.waive")}
                      </Button>
                      {hrCanReopen && (
                        <Button block onClick={() => setDecision("reopen")}>
                          {t("penalties.reopen")}
                        </Button>
                      )}
                      {hrCanRerate && (
                        <Button block onClick={() => setDecision("rerate")}>
                          {t("penalties.rerate")}
                        </Button>
                      )}
                    </>
                  )}
                  {hrCanReviewPayroll && (
                    <>
                      <Button
                        type="primary"
                        block
                        onClick={() => setDecision("approve")}
                      >
                        {t("penalties.approvePayroll")}
                      </Button>
                      <Button block onClick={() => setDecision("hold")}>
                        {t("penalties.holdPayroll")}
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p style={{ ...muted, margin: 0 }}>{t(idleHelp)}</p>
            )}
          </Card>
        </Col>
      </Row>
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
        okButtonProps={{
          disabled: !!requiredNote && !note.trim(),
          danger: decision === "dispute" || decision === "hold",
        }}
        confirmLoading={saving}
      >
        <div
          style={{
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
            padding: "8px 12px",
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {catalogTitle ?? record.catalog_code}
          </div>
          <div style={muted}>
            {employeeName} · {formatDateOnly(record.occurred_on, "—")}
            {!isPendingMark && Number(heroAmount) ? (
              <>
                {" · "}
                <PenaltyAmount value={heroAmount} size={12} />
              </>
            ) : null}
          </div>
        </div>
        {actionError && (
          <Alert
            type="error"
            showIcon
            title={actionError}
            style={{ marginBottom: 12 }}
          />
        )}
        {decision === "acknowledge" ? (
          <p>{t("penalties.acknowledgeConfirm")}</p>
        ) : (
          <>
            {decision && decisionHelp[decision] && (
              <p style={{ ...muted, marginTop: 0 }}>
                {t(decisionHelp[decision] as string)}
              </p>
            )}
            <Form layout="vertical">
              <Form.Item
                label={t(
                  decision === "dispute"
                    ? "penalties.disputeReason"
                    : "penalties.note",
                )}
                htmlFor="penalty-decision-note"
                required={requiredNote}
              >
                <Input.TextArea
                  id="penalty-decision-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  showCount
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
