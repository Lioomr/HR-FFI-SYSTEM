"""Contract tests for the intentionally duplicated URL mounts.

``config/urls.py`` includes ``employees.urls`` and ``audit.urls`` twice: once
unprefixed (legacy, still called by existing frontend screens) and once under the
canonical ``/api/`` prefix. Two mounts of the same app can silently drift -- a new
route added behind one prefix, or an earlier include shadowing a path under only
one of them -- and the frontend then gets 404s on whichever prefix it happens to
use.

These tests walk every route in both apps and assert the two prefixes resolve to
the same view. Delete them together with the legacy unprefixed mount.
"""

from django.test import SimpleTestCase
from django.urls import resolve
from django.urls.exceptions import Resolver404
from django.urls.resolvers import URLPattern, URLResolver

import audit.urls
import employees.urls


def _flatten(patterns, prefix=""):
    """Yield the raw route string of every leaf pattern, including nested includes."""
    for entry in patterns:
        route = getattr(entry.pattern, "_route", None)
        raw = route if route is not None else str(entry.pattern)
        if isinstance(entry, URLResolver):
            yield from _flatten(entry.url_patterns, prefix + raw)
        elif isinstance(entry, URLPattern):
            yield prefix + raw


def _sample_path(raw):
    """Turn a ``path()`` route or a DRF router regex into a concrete request path.

    Returns ``None`` for the router's format-suffix variants, which duplicate a
    route already covered by its plain form.
    """
    # Router format-suffix variants appear both as a regex capture and as DRF's
    # <drf_format_suffix:format> path converter.
    if "format>" in raw:
        return None

    out = raw
    # Regex captures from DRF routers, always of the form (?P<name>[^/.]+).
    while "(?P<" in out:
        start = out.index("(?P<")
        end = out.index(")", start)
        out = out[:start] + "1" + out[end + 1 :]
    # Path converters from path(), e.g. <int:pk> or <str:key>.
    while "<" in out and ">" in out:
        start = out.index("<")
        end = out.index(">", start)
        converter = out[start + 1 : end]
        out = out[:start] + ("1" if converter.startswith("int:") else "sample") + out[end + 1 :]

    return out.lstrip("^").rstrip("$").replace("/?", "/")


def _view_identity(path):
    try:
        match = resolve(path)
    except Resolver404:
        return "RESOLVER404"

    func = match.func
    view_class = getattr(func, "cls", None) or getattr(func, "view_class", None)
    name = f"{view_class.__module__}.{view_class.__name__}" if view_class else f"{func.__module__}.{func.__qualname__}"
    # ``actions`` distinguishes a viewset's list route from its detail route.
    return f"{name}|{match.url_name}|{sorted(match.kwargs)}|{getattr(func, 'actions', None)}"


class DualMountRouteContractTests(SimpleTestCase):
    def _assert_prefixes_match(self, module, label):
        checked = 0
        seen = set()
        for raw in _flatten(module.urlpatterns):
            path = _sample_path(raw)
            if path is None or path in seen:
                continue
            seen.add(path)
            checked += 1

            bare = _view_identity("/" + path)
            prefixed = _view_identity("/api/" + path)
            self.assertEqual(
                bare,
                prefixed,
                f"{label}: /{path} and /api/{path} resolve differently. "
                "Both mounts must stay equivalent until the legacy unprefixed routes are retired.",
            )
            self.assertNotEqual(bare, "RESOLVER404", f"{label}: /{path} does not resolve under either prefix")

        self.assertGreater(checked, 0, f"{label}: no routes were checked")

    def test_employee_routes_are_identical_under_both_prefixes(self):
        self._assert_prefixes_match(employees.urls, "employees.urls")

    def test_audit_routes_are_identical_under_both_prefixes(self):
        self._assert_prefixes_match(audit.urls, "audit.urls")
