import type { ReactNode } from "react";
import { Alert, Button, Form, Input, type FormInstance } from "antd";

import { useI18n } from "../../i18n/useI18n";
import type {
  GradeRanges,
  RatingCriterion,
} from "../../services/api/contractRatingsApi";
import RatingBandSelector from "./RatingBandSelector";
import {
  estimateAverage,
  isScoreInGradeRange,
  sortCriteria,
  type CriterionDraft,
  type RatingFormValues,
} from "./ratingHelpers";

/**
 * The evaluation form: every criterion the server lists plus one overall
 * remark. Manager and employee pages mount this exact component unchanged —
 * it has no recommendation, change-type or salary field, and accepts no
 * children through which one could be added. The parent decides which
 * endpoint `onFinish` posts to.
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
}: {
  form: FormInstance<RatingFormValues>;
  criteria: RatingCriterion[];
  gradeRanges: GradeRanges;
  initialValues?: Partial<RatingFormValues>;
  submitting: boolean;
  submitLabel: string;
  onFinish: (values: RatingFormValues) => void | Promise<void>;
  errors?: ReactNode;
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

      {errors}

      <Button type="primary" htmlType="submit" loading={submitting} block>
        {submitLabel}
      </Button>
    </Form>
  );
}
