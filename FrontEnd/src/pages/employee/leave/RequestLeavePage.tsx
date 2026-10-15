import BackButton from "../../../components/ui/BackButton";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import {
  Button,
  Card,
  Form,
  Select,
  DatePicker,
  Input,
  Alert,
  notification,
  Upload,
  Row,
  Col,
  Radio,
} from "antd";
import { SendOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";

import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import {
  getLeaveTypes,
  createLeaveRequest,
  editLeaveRequest,
  getLeaveRequest,
  getMyLeaveBalance,
  type EditLeaveRequestPayload,
  type LeaveRequest,
  type LeaveType,
  type LeaveBalance,
} from "../../../services/api/leaveApi";
import {
  getEmployee,
  listDelegationCandidates,
  type DelegationCandidate,
} from "../../../services/api/employeesApi";
import { isApiError } from "../../../services/api/apiTypes";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { getHttpStatus } from "../../../services/api/httpErrors";
import {
  annualLeaveDaysIssueMessage,
  getLeavePageLoadErrorMessage,
  getLeaveValidationErrors,
  isAnnualLeaveCode,
  isEmployeeLeaveDateDisabled,
  readLeaveBalanceFigures,
  validateAnnualLeaveDays,
} from "./leaveRequestValidation";
import { formatDelegationCandidateLabel } from "../../../utils/delegationCandidates";
import { isSaudiEmployee } from "../../../utils/countries";

const { Option } = Select;
const { TextArea } = Input;
const { RangePicker } = DatePicker;
const travelDetailFields = [
  "date_of_rejoin",
  "po_box",
  "full_address",
  "airplane_ticket_payer",
  "airplane_ticket_address",
  "delegated_to",
  "delegation_note",
];

export function LeaveSubmissionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert type="error" title={message} showIcon style={{ marginBottom: 24 }} />
  );
}

/** Form fields a server validation error can be attached to in edit mode. */
const EDITABLE_FORM_FIELDS = [
  "leave_type",
  "reason",
  "will_travel",
  "will_require_visa",
  "other_leave_description",
  "date_of_rejoin",
  "po_box",
  "full_address",
  "airplane_ticket_payer",
  "airplane_ticket_address",
  "delegation_note",
  "document",
];

/**
 * Create form, also used (mode="edit") to edit the signed-in employee's own
 * request until it reaches HR. The server decides editability (`can_edit`).
 */
