import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";

import ApprovalActions from "../../components/ceo/ApprovalActions";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import SARIcon from "../../components/icons/SARIcon";
import JobOfferApprovalStatusTag from "../../components/jobOffers/JobOfferApprovalStatusTag";
import JobOfferCeoDecision from "../../components/jobOffers/JobOfferCeoDecision";
import JobOfferDecisionModal, {
  type JobOfferDecisionValues,
} from "../../components/jobOffers/JobOfferDecisionModal";
import JobOfferWorkflowHistory from "../../components/jobOffers/JobOfferWorkflowHistory";
import JobOfferDocumentSection, {
  JobOfferDocumentGrid,
} from "../../components/jobOffers/JobOfferDocumentSection";
import Unauthorized403Page from "../Unauthorized403Page";

import { isApiError } from "../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  isConflict,
  isForbidden,
  isNotFound,
} from "../../services/api/httpErrors";
import { triggerBlobDownload } from "../../services/api/downloads";
import { previewBlob } from "../../utils/download";
import {
  listDepartments,
  type Department,
} from "../../services/api/departmentsApi";
import { listPositions, type Position } from "../../services/api/positionsApi";
import {
  approveJobOffer,
  downloadJobOfferCv,
  getJobOffer,
  rejectJobOffer,
  requestJobOfferChanges,
  updateJobOffer,
  type JobOffer,
  type JobOfferPayload,
} from "../../services/api/jobOffersApi";
import {
  AMOUNT_FIELDS,
  calculateTotalPackage,
  canApprove,
  canEdit,
  canReject,
  canRequestChanges,
} from "../hr/job-offers/jobOfferRules";
import { useI18n } from "../../i18n/useI18n";
import { formatNumber } from "../../utils/currency";
import { formatDateOnly, formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

const DATE_FORMAT = "YYYY-MM-DD";

/** The decision the dialog is collecting, or null when it is closed. */
type PendingDecision = "request_changes" | "reject";

/**
 * Exactly the commercial fields the backend lets a CEO write.
 *
 * The API rejects the whole PATCH when it carries anything outside this set, so
 * the form owns no candidate identity, contact or CV field — those stay HR's.
 */
type CommercialFormValues = {
  department_id?: number;
  position_id?: number;
  classification?: string;
  location?: string;
  basic_salary?: number;
  housing_allowance?: number;
  transportation_allowance?: number;
  other_allowance?: number;
  vacation?: string;
  tickets?: string;
  contract_status?: string;
  contract_type?: string;
  contract_duration?: string;
  medical_insurance?: string;
  offer_date: Dayjs;
  expiry_date: Dayjs;
};

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

export default function CEOJobOfferDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [messageApi, messageContext] = message.useMessage();
  const [form] = Form.useForm<CommercialFormValues>();

  const [offer, setOffer] = useState<JobOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cvPreviewing, setCvPreviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

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

  // Only needed once the CEO actually opens the commercial form; the read-only
  // view shows the names the backend already derived.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    const run = async () => {
      try {
        const [departmentResponse, positionResponse] = await Promise.all([
          listDepartments(),
          listPositions(),
        ]);
        if (cancelled) return;
        if (!isApiError(departmentResponse))
          setDepartments(departmentResponse.data || []);
        if (!isApiError(positionResponse))
          setPositions(positionResponse.data || []);
      } catch {
        if (!cancelled) {
          setDepartments([]);
          setPositions([]);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [editing]);

  /**
   * Surfaces what the API said, and treats a 409 as a stale view.
   *
   * Another approver may have decided the offer, or HR may have pulled it back,
   * between this page loading and the click. Reloading shows the real state
   * rather than leaving actions on screen the API has already refused.
   */
  const reportActionError = useCallback(
    (err: unknown, fallbackKey: string): string => {
      const detail = getHttpErrorMessage(err) || t(fallbackKey);
      if (isConflict(err)) void load({ isRefresh: true });
      return detail;
    },
    [load, t],
  );

  const openEditor = useCallback(() => {
    if (!offer) return;
    setTermsError(null);
    form.setFieldsValue({
      department_id: offer.department_id ?? undefined,
      position_id: offer.position_id ?? undefined,
      classification: offer.classification,
      location: offer.location,
      basic_salary: Number(offer.basic_salary) || 0,
      housing_allowance: Number(offer.housing_allowance) || 0,
      transportation_allowance: Number(offer.transportation_allowance) || 0,
      other_allowance: Number(offer.other_allowance) || 0,
      vacation: offer.vacation,
      tickets: offer.tickets,
      contract_status: offer.contract_status,
      contract_type: offer.contract_type,
      contract_duration: offer.contract_duration,
      medical_insurance: offer.medical_insurance,
      offer_date: dayjs(offer.offer_date),
      expiry_date: dayjs(offer.expiry_date),
    } as CommercialFormValues);
    setEditing(true);
  }, [offer, form]);

  const handleSaveTerms = useCallback(async () => {
    setTermsError(null);
    let values: CommercialFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // Every key here is on the backend commercial allow-list; adding anything
    // else would make it reject the whole PATCH with a 403.
    const payload: JobOfferPayload = {
      classification: values.classification?.trim() || "",
      location: values.location?.trim() || "",
      basic_salary: String(values.basic_salary ?? 0),
      housing_allowance: String(values.housing_allowance ?? 0),
      transportation_allowance: String(values.transportation_allowance ?? 0),
      other_allowance: String(values.other_allowance ?? 0),
      total_salary_package: String(calculateTotalPackage(values)),
      vacation: values.vacation?.trim() || "",
      tickets: values.tickets?.trim() || "",
      contract_status: values.contract_status?.trim() || "",
      contract_type: values.contract_type?.trim() || "",
      contract_duration: values.contract_duration?.trim() || "",
      medical_insurance: values.medical_insurance?.trim() || "",
      offer_date: values.offer_date?.format(DATE_FORMAT),
      expiry_date: values.expiry_date?.format(DATE_FORMAT),
    };
    if (values.department_id != null)
      payload.department_id = values.department_id;
    if (values.position_id != null) payload.position_id = values.position_id;

    setSavingTerms(true);
    try {
      const response = await updateJobOffer(id!, payload);
      if (isApiError(response)) {
        setTermsError(response.message || t("jobOffers.form.saveFailed"));
        return;
      }
      setOffer(response.data);
      setEditing(false);
      messageApi.success(t("jobOffers.ceo.termsSaved"));
    } catch (err: unknown) {
      setTermsError(reportActionError(err, "jobOffers.form.saveFailed"));
    } finally {
      setSavingTerms(false);
    }
  }, [form, id, messageApi, t, reportActionError]);

  const handleApprove = useCallback(async () => {
    setDeciding(true);
    try {
      const response = await approveJobOffer(id!, {});
      if (isApiError(response)) {
        messageApi.error(
          response.message || t("jobOffers.approval.approveFailed"),
        );
        return;
      }
      setOffer(response.data);
      messageApi.success(t("jobOffers.approval.approveSuccess"));
    } catch (err: unknown) {
      messageApi.error(
        reportActionError(err, "jobOffers.approval.approveFailed"),
      );
    } finally {
      setDeciding(false);
    }
  }, [id, messageApi, t, reportActionError]);

  const handleDecision = useCallback(
    async (values: JobOfferDecisionValues) => {
      if (!pending) return;
      const isReject = pending === "reject";
      const fallbackKey = isReject
        ? "jobOffers.approval.rejectFailed"
        : "jobOffers.approval.requestChangesFailed";
      setDeciding(true);
      setDecisionError(null);
      try {
        const response = isReject
          ? await rejectJobOffer(id!, values)
          : await requestJobOfferChanges(id!, values);
        if (isApiError(response)) {
          setDecisionError(response.message || t(fallbackKey));
          return;
        }
        setOffer(response.data);
        setPending(null);
        messageApi.success(
          t(
            isReject
              ? "jobOffers.approval.rejectSuccess"
              : "jobOffers.approval.requestChangesSuccess",
          ),
        );
      } catch (err: unknown) {
        setDecisionError(reportActionError(err, fallbackKey));
      } finally {
        setDeciding(false);
      }
    },
    [pending, id, messageApi, t, reportActionError],
  );

  const handleCvDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await downloadJobOfferCv(id!);
      triggerBlobDownload(blob, `job_offer_${id}_cv`);
    } catch (err: unknown) {
      messageApi.error(reportActionError(err, "jobOffers.cv.failed"));
    } finally {
      setDownloading(false);
    }
  }, [id, messageApi, t, reportActionError]);

  /**
   * Opens the CV in a new tab. A Word document cannot render there, so it falls
   * back to a download rather than leaving the user on a blank viewer. The tab
   * is opened synchronously so the browser does not block it as a popup once
   * the bytes have been fetched.
   */
  const handleCvPreview = useCallback(async () => {
    const tab = window.open("about:blank", "_blank");
    setCvPreviewing(true);
    try {
      const blob = await downloadJobOfferCv(id!);
      if (!(await previewBlob(blob, tab))) {
        triggerBlobDownload(blob, `job_offer_${id}_cv`);
        messageApi.info(t("jobOffers.cv.previewUnavailable"));
      }
    } catch (err: unknown) {
      tab?.close();
      messageApi.error(reportActionError(err, "jobOffers.cv.failed"));
    } finally {
      setCvPreviewing(false);
    }
  }, [id, messageApi, t, reportActionError]);

  const departmentOptions = useMemo(
    () =>
      departments.map((department) => ({
        value: department.id,
        label: department.name || department.code,
      })),
    [departments],
  );

  const positionOptions = useMemo(
    () =>
      positions.map((position) => ({
        value: position.id,
        label: position.name || position.code,
      })),
    [positions],
  );

  if (forbidden) return <Unauthorized403Page />;

  if (loading) {
    return (
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <LoadingState title={t("loading.generic")} lines={8} />
      </div>
    );
  }

  if (error || !offer) {
    return (
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <ErrorState
          title={t("common.error")}
          description={error || t("jobOffers.detail.notFound")}
          onRetry={() => load()}
        />
      </div>
    );
  }

  // The backend decides who may act: role alone is not enough, because company
  // scope, the workflow stage and the assigned approver all weigh in.
  const approvable = canApprove(offer);
  const rejectable = canReject(offer);
  const revisable = canRequestChanges(offer);
  const editable = canEdit(offer);
  const actionable = approvable || rejectable || revisable;

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto", paddingBottom: 32 }}>
      {messageContext}

      <PageHeader
        title={offer.candidate_full_name}
        subtitle={offer.position_title}
        secondarySubtitle={t("jobOffers.detail.reference", {
          reference: offer.reference_number,
        })}
        breadcrumb={t("jobOffers.ceo.title")}
        tags={
          <JobOfferApprovalStatusTag
            status={offer.approval_status}
            fallbackLabel={offer.approval_status_label}
            size="large"
          />
        }
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => navigate("/ceo/job-offers")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("jobOffers.ceo.backToInbox")}
            </Button>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={refreshing}
              onClick={() => load({ isRefresh: true })}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("jobOffers.action.refresh")}
            </Button>
            {offer.has_cv && (
              <>
                <Button
                  icon={<EyeOutlined aria-hidden />}
                  loading={cvPreviewing}
                  onClick={handleCvPreview}
                  style={{ borderRadius: 10, minHeight: 40 }}
                >
                  {t("jobOffers.action.previewCv")}
                </Button>
                <Button
                  icon={<DownloadOutlined aria-hidden />}
                  loading={downloading}
                  onClick={handleCvDownload}
                  style={{ borderRadius: 10, minHeight: 40 }}
                >
                  {t("jobOffers.action.downloadCv")}
                </Button>
              </>
            )}
            {editable && !editing && (
              <Button
                icon={<EditOutlined aria-hidden />}
                onClick={openEditor}
                style={{ borderRadius: 10, minHeight: 40 }}
              >
                {t("jobOffers.ceo.editTerms")}
              </Button>
            )}
          </div>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <JobOfferDocumentSection
            title={t("jobOffers.ceo.section.candidate")}
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
                  label: t("jobOffers.field.company"),
                  value: offer.company_name || "—",
                },
                {
                  label: t("jobOffers.field.candidateEmail"),
                  value: offer.candidate_email || "—",
                },
                {
                  label: t("jobOffers.field.candidatePhone"),
                  value: offer.candidate_phone_number || "—",
                },
                {
                  label: t("jobOffers.field.nationality"),
                  value: offer.nationality || "—",
                },
                {
                  label: t("jobOffers.field.dateOfBirth"),
                  value: formatDateOnly(offer.date_of_birth, "—"),
                },
                {
                  label: t("jobOffers.field.idNumber"),
                  value: offer.id_passport_iqama_number || "—",
                },
                {
                  label: t("jobOffers.col.submittedAt"),
                  value: formatDateTimeShort(offer.submitted_at, "—"),
                },
              ]}
            />
            <div
              style={{
                marginTop: 16,
                borderTop: "1px solid #e2e8f0",
                paddingTop: 16,
              }}
            >
              {offer.has_cv ? (
                <Space size={8} wrap>
                  <Button
                    icon={<EyeOutlined aria-hidden />}
                    loading={cvPreviewing}
                    onClick={handleCvPreview}
                    style={{ borderRadius: 10 }}
                  >
                    {t("jobOffers.action.previewCv")}
                  </Button>
                  <Button
                    icon={<DownloadOutlined aria-hidden />}
                    loading={downloading}
                    onClick={handleCvDownload}
                    style={{ borderRadius: 10 }}
                  >
                    {t("jobOffers.action.downloadCv")}
                  </Button>
                </Space>
              ) : (
                <Text type="secondary">{t("jobOffers.detail.noCv")}</Text>
              )}
            </div>
          </JobOfferDocumentSection>

          {editing ? (
            <Surface style={{ marginBottom: 16 }}>
              <SectionTitle>
                {t("jobOffers.ceo.section.commercialTerms")}
              </SectionTitle>
              <Alert
                type="info"
                showIcon
                style={{ borderRadius: 12, marginBottom: 16 }}
                message={t("jobOffers.ceo.editTermsHint")}
              />
              {termsError && (
                <Alert
                  type="error"
                  showIcon
                  closable
                  onClose={() => setTermsError(null)}
                  style={{ borderRadius: 12, marginBottom: 16 }}
                  message={termsError}
                />
              )}
              <Form<CommercialFormValues> form={form} layout="vertical">
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="position_id"
                      label={t("jobOffers.field.position")}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={positionOptions}
                        placeholder={t("jobOffers.form.positionPlaceholder")}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="department_id"
                      label={t("jobOffers.field.departmentRef")}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={departmentOptions}
                        placeholder={t("jobOffers.form.departmentPlaceholder")}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="classification"
                      label={t("jobOffers.field.classification")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="location"
                      label={t("jobOffers.field.location")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  {AMOUNT_FIELDS.map((field) => (
                    <Col xs={24} md={12} lg={6} key={field}>
                      <Form.Item
                        name={field}
                        label={t(
                          `jobOffers.field.${
                            field === "basic_salary"
                              ? "basicSalary"
                              : field === "housing_allowance"
                                ? "housingAllowance"
                                : field === "transportation_allowance"
                                  ? "transportationAllowance"
                                  : "otherAllowance"
                          }`,
                        )}
                        rules={[
                          {
                            type: "number",
                            min: 0,
                            message: t("jobOffers.validation.negativeAmount"),
                          },
                        ]}
                      >
                        <InputNumber
                          min={0}
                          step={100}
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                  ))}
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="vacation"
                      label={t("jobOffers.field.vacation")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="tickets"
                      label={t("jobOffers.field.tickets")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="contract_status"
                      label={t("jobOffers.field.contractStatus")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="contract_type"
                      label={t("jobOffers.field.contractType")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="contract_duration"
                      label={t("jobOffers.field.contractDuration")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="medical_insurance"
                      label={t("jobOffers.field.medicalInsurance")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="offer_date"
                      label={t("jobOffers.field.offerDate")}
                      rules={[
                        {
                          required: true,
                          message: t("jobOffers.validation.required"),
                        },
                      ]}
                    >
                      <DatePicker
                        style={{ width: "100%" }}
                        format={DATE_FORMAT}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="expiry_date"
                      label={t("jobOffers.field.expiryDate")}
                      dependencies={["offer_date"]}
                      rules={[
                        {
                          required: true,
                          message: t("jobOffers.validation.required"),
                        },
                        {
                          validator: async (
                            _rule,
                            value: Dayjs | undefined,
                          ) => {
                            const offerDate = form.getFieldValue(
                              "offer_date",
                            ) as Dayjs | undefined;
                            if (
                              value &&
                              offerDate &&
                              value.isBefore(offerDate, "day")
                            ) {
                              throw new Error(
                                t("jobOffers.validation.expiryBeforeOffer"),
                              );
                            }
                          },
                        },
                      ]}
                    >
                      <DatePicker
                        style={{ width: "100%" }}
                        format={DATE_FORMAT}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Space
                  size={8}
                  wrap
                  style={{ justifyContent: "flex-end", width: "100%" }}
                >
                  <Button
                    onClick={() => {
                      setEditing(false);
                      setTermsError(null);
                    }}
                    disabled={savingTerms}
                    style={{ borderRadius: 10 }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined aria-hidden />}
                    loading={savingTerms}
                    onClick={handleSaveTerms}
                    style={{ borderRadius: 10, fontWeight: 600 }}
                  >
                    {t("jobOffers.ceo.saveTerms")}
                  </Button>
                </Space>
              </Form>
            </Surface>
          ) : (
            <>
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
                      label: t("jobOffers.field.department"),
                      value: offer.department || "—",
                    },
                    {
                      label: t("jobOffers.field.classification"),
                      value: offer.classification || "—",
                    },
                    {
                      label: t("jobOffers.field.location"),
                      value: offer.location || "—",
                    },
                    {
                      label: t("jobOffers.field.offerDate"),
                      value: formatDateOnly(offer.offer_date, "—"),
                    },
                    {
                      label: t("jobOffers.field.expiryDate"),
                      value: formatDateOnly(offer.expiry_date, "—"),
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
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: "#c2410c",
                      }}
                    >
                      {formatNumber(offer.total_salary_package)}
                    </span>
                    <SARIcon size={18} color="#c2410c" />
                  </Space>
                </div>
              </JobOfferDocumentSection>

              <JobOfferDocumentSection
                title={t("jobOffers.detail.section.benefits")}
                style={{ marginBottom: 16 }}
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
            </>
          )}
        </Col>

        <Col xs={24} xl={8}>
          <Surface style={{ marginBottom: 16 }}>
            <SectionTitle>{t("jobOffers.ceo.decisionTitle")}</SectionTitle>

            {offer.ceo_decision_at ? (
              <JobOfferCeoDecision offer={offer} />
            ) : null}

            {actionable ? (
              <div style={{ marginTop: offer.ceo_decision_at ? 16 : 0 }}>
                <Text
                  type="secondary"
                  style={{ display: "block", marginBottom: 16 }}
                >
                  {t("jobOffers.ceo.decisionHint")}
                </Text>
                <ApprovalActions
                  size="middle"
                  block
                  onApprove={handleApprove}
                  onReject={() => {
                    setDecisionError(null);
                    setPending("reject");
                  }}
                  approveLoading={deciding}
                  approveDisabled={!approvable}
                  rejectDisabled={!rejectable}
                  subjectLabel={offer.candidate_full_name}
                />
                {revisable && (
                  <Button
                    block
                    onClick={() => {
                      setDecisionError(null);
                      setPending("request_changes");
                    }}
                    disabled={deciding}
                    aria-label={`${t("jobOffers.approval.requestChanges")}: ${offer.candidate_full_name}`}
                    style={{ borderRadius: 8, fontWeight: 600, marginTop: 8 }}
                  >
                    {t("jobOffers.approval.requestChanges")}
                  </Button>
                )}
              </div>
            ) : (
              // Already decided elsewhere, or never this approver's to make.
              <Alert
                type="info"
                showIcon
                style={{
                  borderRadius: 12,
                  marginTop: offer.ceo_decision_at ? 16 : 0,
                }}
                message={t("jobOffers.ceo.noActionAvailable")}
              />
            )}
          </Surface>

          <Surface>
            <SectionTitle>
              {t("jobOffers.detail.section.workflow")}
            </SectionTitle>
            <JobOfferWorkflowHistory history={offer.workflow?.history} />
          </Surface>
        </Col>
      </Row>

      <JobOfferDecisionModal
        open={pending !== null}
        requireReason
        danger={pending === "reject"}
        title={
          pending === "reject"
            ? t("jobOffers.approval.rejectTitle")
            : t("jobOffers.approval.requestChangesTitle")
        }
        confirmText={
          pending === "reject"
            ? t("common.reject")
            : t("jobOffers.approval.requestChanges")
        }
        subject={offer.candidate_full_name}
        loading={deciding}
        errorMessage={decisionError}
        onCancel={() => setPending(null)}
        onSubmit={handleDecision}
      />
    </div>
  );
}
