"""Who the executives (top tier) are: the CEO and the General Manager.

Executives decide other people's requests. They are never the requester or subject of a
request, a contract rating or a contract decision, and they get the executive notification
policy (``in_app_notifications.executive_policy``). Every check goes through this module so
both rules always agree.

The General Manager has no user account, so a profile counts by its title as well as by the
CEO group. Titles are compared trimmed, case-insensitively and exactly ("Assistant General
Manager" is not an executive) until a model flag replaces them.
"""

from __future__ import annotations

import re

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q

EXECUTIVE_GROUP = "CEO"
EXECUTIVE_TITLES = frozenset({"chief executive officer", "general manager", "المدير العام"})
EXECUTIVE_REQUEST_ERROR = "Requests cannot be submitted by or for the CEO or General Manager."

_TITLE_REGEX = r"^\s*(" + "|".join(re.escape(title) for title in sorted(EXECUTIVE_TITLES)) + r")\s*$"


def _has_executive_title(profile) -> bool:
    names = {
        (getattr(profile, "job_title", "") or "").strip().lower(),
        (getattr(profile, "job_title_en", "") or "").strip().lower(),
    }
    position = getattr(profile, "position_ref", None)
    if position is not None:
        names.add((getattr(position, "name", "") or "").strip().lower())
    return bool(names & EXECUTIVE_TITLES)


def _in_executive_group(user) -> bool:
    return bool(user and getattr(user, "pk", None)) and user.groups.filter(name=EXECUTIVE_GROUP).exists()


def is_executive_user(user) -> bool:
    """CEO group member, or a user whose profile title/position is an executive title."""
    if not user or not getattr(user, "pk", None):
        return False
    if _in_executive_group(user):
        return True
    try:
        profile = user.employee_profile
    except (AttributeError, ObjectDoesNotExist):
        return False
    return _has_executive_title(profile)


def is_executive_profile(profile) -> bool:
    """Profile form of ``is_executive_user``; also covers an executive with no user account."""
    if profile is None:
        return False
    if _has_executive_title(profile):
        return True
    return bool(profile.user_id) and _in_executive_group(profile.user)


def executive_profile_q(prefix: str = "") -> Q:
    """Queryset form of ``is_executive_profile`` for profiles reached through ``prefix``."""
    return (
        Q(**{f"{prefix}user__groups__name": EXECUTIVE_GROUP})
        | Q(**{f"{prefix}job_title__iregex": _TITLE_REGEX})
        | Q(**{f"{prefix}job_title_en__iregex": _TITLE_REGEX})
        | Q(**{f"{prefix}position_ref__name__iregex": _TITLE_REGEX})
    )
