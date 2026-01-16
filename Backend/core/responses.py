from rest_framework.response import Response

def success(data=None, message=None, status=200):
    payload = {"status": "success", "data": data if data is not None else {}}
    if message:
        payload["message"] = message
    return Response(payload, status=status)

def error(message="Request failed", errors=None, status=400):
    payload = {"status": "error", "message": message}
    if errors is not None:
        payload["errors"] = errors
    return Response(payload, status=status)
