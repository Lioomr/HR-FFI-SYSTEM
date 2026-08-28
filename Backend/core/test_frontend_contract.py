"""Contract regression tests for routes consumed by the frontend.

These paths are hardcoded in ``FrontEnd/src/services/api/*.ts``. If a backend
URL moves, the frontend silently gets 404s (unit tests mock the API module, so
they cannot catch this). If any assertion here fails, update the frontend
service in the same PR.

Audit reference: ``docs/code-audit-findings.md`` (C1, C2).
"""

from django.test import SimpleTestCase
from django.urls import resolve


class FrontendContractRoutesTests(SimpleTestCase):
    def _assert_route(self, path, expected_cls, expected_detail):
        match = resolve(path)
        cls_name = getattr(getattr(match.func, "cls", None), "__name__", "")
        self.assertEqual(cls_name, expected_cls, f"{path} resolved to {cls_name or match.func}")
        self.assertEqual(
            match.func.initkwargs.get("detail"),
            expected_detail,
            f"{path} detail flag mismatch",
        )

    def test_ceo_asset_damage_report_routes(self):
        self._assert_route("/api/ceo/assets/damage-reports/", "CEOAssetDamageReportViewSet", False)
        self._assert_route("/api/ceo/assets/damage-reports/1/approve/", "CEOAssetDamageReportViewSet", True)
        self._assert_route("/api/ceo/assets/damage-reports/1/reject/", "CEOAssetDamageReportViewSet", True)

    def test_ceo_asset_return_request_routes(self):
        self._assert_route("/api/ceo/assets/return-requests/", "CEOAssetReturnRequestViewSet", False)
        self._assert_route("/api/ceo/assets/return-requests/1/approve/", "CEOAssetReturnRequestViewSet", True)
        self._assert_route("/api/ceo/assets/return-requests/1/reject/", "CEOAssetReturnRequestViewSet", True)

    def test_employee_import_history_routes(self):
        self._assert_route("/imports/employees/history/5/", "EmployeeImportHistoryViewSet", True)
        self._assert_route("/imports/employees/history/5/errors-file", "EmployeeImportHistoryViewSet", True)
