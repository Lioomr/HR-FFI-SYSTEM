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
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { ArrowLeftOutlined, InboxOutlined, SaveOutlined, SendOutlined } from "@ant-design/icons";

import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import PhoneNumberInput from "../../../components/ui/PhoneNumberInput";
import NationalitySelect from "../../../components/ui/NationalitySelect";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden, isValidationError } from "../../../services/api/httpErrors";
import {
  CV_ACCEPT,
  createHiringRequest,
  getHiringRequest,
  submitHiringRequest,
  updateHiringRequest,
  type HiringRequest,
  type HiringRequestPayload,
} from "../../../services/api/hiringRequestsApi";
import { useAuthStore } from "../../../auth/authStore";
import { getActiveOrganization } from "../../../utils/organizationContext";
import { useI18n } from "../../../i18n/useI18n";
import { apply422ToForm, getFirstApiErrorMessage } from "../../../utils/formErrors";
import { isAllowedCvFile } from "./hiringRequestRules";

const { Text } = Typography;

const DATE_FORMAT = "YYYY-MM-DD";
const E164 = /^\+[1-9]\d{7,14}$/;

type HiringRequestFormValues = {
  candidate_full_name: string;
  candidate_email?: string;
  candidate_phone_number?: string;
  nationality?: string;
  date_of_birth?: Dayjs;
  proposed_salary?: number;
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span
          style={{
            width: 4,
            height: 20,
            borderRadius: 4,
            background: "linear-gradient(180deg, #f97316, #fb923c)",
          }}
        />
        <Typography.Title level={5} style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>
          {title}
        </Typography.Title>
      </div>
      {children}
    </div>
  );
}

