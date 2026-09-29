/**
 * 3D view: terrain relief, sky, and extruded buildings.
 *
 * This is for looking at, not for measuring. The heights come from Mapbox's
 * global elevation tileset, which tops out around 5 to 10 m per pixel — plenty
 * to read the shape of a course, nowhere near enough to answer a mast
 * question. The slope shading is the thing that answers that, and it comes from
 * the elevation file uploaded against the course (see lib/dem.js).
 *
 * The two can disagree visually. A bank that the 1 m LiDAR shades red may look
 * like nothing at all in the 3D relief, because a global DEM has smoothed it
 * away. When that happens the shading is right and the relief is wrong, and the
 * planner says so on screen rather than leaving anyone to guess.
 *
 * It costs nothing to run. Mapbox GL JS is billed per map load rather than per
 * tile, so terrain tiles come out of the session already paid for by opening
 * the map — no second API, no second key, no second licence.
 */
import { TERRAIN_EXAGGERATION, PITCH_3D } from '../data/constants.js';

const DEM_SOURCE = 'mapbox-dem';
const SKY_LAYER = 'sky';
const BUILDINGS_LAYER = 'buildings-3d';

/**
 * Turns the 3D view on or off.
 *
 * Safe to call repeatedly with the same argument, and safe to call before the
 * style has finished loading — everything it touches is checked first.
 */
export function syncTerrain(map, on) {
  if (!map || !map.getStyle?.()) return;

  if (!on) {
    map.setTerrain(null);
    if (map.getLayer(SKY_LAYER)) map.removeLayer(SKY_LAYER);
    if (map.getLayer(BUILDINGS_LAYER)) map.removeLayer(BUILDINGS_LAYER);
    // The DEM source is left in place. Re-adding it on every toggle would
    // re-fetch tiles the browser already has.
    return;
  }

  if (!map.getSource(DEM_SOURCE)) {
    map.addSource(DEM_SOURCE, {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    });
  }

  // Golf is gentle. A course with fifteen metres of relief over a kilometre
  // reads as flat at true scale once it is on a screen, so the relief is
  // exaggerated to make the landform legible — which is the other reason
  // nothing here is safe to measure against.
  map.setTerrain({ source: DEM_SOURCE, exaggeration: TERRAIN_EXAGGERATION });

  if (!map.getLayer(SKY_LAYER)) {
    map.addLayer({
      id: SKY_LAYER, type: 'sky',
      paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 12 },
    });
  }

  addBuildings(map);
}

/**
 * The clubhouse, the hospitality builds, anything with a height in Mapbox
 * Streets. Worth having, because a camera position is often chosen by what it
 * can see past.
 *
 * Guarded rather than assumed: the building data belongs to the style, and a
 * style without it must not take the whole 3D view down with it.
 */
function addBuildings(map) {
  if (map.getLayer(BUILDINGS_LAYER)) return;
  try {
    const style = map.getStyle();
    const source = Object.entries(style.sources ?? {})
      .find(([, s]) => s.type === 'vector' && /mapbox-streets|composite/.test(s.url ?? ''))?.[0]
      ?? (style.sources?.composite ? 'composite' : null);
    if (!source) return;

    map.addLayer({
      id: BUILDINGS_LAYER, type: 'fill-extrusion', source, 'source-layer': 'building',
      filter: ['all', ['==', ['get', 'extrude'], 'true'], ['has', 'height']],
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#8FA3B8',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.55,
      },
    });
  } catch {
    // No building data in this style. The terrain and sky still work.
  }
}

/** Tilts into the 3D view, or back to straight down for planning. */
export function setPitch(map, on) {
  if (!map) return;
  map.easeTo({ pitch: on ? PITCH_3D : 0, bearing: on ? map.getBearing?.() ?? 0 : 0, duration: 600 });
}
