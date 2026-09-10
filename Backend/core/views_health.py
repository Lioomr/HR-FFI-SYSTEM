import logging
import secrets

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config.worker_readiness import ReadinessError, check_evolution_api, check_redis
from core.services.email_service import EmailService

logger = logging.getLogger(__name__)

HEALTH_COMPONENTS_CACHE_KEY = "core:healthz:components"
HEALTH_TOKEN_HEADER = "HTTP_X_HEALTH_TOKEN"
HEALTHY_COMPONENT_VALUES = frozenset({"ok", "disabled", "configured"})


def _check_database() -> str:
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return "ok"
    except Exception:
        logger.exception("health_check_database_failed")
        return "down"


def _check_database_migrations() -> str:
    try:
        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        return "pending" if pending else "ok"
    except Exception:
        logger.exception("health_check_database_migrations_failed")
        return "down"


def _check_celery_worker() -> str:
    try:
        from config.celery import app as celery_app

        replies = celery_app.control.inspect(timeout=2.0).ping() or {}
        return "ok" if replies else "down"
    except Exception:
        logger.exception("health_check_celery_worker_failed")
        return "down"


def _check_redis(url: str) -> str:
    try:
        check_redis(url)
        return "ok"
    except ReadinessError:
        return "down"
    except Exception:
        logger.exception("health_check_redis_failed")
        return "down"


def _check_evolution_api() -> str:
    if not getattr(settings, "NOTIFICATION_WHATSAPP_DELIVERY_ENABLED", True):
        return "disabled"
    base_url = getattr(settings, "EVOLUTION_API_BASE_URL", "")
    if not base_url:
        return "not_configured"
    try:
        check_evolution_api(base_url, request_timeout_seconds=3.0)
        return "ok"
    except ReadinessError:
        return "down"
    except Exception:
        logger.exception("health_check_evolution_api_failed")
        return "down"


def _check_email_provider() -> str:
    try:
        return "configured" if EmailService().is_configured() else "not_configured"
    except Exception:
        logger.exception("health_check_email_provider_failed")
        return "down"


def _collect_components() -> dict[str, str]:
    return {
        "database": _check_database(),
        "database_migrations": _check_database_migrations(),
        "redis": _check_redis(getattr(settings, "REDIS_URL", "redis://localhost:6379/0")),
        "celery_broker": _check_redis(getattr(settings, "CELERY_BROKER_URL", "redis://localhost:6379/2")),
        "celery_worker": _check_celery_worker(),
        "evolution_api": _check_evolution_api(),
        "email_provider": _check_email_provider(),
    }


def _cache_timeout_seconds() -> int:
    try:
        return max(0, int(getattr(settings, "HEALTH_CHECK_CACHE_SECONDS", 15)))
    except (TypeError, ValueError):
        return 15


def _get_components() -> dict[str, str]:
    """Reuse recent probe results so repeated calls cannot amplify into load on every dependency."""
    timeout = _cache_timeout_seconds()
    if timeout <= 0:
        return _collect_components()

    try:
        cached = cache.get(HEALTH_COMPONENTS_CACHE_KEY)
    except Exception:
        logger.exception("health_check_cache_read_failed")
        cached = None
    if isinstance(cached, dict):
        return cached

    components = _collect_components()
    try:
        cache.set(HEALTH_COMPONENTS_CACHE_KEY, components, timeout)
    except Exception:
        logger.exception("health_check_cache_write_failed")
    return components


def _has_valid_probe_token(request) -> bool:
    expected = (getattr(settings, "HEALTH_CHECK_TOKEN", "") or "").strip()
    if not expected:
        return False
    provided = (request.META.get(HEALTH_TOKEN_HEADER) or "").strip()
    if not provided:
        return False
    return secrets.compare_digest(provided, expected)


def _is_admin_user(request) -> bool:
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return False
    if user.is_staff or user.is_superuser:
        return True
    try:
        return user.groups.filter(name="SystemAdmin").exists()
    except Exception:
        logger.exception("health_check_group_lookup_failed")
        return False


def _is_diagnostics_authorized(request) -> bool:
    return _has_valid_probe_token(request) or _is_admin_user(request)


class HealthCheckView(APIView):
    """Public liveness probe.

    Anonymous callers only learn that the process is serving requests. Dependency
    diagnostics (database, migrations, Redis, Celery, Evolution API, email provider)
    reveal internal infrastructure state and are expensive to compute, so they are
    limited to admin users or callers presenting the ``X-Health-Token`` probe token.
    Readiness probes should send that header to receive the 503 on degradation.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        if not _is_diagnostics_authorized(request):
            return Response({"status": "ok"}, status=status.HTTP_200_OK)

        components = _get_components()
        unhealthy = {name: value for name, value in components.items() if value not in HEALTHY_COMPONENT_VALUES}
        overall_status = status.HTTP_200_OK if not unhealthy else status.HTTP_503_SERVICE_UNAVAILABLE
        return Response(
            {"status": "ok" if not unhealthy else "degraded", "components": components},
            status=overall_status,
        )
