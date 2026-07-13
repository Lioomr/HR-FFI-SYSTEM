import logging

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config.worker_readiness import ReadinessError, check_evolution_api, check_redis
from core.services.email_service import EmailService

logger = logging.getLogger(__name__)


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


class HealthCheckView(APIView):
    """Lightweight liveness/readiness probe for infra monitoring only, no dashboard."""

    permission_classes = [AllowAny]

    def get(self, request):
        components = {
            "redis": _check_redis(getattr(settings, "REDIS_URL", "redis://localhost:6379/0")),
            "celery_broker": _check_redis(getattr(settings, "CELERY_BROKER_URL", "redis://localhost:6379/2")),
            "celery_worker": _check_celery_worker(),
            "evolution_api": _check_evolution_api(),
            "email_provider": _check_email_provider(),
        }
        unhealthy = {
            name: value
            for name, value in components.items()
            if value not in {"ok", "disabled", "configured"}
        }
        overall_status = status.HTTP_200_OK if not unhealthy else status.HTTP_503_SERVICE_UNAVAILABLE
        return Response(
            {"status": "ok" if not unhealthy else "degraded", "components": components},
            status=overall_status,
        )
