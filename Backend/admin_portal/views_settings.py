from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsSystemAdmin
from core.responses import success, error
from audit.utils import audit

from .models import SystemSettings
from .serializers_settings import SettingsUpdateSerializer, to_settings_response


class SettingsView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def get(self, request):
        obj = SystemSettings.get_solo()
        return success(to_settings_response(obj))

    def put(self, request):
        s = SettingsUpdateSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors, status=422)

        obj, changed = s.save()

        audit(
            request,
            action="settings_updated",
            entity="settings",
            entity_id="1",
            metadata={"changed": changed},
        )

        return success(to_settings_response(obj))
