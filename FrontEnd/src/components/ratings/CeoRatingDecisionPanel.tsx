import { useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Space,
  Typography,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  RiseOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

import { useI18n } from "../../i18n/useI18n";
import {
  CONTRACT_SALARY_COMPONENTS,
  type ContractSalaryComponent,
  type ContractSalaryTerms,
} from "../../services/api/contractDecisionsApi";
import {
  isRatedFullContractRating,
  type CeoDecisionPayload,
  type CeoReturnAction,
  type FullContractRating,
} from "../../services/api/contractRatingsApi";
import { formatDateOnly } from "../../utils/dateTime";
import { RatingActionErrors } from "./RatingOutcomeDetails";
import {
  SALARY_PATTERN,
  defaultSalaryEffectiveDate,
  previewSalaryIncrease,
} from "./ratingHelpers";

const { Paragraph, Text } = Typography;

type SimpleOutcome = "RENEW" | "TERMINATE";

type IncreaseValues = {
  terms: Partial<Record<ContractSalaryComponent, string>>;
  salary_effective_date?: Dayjs;
  comment?: string;
};

const RETURN_ACTIONS: CeoReturnAction[] = [
  "RETURN_TO_MANAGER",
  "RETURN_TO_EMPLOYEE",
  "RETURN_TO_BOTH",
];

/** Components whose entered amount differs from the live value. */
function changedTerms(
  current: ContractSalaryTerms,
  entered: IncreaseValues["terms"],
): ContractSalaryTerms {
  const changed: ContractSalaryTerms = {};
  for (const field of CONTRACT_SALARY_COMPONENTS) {
    const raw = (entered?.[field] ?? "").trim();
    if (raw && Number(raw) !== Number(current?.[field] ?? 0)) {
      changed[field] = raw;
    }
  }
  return changed;
}

/**
 * The CEO's decision on a PENDING_CEO rating: exactly one of Renew, Renew with
 * Increase or Terminate, or — on a rated cycle only — a return for correction.
 *
 * Salary inputs exist only inside the Renew with Increase dialog, and only
 * that submission builds a payload carrying `ceo_approved_terms` /
 * `salary_effective_date` (the payload type forbids them elsewhere).
 */
export default function CeoRatingDecisionPanel({
  rating,
  loading,
  errors,
  onClearErrors,
  onDecide,
}: {
  rating: FullContractRating;
  loading: boolean;
  errors: string[];
  onClearErrors: () => void;
  /** Resolves true when the decision was recorded. */
  onDecide: (payload: CeoDecisionPayload) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [simple, setSimple] = useState<SimpleOutcome | null>(null);
  const [comment, setComment] = useState("");
  const [increaseOpen, setIncreaseOpen] = useState(false);
  const [returnAction, setReturnAction] = useState<CeoReturnAction | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnError, setReturnError] = useState<string | null>(null);

  const current = rating.current_terms ?? {};
  const rated = isRatedFullContractRating(rating);
  const dialogOpen = Boolean(simple || increaseOpen || returnAction);

  const openSimple = (outcome: SimpleOutcome) => {
    onClearErrors();
    setComment("");
    setSimple(outcome);
  };

  const openIncrease = () => {
    onClearErrors();
    setIncreaseOpen(true);
  };

  return (
    <>
      {!dialogOpen ? <RatingActionErrors errors={errors} /> : null}
      <Text strong style={{ display: "block", marginBottom: 8 }}>
        {t("contractRatings.ceoDecisionPrompt")}
      </Text>
      <Space wrap size={8}>
        <Button
          type="primary"
          icon={<CheckOutlined aria-hidden />}
          disabled={loading}
          onClick={() => openSimple("RENEW")}
        >
          {t("contractRatings.outcome.RENEW")}
        </Button>
        <Button
          icon={<RiseOutlined aria-hidden />}
          disabled={loading}
          onClick={openIncrease}
        >
          {t("contractRatings.outcome.RENEW_WITH_CHANGES")}
        </Button>
        <Button
          danger
          icon={<CloseOutlined aria-hidden />}
          disabled={loading}
          onClick={() => openSimple("TERMINATE")}
        >
          {t("contractRatings.outcome.TERMINATE")}
        </Button>
      </Space>

      {rated ? (
        <>
          <Divider style={{ margin: "16px 0 12px" }} />
          <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
            {t("contractRatings.returnPrompt")}
          </Text>
          <Space wrap size={8}>
            {RETURN_ACTIONS.map((action) => (
              <Button
                key={action}
                icon={<RollbackOutlined aria-hidden />}
                disabled={loading}
                onClick={() => {
                  onClearErrors();
                  setReturnReason("");
                  setReturnError(null);
                  setReturnAction(action);
                }}
              >
                {t(`contractRatings.returnAction.${action}`)}
              </Button>
            ))}
          </Space>
        </>
      ) : null}

      {/* Renew / Terminate: comment optional, no salary data */}
      <Modal
        open={simple !== null}
        title={simple ? t(`contractRatings.outcomeTitle.${simple}`) : undefined}
        okText={simple ? t(`contractRatings.outcome.${simple}`) : undefined}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: simple === "TERMINATE", loading }}
        cancelButtonProps={{ disabled: loading }}
        onCancel={() => !loading && setSimple(null)}
        onOk={async () => {
          if (!simple) return;
          const ok = await onDecide({
            ceo_decision: simple,
            comment: comment.trim(),
          });
          if (ok) setSimple(null);
        }}
        destroyOnHidden
      >
        <RatingActionErrors errors={errors} />
        <Paragraph strong>{rating.employee.full_name}</Paragraph>
        <Alert
          type={simple === "TERMINATE" ? "warning" : "info"}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            simple === "TERMINATE"
              ? t("contractRatings.terminateHint", {
                  date: formatDateOnly(rating.contract_expiry),
                })
              : t("contractRatings.renewHint")
          }
        />
        <Input.TextArea
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("contractRatings.optionalComment")}
          aria-label={t("contractRatings.optionalComment")}
        />
      </Modal>

      {/* Renew with Increase: the only place salary is ever entered */}
      <Modal
        open={increaseOpen}
        title={t("contractRatings.outcomeTitle.RENEW_WITH_CHANGES")}
        footer={null}
        onCancel={() => !loading && setIncreaseOpen(false)}
        destroyOnHidden
      >
        <RatingActionErrors errors={errors} />
        {increaseOpen ? (
          <IncreaseForm
            current={current}
            contractExpiry={rating.contract_expiry}
            loading={loading}
            onSubmit={async (payload) => {
              if (await onDecide(payload)) setIncreaseOpen(false);
            }}
          />
        ) : null}
      </Modal>

      {/* Return for correction: reason required, rated cycles only */}
      <Modal
        open={returnAction !== null}
        title={
          returnAction
            ? t(`contractRatings.returnAction.${returnAction}`)
            : undefined
        }
        okText={t("contractRatings.returnConfirm")}
        cancelText={t("common.cancel")}
        okButtonProps={{ loading }}
        cancelButtonProps={{ disabled: loading }}
        onCancel={() => !loading && setReturnAction(null)}
        onOk={async () => {
          if (!returnAction) return;
          const reason = returnReason.trim();
          if (!reason) {
            setReturnError(t("contractRatings.reasonRequired"));
            return;
          }
          const ok = await onDecide({ ceo_decision: returnAction, comment: reason });
          if (ok) setReturnAction(null);
        }}
        destroyOnHidden
      >
        <RatingActionErrors errors={errors} />
        <Paragraph type="secondary">{t("contractRatings.returnHint")}</Paragraph>
        <Form layout="vertical">
          <Form.Item
            label={t("contractRatings.returnReason")}
            required
            validateStatus={returnError ? "error" : undefined}
            help={returnError ?? undefined}
          >
            <Input.TextArea
              rows={4}
              value={returnReason}
              onChange={(event) => {
                setReturnReason(event.target.value);
                if (returnError) setReturnError(null);
              }}
              aria-label={t("contractRatings.returnReason")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/**
 * Salary entry for Renew with Increase. Mounted only while that dialog is
 * open, so no salary input exists on the page for any other outcome.
 */
function IncreaseForm({
  current,
  contractExpiry,
  loading,
  onSubmit,
}: {
  current: ContractSalaryTerms;
  contractExpiry: string | null;
  loading: boolean;
  onSubmit: (
    payload: Extract<CeoDecisionPayload, { ceo_decision: "RENEW_WITH_CHANGES" }>,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm<IncreaseValues>();
  const enteredTerms = Form.useWatch("terms", form);
  const [error, setError] = useState<string | null>(null);
  const preview = previewSalaryIncrease(current, enteredTerms);

  const initialValues = (): IncreaseValues => {
    const terms: IncreaseValues["terms"] = {};
    for (const field of CONTRACT_SALARY_COMPONENTS) {
      const value = current[field];
      terms[field] = value != null ? String(value) : "";
    }
    const effective = defaultSalaryEffectiveDate(contractExpiry);
    return {
      terms,
      salary_effective_date: effective ? dayjs(effective) : undefined,
      comment: "",
    };
  };

  const finish = async (values: IncreaseValues) => {
    const terms = changedTerms(current, values.terms);
    if (!Object.keys(terms).length) {
      setError(t("contractRatings.increaseNoChange"));
      return;
    }
    setError(null);
    await onSubmit({
      ceo_decision: "RENEW_WITH_CHANGES",
      comment: (values.comment ?? "").trim(),
      ceo_approved_terms: terms,
      salary_effective_date: values.salary_effective_date!.format("YYYY-MM-DD"),
    });
  };

  return (
    <>
      <Paragraph type="secondary">{t("contractRatings.increaseHint")}</Paragraph>
      <Form<IncreaseValues>
        form={form}
        layout="vertical"
        initialValues={initialValues()}
        onFinish={finish}
      >
        {CONTRACT_SALARY_COMPONENTS.map((field) => (
          <Form.Item
            key={field}
            name={["terms", field]}
            label={t(`contractDecisions.terms.${field}`)}
            extra={t("contractRatings.currentValue", {
              value: current[field] ?? "—",
            })}
            rules={[
              {
                validator: (_rule, value?: string) => {
                  const raw = (value ?? "").trim();
                  return !raw || SALARY_PATTERN.test(raw)
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(t("contractDecisions.invalidAmount")),
                      );
                },
              },
            ]}
          >
            <Input inputMode="decimal" autoComplete="off" />
          </Form.Item>
        ))}
        <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t("contractRatings.currentTotal")}>
            {current.total_salary ?? preview?.currentTotal.toFixed(2) ?? "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.newTotalPreview")}>
            {preview ? preview.newTotal.toFixed(2) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("contractRatings.increasePreview")}>
            {preview
              ? `${preview.amount.toFixed(2)}${
                  preview.percent != null ? ` (${preview.percent.toFixed(2)}%)` : ""
                }`
              : "—"}
          </Descriptions.Item>
        </Descriptions>
        {preview && preview.amount < 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("contractRatings.increaseIsDecrease")}
          />
        ) : null}
        <Form.Item
          name="salary_effective_date"
          label={t("contractRatings.salaryEffectiveDate")}
          extra={t("contractRatings.salaryEffectiveDateDefault")}
          rules={[{ required: true, message: t("contractRatings.fieldRequired") }]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="comment" label={t("contractRatings.optionalComment")}>
          <Input.TextArea rows={2} />
        </Form.Item>
        {error ? (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />
        ) : null}
        <Button type="primary" htmlType="submit" loading={loading} block>
          {t("contractRatings.outcome.RENEW_WITH_CHANGES")}
        </Button>
      </Form>
    </>
  );
}
