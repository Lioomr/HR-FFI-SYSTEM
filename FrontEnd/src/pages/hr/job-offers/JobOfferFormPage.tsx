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
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  ArrowLeftOutlined,
  InboxOutlined,
  SaveOutlined,
  SendOutlined,
} from "@ant-design/icons";

import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import PhoneNumberInput from "../../../components/ui/PhoneNumberInput";
import NationalitySelect from "../../../components/ui/NationalitySelect";
import SARIcon from "../../../components/icons/SARIcon";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import {
  isForbidden,
  isValidationError,
} from "../../../services/api/httpErrors";
import {
  listDepartments,
  type Department,
} from "../../../services/api/departmentsApi";
import {
  listPositions,
  type Position,
} from "../../../services/api/positionsApi";
import {
  CV_ACCEPT,
  createJobOffer,
  getJobOffer,
  submitJobOffer,
  updateJobOffer,
  type JobOffer,
  type JobOfferPayload,
} from "../../../services/api/jobOffersApi";
import { useI18n } from "../../../i18n/useI18n";
import {
  apply422ToForm,
  getFirstApiErrorMessage,
} from "../../../utils/formErrors";
import { formatNumber } from "../../../utils/currency";
import {
  AMOUNT_FIELDS,
  calculateTotalPackage,
  canSubmit,
  isAllowedCvFile,
} from "./jobOfferRules";

const { Text } = Typography;

const DATE_FORMAT = "YYYY-MM-DD";
const E164 = /^\+[1-9]\d{7,14}$/;

type JobOfferFormValues = {
  candidate_full_name: string;
  candidate_email?: string;
  candidate_phone_number?: string;
  nationality?: string;
  date_of_birth?: Dayjs;
  id_passport_iqama_number?: string;
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

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: 24,
        marginBottom: 16,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
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
          {title}
        </Typography.Title>
      </div>
      {children}
    </div>
  );
}

