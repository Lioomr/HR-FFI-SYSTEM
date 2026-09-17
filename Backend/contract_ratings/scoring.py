from decimal import Decimal

from .criteria import CRITERIA, CRITERION_CODES, GRADE_RANGES


def validate_criterion_ratings(ratings):
    if not isinstance(ratings, dict) or set(ratings) != CRITERION_CODES:
        raise ValueError("Exactly the 18 evaluation criteria are required.")
    for code, entry in ratings.items():
        if not isinstance(entry, dict) or set(entry) != {"grade", "score", "remark"}:
            raise ValueError(f"{code}: grade, score and remark are required.")
        grade, score = entry["grade"], entry["score"]
        if not isinstance(grade, str) or grade not in GRADE_RANGES:
            raise ValueError(f"{code}: invalid grade.")
        lo, hi = GRADE_RANGES[grade]
        if type(score) is not int or not lo <= score <= hi:
            raise ValueError(f"{code}: score must be an integer between {lo} and {hi}.")
        if not isinstance(entry["remark"], str):
            raise ValueError(f"{code}: remark must be text.")
    return ratings


def compute_average_and_grade(criterion_ratings: dict) -> tuple[Decimal, str]:
    validate_criterion_ratings(criterion_ratings)
    average = (sum(Decimal(e["score"]) for e in criterion_ratings.values()) / len(CRITERIA)).quantize(Decimal("0.01"))
    # Integer response bands use their lower thresholds for fractional averages.
    grade = next(g for g, (lo, _) in GRADE_RANGES.items() if average >= lo)
    return average, grade


def build_comparison_summary(manager, employee):
    summary = {}
    for item in CRITERIA:
        code = item["code"]
        left, right = manager.criterion_ratings[code], employee.criterion_ratings[code]
        summary[code] = {
            "manager_grade": left["grade"],
            "manager_score": left["score"],
            "employee_grade": right["grade"],
            "employee_score": right["score"],
            "difference": left["score"] - right["score"],
        }
    for name, response in (("manager", manager), ("employee", employee)):
        summary[f"{name}_average"] = str(response.average_score)
        summary[f"{name}_overall_grade"] = response.overall_grade
    return summary
