from django.db import models
from django.utils.translation import gettext_lazy as _


class RatingGrade(models.TextChoices):
    EXCELLENT = "EXCELLENT", _("Excellent")
    VERY_GOOD = "VERY_GOOD", _("Very Good")
    GOOD = "GOOD", _("Good")
    ACCEPTABLE = "ACCEPTABLE", _("Acceptable")
    POOR = "POOR", _("Poor")


GRADE_RANGES = {
    RatingGrade.EXCELLENT: (90, 100),
    RatingGrade.VERY_GOOD: (80, 89),
    RatingGrade.GOOD: (70, 79),
    RatingGrade.ACCEPTABLE: (60, 69),
    RatingGrade.POOR: (0, 59),
}


CRITERIA = tuple(
    {"code": code, "label_en": en, "label_ar": ar, "display_order": order}
    for order, (code, en, ar) in enumerate(
        (
            (
                "work_accomplishment",
                "Accomplishment of the work according to the required level",
                "إنجاز العمل بالمستوى المطلوب",
            ),
            ("cooperation", "Cooperation and helping colleagues", "التعاون ومساعدة الزملاء"),
            (
                "company_loyalty",
                "Loyalty to the company and preserving its interests",
                "الإخلاص للشركة والمحافظة على مصالحها",
            ),
            (
                "work_rules_understanding",
                "Ability to understand work rules and procedures",
                "القدرة على استيعاب قواعد وأساليب العمل",
            ),
            ("work_discipline", "Regularity and discipline at work", "الترتيب والنظام في العمل"),
            ("policy_compliance", "Observing company policies and systems", "الالتزام بأنظمة وسياسات الشركة"),
            ("work_improvement", "Caring of work improvement and development", "الاهتمام بتطوير وتحسين مستوى العمل"),
            ("initiative_creativity", "Initiative and creativity at work", "المبادرة والابتكار في العمل"),
            ("decision_making", "Ability for taking sound decisions", "القدرة على اتخاذ القرارات"),
            (
                "work_pressure_response",
                "Working hard and responding to work pressure",
                "الاجتهاد والتجاوب مع ضغط العمل",
            ),
            (
                "timely_completion",
                "Accomplishment of the work according to the required time",
                "إنجاز العمل في الموعد المطلوب",
            ),
            ("company_property_care", "Preserving the company properties", "المحافظة على ممتلكات الشركة"),
            ("independent_work", "Ability to work without supervision", "القدرة على العمل دون مراقبة"),
            ("greater_responsibility", "Ability to bear a larger responsibility", "القدرة على تحمل مسؤولية أكبر"),
            ("respect_others", "Respecting others", "احترام الغير"),
            (
                "accepts_manager_feedback",
                "Accepting directions and criticism of one's manager",
                "تقبل توجيهات وانتقادات الرؤساء",
            ),
            ("personal_behavior", "Personal behavior", "التصرف الشخصي"),
            ("appearance", "Appearance", "المظهر"),
        ),
        start=1,
    )
)
CRITERION_CODES = frozenset(item["code"] for item in CRITERIA)
