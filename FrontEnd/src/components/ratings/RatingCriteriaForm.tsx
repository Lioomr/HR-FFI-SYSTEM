import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Divider,
  Form,
  Input,
  Radio,
  Select,
  Typography,
  type FormInstance,
} from "antd";

import { useI18n } from "../../i18n/useI18n";
import { isApiError } from "../../services/api/apiTypes";
import { CONTRACT_SALARY_COMPONENTS } from "../../services/api/contractDecisionsApi";
import type {
  GradeRanges,
  RatingChangeType,
  RatingCriterion,
} from "../../services/api/contractRatingsApi";
import {
  listRatingPositions,
  type RatingPositionOption,
} from "../../services/api/contractRatingsApi";
import RatingBandSelector from "./RatingBandSelector";
import {
  CHANGE_TYPES,
  RECOMMENDATIONS,
  SALARY_PATTERN,
  estimateAverage,
  isScoreInGradeRange,
  sortCriteria,
  type CriterionDraft,
  type RatingFormValues,
} from "./ratingHelpers";

const { Paragraph, Text } = Typography;

/**
 * The 18-criterion evaluation form plus the overall remark. The manager's
 * recommendation block is passed in as `children` by the manager page only, so
 * the employee page never renders or submits those fields.
 */
export default function RatingCriteriaForm({
  form,
  criteria,
  gradeRanges,
  initialValues,
  submitting,
  submitLabel,
  onFinish,
  errors,
  children,
}: {
  form: FormInstance<RatingFormValues>;
  criteria: RatingCriterion[];
  gradeRanges: GradeRanges;
  initialValues?: Partial<RatingFormValues>;
  submitting: boolean;
  submitLabel: string;
  onFinish: (values: RatingFormValues) => void | Promise<void>;
  errors?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const ordered = sortCriteria(criteria);

  return (
    <Form<RatingFormValues>
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={onFinish}
      scrollToFirstError
    >
      {ordered.map((criterion, index) => (
        <Form.Item
          key={criterion.code}
          name={["criterion_ratings", criterion.code]}
          style={{ marginBottom: 0 }}
          rules={[
            {
              validator: (_rule, value?: CriterionDraft) => {
                if (!value?.grade) {
                  return Promise.reject(
                    new Error(t("contractRatings.gradeRequired")),
                  );
                }
                if (
                  !isScoreInGradeRange(gradeRanges, value.grade, value.score)
                ) {
                  const [min, max] = gradeRanges[value.grade];
                  return Promise.reject(
                    new Error(
                      t("contractRatings.scoreOutOfRange", {
                        min: String(min),
                        max: String(max),
                      }),
                    ),
                  );
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <RatingBandSelector
            criterion={criterion}
            index={index + 1}
            gradeRanges={gradeRanges}
          />
        </Form.Item>
      ))}

      <Form.Item noStyle shouldUpdate>
        {() => {
          const preview = estimateAverage(
            ordered,
            gradeRanges,
            form.getFieldValue("criterion_ratings"),
          );
          return (
            <Alert
              type="info"
              showIcon
              style={{ margin: "16px 0" }}
              message={
                preview.average != null && preview.grade
                  ? t("contractRatings.estimatedAverage", {
                      average: preview.average.toFixed(2),
                      grade: t(`contractRatings.gradeLabel.${preview.grade}`),
                    })
                  : t("contractRatings.progress", {
                      complete: String(preview.complete),
                      total: String(ordered.length),
                    })
              }
              description={t("contractRatings.estimateDisclaimer")}
            />
          );
        }}
      </Form.Item>

      <Form.Item
        name="overall_remark"
        label={t("contractRatings.overallRemark")}
      >
        <Input.TextArea rows={3} />
      </Form.Item>

      {children}

      {errors}

      <Button type="primary" htmlType="submit" loading={submitting} block>
        {submitLabel}
      </Button>
    </Form>
  );
}

/**
 * Manager-only: recommendation, the change types for "continue with changes",
 * and the one detail field each selected change type requires. Rendered inside
 * RatingCriteriaForm by ManagerRatingFormPage only.
 */
export function ManagerRecommendationFields({
  form,
  contractExpiry,
  ratingId,
}: {
  form: FormInstance<RatingFormValues>;
  contractExpiry: string | null;
  ratingId: number;
}) {
  const { t } = useI18n();
  const recommendation = Form.useWatch("recommendation", form);
  const changeTypes = Form.useWatch("recommended_change_types", form) ?? [];
  const wantsPosition =
    recommendation === "CONTINUE_WITH_CHANGES" &&
    changeTypes.includes("POSITION_CHANGE");
  const [positions, setPositions] = useState<RatingPositionOption[] | null>(
    null,
  );
  const [positionsUnavailable, setPositionsUnavailable] = useState(false);

  useEffect(() => {
    if (!wantsPosition || positions || positionsUnavailable) return;
    let active = true;
    listRatingPositions(ratingId)
      .then((response) => {
        if (!active) return;
        if (isApiError(response)) setPositionsUnavailable(true);
        else setPositions(response.data);
      })
      .catch(() => active && setPositionsUnavailable(true));
    return () => {
      active = false;
    };
  }, [wantsPosition, positions, positionsUnavailable, ratingId]);

  const withChanges = recommendation === "CONTINUE_WITH_CHANGES";
  const has = (type: RatingChangeType) =>
    withChanges && changeTypes.includes(type);

  return (
    <>
      <Divider>{t("contractRatings.recommendationSection")}</Divider>
      <Form.Item
        name="recommendation"
        label={t("contractRatings.recommendation")}
        rules={[
          {
            required: true,
            message: t("contractRatings.recommendationRequired"),
          },
        ]}
      >
        <Radio.Group
          options={RECOMMENDATIONS.map((value) => ({
            value,
            label: t(`contractRatings.recommendationLabel.${value}`),
          }))}
        />
      </Form.Item>

      {withChanges ? (
        <Form.Item
          name="recommended_change_types"
          label={t("contractRatings.changeTypes")}
          rules={[
            {
              type: "array",
              min: 1,
              required: true,
              message: t("contractRatings.changeTypesRequired"),
            },
          ]}
        >
          <Checkbox.Group
            options={CHANGE_TYPES.map((value) => ({
              value,
              label: t(`contractRatings.changeTypeLabel.${value}`),
            }))}
          />
        </Form.Item>
      ) : null}

      {has("SALARY_INCREASE") ? (
        <div
          style={{
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <Text strong>{t("contractRatings.salaryProposal")}</Text>
          <Paragraph type="secondary" style={{ marginTop: 4 }}>
            {t("contractRatings.salaryProposalHint")}
          </Paragraph>
          {CONTRACT_SALARY_COMPONENTS.map((field) => (
            <Form.Item
              key={field}
              name={["proposed_terms", field]}
              label={t(`contractDecisions.terms.${field}`)}
              rules={[
                {
                  validator: (_rule, value?: string) => {
                    const raw = (value ?? "").trim();
                    if (!raw || SALARY_PATTERN.test(raw)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(t("contractDecisions.invalidAmount")),
                    );
                  },
                },
              ]}
            >
              <Input inputMode="decimal" autoComplete="off" />
            </Form.Item>
          ))}
          <Form.Item
            name="salary_effective_date"
            label={t("contractRatings.salaryEffectiveDate")}
            extra={
              contractExpiry
                ? t("contractRatings.salaryEffectiveDateHint")
                : undefined
            }
            style={{ marginBottom: 0 }}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </div>
      ) : null}

      {has("JOB_TITLE_CHANGE") ? (
        <Form.Item
          name="proposed_job_title"
          label={t("contractRatings.proposedJobTitle")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t("contractRatings.fieldRequired"),
            },
            { max: 100 },
          ]}
        >
          <Input maxLength={100} />
        </Form.Item>
      ) : null}

      {has("POSITION_CHANGE") ? (
        <Form.Item
          name="proposed_position_id"
          label={t("contractRatings.proposedPosition")}
          extra={
            positionsUnavailable ? (
              <>
                {t("contractRatings.positionsUnavailable")}{" "}
                <Button
                  type="link"
                  onClick={() => setPositionsUnavailable(false)}
                >
                  {t("common.retry")}
                </Button>
              </>
            ) : undefined
          }
          rules={[
            { required: true, message: t("contractRatings.fieldRequired") },
          ]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={t("employees.form.positionPlaceholder")}
            loading={!positions && !positionsUnavailable}
            disabled={positionsUnavailable}
            options={(positions ?? []).map((position) => ({
              value: position.id,
              label: position.name,
            }))}
          />
        </Form.Item>
      ) : null}

      {has("OTHER") ? (
        <Form.Item
          name="other_change_notes"
          label={t("contractRatings.otherChangeNotes")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t("contractRatings.fieldRequired"),
            },
          ]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
      ) : null}
    </>
  );
}
