import { useEffect, useMemo } from "react";
import { Typography } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

import {
  MAP_DEFAULT_ZOOM,
  MAP_FIT_PADDING,
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_URL,
} from "../../config/mapConfig";
import { toLatitude, toLongitude } from "../../utils/coordinates";
import { useI18n } from "../../i18n/useI18n";

const MAP_HEIGHT = 280;

/**
 * An inline SVG pin, so the picker needs no Leaflet image assets.
 *
 * Leaflet's default icon resolves its PNGs relative to the CSS, which breaks
 * under bundlers. A `divIcon` sidesteps that entirely and keeps the component
 * free of asset imports that would also have to be stubbed in tests.
 */
const markerIcon = L.divIcon({
  className: "work-location-marker",
  html: `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="#1677ff"/>
    <circle cx="13" cy="13" r="5" fill="#ffffff"/>
  </svg>`,
  iconSize: [26, 34],
  iconAnchor: [13, 34],
});

/**
 * Keeps the viewport on the selected site.
 *
 * With a usable radius the whole circle is fitted, so widening the radius zooms
 * out far enough to show it; without one the map just recentres.
 */
function FitToSelection({
  latitude,
  longitude,
  radiusMeters,
}: {
  latitude: number;
  longitude: number;
  radiusMeters: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    const center = L.latLng(latitude, longitude);

    if (radiusMeters && radiusMeters > 0) {
      // Do not use Circle#getBounds here. A newly-created Leaflet circle is
      // not attached to a map yet, so its projection state is undefined.
      // LatLng#toBounds is map-independent and takes the same metre radius.
      const bounds = center.toBounds(radiusMeters);
      map.fitBounds(bounds, { padding: MAP_FIT_PADDING });
      return;
    }

    map.setView(center, MAP_DEFAULT_ZOOM);
  }, [map, latitude, longitude, radiusMeters]);

  return null;
}

/** Clicking anywhere on the map moves the site centre there. */
function ClickToPlace({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (disabled) return;
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export type WorkLocationMapPickerProps = {
  /** Raw form values; strings, numbers, empty and out-of-range are all handled. */
  latitude: unknown;
  longitude: unknown;
  radiusMeters: unknown;
  /** Receives raw numbers. The caller owns six-decimal serialisation. */
  onChange: (latitude: number, longitude: number) => void;
  disabled?: boolean;
};

export default function WorkLocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onChange,
  disabled = false,
}: WorkLocationMapPickerProps) {
  const { t } = useI18n();

  const lat = toLatitude(latitude);
  const lng = toLongitude(longitude);

  const radius = useMemo(() => {
    const parsed = Number(radiusMeters);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [radiusMeters]);

  // Incomplete or out-of-range input is normal while typing, so this is a
  // placeholder rather than an error state.
  if (lat === null || lng === null) {
    return (
      <div
        data-testid="map-placeholder"
        style={{
          height: MAP_HEIGHT,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          textAlign: "center",
          padding: 16,
          borderRadius: 12,
          border: "1px dashed #d9d9d9",
          background: "#fafafa",
        }}
      >
        <EnvironmentOutlined style={{ fontSize: 24, color: "#bfbfbf" }} />
        <Typography.Text type="secondary">
          {t("workLocations.map.placeholder")}
        </Typography.Text>
      </div>
    );
  }

  const center: [number, number] = [lat, lng];

  return (
    <div
      role="group"
      aria-label={t("workLocations.map.ariaLabel")}
      data-testid="map-picker"
      style={{ borderRadius: 12, overflow: "hidden" }}
    >
      <MapContainer
        center={center}
        zoom={MAP_DEFAULT_ZOOM}
        scrollWheelZoom={false}
        // Leaflet's own keyboard handling: focus the map, then pan with the
        // arrow keys and zoom with +/-. Precise entry stays on the numeric
        // latitude/longitude fields, which remain the accessible path.
        keyboard
        style={{ height: MAP_HEIGHT, width: "100%" }}
      >
        <TileLayer url={MAP_TILE_URL} attribution={MAP_TILE_ATTRIBUTION} />

        <ClickToPlace disabled={disabled} onPick={onChange} />
        <FitToSelection latitude={lat} longitude={lng} radiusMeters={radius} />

        {radius !== null && (
          <Circle
            center={center}
            radius={radius}
            pathOptions={{
              color: "#1677ff",
              fillColor: "#1677ff",
              fillOpacity: 0.15,
            }}
          />
        )}

        <Marker
          position={center}
          icon={markerIcon}
          draggable={!disabled}
          alt={t("workLocations.map.markerAlt")}
          eventHandlers={{
            dragend(event) {
              const { lat: nextLat, lng: nextLng } = event.target.getLatLng();
              onChange(nextLat, nextLng);
            },
          }}
        />
      </MapContainer>
    </div>
  );
}
