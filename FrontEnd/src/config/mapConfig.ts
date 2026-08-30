/**
 * Tile provider configuration for the Work Location map picker.
 *
 * Both values are read from Vite env vars so a deployment can point at its own
 * tile provider without a code change. The defaults are keyless OpenStreetMap
 * tiles, suitable for development only — see the production follow-up in the
 * stage report before using these in production.
 *
 * No credentials, API keys, or provider secrets belong in this file. A provider
 * that requires a key must supply it through `VITE_MAP_TILE_URL` in the
 * deployment's own (gitignored) `.env`.
 */

const DEFAULT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * OpenStreetMap's tile usage policy requires visible attribution. Leaflet
 * renders this string in the map's attribution control.
 */
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const MAP_TILE_URL: string =
  import.meta.env.VITE_MAP_TILE_URL || DEFAULT_TILE_URL;

export const MAP_TILE_ATTRIBUTION: string =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION || DEFAULT_TILE_ATTRIBUTION;

/** Zoom used when a site has coordinates but no usable radius to fit to. */
export const MAP_DEFAULT_ZOOM = 16;

/** Padding, in pixels, kept around the radius circle when auto-fitting. */
export const MAP_FIT_PADDING: [number, number] = [24, 24];