export default function RequestLeavePage({
  mode = "create",
}: {
  mode?: "create" | "edit";
}) {
  const isEdit = mode === "edit";
  const { id: requestId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [editRequest, setEditRequest] = useState<LeaveRequest | null>(null);
  const [notEditableMessage, setNotEditableMessage] = useState<string | null>(
    null,
  );
  // The request's own whole days are already reserved in `pending_days`; give
  // them back to the balance while it is being edited.
  const ownReservation = useRef<{ leaveTypeId: number; days: number } | null>(
    null,
  );
  const submitInFlight = useRef(false);
  const detailsPath = `/employee/leave/requests/${requestId}`;
  const backPath = isEdit ? detailsPath : "/employee/leave/requests";

  // Translate leave type names coming from the API
  const translateLeaveType = (name?: string): string => {
    if (!name) return "";
    const key = `leave.type.${name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z_]/g, "")}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<Record<number, LeaveBalance>>({});
  const selectedLeaveTypeId = Form.useWatch("leave_type", form);
  const selectedLeaveBalance = selectedLeaveTypeId
    ? balances[selectedLeaveTypeId]
    : undefined;
  const selectedBalanceFigures = selectedLeaveBalance
    ? readLeaveBalanceFigures(selectedLeaveBalance)
    : undefined;

  const [daysCount, setDaysCount] = useState(0);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [isSickSelected, setIsSickSelected] = useState(false);
  const [delegationCandidates, setDelegationCandidates] = useState<
    DelegationCandidate[]
  >([]);
  const [isSaudi, setIsSaudi] = useState<boolean | null>(null);
  const willTravel = Form.useWatch("will_travel", form);

  // Annual Leave is limited by requestable_days, which the backend already
  // reduced by pending reservations and the sub-day remainder. Every other
  // type keeps its previous remaining_days rule.
  const getAvailableDaysForType = (typeObj: LeaveType): number =>
    Number(balances[typeObj.id]?.remaining_days || 0);

  const getDaysIssueMessage = (
    typeObj: LeaveType,
    requestedDays: number,
  ): string | null => {
    if (isAnnualLeaveCode(typeObj.code)) {
      const issue = validateAnnualLeaveDays(
        requestedDays,
        balances[typeObj.id],
      );
      return issue ? annualLeaveDaysIssueMessage(issue, t) : null;
    }
    return getAvailableDaysForType(typeObj) < requestedDays
      ? t("leave.insufficientBalance")
      : null;
  };

  const formatDays = (value: number | string | undefined): string => {
    const numericValue = Number(value || 0);
    return Number.isInteger(numericValue)
      ? String(numericValue)
      : numericValue.toFixed(2);
  };

  // Balances are re-read after every submit attempt so a pending reservation
  // created elsewhere is reflected before the employee tries again.
  const loadBalances = useCallback(async () => {
    const balanceRes = await getMyLeaveBalance();
    if (!isApiError(balanceRes)) {
      const map: Record<number, LeaveBalance> = {};
      (balanceRes.data || []).forEach((b) => {
        map[b.leave_type_id] = b;
      });
      const own = ownReservation.current;
      const ownBalance = own ? map[own.leaveTypeId] : undefined;
      if (own && ownBalance?.requestable_days !== undefined) {
        map[own.leaveTypeId] = {
          ...ownBalance,
          requestable_days: Number(ownBalance.requestable_days || 0) + own.days,
          pending_days: Math.max(
            0,
            Number(ownBalance.pending_days || 0) - own.days,
          ),
        };
      }
      setBalances(map);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const typesRes = await getLeaveTypes();
        const types = !isApiError(typesRes) ? typesRes.data || [] : [];
        if (!isApiError(typesRes)) {
          setLeaveTypes(types);
        }

        if (isEdit) {
          const requestRes = await getLeaveRequest(requestId);
          if (isApiError(requestRes)) throw new Error(requestRes.message);
          const current = requestRes.data;
          setEditRequest(current);
          if (current.workflow?.can_edit !== true) {
            setNotEditableMessage(t("requests.edit.notEditable"));
          }
          const typeCode = (
            types.find((item) => item.id === current.leave_type?.id)?.code ||
            current.leave_type?.code ||
            ""
          ).toUpperCase();
          setIsOtherSelected(typeCode === "OTHER");
          setIsSickSelected(["SICK", "SICK_LEAVE"].includes(typeCode));
          if (isAnnualLeaveCode(typeCode)) {
            ownReservation.current = {
              leaveTypeId: current.leave_type.id,
              days: Number(current.days || 0),
            };
          }
          setDaysCount(
            Math.max(
              0,
              dayjs(current.end_date).diff(dayjs(current.start_date), "day") +
                1,
            ),
          );
        }

        await loadBalances();

        const profileRes = await getEmployee("me");
        if (isApiError(profileRes)) throw new Error(profileRes.message);
        setIsSaudi(isSaudiEmployee(profileRes.data));
        // Edit mode never changes the alternative employee, so the candidate
        // list is not needed.
        if (!isEdit)
          try {
            const employeesRes = await listDelegationCandidates();
            if (isApiError(employeesRes)) {
              notification.warning({
                message: t("leave.alternatesUnavailable"),
              });
            } else {
              setDelegationCandidates(employeesRes.data || []);
            }
          } catch {
            notification.warning({ message: t("leave.alternatesUnavailable") });
          }
      } catch (e) {
        console.error(e);
        setSubmitError(getLeavePageLoadErrorMessage(e));
        notification.error({
          message: t("common.error"),
          description: getLeavePageLoadErrorMessage(e),
        });
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [t, loadBalances, isEdit, requestId]);

  // The form mounts only after loading ends, so prefill from an effect.
  useEffect(() => {
    if (!isEdit || loading || !editRequest) return;
    const current = editRequest;
    form.setFieldsValue({
      leave_type: current.leave_type?.id,
      dates: [dayjs(current.start_date), dayjs(current.end_date)],
      reason: current.reason || "",
      will_travel: current.will_travel === true,
      will_require_visa:
        current.will_require_visa === null
          ? undefined
          : current.will_require_visa,
      other_leave_description: current.other_leave_description || "",
      date_of_rejoin: current.date_of_rejoin
        ? dayjs(current.date_of_rejoin)
        : undefined,
      po_box: current.po_box || "",
      full_address: current.full_address || "",
      airplane_ticket_payer: current.airplane_ticket_payer || undefined,
      airplane_ticket_address: current.airplane_ticket_address || "",
      delegation_note: current.delegation_note || "",
    });
  }, [isEdit, loading, editRequest, form]);

  const handleValuesChange = (changedValues: any, allValues: any) => {
    if (
      Object.hasOwn(changedValues, "will_travel") &&
      !changedValues.will_travel
    ) {
      form.setFieldValue("will_require_visa", undefined);
      form.setFields(travelDetailFields.map((name) => ({ name, errors: [] })));
    }
    if (changedValues.leave_type) {
      const typeObj = leaveTypes.find((t) => t.id === changedValues.leave_type);
      setIsOtherSelected(typeObj?.code === "OTHER");
      const nextIsSickSelected = ["SICK", "SICK_LEAVE"].includes(
        (typeObj?.code || "").toUpperCase(),
      );
      setIsSickSelected(nextIsSickSelected);
      if (!nextIsSickSelected) {
        form.setFields([{ name: "document", errors: [] }]);
      }
    }

    if (changedValues.dates || changedValues.leave_type) {
      if (changedValues.dates) {
        setSubmitError(null);
        form.setFields([{ name: "dates", errors: [] }]);
      }
      const { dates, leave_type } = allValues;

      if (dates && dates[0] && dates[1]) {
        const start = dates[0];
        const end = dates[1];
        const diff = end.diff(start, "day") + 1;
        setDaysCount(diff > 0 ? diff : 0);

        if (leave_type) {
          const typeObj = leaveTypes.find((t) => t.id === leave_type);
          if (typeObj) {
            if (typeObj.code === "OTHER") {
              setBalanceError(null);
            } else {
              const bal = balances[typeObj.id];
              setBalanceError(bal ? getDaysIssueMessage(typeObj, diff) : null);
            }
          }
        }
      } else {
        setDaysCount(0);
        setBalanceError(null);
      }
    }
  };

  const refreshEditedRequest = async () => {
    try {
      const res = await getLeaveRequest(requestId);
      if (isApiError(res)) return;
      setEditRequest(res.data);
      if (res.data.workflow?.can_edit !== true) {
        setNotEditableMessage(t("requests.edit.notEditable"));
      }
    } catch {
      // Keep the current view; the server re-checks on the next save.
    }
  };

  const handleEditFinish = async (values: any) => {
    if (isSaudi === null || submitInFlight.current) return;
    if (balanceError) {
      notification.error({
        message: t("common.error"),
        description: balanceError,
      });
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: EditLeaveRequestPayload = {
        leave_type: values.leave_type,
        start_date: values.dates[0].format("YYYY-MM-DD"),
        end_date: values.dates[1].format("YYYY-MM-DD"),
        reason: values.reason || "",
        will_travel: values.will_travel === true,
        other_leave_description: values.other_leave_description || "",
        date_of_rejoin: values.date_of_rejoin
          ? values.date_of_rejoin.format("YYYY-MM-DD")
          : null,
        po_box: values.po_box || "",
        full_address: values.full_address || "",
        airplane_ticket_payer: values.airplane_ticket_payer || "",
        airplane_ticket_address: values.airplane_ticket_address || "",
        delegation_note: values.delegation_note || "",
      };
      if (!isSaudi && values.will_travel === true) {
        payload.will_require_visa = values.will_require_visa === true;
      }
      const file = ((values.document || []) as UploadFile[])[0]?.originFileObj;
      if (file) payload.document = file;

      const response = await editLeaveRequest(requestId, payload);
      if (isApiError(response)) {
        throw { response: { status: 422, data: response }, apiData: response };
      }
      notification.success({ message: t("requests.edit.success") });
      navigate(detailsPath);
    } catch (err: any) {
      const status = getHttpStatus(err);
      const validationErrors = getLeaveValidationErrors(err);
      // Only errors tied to an editable form field count as validation
      // errors; anything else (including a "no longer editable" message that
      // happens to contain a colon) is the not-editable case.
      const fieldErrors = validationErrors.filter(
        ({ field }) =>
          field === "start_date" ||
          field === "end_date" ||
          (field !== undefined && EDITABLE_FORM_FIELDS.includes(field)),
      );
      let description = getDetailedHttpErrorMessage(t, err);
      if (status === 422 && fieldErrors.length === 0) {
        // Not editable in this status: show the server's message, then
        // refresh because the request moved on.
        description =
          err?.response?.data?.message || t("requests.edit.notEditable");
        setNotEditableMessage(description);
        await refreshEditedRequest();
      } else if (validationErrors.length > 0) {
        description = validationErrors.map(({ message }) => message).join(", ");
        form.setFields(
          fieldErrors.flatMap(({ field, message }) => {
            if (field === "start_date" || field === "end_date")
              return [{ name: "dates", errors: [message] }];
            return EDITABLE_FORM_FIELDS.includes(field as string)
              ? [{ name: field as string, errors: [message] }]
              : [];
          }),
        );
      } else if (status === 404) {
        description = t("requests.edit.notEditable");
      }
      setSubmitError(description);
      notification.error({ message: t("requests.edit.failed"), description });
      await loadBalances();
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleFinish = async (values: any) => {
    if (isEdit) return handleEditFinish(values);
    if (isSaudi === null) return;
    if (balanceError) {
      notification.error({
        message: t("common.error"),
        description: balanceError,
      });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = new FormData();
      payload.append("leave_type", String(values.leave_type));
      payload.append("start_date", values.dates[0].format("YYYY-MM-DD"));
      payload.append("end_date", values.dates[1].format("YYYY-MM-DD"));
      payload.append("reason", values.reason || "");
      payload.append("will_travel", String(values.will_travel === true));
      if (!isSaudi && values.will_travel === true) {
        payload.append(
          "will_require_visa",
          String(values.will_require_visa === true),
        );
      }

      const fileList = (values.document || []) as UploadFile[];
      const file = fileList[0]?.originFileObj;
      if (file) {
        payload.append("document", file);
      }

      payload.append(
        "other_leave_description",
        values.other_leave_description || "",
      );
      if (values.date_of_rejoin)
        payload.append(
          "date_of_rejoin",
          values.date_of_rejoin.format("YYYY-MM-DD"),
        );
      payload.append("po_box", values.po_box || "");
      payload.append("full_address", values.full_address || "");
      payload.append(
        "airplane_ticket_payer",
        values.airplane_ticket_payer || "",
      );
      payload.append(
        "airplane_ticket_address",
        values.airplane_ticket_address || "",
      );
      if (values.delegated_to != null)
        payload.append("delegated_to", String(values.delegated_to));
      payload.append("delegation_note", values.delegation_note || "");

      await createLeaveRequest(payload);
      await loadBalances();

      notification.success({
        message: t("common.submit"),
        description: t("leave.submitRequest"),
      });
      navigate("/employee/leave/requests");
    } catch (err: any) {
      console.error("Submit Error:", err);

      let description = getDetailedHttpErrorMessage(t, err);
      const validationErrors = getLeaveValidationErrors(err);
      if (validationErrors.length > 0) {
        description = validationErrors.map(({ message }) => message).join(", ");
        const startDateError = validationErrors.find(
          ({ field }) => field === "start_date",
        );
        if (startDateError) {
          form.setFields([{ name: "dates", errors: [startDateError.message] }]);
        }
      }

      setSubmitError(description);
      notification.error({ message: t("common.error"), description });
      await loadBalances();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <PageHeader
        title={isEdit ? t("leave.edit.title") : t("leave.requestTitle")}
        subtitle={isEdit ? t("requests.edit.hint") : t("leave.requestSubtitle")}
        actions={
          <BackButton
            onClick={() => navigate(backPath)}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {isEdit
              ? t("requests.edit.backToDetails")
              : t("leave.backToRequests")}
          </BackButton>
        }
      />

      <Card style={{ borderRadius: 16 }} loading={loading}>
        {balanceError && (
          <Alert
            type="error"
            message={balanceError}
            showIcon
            style={{ marginBottom: 24 }}
          />
        )}

        {isEdit && (
          <Alert
            type={notEditableMessage ? "warning" : "info"}
            title={notEditableMessage || t("requests.edit.hint")}
            showIcon
            style={{ marginBottom: 24 }}
          />
        )}

        <LeaveSubmissionError message={submitError} />

        <Form
          layout="vertical"
          form={form}
          onFinish={handleFinish}
          onValuesChange={handleValuesChange}
        >
          <Form.Item
            label={t("leave.type")}
            name="leave_type"
            rules={[{ required: true, message: t("common.required") }]}
          >
            <Select placeholder={t("leave.selectType")}>
              {leaveTypes.map((lt) => (
                <Option key={lt.id} value={lt.id}>
                  {translateLeaveType(lt.name)}
                </Option>
              ))}
            </Select>
          </Form.Item>

          {selectedLeaveBalance && (
            <div
              style={{
                marginTop: -8,
                marginBottom: 24,
                padding: 12,
                background: "#f0f7ff",
                border: "1px solid #91caff",
                borderRadius: 8,
              }}
            >
              <div>
                <strong>{t("leave.balanceTitle")}:</strong>{" "}
                {t("leave.remaining")}:{" "}
                {formatDays(selectedLeaveBalance.remaining_days)}{" "}
                {t("leave.days")}
                {" | "}
                {t("leave.used")}: {formatDays(selectedLeaveBalance.used_days)}{" "}
                {t("leave.days")}
                {" | "}
                {t("leave.allowed")}:{" "}
                {formatDays(selectedLeaveBalance.total_days)} {t("leave.days")}
              </div>
              {selectedBalanceFigures?.hasRequestableDays && (
                <div style={{ marginTop: 6 }}>
                  <strong>{t("leave.requestableDays")}:</strong>{" "}
                  {formatDays(selectedBalanceFigures.requestable)}{" "}
                  {t("leave.days")}
                </div>
              )}
            </div>
          )}

          <Form.Item
            label={t("common.date")}
            name="dates"
            rules={[{ required: true, message: t("common.required") }]}
            extra={t("leave.backdateHelper")}
          >
            <RangePicker
              style={{ width: "100%" }}
              format="YYYY-MM-DD"
              disabledDate={(current) => isEmployeeLeaveDateDisabled(current)}
            />
          </Form.Item>

          {daysCount > 0 && (
            <div
              style={{
                marginBottom: 24,
                padding: 12,
                background: "#f6ffed",
                border: "1px solid #b7eb8f",
                borderRadius: 8,
              }}
            >
              <strong>{t("leave.totalDays")}:</strong> {daysCount}
            </div>
          )}

          <Form.Item
            label={t("leave.willTravel")}
            name="will_travel"
            rules={[{ required: true, message: t("common.required") }]}
          >
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value={true}>{t("common.yes")}</Radio.Button>
              <Radio.Button value={false}>{t("common.no")}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {willTravel === true && isSaudi === false && (
            <Form.Item
              label={t("leave.willRequireVisa")}
              name="will_require_visa"
              rules={[{ required: true, message: t("common.required") }]}
            >
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value={true}>{t("common.yes")}</Radio.Button>
                <Radio.Button value={false}>{t("common.no")}</Radio.Button>
              </Radio.Group>
            </Form.Item>
          )}

          <Form.Item
            label={
              isOtherSelected
                ? t("leave.reasonRequired")
                : t("leave.reasonOptional")
            }
            name="reason"
            rules={[
              { required: isOtherSelected, message: t("common.required") },
            ]}
          >
            <TextArea rows={4} placeholder={t("leave.reason")} />
          </Form.Item>

          <Form.Item
            label={
              isSickSelected ? t("leave.docRequired") : t("leave.docOptional")
            }
            name="document"
            valuePropName="fileList"
            getValueFromEvent={(e) =>
              Array.isArray(e) ? e : e?.fileList || []
            }
            extra={
              isEdit && editRequest?.document
                ? t("leave.edit.keepDocument")
                : undefined
            }
            rules={[
              {
                validator: (_, value: UploadFile[]) => {
                  if (!isSickSelected) return Promise.resolve();
                  if (isEdit && editRequest?.document) return Promise.resolve();
                  return value && value.length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("common.required")));
                },
              },
            ]}
          >
            <Upload
              beforeUpload={() => false}
              maxCount={1}
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            >
              <Button>{t("leave.chooseFile")}</Button>
            </Upload>
          </Form.Item>

          {isOtherSelected && (
            <Form.Item
              label={t("leave.otherLeaveDescription")}
              name="other_leave_description"
            >
              <Input />
            </Form.Item>
          )}

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                label={t("leave.dateOfRejoin")}
                name="date_of_rejoin"
                rules={[
                  {
                    required: willTravel === true,
                    message: t("leave.travelDetailRequired"),
                  },
                ]}
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={t("leave.poBox")}
                name="po_box"
                rules={[
                  {
                    required: willTravel === true,
                    whitespace: true,
                    message: t("leave.travelDetailRequired"),
                  },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label={t("leave.fullAddress")}
            name="full_address"
            rules={[
              {
                required: willTravel === true,
                whitespace: true,
                message: t("leave.travelDetailRequired"),
              },
            ]}
          >
            <Input />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                label={t("leave.airplaneTicketPayer")}
                name="airplane_ticket_payer"
                rules={[
                  {
                    required: willTravel === true,
                    message: t("leave.travelDetailRequired"),
                  },
                ]}
              >
                <Select allowClear placeholder="-">
                  <Option value="company">
                    {t("leave.ticketPayer.company")}
                  </Option>
                  <Option value="employee">
                    {t("leave.ticketPayer.employee")}
                  </Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={t("leave.airplaneTicketAddress")}
                name="airplane_ticket_address"
                rules={[
                  {
                    required: willTravel === true,
                    whitespace: true,
                    message: t("leave.travelDetailRequired"),
                  },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          {isEdit ? (
            <Form.Item
              label={t("leave.delegatedTo")}
              extra={t("leave.edit.delegateReadonly")}
            >
              <Input
                disabled
                aria-label={t("leave.delegatedTo")}
                value={editRequest?.delegated_to?.full_name || "-"}
              />
            </Form.Item>
          ) : (
            <Form.Item
              label={t("leave.delegatedTo")}
              name="delegated_to"
              rules={[
                {
                  required: willTravel === true,
                  message: t("leave.travelDetailRequired"),
                },
              ]}
            >
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="-"
                options={delegationCandidates.map((e) => ({
                  value: e.id,
                  label: formatDelegationCandidateLabel(e),
                }))}
              />
            </Form.Item>
          )}

          <Form.Item
            label={t("leave.delegationNote")}
            name="delegation_note"
            rules={[
              {
                required: willTravel === true,
                whitespace: true,
                message: t("leave.travelDetailRequired"),
              },
            ]}
          >
            <TextArea rows={3} />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            icon={<SendOutlined aria-hidden />}
            block
            size="large"
            loading={submitting}
            disabled={
              !!balanceError ||
              isSaudi === null ||
              (isEdit &&
                (!editRequest || editRequest.workflow?.can_edit !== true))
            }
          >
            {isEdit ? t("requests.edit.save") : t("leave.submitRequest")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