export default function HiringRequestFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const requestId = params.id;
  const isEdit = Boolean(requestId);
  const [form] = Form.useForm<HiringRequestFormValues>();
  const [messageApi, messageContext] = message.useMessage();

  const user = useAuthStore((state) => state.user);
  const activeOrganization = getActiveOrganization(user);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [request, setRequest] = useState<HiringRequest | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [cvError, setCvError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await getHiringRequest(requestId!);
        if (isApiError(response)) {
          setLoadError(response.message || t("hiringRequests.detail.loadFailed"));
          return;
        }
        const data = response.data;
        setRequest(data);
        form.setFieldsValue({
          candidate_full_name: data.candidate_full_name,
          candidate_email: data.candidate_email,
          candidate_phone_number: data.candidate_phone_number,
          nationality: data.nationality,
          date_of_birth: data.date_of_birth ? dayjs(data.date_of_birth) : undefined,
          proposed_salary: Number(data.proposed_salary) || 0,
        } as HiringRequestFormValues);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setLoadError((err as Error)?.message || t("hiringRequests.detail.loadFailed"));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [isEdit, requestId, form, t]);

  const companyName = useMemo(
    () => request?.company_name || activeOrganization?.name || "—",
    [request, activeOrganization],
  );

  const buildPayload = useCallback(
    (values: HiringRequestFormValues): HiringRequestPayload => ({
      candidate_full_name: values.candidate_full_name?.trim(),
      candidate_email: values.candidate_email?.trim() || "",
      candidate_phone_number: values.candidate_phone_number?.trim() || "",
      nationality: values.nationality?.trim() || "",
      ...(values.date_of_birth ? { date_of_birth: values.date_of_birth.format(DATE_FORMAT) } : {}),
      proposed_salary: String(values.proposed_salary ?? 0),
      ...(cvFile ? { cv_file: cvFile } : {}),
    }),
    [cvFile],
  );

  /** Saves the draft and hands back the id, so Submit can chain onto a create. */
  const persist = useCallback(
    async (values: HiringRequestFormValues): Promise<number | null> => {
      const payload = buildPayload(values);
      const response = isEdit
        ? await updateHiringRequest(requestId!, payload)
        : await createHiringRequest(payload);
      if (isApiError(response)) {
        setServerError(response.message || t("hiringRequests.form.saveFailed"));
        return null;
      }
      return response.data.id;
    },
    [buildPayload, isEdit, requestId, t],
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

  const handleSaveDraft = useCallback(async () => {
    setServerError(null);
    let values: HiringRequestFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving("draft");
    try {
      const id = await persist(values);
      if (id === null) return;
      messageApi.success(isEdit ? t("hiringRequests.form.updated") : t("hiringRequests.form.created"));
      navigate(`/hr/hiring-requests/${id}`);
    } catch (err: unknown) {
      handleFailure(err, "hiringRequests.form.saveFailed");
    } finally {
      setSaving(null);
    }
  }, [form, persist, messageApi, isEdit, navigate, t, handleFailure]);

  const handleSubmitToCeo = useCallback(async () => {
    setServerError(null);
    setCvError(null);
    let values: HiringRequestFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // The backend refuses submission without a CV, so say so here rather than
    // saving a draft and then failing on the second call.
    if (!cvFile && !request?.has_cv) {
      setCvError(t("hiringRequests.form.cvRequiredForSubmit"));
      return;
    }
    setSaving("submit");
    try {
      const id = await persist(values);
      if (id === null) return;
      const response = await submitHiringRequest(id);
      if (isApiError(response)) {
        setServerError(response.message || t("hiringRequests.submit.failed"));
        return;
      }
      messageApi.success(t("hiringRequests.submit.success"));
      navigate(`/hr/hiring-requests/${id}`);
    } catch (err: unknown) {
      handleFailure(err, "hiringRequests.submit.failed");
    } finally {
      setSaving(null);
    }
  }, [form, cvFile, request, persist, messageApi, navigate, t, handleFailure]);

  if (forbidden) return <Unauthorized403Page />;

  const editingBlocked = isEdit && request !== null && !request.workflow?.can_edit;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: 32 }}>
      {messageContext}

      <PageHeader
        title={isEdit ? t("hiringRequests.form.editTitle") : t("hiringRequests.form.createTitle")}
        subtitle={isEdit ? t("hiringRequests.form.editSubtitle") : t("hiringRequests.form.createSubtitle")}
        breadcrumb={t("hiringRequests.title")}
        actions={
          <Button
            icon={<ArrowLeftOutlined aria-hidden />}
            onClick={() => navigate("/hr/hiring-requests")}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {t("hiringRequests.action.backToList")}
          </Button>
        }
      />

      {loading ? (
        <LoadingState title={t("loading.generic")} lines={8} />
      ) : loadError ? (
        <Alert type="error" showIcon message={loadError} style={{ borderRadius: 12 }} />
      ) : (
        <Form<HiringRequestFormValues>
          form={form}
          layout="vertical"
          requiredMark
          disabled={editingBlocked}
        >
          {editingBlocked && (
            <Alert
              type="warning"
              showIcon
              message={t("hiringRequests.form.notEditable")}
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

          <SectionCard title={t("hiringRequests.form.section.candidate")}>
            <div
              style={{
                marginBottom: 18,
                padding: "12px 16px",
                borderRadius: 12,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                {t("hiringRequests.field.joiningCompany")}
              </Text>
              <Text strong style={{ fontSize: 15, color: "#0f172a" }}>
                {companyName}
              </Text>
            </div>

            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="candidate_full_name"
                  label={t("hiringRequests.field.candidateFullName")}
                  rules={[{ required: true, message: t("hiringRequests.validation.required") }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="candidate_email"
                  label={t("hiringRequests.field.candidateEmail")}
                  rules={[{ type: "email", message: t("hiringRequests.validation.emailInvalid") }]}
                >
                  <Input inputMode="email" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="candidate_phone_number"
                  label={t("hiringRequests.field.candidatePhone")}
                  rules={[{ pattern: E164, message: t("hiringRequests.validation.phoneInvalid") }]}
                >
                  <PhoneNumberInput size="middle" placeholder="501234567" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="nationality" label={t("hiringRequests.field.nationality")}>
                  <NationalitySelect placeholder={t("hiringRequests.form.nationalityPlaceholder")} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="date_of_birth" label={t("hiringRequests.field.dateOfBirth")}>
                  <DatePicker
                    style={{ width: "100%" }}
                    format={DATE_FORMAT}
                    disabledDate={(current) => current && current.isAfter(dayjs(), "day")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="proposed_salary"
                  label={t("hiringRequests.field.proposedSalary")}
                  initialValue={0}
                  rules={[
                    { type: "number", min: 0, message: t("hiringRequests.validation.negativeAmount") },
                  ]}
                >
                  <InputNumber min={0} step={500} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
          </SectionCard>

          <SectionCard title={t("hiringRequests.form.section.cv")}>
            {request?.has_cv && !cvFile && (
              <Alert
                type="success"
                showIcon
                message={t("hiringRequests.form.cvAlreadyAttached")}
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
                      ? t("hiringRequests.form.cvTooLarge")
                      : t("hiringRequests.form.cvWrongType"),
                  );
                  return Upload.LIST_IGNORE;
                }
                setCvError(null);
                setCvFile(file);
                setFileList([{ uid: file.name, name: file.name, status: "done" }]);
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
                {t("hiringRequests.form.cvDropzone")}
              </p>
              <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
                {t("hiringRequests.form.cvHint")}
              </p>
            </Upload.Dragger>
            {cvError && (
              <div role="alert" style={{ color: "#dc2626", marginTop: 10, fontSize: 13 }}>
                {cvError}
              </div>
            )}
          </SectionCard>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button
              onClick={() => navigate(isEdit ? `/hr/hiring-requests/${requestId}` : "/hr/hiring-requests")}
              style={{ borderRadius: 10, minHeight: 42 }}
            >
              {t("hiringRequests.form.discard")}
            </Button>
            <Button
              icon={<SaveOutlined aria-hidden />}
              loading={saving === "draft"}
              onClick={handleSaveDraft}
              style={{ borderRadius: 10, minHeight: 42, fontWeight: 600 }}
            >
              {t("hiringRequests.form.saveDraft")}
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined aria-hidden />}
              loading={saving === "submit"}
              onClick={handleSubmitToCeo}
              style={{ borderRadius: 10, minHeight: 42, fontWeight: 600, paddingInline: 24 }}
            >
              {t("hiringRequests.form.submitToCeo")}
            </Button>
          </div>
        </Form>
      )}
    </div>
  );
}
