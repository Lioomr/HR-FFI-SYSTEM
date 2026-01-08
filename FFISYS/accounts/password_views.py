from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .audit import log_action


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        new_password = request.data.get("new_password")
        if not new_password:
            return Response({"error": "Password required"}, status=400)

        user = request.user
        user.set_password(new_password)
        user.must_change_password = False
        user.invite_expires_at = None
        user.save()

        log_action(
            actor=user,
            action="CHANGE_PASSWORD",
            target=user.email,
            ip=request.META.get("REMOTE_ADDR"),
        )

        return Response({"status": "password updated"})
