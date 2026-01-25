from rest_framework.views import exception_handler
from rest_framework.exceptions import ValidationError
from django.http import Http404

from core.responses import error

def custom_exception_handler(exc, context):
    if isinstance(exc, Http404):
        return error("Not found", status=404)

    resp = exception_handler(exc, context)

    if resp is None:
        return error("Server error", status=500)

    if isinstance(exc, ValidationError):
        return error("Validation error", errors=resp.data, status=422)

    message = "Request failed"
    if isinstance(resp.data, dict) and "detail" in resp.data:
        message = str(resp.data["detail"])

    return error(message, status=resp.status_code)
