import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { ArrowLeftOutlined, SaveOutlined } from "@ant-design/icons";

import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import PhoneNumberInput from "../../../components/ui/PhoneNumberInput";
import NationalitySelect from "../../../components/ui/NationalitySelect";
import HiringRequestSourcePanel from "../../../components/hiringRequests/HiringRequestSourcePanel";
import SARIcon from "../../../components/icons/SARIcon";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import {
  isForbidden,
  isValidationError,
} from "../../../services/api/httpErrors";
import {
  listEmployees,
  type Employee,
} from "../../../services/api/employeesApi";
import {
  listDepartments,
  type Department,
} from "../../../services/api/departmentsApi";
import {
  listPositions,
  type Position,
} from "../../../services/api/positionsApi";
import {
  createJobOffer,
  getJobOffer,
  updateJobOffer,
  type JobOffer,
  type JobOfferPayload,
} from "../../../services/api/jobOffersApi";
import {
  downloadHiringRequestCv,
  getHiringRequest,
  type HiringRequest,
} from "../../../services/api/hiringRequestsApi";
import { triggerBlobDownload } from "../../../services/api/downloads";
import { useI18n } from "../../../i18n/useI18n";
import {
  apply422ToForm,
  getFirstApiErrorMessage,
} from "../../../utils/formErrors";
import { formatNumber } from "../../../utils/currency";
import { AMOUNT_FIELDS, calculateTotalPackage } from "./jobOfferRules";

const { Text } = Typography;

const DATE_FORMAT = "YYYY-MM-DD";
const E164 = /^\+[1-9]\d{7,14}$/;

