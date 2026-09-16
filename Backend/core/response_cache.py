"""Small helpers for the short-TTL response caches on hot, read-heavy endpoints.

These endpoints (HR summary, admin summary, employee list) recompute the same
answer for every request that shares the same scope (company id, query
string, ...) within a short window, so we cache the already-serialized
response payload rather than re-running the underlying queries every time.

The cache backend is django-redis in production -- configured with
``IGNORE_EXCEPTIONS: True`` and short socket timeouts (see
``config/settings.py``), so a Redis outage or hiccup fails open and simply
behaves like a cache miss. Callers of this module therefore never need to
wrap ``cache.get``/``cache.set`` in try/except. Under pytest, ``CACHES`` is
swapped to Django's in-process ``LocMemCache``.

Every cache key here is built from non-user-specific scope values (a company
id, a global marker, or -- for the employee list -- the resolved organization
scope id and the full canonical query string). Callers are responsible for
never including a per-request user id in these keys, and for never reading or
writing this cache at all for a response whose contents vary per requesting
user (see ``EmployeeProfileViewSet.list`` for the branch that must skip this
cache entirely).
"""

from __future__ import annotations

from django.core.cache import cache


def canonical_query_string(query_params) -> str:
    """Return a deterministic string for a query dict, independent of param order.

    Two requests that differ only in the order of their query parameters (or
    the order of repeated values for the same key) must produce the same
    cache key; two requests with genuinely different params/values must not.
    """
    keys = list(query_params.keys()) if hasattr(query_params, "keys") else []
    items = []
    for key in sorted(keys):
        if hasattr(query_params, "getlist"):
            values = query_params.getlist(key)
        else:
            raw = query_params.get(key)
            values = [raw] if raw is not None else []
        for value in sorted(str(v) for v in values):
            items.append(f"{key}={value}")
    return "&".join(items)


def build_cache_key(*parts: object) -> str:
    return ":".join(str(part) for part in parts)


def get_cached_response_data(key: str):
    """Return the cached payload for ``key``, or ``None`` on a miss/expired entry."""
    return cache.get(key)


def set_cached_response_data(key: str, data, timeout: int) -> None:
    """Cache ``data`` under ``key`` for ``timeout`` seconds (no-op if timeout <= 0)."""
    if timeout and timeout > 0:
        cache.set(key, data, timeout)


def get_cache_version(version_key: str) -> int:
    """Return the current version counter for ``version_key``, seeding it at 1."""
    version = cache.get(version_key)
    if version is None:
        version = 1
        cache.set(version_key, version, None)
    return version


def bump_cache_version(version_key: str) -> None:
    """Best-effort cache-buster: increment an integer version counter.

    Callers fold the current version into their cache key, so a write can
    invalidate every previously-cached query-string variant for a scope
    (e.g. a company) without enumerating or deleting each one individually --
    the old keys simply become unreachable once the version changes.

    This is a best-effort optimization on top of the TTL, not a substitute
    for it: if the cache backend does not support ``incr`` (or the key
    doesn't exist yet), we just reseed it rather than raise.
    """
    try:
        cache.incr(version_key)
    except ValueError:
        cache.set(version_key, 2, None)
