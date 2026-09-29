/** Every tunable and every colour lives here. No logic. */

/** Cameras are one colour whatever they are mounted on — the badge letter
 *  carries the type, not the fill. Note the tower badge is ▲ rather than T,
 *  because tripod already owns T. */
export const CAMERA_COLOUR = '#FF3D71';

export const CAMERA_TYPES = [
  // `badge` is what shows on the map, `mark` is what goes in the export —
  // the tower triangle reads better on screen, the caret survives a CSV.
  { id: 'tripod', label: 'Tripod',      badge: 'T', mark: 'T' },
  { id: 'led',    label: 'LED board',   badge: 'L', mark: 'L' },
  { id: 'tower',  label: 'Tower',       badge: '▲', mark: '^' },
  { id: 'hospo',  label: 'Hospitality', badge: 'H', mark: 'H' },
];

export const CABLE_TYPES = [
  { id: 'cat6',  label: 'Cat6',  colour: '#42C6FF', maxRunM: 90 },
  { id: 'fibre', label: 'Fibre', colour: '#FFA23A', maxRunM: 10000 },
];

/** Markers are drawn as real shapes — see map/icons.js. */
export const MARKER_TYPES = [
  { id: 'flag',    label: 'Flag',    colour: '#00E5A0' },
  { id: 'warning', label: 'Warning', colour: '#FFB020' },
  { id: 'power',   label: 'Power',   colour: '#FFE45E' },
  { id: 'info',    label: 'Info',    colour: '#9BB4C8' },
];

export const SWITCH_COLOUR = '#FFFFFF';

/** Cameras 1–60, three per hole: hole 1 owns 1–3, hole 2 owns 4–6, and so on. */
export const CAMS_PER_HOLE = 3;
export const MAX_CAMERA_NUMBER = 60;

/**
 * Three camera positions per hole, numbered clockwise from the left of the
 * green: g01 left, g02 middle, g03 right. The rigging sheet is a column per
 * position, so this is fixed rather than open-ended — a camera without a hole
 * and a position cannot appear on it.
 */
export const POSITIONS_PER_HOLE = 3;

/** Holes in a round. The selector, the panel and the camera plan all run the
 *  full set regardless of how much geometry has been captured — deriving it
 *  from the holes that exist would collapse the strip to one button the moment
 *  the first hole was laid out. */
export const HOLES_PER_ROUND = 18;

/** Cable length buckets shown in the info bar. */
export const CABLE_BUCKETS = [
  { id: 'short', label: '0–50 m',   min: 0,   max: 50 },
  { id: 'mid',   label: '50–100 m', min: 50,  max: 100 },
  { id: 'long',  label: '100 m +',  min: 100, max: Infinity },
];

/** Pixel radius within which a cable point snaps to a camera, switch or
 *  another cable's endpoint. */
export const SNAP_PX = 14;

/** Metres panned per WASD frame, before zoom scaling. */
export const PAN_STEP_PX = 120;

export const MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

/* ------------------------------------------------------- ground slope ----- */

/**
 * The steepest ground a tripod can still be levelled on. Five degrees is the
 * working figure; it is a setting rather than a constant because it belongs to
 * the head and the legs, not to the app — a heavy box on a tall column runs out
 * of level well before a light one on short legs.
 */
export const TRIPOD_MAX_SLOPE_DEG = 5;
export const TRIPOD_SLOPE_RANGE = [1, 20];

/** Ground within this much of the limit is shown as marginal, not as fine. */
export const SLOPE_MARGIN_DEG = 1;

/**
 * Slope is stored as one byte per cell, a quarter of a degree per step. That is
 * finer than any DEM can justify and keeps a whole course under a megabyte.
 * 255 means no reading — never zero, which would read as flat ground.
 */
export const SLOPE_STEP_DEG = 0.25;
export const SLOPE_MAX_DEG = 60;
export const SLOPE_NO_DATA = 255;

/**
 * Cell budget for a stored slope grid. A course is about 1.5 km across, so
 * 250k cells lands near 3 m — coarser than a 1 m LiDAR source, but a tripod
 * stands on about a metre of ground and the shading is there to point at the
 * flat areas, not to certify a single leg.
 */
export const MAX_DEM_CELLS = 250000;

/** Shading colours. Deliberately unlike the cameras and the cables. */
export const SLOPE_COLOURS = {
  flat:  [ 62, 190, 120],
  near:  [235, 180,  40],
  steep: [225,  60,  60],
};
export const SLOPE_OPACITY = 0.45;

/* --------------------------------------------------------------- 3D view -- */

/**
 * Terrain relief is for reading the shape of a course, never for measuring it.
 * Mapbox's global elevation tileset runs to about 5–10 m per pixel, so it will
 * not show the bank a 1 m LiDAR file shades red. Where the two disagree, the
 * slope shading is the one to believe.
 *
 * Golf is gentle enough that true scale reads as flat on a screen, so the
 * relief is exaggerated to make it legible — which is the other reason nothing
 * in the 3D view is safe to measure against.
 */
export const TERRAIN_EXAGGERATION = 1.5;
export const PITCH_3D = 60;

/**
 * How far from the course centre a click may place something. Generous enough
 * for any real course and its car parks, tight enough to catch a click near the
 * horizon in the tilted view, which can unproject kilometres away.
 */
export const MAX_PLACE_FROM_COURSE_M = 5000;
