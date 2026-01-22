from rest_framework.views import exception_handler
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from django.http import Http404

def custom_exception_handler(exc, context):
    print(f"DEBUG_EXC: {type(exc)} {exc}")
    if isinstance(exc, Http404):
        return Response({"status": "error", "message": "Not found"}, status=404)

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
