import logging
import os

import requests

logger = logging.getLogger(__name__)


class CogneeError(RuntimeError):
    pass


def _enabled():
    return os.environ.get("COGNEE_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def _request(method, path, payload=None):
    if not _enabled():
        return None
    base_url = os.environ.get("COGNEE_BASE_URL", "http://cognee:8000").rstrip("/")
    url = f"{base_url}/{path.lstrip('/')}"
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("COGNEE_API_KEY")
    if api_key:
        headers["X-Api-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        response = requests.request(
            method,
            url,
            json=payload,
            headers=headers,
            timeout=float(os.environ.get("COGNEE_TIMEOUT_SECONDS", "10")),
        )
        response.raise_for_status()
        return response.json() if response.content else {}
    except requests.RequestException as exc:
        raise CogneeError(f"Cognee request failed: {exc}") from exc


def remember(text, *, company_id=None, user_id=None, dataset="ffi_hr"):
    """Store non-sensitive agent context in Cognee.

    The dataset is company-scoped to prevent cross-company retrieval.
    Callers must redact PII and confidential HR records before using this adapter.
    """
    return _request(
        "POST",
        os.environ.get("COGNEE_ADD_PATH", "/api/v1/add"),
        {
            "data": text,
            "dataset_name": f"{dataset}:company:{company_id or 'global'}",
            "user": str(user_id) if user_id else None,
        },
    )


def recall(query, *, company_id=None, dataset="ffi_hr"):
    return _request(
        "POST",
        os.environ.get("COGNEE_SEARCH_PATH", "/api/v1/search"),
        {
            "search_query": query,
            "datasets": [f"{dataset}:company:{company_id or 'global'}"],
        },
    )


def status():
    if not _enabled():
        return {"enabled": False, "reachable": False}
    try:
        _request("GET", os.environ.get("COGNEE_HEALTH_PATH", "/health"))
        return {"enabled": True, "reachable": True}
    except CogneeError as exc:
        logger.warning("Cognee is unavailable: %s", exc)
        return {"enabled": True, "reachable": False}
