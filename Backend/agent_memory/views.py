from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import CogneeError, recall, remember, status as cognee_status


class MemoryStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"data": cognee_status(), "message": "Memory status", "status": "success"})


class MemoryRecallView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        query = request.data.get("query")
        if not isinstance(query, str) or not query.strip():
            return Response({"error": "query is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = recall(query.strip(), company_id=request.headers.get("x-active-company-id"))
        except CogneeError as exc:
            return Response({"error": "Memory service unavailable", "detail": str(exc)}, status=503)
        return Response({"data": result or [], "message": "Memory recalled", "status": "success"})


class MemoryRememberView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        text = request.data.get("text")
        if not isinstance(text, str) or not text.strip():
            return Response({"error": "text is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = remember(
                text.strip(),
                company_id=request.headers.get("x-active-company-id"),
                user_id=request.user.pk,
            )
        except CogneeError as exc:
            return Response({"error": "Memory service unavailable", "detail": str(exc)}, status=503)
        return Response({"data": result or {}, "message": "Memory stored", "status": "success"})

