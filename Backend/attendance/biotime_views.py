from rest_framework import views, viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from .models import BioTimeConfig, BioTimeEmployeeMap
from .serializers import BioTimeConfigSerializer, BioTimeEmployeeMapSerializer
from .biotime_client import BioTimeClient
from .services import SyncBioTimeService
from core.permissions import IsHRManagerOrAdmin


class BioTimeConfigViewSet(views.APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        config = BioTimeConfig.get_solo()
        serializer = BioTimeConfigSerializer(config)
        return Response(serializer.data)

    def put(self, request):
        config = BioTimeConfig.get_solo()
        payload = request.data.copy()
        if "password" in payload and not payload["password"]:
            payload.pop("password")

        serializer = BioTimeConfigSerializer(config, data=payload, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class BioTimeActionsViewSet(views.APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, action):
        if action == "test-connection":
            config = BioTimeConfig.get_solo()
            
            # Allow testing with submitted data if provided, otherwise use saved config
            ip = request.data.get("server_ip", config.server_ip)
            port = request.data.get("server_port", config.server_port)
            user = request.data.get("username", config.username)
            password = request.data.get("password", config.password)
            
            client = BioTimeClient(ip, port, user, password)
            if client.test_connection():
                return Response({"status": "success", "message": "Connection successful"})
            else:
                return Response({"status": "error", "message": "Connection failed"}, status=status.HTTP_400_BAD_REQUEST)
                
        elif action == "sync-now":
            try:
                days_back = max(int(request.data.get("days_back", 7)), 1)
            except (TypeError, ValueError):
                return Response(
                    {"status": "error", "message": "days_back must be a positive integer."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            success, message = SyncBioTimeService.execute(days_back=days_back)
            if success:
                return Response({"status": "success", "message": message})
            else:
                return Response({"status": "error", "message": message}, status=status.HTTP_400_BAD_REQUEST)
                
        return Response({"error": "Invalid action"}, status=status.HTTP_400_BAD_REQUEST)


class BioTimeEmployeeMapViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    queryset = BioTimeEmployeeMap.objects.all().select_related("employee_profile", "employee_profile__user")
    serializer_class = BioTimeEmployeeMapSerializer

    @action(detail=False, methods=["get"])
    def unmapped(self, request):
        """Fetch users from the device that are not yet mapped to the HR system."""
        try:
            unmapped_users = SyncBioTimeService.get_unmapped_users()
            return Response(unmapped_users)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
