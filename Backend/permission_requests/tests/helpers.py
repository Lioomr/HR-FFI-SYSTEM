from django.utils import timezone

BASE_URL = "/api/permission-requests/"


def payload(**overrides):
    data = {
        "request_date": timezone.localdate().isoformat(),
        "from_time": "09:00",
        "to_time": "10:00",
        "exit_type": "personal",
        "reason": "Personal appointment",
    }
    data.update(overrides)
    return data


def field_errors(response):
    """``{field: [message, ...]}`` from the standard 422 envelope."""

    grouped = {}
    for item in response.data.get("errors", []):
        if isinstance(item, dict):
            grouped.setdefault(item.get("field"), []).append(item.get("message"))
    return grouped
