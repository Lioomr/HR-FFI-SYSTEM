import BackButton from "../../../components/ui/BackButton";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  getMyLeaveBalance,
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

export default function RequestLeavePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [form] = Form.useForm();

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
      setBalances(map);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const typesRes = await getLeaveTypes();
        if (!isApiError(typesRes)) {
          setLeaveTypes(typesRes.data || []);
        }

        await loadBalances();

        const profileRes = await getEmployee("me");
        if (isApiError(profileRes)) throw new Error(profileRes.message);
        setIsSaudi(isSaudiEmployee(profileRes.data));
        try {
          const employeesRes = await listDelegationCandidates();
          if (isApiError(employeesRes)) {
            notification.warning({ message: t("leave.alternatesUnavailable") });
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
  }, [t, loadBalances]);

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

  const handleFinish = async (values: any) => {
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
        title={t("leave.requestTitle")}
        subtitle={t("leave.requestSubtitle")}
        actions={
          <BackButton
            onClick={() => navigate("/employee/leave/requests")}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {t("leave.backToRequests")}
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
            rules={[
              {
                validator: (_, value: UploadFile[]) => {
                  if (!isSickSelected) return Promise.resolve();
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
            icon={<SendOutlined />}
            block
            size="large"
            loading={submitting}
            disabled={!!balanceError || isSaudi === null}
          >
            {t("leave.submitRequest")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
