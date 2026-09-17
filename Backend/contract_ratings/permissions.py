from rest_framework.exceptions import PermissionDenied

from core.permissions import is_department_ceo_approver_user, is_hr_workflow_approver_user
from employees.services.manager_relationships import manager_approval_actor_source
from organization.services import get_user_accessible_company_ids


def require_company_access(actor, rating):
    if not actor or not actor.is_active or rating.company_id not in get_user_accessible_company_ids(actor):
        raise PermissionDenied("You cannot access this rating's company.")


def viewer_role(actor, rating):
    if not actor or not actor.is_authenticated:
        return None
    if rating.rating_mode == rating.RatingMode.RATE and rating.employee_profile.user_id == actor.id:
        return "employee"
    if rating.rating_mode == rating.RatingMode.RATE and manager_approval_actor_source(actor, rating.employee_profile):
        return "manager"
    if is_hr_workflow_approver_user(actor):
        return "hr"
    if is_department_ceo_approver_user(actor) and (
        rating.status == "PENDING_CEO" or rating.ceo_decided_by_id == actor.id
    ):
        return "ceo"
    return None
