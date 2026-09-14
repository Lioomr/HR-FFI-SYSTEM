from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from audit.utils import audit
from core.permissions import IsHRManagerOrAdmin, get_role
from core.responses import error, success

from .models import SystemSettings
from .serializers_settings import AttendanceSettingsUpdateSerializer, SettingsUpdateSerializer, to_settings_response


class SettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.request.method == "PUT":
            return [IsAuthenticated(), IsHRManagerOrAdmin()]
        return [IsAuthenticated()]

    def get(self, request):
        obj = SystemSettings.get_solo()
        return success(to_settings_response(obj))

    def put(self, request):
        attendance_only = set(request.data.keys()) == {"attendance"}
        if attendance_only:
            s = AttendanceSettingsUpdateSerializer(data=request.data)
        elif get_role(request.user) == "SystemAdmin":
            s = SettingsUpdateSerializer(data=request.data)
        else:
            return error("Only System Admin may update non-attendance settings.", status=403)
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
