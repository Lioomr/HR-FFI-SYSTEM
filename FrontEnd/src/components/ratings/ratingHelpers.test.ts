import { describe, expect, it } from "vitest";

import type {
  GradeRanges,
  RatingCriterion,
} from "../../services/api/contractRatingsApi";
import {
  estimateAverage,
  isScoreInGradeRange,
  orderedGrades,
  toCriterionRatings,
  toProposedTerms,
} from "./ratingHelpers";

const ranges: GradeRanges = {
  EXCELLENT: [90, 100],
  VERY_GOOD: [80, 89],
  GOOD: [70, 79],
  ACCEPTABLE: [60, 69],
  POOR: [0, 59],
};

const criteria: RatingCriterion[] = [
  { code: "b", label_en: "B", label_ar: "ب", display_order: 2 },
  { code: "a", label_en: "A", label_ar: "أ", display_order: 1 },
];

describe("rating helpers", () => {
  it("orders grades from the server ranges, highest first", () => {
    expect(orderedGrades(ranges)).toEqual([
      "EXCELLENT",
      "VERY_GOOD",
      "GOOD",
      "ACCEPTABLE",
      "POOR",
    ]);
  });

  it("accepts only whole scores inside the grade's inclusive range", () => {
    expect(isScoreInGradeRange(ranges, "EXCELLENT", 90)).toBe(true);
    expect(isScoreInGradeRange(ranges, "EXCELLENT", 100)).toBe(true);
    expect(isScoreInGradeRange(ranges, "EXCELLENT", 89)).toBe(false);
    expect(isScoreInGradeRange(ranges, "VERY_GOOD", 85.5)).toBe(false);
    expect(isScoreInGradeRange(ranges, undefined, 85)).toBe(false);
    expect(isScoreInGradeRange(ranges, "POOR", undefined)).toBe(false);
  });

  it("estimates only once every criterion is valid", () => {
    expect(
      estimateAverage(criteria, ranges, { a: { grade: "GOOD", score: 75 } }),
    ).toEqual({ complete: 1 });
    // 89.5 uses the backend's lower-bound rule: VERY_GOOD, not EXCELLENT.
    expect(
      estimateAverage(criteria, ranges, {
        a: { grade: "EXCELLENT", score: 90 },
        b: { grade: "VERY_GOOD", score: 89 },
      }),
    ).toEqual({ complete: 2, average: 89.5, grade: "VERY_GOOD" });
  });

  it("builds the full criterion object with trimmed remarks", () => {
    expect(
      toCriterionRatings(criteria, {
        a: { grade: "GOOD", score: 70, remark: "  ok " },
        b: { grade: "POOR", score: 10 },
      }),
    ).toEqual({
      b: { grade: "POOR", score: 10, remark: "" },
      a: { grade: "GOOD", score: 70, remark: "ok" },
    });
  });

  it("proposes only the salary components that were typed", () => {
    expect(
      toProposedTerms({ basic_salary: " 5600 ", other_allowance: "" }),
    ).toEqual({ basic_salary: "5600" });
  });
});
