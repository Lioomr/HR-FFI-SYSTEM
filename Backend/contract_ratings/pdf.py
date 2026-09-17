"""Approved, map-driven Contract Rating PDF renderer."""

from __future__ import annotations

from core.pdf_forms import load_form_assets, render_mapped_form
from core.pdf_signers import signature_for_user

from .criteria import CRITERIA

TEMPLATE_FILENAME = "employee_evaluation_blank.pdf"
FIELD_MAP_FILENAME = "employee_evaluation_blank_field_map.json"


def _range_key(score):
    score = int(score or 0)
    if score <= 60:
        return "0_to_60"
    if score <= 69:
        return "61_to_69"
    if score <= 79:
        return "70_to_79"
    if score <= 89:
        return "80_to_89"
    return "90_to_100"


def build_contract_rating_pdf(rating) -> bytes:
    """Fill the HR-approved template with the manager evaluation only.

    A manager may download their own report without exposing the employee's
    confidential self-evaluation. HR/CEO see the same authoritative document.
    """
    assets = load_form_assets(
        TEMPLATE_FILENAME,
        FIELD_MAP_FILENAME,
        required_keys=("employee_name", "rating_1", "recommendation"),
    )
    if assets is None:
        raise ValueError("The approved employee evaluation PDF template is unavailable.")

    profile = rating.employee_profile
    response = rating.manager_response
    values = {
        "reference_no": f"CR-{rating.id}",
        "document_date": rating.created_at.date().isoformat(),
        "employee_name": profile.full_name,
        "position": rating.job_title_snapshot,
        "employee_no": profile.employee_number or profile.employee_id,
        "department": rating.department_snapshot,
        "section": rating.section_snapshot,
        "evaluation_from": rating.evaluation_period_from.isoformat() if rating.evaluation_period_from else "",
        "evaluation_to": rating.evaluation_period_to.isoformat() if rating.evaluation_period_to else "",
        "direct_manager_name": rating.manager_at_creation.full_name if rating.manager_at_creation else "",
        "hr_name": rating.hr_reviewed_by.full_name if rating.hr_reviewed_by else "",
        "ceo_name": rating.ceo_decided_by.full_name if rating.ceo_decided_by else "",
    }
    if response:
        for index, criterion in enumerate(CRITERIA, start=1):
            answer = response.criterion_ratings.get(criterion["code"], {})
            if answer:
                values[f"rating_{index}"] = _range_key(answer.get("score"))
                values[f"remark_{index}"] = answer.get("remark", "")
        values["average"] = str(response.average_score)
        values["recommendation"] = (
            "terminate"
            if response.recommendation == "TERMINATE"
            else "renew_with_salary_increase"
            if "SALARY_INCREASE" in (response.recommended_change_types or [])
            else "proceed"
        )

    signatures = {
        "direct_manager_signature_image": signature_for_user(rating.manager_at_creation),
        "hr_signature_image": signature_for_user(rating.hr_reviewed_by),
        "ceo_signature_image": signature_for_user(rating.ceo_decided_by),
    }
    pdf_bytes, _ = render_mapped_form(assets, values, signatures=signatures)
    return pdf_bytes