export default function JobOfferFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const offerId = params.id;
  const isEdit = Boolean(offerId);
  const [form] = Form.useForm<JobOfferFormValues>();
  const [messageApi, messageContext] = message.useMessage();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [offer, setOffer] = useState<JobOffer | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceLoaded, setReferenceLoaded] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [cvError, setCvError] = useState<string | null>(null);

  // Watch the four salary components rather than the whole form: a blanket
  // `useWatch([], form)` re-renders every field on each keystroke, and the
  // total only ever depends on these.
  const basicSalary = Form.useWatch("basic_salary", form);
  const housingAllowance = Form.useWatch("housing_allowance", form);
  const transportationAllowance = Form.useWatch(
    "transportation_allowance",
    form,
  );
  const otherAllowance = Form.useWatch("other_allowance", form);
  const totalPackage = useMemo(
    () =>
      calculateTotalPackage({
        basic_salary: basicSalary,
        housing_allowance: housingAllowance,
        transportation_allowance: transportationAllowance,
        other_allowance: otherAllowance,
      }),
    [basicSalary, housingAllowance, transportationAllowance, otherAllowance],
  );

  useEffect(() => {
    if (!isEdit) {
      form.setFieldsValue({
        offer_date: dayjs(),
        expiry_date: dayjs().add(14, "day"),
      } as Partial<JobOfferFormValues> as JobOfferFormValues);
      return;
    }
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await getJobOffer(offerId!);
        if (isApiError(response)) {
          setLoadError(response.message || t("jobOffers.detail.loadFailed"));
          return;
        }
        const data = response.data;
        setOffer(data);
        form.setFieldsValue({
          department_id: data.department_id ?? undefined,
          position_id: data.position_id ?? undefined,
          candidate_full_name: data.candidate_full_name,
          candidate_email: data.candidate_email,
          candidate_phone_number: data.candidate_phone_number,
          nationality: data.nationality,
          date_of_birth: data.date_of_birth
            ? dayjs(data.date_of_birth)
            : undefined,
          id_passport_iqama_number: data.id_passport_iqama_number,
          classification: data.classification,
          location: data.location,
          basic_salary: Number(data.basic_salary) || 0,
          housing_allowance: Number(data.housing_allowance) || 0,
          transportation_allowance: Number(data.transportation_allowance) || 0,
          other_allowance: Number(data.other_allowance) || 0,
          vacation: data.vacation,
          tickets: data.tickets,
          contract_status: data.contract_status,
          contract_type: data.contract_type,
          contract_duration: data.contract_duration,
          medical_insurance: data.medical_insurance,
          offer_date: dayjs(data.offer_date),
          expiry_date: dayjs(data.expiry_date),
        } as JobOfferFormValues);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setLoadError(
          (err as Error)?.message || t("jobOffers.detail.loadFailed"),
        );
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [isEdit, offerId, form, t]);

  /**
   * Department and position are company HR reference records, not free text:
   * the backend validates the ids and derives the display text from them.
   */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setReferenceLoading(true);
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
        // Treated as "none configured": the empty state below tells HR where to
        // add them, which is more useful than a dead-end error on this screen.
        if (!cancelled) {
          setDepartments([]);
          setPositions([]);
        }
      } finally {
        if (!cancelled) {
          setReferenceLoading(false);
          setReferenceLoaded(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

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

  /** Reference data exists but is empty — HR has to seed it before saving. */
  const referenceEmpty =
    referenceLoaded && (departments.length === 0 || positions.length === 0);

  const buildPayload = useCallback(
    (values: JobOfferFormValues): JobOfferPayload => {
      const payload: JobOfferPayload = {
        candidate_full_name: values.candidate_full_name?.trim(),
        candidate_email: values.candidate_email?.trim() || "",
        candidate_phone_number: values.candidate_phone_number?.trim() || "",
        nationality: values.nationality?.trim() || "",
        id_passport_iqama_number: values.id_passport_iqama_number?.trim() || "",
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

      if (values.date_of_birth)
        payload.date_of_birth = values.date_of_birth.format(DATE_FORMAT);
      // The backend derives the department and position text from the reference
      // records, so sending our own copy could only ever disagree with it.
      if (values.department_id != null)
        payload.department_id = values.department_id;
      if (values.position_id != null) payload.position_id = values.position_id;
      // Only sent when HR actually picked a file: an edit without one must not
      // blank the CV already on file.
      if (cvFile) payload.cv_file = cvFile;
      return payload;
    },
    [cvFile],
  );

  /** Saves the offer and hands back its id, so Submit can chain onto a create. */
  const persist = useCallback(
    async (values: JobOfferFormValues): Promise<number | null> => {
      const payload = buildPayload(values);
      const response = isEdit
        ? await updateJobOffer(offerId!, payload)
        : await createJobOffer(payload);
      if (isApiError(response)) {
        setServerError(response.message || t("jobOffers.form.saveFailed"));
        return null;
      }
      return response.data.id;
    },
    [buildPayload, isEdit, offerId, t],
  );

  const handleFailure = useCallback(
    (err: unknown, fallbackKey: string) => {
      if (isValidationError(err)) {
        apply422ToForm(form, err);
        setServerError(getFirstApiErrorMessage(err) || t(fallbackKey));
      } else {
        setServerError((err as Error)?.message || t(fallbackKey));
      }
    },
    [form, t],
  );

  /** The backend requires a CV on create and before any submission. */
  const missingCv = !cvFile && !offer?.has_cv;

  const handleSave = useCallback(async () => {
    setServerError(null);
    setCvError(null);
    let values: JobOfferFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!isEdit && missingCv) {
      setCvError(t("jobOffers.form.cvRequired"));
      return;
    }
    setSaving("draft");
    try {
      const id = await persist(values);
      if (id === null) return;
      messageApi.success(
        isEdit ? t("jobOffers.form.updated") : t("jobOffers.form.created"),
      );
      navigate(`/hr/job-offers/${id}`);
    } catch (err: unknown) {
      handleFailure(err, "jobOffers.form.saveFailed");
    } finally {
      setSaving(null);
    }
  }, [
    form,
    isEdit,
    missingCv,
    persist,
    messageApi,
    navigate,
    t,
    handleFailure,
  ]);

  const handleSubmitToCeo = useCallback(async () => {
    setServerError(null);
    setCvError(null);
    let values: JobOfferFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // Saying so here beats saving the offer and then failing on the second call.
    if (missingCv) {
      setCvError(t("jobOffers.form.cvRequiredForSubmit"));
      return;
    }
    setSaving("submit");
    try {
      const id = await persist(values);
      if (id === null) return;
      const response = await submitJobOffer(id);
      if (isApiError(response)) {
        setServerError(response.message || t("jobOffers.submit.failed"));
        return;
      }
      messageApi.success(t("jobOffers.submit.success"));
      navigate(`/hr/job-offers/${id}`);
    } catch (err: unknown) {
      handleFailure(err, "jobOffers.submit.failed");
    } finally {
      setSaving(null);
    }
  }, [form, missingCv, persist, messageApi, navigate, t, handleFailure]);

  // Either channel alone is enough; the backend refuses to send with neither.
  const validateContact = useCallback(async () => {
    const email = (form.getFieldValue("candidate_email") || "").trim();
    const phone = (form.getFieldValue("candidate_phone_number") || "").trim();
    if (!email && !phone)
      throw new Error(t("jobOffers.validation.contactRequired"));
  }, [form, t]);

  if (forbidden) return <Unauthorized403Page />;

  // Editing is the backend call: HR keeps drafts and returned offers open,
  // everything else is read-only.
  const editingBlocked = isEdit && offer !== null && !offer.workflow?.can_edit;
  // A brand-new offer is always submittable once saved; an existing one only
  // while the backend still says so.
  const submitAvailable = !isEdit || (offer !== null && canSubmit(offer));

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", paddingBottom: 32 }}>
      {messageContext}

      <PageHeader
        title={
          isEdit
            ? t("jobOffers.form.editTitle")
            : t("jobOffers.form.createTitle")
        }
        subtitle={
          isEdit
            ? t("jobOffers.form.editSubtitle")
            : t("jobOffers.form.createSubtitle")
        }
        breadcrumb={t("jobOffers.title")}
        actions={
          <Button
            icon={<ArrowLeftOutlined aria-hidden />}
            onClick={() => navigate("/hr/job-offers")}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {t("jobOffers.action.backToList")}
          </Button>
        }
      />

      {loading ? (
        <LoadingState title={t("loading.generic")} lines={8} />
      ) : loadError ? (
        <Alert
          type="error"
          showIcon
          message={loadError}
          style={{ borderRadius: 12 }}
        />
      ) : (
        <Form<JobOfferFormValues>
          form={form}
          layout="vertical"
          requiredMark
          disabled={editingBlocked}
        >
          {editingBlocked && (
            <Alert
              type="warning"
              showIcon
              message={t("jobOffers.form.notEditable")}
              style={{ borderRadius: 12, marginBottom: 16 }}
            />
          )}
          {offer?.approval_status === "changes_requested" &&
            offer.ceo_decision_reason && (
              <Alert
                type="warning"
                showIcon
                style={{ borderRadius: 12, marginBottom: 16 }}
                message={t("jobOffers.approval.changesRequestedTitle")}
                description={offer.ceo_decision_reason}
              />
            )}
          {serverError && (
            <Alert
              type="error"
              showIcon
              message={serverError}
              closable
              onClose={() => setServerError(null)}
              style={{ borderRadius: 12, marginBottom: 16 }}
            />
          )}

          <SectionCard title={t("jobOffers.form.section.candidate")}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="candidate_full_name"
                  label={t("jobOffers.field.candidateFullName")}
                  rules={[
                    {
                      required: true,
                      message: t("jobOffers.validation.required"),
                    },
                  ]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="candidate_email"
                  label={t("jobOffers.field.candidateEmail")}
                  dependencies={["candidate_phone_number"]}
                  rules={[
                    {
                      type: "email",
                      message: t("jobOffers.validation.emailInvalid"),
                    },
                    { validator: validateContact },
                  ]}
                >
                  <Input inputMode="email" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="candidate_phone_number"
                  label={t("jobOffers.field.candidatePhone")}
                  extra={t("jobOffers.form.contactHint")}
                  dependencies={["candidate_email"]}
                  rules={[
                    {
                      pattern: E164,
                      message: t("jobOffers.validation.phoneInvalid"),
                    },
                    { validator: validateContact },
                  ]}
                >
                  {/* Country code comes from the picker, so the value reaching
                      the backend is always E.164 and never a locally formatted
                      number the messaging channel would reject. */}
                  <PhoneNumberInput size="middle" placeholder="501234567" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="nationality"
                  label={t("jobOffers.field.nationality")}
                >
                  <NationalitySelect
                    placeholder={t("jobOffers.form.nationalityPlaceholder")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="date_of_birth"
                  label={t("jobOffers.field.dateOfBirth")}
                >
                  <DatePicker
                    style={{ width: "100%" }}
                    format={DATE_FORMAT}
                    disabledDate={(current) =>
                      current && current.isAfter(dayjs(), "day")
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="id_passport_iqama_number"
                  label={t("jobOffers.field.idNumber")}
                >
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </SectionCard>

          <SectionCard title={t("jobOffers.form.section.cv")}>
            {offer?.has_cv && !cvFile && (
              <Alert
                type="success"
                showIcon
                message={t("jobOffers.form.cvAlreadyAttached")}
                style={{ borderRadius: 12, marginBottom: 16 }}
              />
            )}
            <Upload.Dragger
              name="cv_file"
              accept={CV_ACCEPT}
              maxCount={1}
              fileList={fileList}
              // Selection is held locally and sent with the form, so nothing is
              // uploaded until HR actually saves.
              beforeUpload={(file) => {
                const check = isAllowedCvFile(file);
                if (!check.ok) {
                  setCvError(
                    check.reason === "size"
                      ? t("jobOffers.form.cvTooLarge")
                      : t("jobOffers.form.cvWrongType"),
                  );
                  return Upload.LIST_IGNORE;
                }
                setCvError(null);
                setCvFile(file);
                setFileList([
                  { uid: file.name, name: file.name, status: "done" },
                ]);
                return false;
              }}
              onRemove={() => {
                setCvFile(null);
                setFileList([]);
                return true;
              }}
            >
              <p className="ant-upload-drag-icon" style={{ marginBottom: 8 }}>
                <InboxOutlined aria-hidden style={{ color: "#f97316" }} />
              </p>
              <p style={{ fontWeight: 600, color: "#0f172a", margin: 0 }}>
                {t("jobOffers.form.cvDropzone")}
              </p>
              <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
                {t("jobOffers.form.cvHint")}
              </p>
            </Upload.Dragger>
            {cvError && (
              <div
                role="alert"
                style={{ color: "#dc2626", marginTop: 10, fontSize: 13 }}
              >
                {cvError}
              </div>
            )}
          </SectionCard>

          <SectionCard title={t("jobOffers.form.section.job")}>
            {referenceEmpty && (
              <Alert
                type="warning"
                showIcon
                style={{ borderRadius: 12, marginBottom: 16 }}
                message={t("jobOffers.reference.emptyTitle")}
                description={
                  <div>
                    <div style={{ marginBottom: 12 }}>
                      {departments.length === 0 && positions.length === 0
                        ? t("jobOffers.reference.emptyBoth")
                        : departments.length === 0
                          ? t("jobOffers.reference.emptyDepartments")
                          : t("jobOffers.reference.emptyPositions")}
                    </div>
                    <Space size={8} wrap>
                      {departments.length === 0 && (
                        <Button
                          onClick={() => navigate("/hr/departments")}
                          style={{ borderRadius: 10, fontWeight: 600 }}
                        >
                          {t("jobOffers.reference.goToDepartments")}
                        </Button>
                      )}
                      {positions.length === 0 && (
                        <Button
                          onClick={() => navigate("/hr/positions")}
                          style={{ borderRadius: 10, fontWeight: 600 }}
                        >
                          {t("jobOffers.reference.goToPositions")}
                        </Button>
                      )}
                    </Space>
                  </div>
                }
              />
            )}
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="position_id"
                  label={t("jobOffers.field.position")}
                  extra={t("jobOffers.form.referenceHint")}
                  rules={[
                    {
                      required: true,
                      message: t("jobOffers.validation.positionRequired"),
                    },
                  ]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={referenceLoading}
                    options={positionOptions}
                    placeholder={t("jobOffers.form.positionPlaceholder")}
                    notFoundContent={t("jobOffers.reference.emptyPositions")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="department_id"
                  label={t("jobOffers.field.departmentRef")}
                  extra={t("jobOffers.form.referenceHint")}
                  rules={[
                    {
                      required: true,
                      message: t("jobOffers.validation.departmentRequired"),
                    },
                  ]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={referenceLoading}
                    options={departmentOptions}
                    placeholder={t("jobOffers.form.departmentPlaceholder")}
                    notFoundContent={t("jobOffers.reference.emptyDepartments")}
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
            </Row>
          </SectionCard>

          <SectionCard title={t("jobOffers.form.section.compensation")}>
            <Row gutter={16}>
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
                    initialValue={0}
                    rules={[
                      {
                        type: "number",
                        min: 0,
                        message: t("jobOffers.validation.negativeAmount"),
                      },
                    ]}
                  >
                    <InputNumber min={0} step={100} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              ))}
            </Row>

            <div
              style={{
                marginTop: 4,
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
              <div>
                <div style={{ fontWeight: 700, color: "#0f172a" }}>
                  {t("jobOffers.field.totalPackage")}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t("jobOffers.form.totalHint")}
                </Text>
              </div>
              <Space size={6} aria-label={t("jobOffers.field.totalPackage")}>
                <span
                  style={{ fontSize: 22, fontWeight: 800, color: "#c2410c" }}
                >
                  {formatNumber(totalPackage)}
                </span>
                <SARIcon size={18} color="#c2410c" />
              </Space>
            </div>
          </SectionCard>

          <SectionCard title={t("jobOffers.form.section.benefits")}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="vacation"
                  label={t("jobOffers.field.vacation")}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="tickets" label={t("jobOffers.field.tickets")}>
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
            </Row>
          </SectionCard>

          <SectionCard title={t("jobOffers.form.section.metadata")}>
            <Alert
              type="info"
              showIcon
              message={t("jobOffers.form.automationHint")}
              style={{ marginBottom: 18, borderRadius: 12 }}
            />
            <Row gutter={16}>
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
                  <DatePicker style={{ width: "100%" }} format={DATE_FORMAT} />
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
                      validator: async (_rule, value: Dayjs | undefined) => {
                        const offerDate = form.getFieldValue("offer_date") as
                          | Dayjs
                          | undefined;
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
                  <DatePicker style={{ width: "100%" }} format={DATE_FORMAT} />
                </Form.Item>
              </Col>
            </Row>
          </SectionCard>

          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <Button
              onClick={() =>
                navigate(
                  isEdit ? `/hr/job-offers/${offerId}` : "/hr/job-offers",
                )
              }
              style={{ borderRadius: 10, minHeight: 42 }}
            >
              {t("jobOffers.form.discard")}
            </Button>
            <Button
              icon={<SaveOutlined aria-hidden />}
              loading={saving === "draft"}
              onClick={handleSave}
              // Nothing valid can be saved until the company has the reference
              // records the backend insists on.
              disabled={referenceEmpty}
              style={{ borderRadius: 10, minHeight: 42, fontWeight: 600 }}
            >
              {isEdit
                ? t("jobOffers.form.saveChanges")
                : t("jobOffers.form.saveDraft")}
            </Button>
            {submitAvailable && (
              <Button
                type="primary"
                icon={<SendOutlined aria-hidden />}
                loading={saving === "submit"}
                onClick={handleSubmitToCeo}
                disabled={referenceEmpty}
                style={{
                  borderRadius: 10,
                  minHeight: 42,
                  fontWeight: 600,
                  paddingInline: 24,
                }}
              >
                {t("jobOffers.form.submitToCeo")}
              </Button>
            )}
          </div>
        </Form>
      )}
    </div>
  );
}
