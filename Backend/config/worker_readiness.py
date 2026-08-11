from __future__ import annotations

import os
import socket
import sys
import time
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

import redis
import requests


class ReadinessError(RuntimeError):
    pass


@dataclass(frozen=True)
class ReadinessConfig:
    whatsapp_enabled: bool
    broker_url: str
    result_backend: str
    evolution_api_url: str
    evolution_api_key_configured: bool
    evolution_instance_configured: bool
    timeout_seconds: float
    interval_seconds: float
    request_timeout_seconds: float


def _env_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_config(environ: Mapping[str, str] | None = None) -> ReadinessConfig:
    env = environ or os.environ
    return ReadinessConfig(
        whatsapp_enabled=_env_bool(env.get("NOTIFICATION_WHATSAPP_DELIVERY_ENABLED"), True),
        broker_url=env.get("CELERY_BROKER_URL", "redis://localhost:6379/2"),
        result_backend=env.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/3"),
        evolution_api_url=env.get("EVOLUTION_API_BASE_URL", "").strip(),
        evolution_api_key_configured=bool(env.get("EVOLUTION_API_KEY", "").strip()),
        evolution_instance_configured=bool(env.get("EVOLUTION_INSTANCE_NAME", "").strip()),
        timeout_seconds=max(1.0, float(env.get("NOTIFICATION_WORKER_READINESS_TIMEOUT_SECONDS", "60"))),
        interval_seconds=max(0.1, float(env.get("NOTIFICATION_WORKER_READINESS_INTERVAL_SECONDS", "2"))),
        request_timeout_seconds=max(0.1, float(env.get("NOTIFICATION_WORKER_READINESS_REQUEST_TIMEOUT_SECONDS", "5"))),
    )


def _target(url: str, *, default_port: int) -> tuple[str, int, str]:
    parsed = urlsplit(url)
    if parsed.scheme not in {"redis", "rediss", "http", "https"} or not parsed.hostname:
        raise ReadinessError("Service URL must include a supported scheme and hostname.")
    port = parsed.port or default_port
    return parsed.hostname, port, f"{parsed.hostname}:{port}"


def check_redis(url: str) -> str:
    host, port, target = _target(url, default_port=6379)
    try:
        socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        client = redis.Redis.from_url(url, socket_connect_timeout=3, socket_timeout=3)
        try:
            if client.ping() is not True:
                raise ReadinessError(f"Redis at {target} did not accept a ping.")
        finally:
            client.close()
    except ReadinessError:
        raise
    except Exception as exc:
        raise ReadinessError(f"Redis at {target} is unavailable ({type(exc).__name__}).") from None
    return target


def check_evolution_api(base_url: str, *, request_timeout_seconds: float) -> str:
    host, port, target = _target(base_url, default_port=443 if base_url.startswith("https://") else 80)
    try:
        socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        response = requests.get(f"{base_url.rstrip('/')}/", timeout=request_timeout_seconds, allow_redirects=False)
        if response.status_code >= 500:
            raise ReadinessError(f"Evolution API at {target} returned HTTP {response.status_code}.")
    except ReadinessError:
        raise
    except Exception as exc:
        raise ReadinessError(f"Evolution API at {target} is unavailable ({type(exc).__name__}).") from None
    return target


def check_required_services(config: ReadinessConfig) -> list[str]:
    ready = []
    seen_redis_targets = set()
    for label, url in (("broker", config.broker_url), ("result backend", config.result_backend)):
        _, _, target = _target(url, default_port=6379)
        if target in seen_redis_targets:
            continue
        check_redis(url)
        seen_redis_targets.add(target)
        ready.append(f"Redis {label} ({target})")

    if config.whatsapp_enabled:
        if not config.evolution_api_url:
            raise ReadinessError(
                "WhatsApp delivery is enabled but EVOLUTION_API_BASE_URL is not configured. "
                "Configure Evolution or set NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=false."
            )
        if not config.evolution_api_key_configured or not config.evolution_instance_configured:
            raise ReadinessError(
                "WhatsApp delivery is enabled but Evolution credentials or instance name are not fully configured."
            )
        target = check_evolution_api(
            config.evolution_api_url,
            request_timeout_seconds=config.request_timeout_seconds,
        )
        ready.append(f"Evolution API ({target})")
    else:
        ready.append("Evolution API check skipped (WhatsApp delivery disabled)")
    return ready


def wait_for_required_services(
    config: ReadinessConfig | None = None,
    *,
    sleep=time.sleep,
    monotonic=time.monotonic,
) -> list[str]:
    config = config or load_config()
    deadline = monotonic() + config.timeout_seconds
    last_error = "readiness check did not run"
    while True:
        try:
            return check_required_services(config)
        except ReadinessError as exc:
            last_error = str(exc)
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise ReadinessError(
                    f"Notification worker readiness timed out after {config.timeout_seconds:g}s: {last_error}"
                ) from None
            print(f"Notification worker waiting: {last_error}", flush=True)
            sleep(min(config.interval_seconds, remaining))


def main() -> int:
    try:
        ready = wait_for_required_services()
    except (ReadinessError, ValueError) as exc:
        print(f"Notification worker readiness failed: {exc}", file=sys.stderr, flush=True)
        return 1
    for service in ready:
        print(f"Notification worker readiness OK: {service}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
