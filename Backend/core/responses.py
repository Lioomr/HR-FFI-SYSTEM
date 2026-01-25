from rest_framework.response import Response


def _normalize_422_errors(errors):
    if errors is None:
        return None
    if isinstance(errors, list):
        return errors
    if isinstance(errors, dict):
        normalized = []
        for field, messages in errors.items():
            if isinstance(messages, (list, tuple)):
                for msg in messages:
                    normalized.append({"field": field, "message": str(msg)})
            else:
                normalized.append({"field": field, "message": str(messages)})
        return normalized
    if isinstance(errors, str):
        return [{"message": errors}]
    return [{"message": str(errors)}]


def success(data=None, message=None, status=200):
    payload = {"status": "success", "data": data if data is not None else {}}
    if message:
        payload["message"] = message
    return Response(payload, status=status)


def error(message="Request failed", errors=None, status=400):
    payload = {"status": "error", "message": message}
    if errors is not None:
        payload["errors"] = _normalize_422_errors(errors) if status == 422 else errors
    return Response(payload, status=status)
