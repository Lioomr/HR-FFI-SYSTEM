from rest_framework.views import exception_handler
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

def custom_exception_handler(exc, context):
    resp = exception_handler(exc, context)

    if resp is None:
        return Response({"status": "error", "message": "Server error"}, status=500)

    if isinstance(exc, ValidationError):
        # DRF returns dict(field -> [msgs]) which matches your frontend expectations
        return Response(
            {"status": "error", "message": "Validation error", "errors": resp.data},
            status=422,
        )

    message = "Request failed"
    if isinstance(resp.data, dict) and "detail" in resp.data:
        message = str(resp.data["detail"])

    return Response({"status": "error", "message": message}, status=resp.status_code)
