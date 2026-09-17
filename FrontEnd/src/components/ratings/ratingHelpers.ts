import { useCallback, useEffect, useState } from "react";

import { isApiError } from "../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../services/api/httpErrors";
import {
  CONTRACT_SALARY_COMPONENTS,
  type ContractSalaryComponent,
  type ContractSalaryTerms,
} from "../../services/api/contractDecisionsApi";
import {
  getRatingCriteria,
  type ContractRatingStatus,
  type CriterionRating,
  type CriterionRatings,
  type GradeRanges,
  type RatingChangeType,
  type RatingCriteriaPayload,
  type RatingCriterion,
  type RatingGrade,
  type RatingRecommendation,
  type RatingResponseBase,
} from "../../services/api/contractRatingsApi";
import { formatDateOnly } from "../../utils/dateTime";

/** A criterion answer while it is being filled; the server requires all three. */
export type CriterionDraft = Partial<CriterionRating>;

export const RECOMMENDATIONS: RatingRecommendation[] = [
  "CONTINUE_CONTRACT",
  "CONTINUE_WITH_CHANGES",
  "TERMINATE",
];

export const CHANGE_TYPES: RatingChangeType[] = [
  "SALARY_INCREASE",
  "JOB_TITLE_CHANGE",
  "POSITION_CHANGE",
  "OTHER",
];

/** Decimal(12,2), non-negative — mirrors the backend money fields. */
export const SALARY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const RATING_STATUS_COLORS: Record<ContractRatingStatus, string> = {
  PENDING_RESPONSES: "default",
  WAITING_MANAGER: "blue",
  WAITING_EMPLOYEE: "blue",
  PENDING_HR: "orange",
  PENDING_CEO: "gold",
  APPROVED: "green",
  REJECTED: "red",
  MANUAL_RESOLUTION_REQUIRED: "volcano",
};

export const GRADE_COLORS: Record<RatingGrade, string> = {
  EXCELLENT: "green",
  VERY_GOOD: "cyan",
  GOOD: "blue",
  ACCEPTABLE: "gold",
  POOR: "red",
};

export interface RatingFormValues {
  criterion_ratings: Record<string, CriterionDraft>;
  overall_remark?: string;
  /* Manager-only fields — never read by the employee page. */
  recommendation?: RatingRecommendation;
  recommended_change_types?: RatingChangeType[];
  proposed_terms?: Partial<Record<ContractSalaryComponent, string>>;
  proposed_job_title?: string;
  proposed_position_id?: number;
  other_change_notes?: string;
  salary_effective_date?: import("dayjs").Dayjs;
}

/** Grades ordered from the highest range down, derived from the server ranges. */
export function orderedGrades(ranges: GradeRanges): RatingGrade[] {
  return (Object.keys(ranges) as RatingGrade[]).sort(
    (a, b) => ranges[b][0] - ranges[a][0],
  );
}

export function isScoreInGradeRange(
  ranges: GradeRanges,
  grade: RatingGrade | undefined,
  score: number | undefined | null,
): boolean {
  if (!grade || score == null || !ranges[grade]) return false;
  const [min, max] = ranges[grade];
  return Number.isInteger(score) && score >= min && score <= max;
}

export function sortCriteria(criteria: RatingCriterion[]): RatingCriterion[] {
  return [...criteria].sort((a, b) => a.display_order - b.display_order);
}

export function criterionLabel(
  criterion: RatingCriterion | undefined,
  code: string,
  language: string,
) {
  if (!criterion) return code;
  return language === "ar" ? criterion.label_ar : criterion.label_en;
}

/** Prefills the criterion rows from an existing (e.g. returned) response. */
export function criterionDraftsFrom(
  response: Pick<RatingResponseBase, "criterion_ratings"> | null | undefined,
): Record<string, CriterionDraft> {
  const drafts: Record<string, CriterionDraft> = {};
  for (const [code, entry] of Object.entries(
    response?.criterion_ratings ?? {},
  )) {
    drafts[code] = { ...entry };
  }
  return drafts;
}

/**
 * Builds the complete `criterion_ratings` object for every criterion the server
 * listed. Callers run form validation first, so each draft is complete here.
 */
export function toCriterionRatings(
  criteria: RatingCriterion[],
  drafts: Record<string, CriterionDraft> | undefined,
): CriterionRatings {
  const result: CriterionRatings = {};
  for (const criterion of criteria) {
    const draft = drafts?.[criterion.code] ?? {};
    result[criterion.code] = {
      grade: draft.grade as RatingGrade,
      score: draft.score as number,
      remark: (draft.remark ?? "").trim(),
    };
  }
  return result;
}

/** Only the salary components actually typed are proposed. */
export function toProposedTerms(
  values: Partial<Record<ContractSalaryComponent, string>> | undefined,
): ContractSalaryTerms {
  const terms: ContractSalaryTerms = {};
  for (const field of CONTRACT_SALARY_COMPONENTS) {
    const raw = (values?.[field] ?? "").trim();
    if (raw) terms[field] = raw;
  }
  return terms;
}

/**
 * A display-only estimate of the average and overall grade. The backend
 * recomputes both from the submitted scores; this value is never sent.
 */
export function estimateAverage(
  criteria: RatingCriterion[],
  ranges: GradeRanges,
  drafts: Record<string, CriterionDraft> | undefined,
): { complete: number; average?: number; grade?: RatingGrade } {
  const scores = criteria
    .map((criterion) => drafts?.[criterion.code])
    .filter((draft): draft is CriterionDraft =>
      isScoreInGradeRange(ranges, draft?.grade, draft?.score),
    )
    .map((draft) => draft.score as number);
  if (scores.length !== criteria.length || !criteria.length) {
    return { complete: scores.length };
  }
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const rounded = Math.round(average * 100) / 100;
  // Same lower-bound rule the backend documents for fractional averages.
  const grade = orderedGrades(ranges).find(
    (candidate) => rounded >= ranges[candidate][0],
  );
  return { complete: scores.length, average: rounded, grade };
}

export function formatPeriod(from: string | null, to: string | null) {
  if (!from && !to) return "—";
  return `${formatDateOnly(from)} → ${formatDateOnly(to)}`;
}

/** Loads the authoritative criteria list and grade ranges once per page. */
export function useRatingCriteria() {
  const [data, setData] = useState<RatingCriteriaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getRatingCriteria();
      if (isApiError(response)) throw new Error(response.message);
      setData(response.data);
    } catch (err) {
      setError(getHttpErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { criteria: data, error, loading, reload: load };
}