type JobOfferFormValues = {
  employee_profile_id?: number | null;
  candidate_full_name: string;
  candidate_email?: string;
  candidate_phone_number?: string;
  nationality?: string;
  id_passport_iqama_number?: string;
  /** Reference ids; only hiring-request offers carry them. */
  department_id?: number;
  position_id?: number;
  position_title: string;
  classification?: string;
  department?: string;
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
  const [searchParams] = useSearchParams();
  const offerId = params.id;
  const isEdit = Boolean(offerId);
  // A new offer only exists as the conversion of an approved hiring request;
  // the backend rejects a create without one.
  const hiringRequestId = (searchParams.get("hiring_request_id") || "").trim();
  const fromRequest = !isEdit && Boolean(hiringRequestId);
  const [form] = Form.useForm<JobOfferFormValues>();
  const [messageApi, messageContext] = message.useMessage();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [offer, setOffer] = useState<JobOffer | null>(null);
  const [profiles, setProfiles] = useState<Employee[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceLoaded, setReferenceLoaded] = useState(false);
  const [hiringRequest, setHiringRequest] = useState<HiringRequest | null>(null);
  const [downloadingCv, setDownloadingCv] = useState(false);

  /**
   * The linked request id, whether it arrived on the create URL or is already
   * recorded on the offer being edited.
   */
  const sourceRequestId = fromRequest
    ? hiringRequestId
    : offer?.hiring_request_id != null
      ? String(offer.hiring_request_id)
      : "";

  /**
   * True while a hiring request owns the candidate identity and basic salary.
   *
   * On create the backend re-copies those fields from the request; on a PATCH
   * it rejects them outright with a 422. Either way they must not be sent, and
   * showing them as inputs would promise an edit that cannot happen.
   */
  const sourceControlled = Boolean(sourceRequestId);

  const watched = Form.useWatch([], form);
  const totalPackage = useMemo(
    () => calculateTotalPackage(watched || {}),
    [watched],
  );

  useEffect(() => {
    if (!fromRequest) return;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await getHiringRequest(hiringRequestId);
        if (isApiError(response)) {
          setLoadError(response.message || t("jobOffers.source.loadFailed"));
          return;
        }
        const data = response.data;
        if (data.status !== "approved") {
          setLoadError(t("jobOffers.source.notApproved"));
          return;
        }
        setHiringRequest(data);
        // Seeded for display and for the package total; the backend re-copies
        // these from the request, so what is sent here does not decide them.
        form.setFieldsValue({
          candidate_full_name: data.candidate_full_name,
          candidate_email: data.candidate_email,
          candidate_phone_number: data.candidate_phone_number,
          nationality: data.nationality,
          basic_salary: Number(data.proposed_salary) || 0,
        } as Partial<JobOfferFormValues> as JobOfferFormValues);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setLoadError((err as Error)?.message || t("jobOffers.source.loadFailed"));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [fromRequest, hiringRequestId, form, t]);

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
        if (data.hiring_request_id != null) {
          // Needed for the source panel; a failure here must not block editing
          // the offer terms, so the panel is simply omitted.
          try {
            const source = await getHiringRequest(data.hiring_request_id);
            if (!isApiError(source)) setHiringRequest(source.data);
          } catch {
            setHiringRequest(null);
          }
        }
        form.setFieldsValue({
          employee_profile_id: data.employee_profile_id ?? null,
          department_id: data.department_id ?? undefined,
          position_id: data.position_id ?? undefined,
          candidate_full_name: data.candidate_full_name,
          candidate_email: data.candidate_email,
          candidate_phone_number: data.candidate_phone_number,
          nationality: data.nationality,
          id_passport_iqama_number: data.id_passport_iqama_number,
          position_title: data.position_title,
          classification: data.classification,
          department: data.department,
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

  const loadProfiles = useCallback(async (search?: string) => {
    setProfilesLoading(true);
    try {
      const response = await listEmployees({
        page: 1,
        page_size: 20,
        ...(search ? { search } : {}),
      });
      if (!isApiError(response)) setProfiles(response.data.results || []);
    } catch {
      // A missing pre-hire list must not block writing the offer by hand.
      setProfiles([]);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  // A hiring-request offer gets its profile from the backend, which creates the
  // pre-hire record itself. Searching for one by hand would only offer a link
  // the API ignores on create and rejects with a 422 on a PATCH.
  useEffect(() => {
    if (sourceControlled) return;
    void loadProfiles();
  }, [loadProfiles, sourceControlled]);

  const profileOptions = useMemo(
    () =>
      profiles.map((employee) => ({
        value: employee.id,
        label: `${employee.full_name_en || employee.full_name || employee.employee_id}${
          employee.employee_id ? ` — ${employee.employee_id}` : ""
        }`,
      })),
    [profiles],
  );

  /**
   * Department and position on a hiring-request offer are company HR reference
   * records, not free text: the backend validates the ids and derives the
   * display text from them.
   */
  useEffect(() => {
    if (!sourceControlled) return;
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
  }, [sourceControlled]);

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
    sourceControlled &&
    referenceLoaded &&
    (departments.length === 0 || positions.length === 0);

  const buildPayload = useCallback(
    (values: JobOfferFormValues): JobOfferPayload => {
      // Offer terms: always writable, on both a create and a PATCH.
      const payload: JobOfferPayload = {
        id_passport_iqama_number: values.id_passport_iqama_number?.trim() || "",
        classification: values.classification?.trim() || "",
        location: values.location?.trim() || "",
        housing_allowance: String(values.housing_allowance ?? 0),
        transportation_allowance: String(values.transportation_allowance ?? 0),
        other_allowance: String(values.other_allowance ?? 0),
        // Still derived from the real basic salary, which the form holds even
        // when the field itself is read-only.
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

      if (!sourceControlled) {
        // A legacy offer with no linked request owns its own candidate data,
        // its own profile link, and its department/position as free text.
        payload.employee_profile_id = values.employee_profile_id ?? null;
        payload.position_title = values.position_title?.trim();
        payload.department = values.department?.trim() || "";
        payload.candidate_full_name = values.candidate_full_name?.trim();
        payload.candidate_email = values.candidate_email?.trim() || "";
        payload.candidate_phone_number = values.candidate_phone_number?.trim() || "";
        payload.nationality = values.nationality?.trim() || "";
        payload.basic_salary = String(values.basic_salary ?? 0);
        return payload;
      }

      // The reference ids are the whole story here: the backend derives the
      // department and position text from those records, so sending our own
      // copy could only ever disagree with it.
      if (values.department_id != null) payload.department_id = values.department_id;
      if (values.position_id != null) payload.position_id = values.position_id;

      // Creating still has to name the request it converts; a PATCH must not,
      // because the link itself is source-controlled too.
      if (fromRequest) payload.hiring_request_id = Number(hiringRequestId);
      return payload;
    },
    [sourceControlled, fromRequest, hiringRequestId],
  );

  const handleSubmit = useCallback(
    async (values: JobOfferFormValues) => {
      setSaving(true);
      setServerError(null);
      try {
        const payload = buildPayload(values);
        const response = isEdit
          ? await updateJobOffer(offerId!, payload)
          : await createJobOffer(payload);
        if (isApiError(response)) {
          setServerError(response.message || t("jobOffers.form.saveFailed"));
          return;
        }
        messageApi.success(
          isEdit ? t("jobOffers.form.updated") : t("jobOffers.form.created"),
        );
        navigate(`/hr/job-offers/${response.data.id}`);
      } catch (err: unknown) {
        if (isValidationError(err)) {
          apply422ToForm(form, err);
          setServerError(
            getFirstApiErrorMessage(err) || t("jobOffers.form.saveFailed"),
          );
        } else {
          setServerError(
            (err as Error)?.message || t("jobOffers.form.saveFailed"),
          );
        }
      } finally {
        setSaving(false);
      }
    },
    [buildPayload, isEdit, offerId, form, messageApi, navigate, t],
  );

  // Either channel alone is enough; the backend refuses to send with neither.
  const validateContact = useCallback(async () => {
    const email = (form.getFieldValue("candidate_email") || "").trim();
    const phone = (form.getFieldValue("candidate_phone_number") || "").trim();
    if (!email && !phone)
      throw new Error(t("jobOffers.validation.contactRequired"));
  }, [form, t]);

  const handleCvDownload = useCallback(async () => {
    if (!sourceRequestId) return;
    setDownloadingCv(true);
    try {
      const blob = await downloadHiringRequestCv(sourceRequestId);
      triggerBlobDownload(blob, `hiring_request_${sourceRequestId}_cv`);
    } catch (err: unknown) {
      messageApi.error((err as Error)?.message || t("hiringRequests.cv.failed"));
    } finally {
      setDownloadingCv(false);
    }
  }, [sourceRequestId, messageApi, t]);

  if (forbidden) return <Unauthorized403Page />;

  const editingBlocked = isEdit && offer !== null && offer.status !== "draft";
  // Creating an offer out of thin air is no longer a supported path.
  const missingSourceRequest = !isEdit && !hiringRequestId;

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

      {missingSourceRequest ? (
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 12 }}
          message={t("jobOffers.source.requiredTitle")}
          description={
            <div>
              <div style={{ marginBottom: 12 }}>{t("jobOffers.source.requiredBody")}</div>
              <Button
                type="primary"
                onClick={() => navigate("/hr/hiring-requests")}
                style={{ borderRadius: 10, fontWeight: 600 }}
              >
                {t("jobOffers.source.goToRequests")}
              </Button>
            </div>
          }
        />
      ) : loading ? (
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
          onFinish={handleSubmit}
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

          {sourceControlled && hiringRequest && (
            <HiringRequestSourcePanel
              request={hiringRequest}
              onDownloadCv={handleCvDownload}
              downloadingCv={downloadingCv}
            />
          )}

          <SectionCard title={t("jobOffers.form.section.candidate")}>
            <Row gutter={16}>
              {/* Owned by the linked hiring request: re-copied from it on
                  create, and rejected with a 422 on a PATCH. They are shown in
                  the source panel above instead of as inputs that cannot save. */}
              {!sourceControlled && (
                <>
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
                </>
              )}
              <Col xs={24} md={12}>
                <Form.Item
                  name="id_passport_iqama_number"
                  label={t("jobOffers.field.idNumber")}
                >
                  <Input />
                </Form.Item>
              </Col>
              {/* The backend creates and links the pre-hire profile itself for a
                  hiring-request offer, so there is nothing here to pick. */}
              {!sourceControlled && (
                <Col xs={24} md={12}>
                  <Form.Item
                    name="employee_profile_id"
                    label={t("jobOffers.field.employeeProfile")}
                    extra={t("jobOffers.form.employeeProfileHint")}
                  >
                    <Select
                      allowClear
                      showSearch
                      filterOption={false}
                      loading={profilesLoading}
                      onSearch={(value) => loadProfiles(value)}
                      options={profileOptions}
                      placeholder={t("jobOffers.form.employeeProfilePlaceholder")}
                    />
                  </Form.Item>
                </Col>
              )}
              {sourceControlled && (
                <Col xs={24} md={12}>
                  <Alert
                    type="info"
                    showIcon
                    style={{ borderRadius: 12 }}
                    message={t("jobOffers.form.profileAutomatic")}
                    description={t("jobOffers.form.profileAutomaticHint")}
                  />
                </Col>
              )}
            </Row>
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
              {/* A hiring-request offer names a company reference record; the
                  backend validates the id and writes the display text itself.
                  Legacy offers keep the free text they were written with. */}
              {sourceControlled ? (
                <>
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
                </>
              ) : (
                <>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="position_title"
                      label={t("jobOffers.field.positionTitle")}
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
                      name="department"
                      label={t("jobOffers.field.department")}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                </>
              )}
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
                    <InputNumber
                      min={0}
                      step={100}
                      style={{ width: "100%" }}
                      // Basic salary comes from the approved request; the
                      // backend overwrites whatever is posted here.
                      disabled={sourceControlled && field === "basic_salary"}
                    />
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
              title={t("jobOffers.form.automationHint")}
              style={{ marginBottom: 18 }}
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
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined aria-hidden />}
              loading={saving}
              // Nothing valid can be submitted until the company has the
              // reference records the backend insists on.
              disabled={referenceEmpty}
              style={{
                borderRadius: 10,
                minHeight: 42,
                fontWeight: 600,
                paddingInline: 24,
              }}
            >
              {isEdit
                ? t("jobOffers.form.saveChanges")
                : t("jobOffers.form.saveDraft")}
            </Button>
          </div>
        </Form>
      )}
    </div>
  );
}
