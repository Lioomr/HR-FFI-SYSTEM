import { Input, InputNumber, Radio, Space, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";
import type {
  GradeRanges,
  RatingCriterion,
  RatingGrade,
} from "../../services/api/contractRatingsApi";

import {
  isScoreInGradeRange,
  orderedGrades,
  type CriterionDraft,
} from "./ratingHelpers";

const { Text } = Typography;

/**
 * One evaluation criterion: a five-grade choice, an integer score limited to
 * that grade's range, and an optional remark.
 *
 * The min/max on the score input are UX only — the backend re-validates every
 * score against its grade and remains authoritative.
 */
export default function RatingBandSelector({
  criterion,
  index,
  gradeRanges,
  value,
  onChange,
  disabled = false,
}: {
  criterion: RatingCriterion;
  /** 1-based position shown beside the label. */
  index: number;
  gradeRanges: GradeRanges;
  value?: CriterionDraft;
  onChange?: (next: CriterionDraft) => void;
  disabled?: boolean;
}) {
  const { t, language } = useI18n();
  const draft: CriterionDraft = value ?? {};
  const label = language === "ar" ? criterion.label_ar : criterion.label_en;
  const range = draft.grade ? gradeRanges[draft.grade] : undefined;
  const labelId = `rating-criterion-${criterion.code}`;

  const emit = (patch: CriterionDraft) =>
    onChange?.({ remark: "", ...draft, ...patch });

  const selectGrade = (grade: RatingGrade) => {
    // A score from the previous grade that falls outside the new range is
    // cleared rather than silently clamped to a number the user never chose.
    const keepScore = isScoreInGradeRange(gradeRanges, grade, draft.score);
    emit({ grade, score: keepScore ? draft.score : undefined });
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      style={{
        padding: "12px 0",
        borderBottom: "1px solid #f0f0f0",
      }}
    >
      <Text strong id={labelId} style={{ display: "block", marginBottom: 8 }}>
        {index}. {label}
      </Text>
      <Space wrap size={[12, 8]} align="start" style={{ width: "100%" }}>
        <Radio.Group
          value={draft.grade}
          onChange={(event) => selectGrade(event.target.value as RatingGrade)}
          optionType="button"
          buttonStyle="solid"
          disabled={disabled}
          aria-label={t("contractRatings.grade")}
          options={orderedGrades(gradeRanges).map((grade) => ({
            value: grade,
            label: t(`contractRatings.gradeLabel.${grade}`, grade),
          }))}
        />
        <Space direction="vertical" size={0}>
          <InputNumber
            value={draft.score ?? null}
            min={range?.[0] ?? 0}
            max={range?.[1] ?? 100}
            precision={0}
            step={1}
            disabled={disabled || !draft.grade}
            placeholder={t("contractRatings.score")}
            aria-label={`${t("contractRatings.score")}: ${label}`}
            onChange={(next) =>
              emit({ score: typeof next === "number" ? next : undefined })
            }
            style={{ width: 110 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {range
              ? t("contractRatings.allowedRange", {
                  min: String(range[0]),
                  max: String(range[1]),
                })
              : t("contractRatings.selectGradeFirst")}
          </Text>
        </Space>
      </Space>
      <Input
        value={draft.remark ?? ""}
        onChange={(event) => emit({ remark: event.target.value })}
        disabled={disabled}
        placeholder={t("contractRatings.remarkPlaceholder")}
        aria-label={`${t("contractRatings.remark")}: ${label}`}
        style={{ marginTop: 8 }}
      />
    </div>
  );
}
