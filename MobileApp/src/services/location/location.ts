import * as Location from 'expo-location';

/**
 * A single foreground GPS reading, already formatted for the attendance contract in
 * `plans/Geofenced Attendance Phase 8 Backend Contract.md`.
 *
 * The values are strings because the server validates them as `DecimalField`s: latitude
 * and longitude are decimal degrees at exactly six decimal places, and `accuracyMeters`
 * is a radius in metres at two decimal places. A reading is created per action, handed
 * straight to the request, and then dropped; nothing here is cached or persisted.
 */
export interface GeoReading {
  latitude: string;
  longitude: string;
  accuracyMeters: string;
}

/**
 * `permission-denied` means the employee refused (or has previously refused) foreground
 * location. `unavailable` covers every other local failure: the provider threw, the
 * platform returned no fix, or the fix carried no usable accuracy radius. Neither reason
 * retains a native error, message, or stack.
 */
export type LocationFailureReason = 'permission-denied' | 'unavailable';

export type LocationOutcome =
  { status: 'ready'; reading: GeoReading } | { status: 'failed'; reason: LocationFailureReason };

/** Decimal places the backend `DecimalField`s accept without rounding surprises. */
const COORDINATE_DECIMALS = 6;
const ACCURACY_DECIMALS = 2;

/**
 * Seam for tests. Production binds these to `expo-location`, which is imported in this
 * module alone so the QA invariant can prove no screen or feature reaches the native
 * location API directly.
 */
export interface LocationProvider {
  requestForegroundPermission: () => Promise<{ granted: boolean }>;
  getCurrentPosition: () => Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
  }>;
}

export const expoLocationProvider: LocationProvider = {
  requestForegroundPermission: () => Location.requestForegroundPermissionsAsync(),
  // `High` is accurate enough to clear the 100 metre contract ceiling without the
  // battery cost of `BestForNavigation`, which is tuned for continuous turn-by-turn use.
  getCurrentPosition: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
};

/**
 * Formats one finite coordinate component. A non-finite value means the platform gave no
 * real fix, so it is rejected here rather than sent as a malformed decimal string.
 */
function fixedOrNull(value: number | null, decimals: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toFixed(decimals);
}

/**
 * Range checking stays on the server. The client only refuses values it cannot render as
 * a decimal at all; anything finite is sent so the backend remains the single authority
 * on what counts as an invalid coordinate or an unacceptable accuracy radius.
 */
export function toGeoReading(coords: {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}): GeoReading | null {
  const latitude = fixedOrNull(coords.latitude, COORDINATE_DECIMALS);
  const longitude = fixedOrNull(coords.longitude, COORDINATE_DECIMALS);
  const accuracyMeters = fixedOrNull(coords.accuracy, ACCURACY_DECIMALS);
  if (latitude === null || longitude === null || accuracyMeters === null) return null;
  return { latitude, longitude, accuracyMeters };
}

/**
 * Requests foreground permission and takes one fresh fix immediately before an
 * attendance mutation. The result is never stored, so no location history can accumulate
 * on the device.
 */
export async function captureCurrentReading(
  provider: LocationProvider = expoLocationProvider,
): Promise<LocationOutcome> {
  let granted: boolean;
  try {
    granted = (await provider.requestForegroundPermission()).granted;
  } catch {
    return { status: 'failed', reason: 'unavailable' };
  }
  if (!granted) return { status: 'failed', reason: 'permission-denied' };

  try {
    const position = await provider.getCurrentPosition();
    const reading = toGeoReading(position.coords);
    return reading ? { status: 'ready', reading } : { status: 'failed', reason: 'unavailable' };
  } catch {
    return { status: 'failed', reason: 'unavailable' };
  }
}

export type CaptureLocation = () => Promise<LocationOutcome>;
