/**
 * Latitude/longitude parsing for coordinate entry.
 *
 * Lives outside the page component so Fast Refresh keeps working
 * (`react-refresh/only-export-components`) and so the parsing rules can be
 * unit-tested on their own.
 */

function toCoordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < -limit || parsed > limit) return null;
  return parsed;
}

/**
 * Coerces a form value to a usable latitude, or `null`.
 *
 * The map picker renders only when both coordinates come back non-null, so a
 * half-typed or out-of-range value shows the placeholder instead of throwing
 * inside Leaflet.
 */
export function toLatitude(value: unknown): number | null {
  return toCoordinate(value, 90);
}

/** Coerces a form value to a usable longitude, or `null`. See `toLatitude`. */
export function toLongitude(value: unknown): number | null {
  return toCoordinate(value, 180);
}

/**
 * Accepts the shapes people actually paste out of a mapping tool —
 * `24.7136, 46.6753`, `24.7136 46.6753`, or a Google Maps `@lat,lng,17z`
 * fragment — and returns the pair only when both halves are in range.
 *
 * Ranges match the backend contract: latitude -90..90, longitude -180..180.
 */
export function parseCoordinatePair(
  raw: string,
): { latitude: number; longitude: number } | null {
  if (!raw) return null;

  const atFragment = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const source = atFragment ? `${atFragment[1]},${atFragment[2]}` : raw;

  const parts = source
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}
