"""Validation and distance helpers for mobile attendance geofencing."""

from __future__ import annotations

import math
from decimal import Decimal

from rest_framework import serializers

from .models import WorkLocation

EARTH_RADIUS_METERS = 6_371_008.8
MAX_GPS_ACCURACY_METERS = Decimal("100")


def haversine_distance_meters(
    latitude_a: Decimal | float,
    longitude_a: Decimal | float,
    latitude_b: Decimal | float,
    longitude_b: Decimal | float,
) -> float:
    """Return the great-circle distance between two decimal-degree coordinates."""
    lat_a, lon_a, lat_b, lon_b = map(float, (latitude_a, longitude_a, latitude_b, longitude_b))
    lat_delta = math.radians(lat_b - lat_a)
    lon_delta = math.radians(lon_b - lon_a)
    a = (
        math.sin(lat_delta / 2) ** 2
        + math.cos(math.radians(lat_a)) * math.cos(math.radians(lat_b)) * math.sin(lon_delta / 2) ** 2
    )
    return EARTH_RADIUS_METERS * 2 * math.asin(math.sqrt(a))


class GeofencePayloadSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    accuracy_meters = serializers.DecimalField(max_digits=8, decimal_places=2)

    def validate(self, attrs):
        latitude = attrs["latitude"]
        longitude = attrs["longitude"]
        accuracy = attrs["accuracy_meters"]

        if not all(value.is_finite() for value in (latitude, longitude, accuracy)):
            raise serializers.ValidationError("GPS coordinates and accuracy must be finite numbers.")
        if not Decimal("-90") <= latitude <= Decimal("90"):
            raise serializers.ValidationError({"latitude": "Latitude must be between -90 and 90."})
        if not Decimal("-180") <= longitude <= Decimal("180"):
            raise serializers.ValidationError({"longitude": "Longitude must be between -180 and 180."})
        if accuracy < 0:
            raise serializers.ValidationError({"accuracy_meters": "Accuracy must be zero or greater."})
        if accuracy > MAX_GPS_ACCURACY_METERS:
            raise serializers.ValidationError({"accuracy_meters": "GPS accuracy must be 100 metres or better."})
        return attrs


class GeofencePayloadError(Exception):
    def __init__(self, *, kind: str):
        self.kind = kind
        super().__init__(kind)


def validate_mobile_geofence(*, payload, company) -> WorkLocation | None:
    """Return the matched location, or None when no active site contains the reading.

    Serializer validation deliberately occurs before caller transaction/locking logic.
    """
    serializer = GeofencePayloadSerializer(data=payload)
    if not serializer.is_valid():
        errors = serializer.errors
        accuracy_errors = errors.get("accuracy_meters", []) if hasattr(errors, "get") else []
        non_field_errors = errors.get("non_field_errors", []) if hasattr(errors, "get") else []
        if any("100 metres or better" in str(item) for item in [*accuracy_errors, *non_field_errors]):
            raise GeofencePayloadError(kind="poor_accuracy")
        raise GeofencePayloadError(kind="invalid_coordinates")
    coordinates = serializer.validated_data

    for location in WorkLocation.objects.filter(company=company, is_active=True).only(
        "id", "name", "latitude", "longitude", "radius_meters"
    ):
        distance = haversine_distance_meters(
            coordinates["latitude"], coordinates["longitude"], location.latitude, location.longitude
        )
        if distance <= float(location.radius_meters):
            return location
    return None
