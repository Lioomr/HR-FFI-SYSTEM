import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { FileSearchOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

import {
  PROFILE_CHANGE_ACCEPT,
  PROFILE_CHANGE_DATE_FIELDS,
  PROFILE_CHANGE_MAX_SIZE_MB,
  getProfileChangeAttachment,
  isExtractionTerminal,
  profileChangeFieldLabelKey,
  submitProfileChangeRequest,
  uploadProfileChangeAttachment,
  validateProfileChangeFile,
  type ProfileChangeAttachment,
  type ProfileChangeDocumentType,
  type ProfileChangeField,
} from "../../services/api/employeeProfileChangeRequestsApi";
import type { Employee } from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../services/api/httpErrors";
import { apply422ToForm } from "../../utils/formErrors";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

export const OCR_POLL_INTERVAL_MS = 1500;
export const OCR_POLL_TIMEOUT_MS = 60000;

type ValueField = Exclude<
  ProfileChangeField,
  "passport_file" | "national_id_file"
>;
type FormValues = Partial<Record<ValueField, string | Dayjs | null>>;

const PERSONAL_FIELDS: ValueField[] = [
  "full_name",
  "date_of_birth",
  "nationality",
  "email",
  "mobile",
];
const DOCUMENT_FIELDS: Record<ProfileChangeDocumentType, ValueField[]> = {
  PASSPORT: ["passport_no", "passport_issue_date", "passport_expiry"],
  SAUDI_ID: ["national_id", "id_expiry"],
};
const VALUE_FIELDS: ValueField[] = [
  ...PERSONAL_FIELDS,
  ...DOCUMENT_FIELDS.PASSPORT,
  ...DOCUMENT_FIELDS.SAUDI_ID,
];
const isDateField = (field: string) =>
  PROFILE_CHANGE_DATE_FIELDS.includes(field as ProfileChangeField);

const REJECTION_KEYS = {
  type: "profileChange.invalidType",
  size: "profileChange.invalidSize",
  empty: "profileChange.invalidEmpty",
} as const;

type DocState = {
  filename?: string;
  attachment?: ProfileChangeAttachment;
  reading?: boolean;
  /** Set when OCR produced nothing usable; the employee types the values. */
  manual?: "failed" | "timeout";
};

export type ProfileChangeFocus = "passport" | "national_id";

/** The employee's current values, as plain strings (dates YYYY-MM-DD). */
function baselineOf(employee: Employee): Record<ValueField, string> {
  const source = employee as Employee & Record<string, unknown>;
  const read = (key: string) =>
    typeof source[key] === "string" ? (source[key] as string).trim() : "";
  const base = {} as Record<ValueField, string>;
  for (const field of VALUE_FIELDS) {
    const value =
      field === "passport_no"
        ? read("passport_no") || read("passport")
        : read(field);
    base[field] = isDateField(field) ? value.slice(0, 10) : value;
  }
  return base;
}

function toFormValue(field: string, value: string) {
  if (!isDateField(field)) return value;
  const parsed = value ? dayjs(value) : null;
  return parsed?.isValid() ? parsed : null;
}

function toText(value: FormValues[ValueField]) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return value.format("YYYY-MM-DD");
}

/**
 * One "request a change" form for personal details and passport / national
 * ID data. Uploading a document lets the server read it (OCR) and suggest
 * values; suggestions stay editable and nothing applies until HR decides.
 */
