"""Cache-key helpers for the employee list response cache.

Kept separate from views.py (rather than living inline there) so the
best-effort invalidation signal in employees/signals.py can bump the version
counter without importing the large views module.
"""

from core.response_cache import build_cache_key, get_cache_version


def employee_list_cache_version_key(company_id: int) -> str:
    return build_cache_key("employee_list_version", "company", company_id)


def employee_list_cache_version(company_id: int) -> int:
    return get_cache_version(employee_list_cache_version_key(company_id))
