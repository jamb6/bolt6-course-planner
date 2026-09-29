/**
 * The ground-slope overlay.
 *
 * Painted as a single image stretched over the DEM's own bounds, rather than as
 * a quarter of a million map features. The grid is already axis aligned in
 * longitude and latitude (lib/dem.js resamples it that way), so the four
 * corners are exactly the bounds and nothing is warped.
 *
 * Three bands, and a fourth state that matters as much: where the elevation
 * file has no reading the image is fully transparent, so the satellite shows
 * through untinted. Nothing is drawn as flat unless it was measured as flat.
 */
import { SLOPE_COLOURS, SLOPE_OPACITY, SLOPE_STEP_DEG, SLOPE_NO_DATA, SLOPE_MARGIN_DEG } from '../data/constants.js';
import { slopeBytes } from '../lib/dem.js';

export const SLOPE_SOURCE = 'slope';
export const SLOPE_LAYER = 'slope-fill';

/** Which band a slope reading falls in, given the mast limit in force. */
export function slopeBand(deg, limitDeg) {
  if (deg == null) return null;
  if (deg > limitDeg) return 'steep';
  if (deg > limitDeg - SLOPE_MARGIN_DEG) return 'near';
  return 'flat';
}

/**
 * Turns the slope grid into a PNG data URL.
 *
 * Re-run whenever the mast limit changes, because the limit is what decides
 * the colours — the stored grid holds degrees and knows nothing about masts.
 */
export function slopeImageURL(dem, limitDeg) {
  const bytes = slopeBytes(dem);
  if (!bytes) return null;

  const canvas = document.createElement('canvas');
  canvas.width = dem.cols;
  canvas.height = dem.rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(dem.cols, dem.rows);

  const alpha = Math.round(SLOPE_OPACITY * 255);
  const limit = limitDeg / SLOPE_STEP_DEG;
  const near = (limitDeg - SLOPE_MARGIN_DEG) / SLOPE_STEP_DEG;

  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    const o = i * 4;
    if (v === SLOPE_NO_DATA) { img.data[o + 3] = 0; continue; }   // no reading, no tint
    const c = v > limit ? SLOPE_COLOURS.steep : v > near ? SLOPE_COLOURS.near : SLOPE_COLOURS.flat;
    img.data[o] = c[0];
    img.data[o + 1] = c[1];
    img.data[o + 2] = c[2];
    img.data[o + 3] = alpha;
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

const corners = (dem) => [
  [dem.west, dem.north], [dem.east, dem.north],
  [dem.east, dem.south], [dem.west, dem.south],
];

/**
 * Puts the overlay on the map, or takes it off.
 *
 * Sits directly under the first line layer so holes, cables and cameras all
 * stay readable on top of it. Called on every relevant change, so it has to be
 * safe to call with the same arguments twice.
 */
export function syncSlopeLayer(map, dem, limitDeg, visible) {
  if (!map || !map.getStyle?.()) return;
  const want = !!(dem && visible);
  const has = !!map.getSource(SLOPE_SOURCE);

  if (!want) {
    if (map.getLayer(SLOPE_LAYER)) map.removeLayer(SLOPE_LAYER);
    if (has) map.removeSource(SLOPE_SOURCE);
    return;
  }

  const url = slopeImageURL(dem, limitDeg);
  if (!url) return;

  if (!has) {
    map.addSource(SLOPE_SOURCE, { type: 'image', url, coordinates: corners(dem) });
    map.addLayer(
      {
        id: SLOPE_LAYER, type: 'raster', source: SLOPE_SOURCE,
        // The image already carries its own alpha, so this stays at 1 — the
        // transparency of a no-data cell has to survive.
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
      },
      map.getLayer('hole-line') ? 'hole-line' : undefined
    );
    return;
  }

  // Already there: repaint it. updateImage takes both, so a new course's grid
  // and a changed mast limit go through the same path.
  map.getSource(SLOPE_SOURCE).updateImage({ url, coordinates: corners(dem) });
}