export default function ProfileChangeRequestForm({
  open,
  employee,
  focus,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  employee: Employee;
  focus?: ProfileChangeFocus;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useI18n();
  const [messageApi, messageContext] = message.useMessage();
  const [form] = Form.useForm<FormValues>();
  const [docs, setDocs] = useState<
    Partial<Record<ProfileChangeDocumentType, DocState>>
  >({});
  const [ocrFields, setOcrFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // Bumped on every open/close so a poll from an earlier session stops.
  const session = useRef(0);
  const timers = useRef<number[]>([]);

  const stopPolling = () => {
    session.current += 1;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => {
    if (!open) return undefined;
    const baseline = baselineOf(employee);
    form.resetFields();
    form.setFieldsValue(
      Object.fromEntries(
        VALUE_FIELDS.map((field) => [
          field,
          toFormValue(field, baseline[field]),
        ]),
      ) as FormValues,
    );
    setDocs({});
    setOcrFields({});
    if (focus) {
      window.setTimeout(() => {
        document
          .getElementById(`profile-change-${focus}`)
          ?.scrollIntoView?.({ block: "start" });
      }, 0);
    }
    return stopPolling;
  }, [open, employee, focus, form]);

  const patchDoc = (type: ProfileChangeDocumentType, patch: DocState) =>
    setDocs((current) => ({
      ...current,
      [type]: { ...current[type], ...patch },
    }));

  const applySuggestions = (
    type: ProfileChangeDocumentType,
    attachment: ProfileChangeAttachment,
  ) => {
    const suggested = Object.entries(attachment.suggested ?? {}).filter(
      ([field, value]) =>
        VALUE_FIELDS.includes(field as ValueField) &&
        typeof value === "string" &&
        value.trim() !== "",
    ) as [ValueField, string][];
    const status = (attachment.extraction_status || "").toLowerCase();
    if (!suggested.length || status === "failed") {
      patchDoc(type, { attachment, reading: false, manual: "failed" });
      return;
    }
    form.setFieldsValue(
      Object.fromEntries(
        suggested.map(([field, value]) => [field, toFormValue(field, value)]),
      ) as FormValues,
    );
    setOcrFields((current) => ({
      ...current,
      ...Object.fromEntries(
        suggested.map(([field, value]) => [
          field,
          toText(toFormValue(field, value) as FormValues[ValueField]),
        ]),
      ),
    }));
    patchDoc(type, { attachment, reading: false, manual: undefined });
  };

  const poll = (
    type: ProfileChangeDocumentType,
    id: number,
    deadline: number,
    token: number,
  ) => {
    const timer = window.setTimeout(async () => {
      if (token !== session.current) return;
      try {
        const response = await getProfileChangeAttachment(id);
        if (token !== session.current) return;
        if (
          !isApiError(response) &&
          isExtractionTerminal(response.data.extraction_status)
        ) {
          applySuggestions(type, response.data);
          return;
        }
      } catch {
        // A transient poll error is retried until the deadline.
      }
      if (token !== session.current) return;
      if (Date.now() >= deadline) {
        patchDoc(type, { reading: false, manual: "timeout" });
        return;
      }
      poll(type, id, deadline, token);
    }, OCR_POLL_INTERVAL_MS);
    timers.current.push(timer);
  };

  const upload = async (type: ProfileChangeDocumentType, file: File) => {
    const token = session.current;
    patchDoc(type, {
      filename: file.name,
      attachment: undefined,
      reading: true,
      manual: undefined,
    });
    try {
      const response = await uploadProfileChangeAttachment(type, file);
      if (token !== session.current) return;
      if (isApiError(response)) {
        patchDoc(type, { filename: undefined, reading: false });
        messageApi.error(response.message || t("profileChange.uploadFailed"));
        return;
      }
      const attachment = response.data;
      if (isExtractionTerminal(attachment.extraction_status)) {
        applySuggestions(type, attachment);
      } else {
        patchDoc(type, { attachment });
        poll(type, attachment.id, Date.now() + OCR_POLL_TIMEOUT_MS, token);
      }
    } catch (error) {
      if (token !== session.current) return;
      patchDoc(type, { filename: undefined, reading: false });
      messageApi.error(
        getHttpErrorMessage(error) || t("profileChange.uploadFailed"),
      );
    }
  };

  const submit = async (values: FormValues) => {
    const baseline = baselineOf(employee);
    const items: Partial<Record<ProfileChangeField, string>> = {};
    for (const field of VALUE_FIELDS) {
      const value = toText(values[field]);
      if (value && value !== baseline[field]) items[field] = value;
    }
    const attachmentIds = Object.values(docs)
      .map((doc) => doc?.attachment?.id)
      .filter((id): id is number => typeof id === "number");
    if (!Object.keys(items).length && !attachmentIds.length) {
      messageApi.error(t("profileChange.nothingChanged"));
      return;
    }
    setSubmitting(true);
    try {
      const response = await submitProfileChangeRequest({
        items,
        attachment_ids: attachmentIds,
      });
      if (isApiError(response)) {
        messageApi.error(response.message || t("profileChange.submitFailed"));
        return;
      }
      messageApi.success(t("profileChange.submitted"));
      stopPolling();
      onSubmitted();
    } catch (error) {
      apply422ToForm(form, error);
      messageApi.error(
        getHttpErrorMessage(error) || t("profileChange.submitFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const reading = Object.values(docs).some((doc) => doc?.reading);

  const label = (field: ValueField) => (
    <Space size={6} wrap>
      <span>{t(profileChangeFieldLabelKey(field))}</span>
      <Form.Item
        noStyle
        shouldUpdate={(prev, next) => prev[field] !== next[field]}
      >
        {({ getFieldValue }) =>
          ocrFields[field] &&
          toText(getFieldValue(field)) === ocrFields[field] ? (
            <Tag color="purple" icon={<FileSearchOutlined />}>
              {t("profileChange.readFromDocument")}
            </Tag>
          ) : null
        }
      </Form.Item>
    </Space>
  );

  const input = (field: ValueField) => (
    <Form.Item
      key={field}
      name={field}
      label={label(field)}
      rules={
        field === "email"
          ? [{ type: "email", message: t("profileChange.invalidEmail") }]
          : undefined
      }
    >
      {isDateField(field) ? (
        <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
      ) : (
        <Input maxLength={field === "full_name" ? 200 : 100} />
      )}
    </Form.Item>
  );

  const documentSection = (
    type: ProfileChangeDocumentType,
    anchor: ProfileChangeFocus,
  ) => {
    const doc = docs[type] ?? {};
    return (
      <Card
        id={`profile-change-${anchor}`}
        size="small"
        title={t(
          type === "PASSPORT" ? "profile.passport" : "profile.nationalId",
        )}
        style={{ marginBottom: 12 }}
      >
        <Form.Item
          label={t("profileChange.documentFile")}
          extra={t("profileChange.fileRules", {
            max: PROFILE_CHANGE_MAX_SIZE_MB,
          })}
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Upload
              accept={PROFILE_CHANGE_ACCEPT}
              maxCount={1}
              showUploadList={false}
              disabled={doc.reading}
              beforeUpload={(file) => {
                const rejection = validateProfileChangeFile(file);
                if (rejection) {
                  messageApi.error(t(REJECTION_KEYS[rejection]));
                  return Upload.LIST_IGNORE;
                }
                void upload(type, file);
                // The API service owns the request; never auto-post.
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} disabled={doc.reading}>
                {t(
                  type === "PASSPORT"
                    ? "profileChange.uploadPassport"
                    : "profileChange.uploadNationalId",
                )}
              </Button>
            </Upload>
            {doc.filename ? <Text type="secondary">{doc.filename}</Text> : null}
            {doc.reading ? (
              <Space size={8}>
                <Spin size="small" />
                <Text>{t("profileChange.reading")}</Text>
              </Space>
            ) : null}
            {doc.manual ? (
              <Alert
                type="warning"
                showIcon
                title={t(
                  doc.manual === "timeout"
                    ? "profileChange.readTimeout"
                    : "profileChange.readFailed",
                )}
              />
            ) : null}
            {/* "partial" means the read passed only some checks: ask the
                employee to verify every value even without warnings. */}
            {doc.attachment &&
            !doc.reading &&
            !doc.manual &&
            (doc.attachment.warnings?.length ||
              doc.attachment.extraction_status === "partial") ? (
              <Alert
                type="info"
                showIcon
                title={t("profileChange.checkValues")}
                description={
                  doc.attachment.warnings?.length ? (
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {doc.attachment.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : undefined
                }
              />
            ) : null}
          </Space>
        </Form.Item>
        {DOCUMENT_FIELDS[type].map(input)}
      </Card>
    );
  };

  return (
    <Modal
      open={open}
      title={t("profileChange.title")}
      okText={t("common.submit")}
      cancelText={t("common.cancel")}
      confirmLoading={submitting}
      okButtonProps={{ disabled: reading }}
      onOk={() => form.submit()}
      onCancel={() => {
        stopPolling();
        onClose();
      }}
      width={640}
      destroyOnHidden
    >
      {messageContext}
      <Alert
        type="info"
        showIcon
        title={t("profileChange.hrReviewHint")}
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" onFinish={submit} preserve>
        <Typography.Title level={5}>
          {t("profileChange.personalSection")}
        </Typography.Title>
        {PERSONAL_FIELDS.map(input)}
        <Typography.Title level={5}>
          {t("profileChange.documentsSection")}
        </Typography.Title>
        {documentSection("PASSPORT", "passport")}
        {documentSection("SAUDI_ID", "national_id")}
      </Form>
    </Modal>
  );
}
