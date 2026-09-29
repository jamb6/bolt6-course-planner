/**
 * Elevation in, ground slope out.
 *
 * A tripod has a levelling limit. Standing one on ground steeper than that
 * means it cannot be levelled, so the planner needs to know where the flat
 * ground is before anyone walks the course. That is a slope question, not an
 * elevation question, and slope is the derivative of elevation — it needs far
 * more resolution than a height reading does. A 30 m global DEM gives elevation
 * to within a metre or two and slope that is close to meaningless over a green
 * surround, which is why this takes an uploaded file rather than calling a
 * global elevation service.
 *
 * The pipeline:
 *   1. read the GeoTIFF and find out where its pixels are (lib/proj.js)
 *   2. resample onto a regular longitude/latitude grid, so everything
 *      downstream — drawing, sampling, the map overlay — is axis aligned
 *   3. compute slope per cell with Horn's 3x3 method, in metres
 *   4. pack it into one byte per cell so a course can carry it around
 *
 * Two rules run through all of it. Slope is measured in true metres, never in
 * degrees of longitude. And anywhere the source has no reading, the result has
 * no reading: a gap stays a gap rather than becoming a smooth wrong surface
 * that looks trustworthy.
 */
import { projectorFor, SUPPORTED_CRS } from './proj.js';
import { MAX_DEM_CELLS, SLOPE_STEP_DEG, SLOPE_NO_DATA, SLOPE_MAX_DEG } from '../data/constants.js';

const D2R = Math.PI / 180;

/** Metres per degree at a latitude, on the WGS84 ellipsoid. */
const mPerDegLat = (lat) => {
  const p = lat * D2R;
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
};
const mPerDegLng = (lat) => {
  const p = lat * D2R;
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
};

/* ------------------------------------------------------------ read a file */

/**
 * Pulls the first image out of a GeoTIFF and works out where it sits.
 *
 * Throws with something a person can act on. An unreadable file is a dead end,
 * but an unsupported projection is not — the message says to re-export in
 * EPSG:4326, which every tool that produced the file can do.
 */
export async function readGeoTiff(arrayBuffer) {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const keys = image.getGeoKeys() ?? {};
  const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? null;
  const proj = projectorFor(epsg);
  if (!proj) {
    throw new Error(
      `This file is in ${epsg ? `EPSG:${epsg}` : 'a projection it does not name'}, which cannot be `
      + `placed on the map with confidence. Re-export it as EPSG:4326 (longitude and latitude) and `
      + `upload it again. Supported as-is: ${SUPPORTED_CRS}.`
    );
  }

  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();          // resY is normally negative
  const width = image.getWidth();
  const height = image.getHeight();
  if (!width || !height) throw new Error('This GeoTIFF has no pixels in it.');

  const rasters = await image.readRasters({ interleave: false });
  const band = rasters[0];
  if (!band) throw new Error('This GeoTIFF has no raster band to read.');

  // GDAL writes the no-data value as a string in the TIFF tags. It is usually
  // a large negative sentinel such as -9999 or -3.4e38.
  const rawNoData = image.getGDALNoData?.();
  const noData = rawNoData == null || Number.isNaN(Number(rawNoData)) ? null : Number(rawNoData);

  return { width, height, band, noData, originX, originY, resX, resY, proj, epsg: proj.epsg };
}

/* ------------------------------------------------- resample to lon/lat ---- */

/**
 * The source's outline in longitude and latitude.
 *
 * Projected grids are not rectangles once they are on a globe, so the four
 * corners alone would clip the bulging edges. Walking the whole perimeter
 * catches them.
 */
function lngLatBounds(src) {
  const { width, height, originX, originY, resX, resY, proj } = src;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const STEPS = 32;
  const edge = (fx, fy) => {
    const [lng, lat] = proj.inverse([originX + fx * width * resX, originY + fy * height * resY]);
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  };
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    edge(t, 0); edge(t, 1); edge(0, t); edge(1, t);
  }
  return { west, south, east, north };
}

/**
 * Builds a regular longitude/latitude elevation grid by sampling the source.
 *
 * Bilinear, and strict about gaps: if any of the four pixels around a sample
 * is missing, the output cell is missing too. Blending a real height with a
 * -9999 sentinel would invent a cliff.
 */
function resampleToLngLat(src, maxCells = MAX_DEM_CELLS) {
  const { west, south, east, north } = lngLatBounds(src);
  const midLat = (south + north) / 2;
  const widthM = (east - west) * mPerDegLng(midLat);
  const heightM = (north - south) * mPerDegLat(midLat);
  if (!(widthM > 0) || !(heightM > 0)) {
    throw new Error('This GeoTIFF does not describe an area on the ground.');
  }

  // Native cell size, taken from the source's own resolution.
  const nativeM = src.proj.degrees
    ? Math.min(Math.abs(src.resX) * mPerDegLng(midLat), Math.abs(src.resY) * mPerDegLat(midLat))
    : Math.min(Math.abs(src.resX), Math.abs(src.resY));

  // Keep the source's own resolution unless that would blow the cell budget,
  // then coarsen just enough to fit. One cell size for both axes, so the cells
  // stay square and slope needs no correction for a stretched grid — getting
  // this wrong tilts every reading and pins the steep ones to the maximum.
  const fitM = Math.sqrt((widthM * heightM) / maxCells);
  const cellM = Math.max(nativeM, fitM);

  let cols = Math.max(2, Math.round(widthM / cellM));
  let rows = Math.max(2, Math.round(heightM / cellM));
  if (cols * rows > maxCells) {                    // rounding only, normally
    const k = Math.sqrt(maxCells / (cols * rows));
    cols = Math.max(2, Math.floor(cols * k));
    rows = Math.max(2, Math.floor(rows * k));
  }
  const dLng = (east - west) / cols;
  const dLat = (north - south) / rows;

  const { width: sw, height: sh, band, noData, originX, originY, resX, resY, proj } = src;
  /**
   * A reading we will not use. Beyond the file's own no-data value, anything
   * below -1000 m is treated as a sentinel: the lowest dry land on Earth is
   * around -430 m, so a -9999 or -32768 left undeclared in the tags is a gap,
   * not a valley. Getting this wrong is what turns a missing patch into a cliff.
   */
  const missing = (v) =>
    v == null || !Number.isFinite(v)
    || (noData != null && Math.abs(v - noData) < 1e-6)
    || v < -1000 || v > 9000;

  const elev = new Float32Array(cols * rows);
  let covered = 0;

  for (let r = 0; r < rows; r++) {
    // Row 0 is the north edge, matching how an image is drawn.
    const lat = north - (r + 0.5) * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = west + (c + 0.5) * dLng;
      const [x, y] = proj.forward([lng, lat]);
      // Pixel space, with the pixel centre at +0.5.
      const px = (x - originX) / resX - 0.5;
      const py = (y - originY) / resY - 0.5;
      const x0 = Math.floor(px), y0 = Math.floor(py);

      if (x0 < 0 || y0 < 0 || x0 + 1 >= sw || y0 + 1 >= sh) { elev[r * cols + c] = NaN; continue; }

      const v00 = band[y0 * sw + x0], v10 = band[y0 * sw + x0 + 1];
      const v01 = band[(y0 + 1) * sw + x0], v11 = band[(y0 + 1) * sw + x0 + 1];
      if (missing(v00) || missing(v10) || missing(v01) || missing(v11)) { elev[r * cols + c] = NaN; continue; }

      const fx = px - x0, fy = py - y0;
      elev[r * cols + c] =
        v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
      covered++;
    }
  }

  return {
    cols, rows, west, south, east, north, elev, nativeM,
    cellXM: dLng * mPerDegLng(midLat),
    cellYM: dLat * mPerDegLat(midLat),
    coverage: covered / (cols * rows),
  };
}

/* ------------------------------------------------------------- slope ------ */

/**
 * Horn's 3x3 method — the same one GDAL and ArcGIS use. It fits a plane
 * through the eight neighbours, which is steadier on noisy LiDAR than taking
 * the two adjacent differences.
 *
 * A cell on the edge of the grid, or next to a gap, gets no reading. There is
 * no honest way to compute a gradient from a partial neighbourhood.
 */
export function slopeGrid({ cols, rows, elev, cellXM, cellYM }) {
  const slope = new Uint8Array(cols * rows).fill(SLOPE_NO_DATA);
  const at = (c, r) => elev[r * cols + c];

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const z = [
        at(c - 1, r - 1), at(c, r - 1), at(c + 1, r - 1),
        at(c - 1, r),     at(c, r),     at(c + 1, r),
        at(c - 1, r + 1), at(c, r + 1), at(c + 1, r + 1),
      ];
      if (z.some((v) => !Number.isFinite(v))) continue;

      const dzdx = ((z[2] + 2 * z[5] + z[8]) - (z[0] + 2 * z[3] + z[6])) / (8 * cellXM);
      const dzdy = ((z[6] + 2 * z[7] + z[8]) - (z[0] + 2 * z[1] + z[2])) / (8 * cellYM);
      const deg = Math.atan(Math.hypot(dzdx, dzdy)) / D2R;

      // Round up, not to nearest. A quarter of a degree either way is nothing
      // to look at, but this figure decides whether a tripod goes somewhere, so
      // the stored value should never read flatter than the ground is.
      const step = Math.ceil(Math.min(deg, SLOPE_MAX_DEG) / SLOPE_STEP_DEG);
      slope[r * cols + c] = Math.min(step, SLOPE_NO_DATA - 1);
    }
  }
  return slope;
}

/* ------------------------------------------------------- pack and unpack -- */

const toBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const CHUNK = 0x8000;                      // apply() blows the stack past ~100k
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
};

const fromBase64 = (s) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The slope grid as bytes. Cached, because every redraw asks for it. */
export function slopeBytes(dem) {
  if (!dem?.slope) return null;
  if (dem._bytes?.length === dem.cols * dem.rows) return dem._bytes;
  const bytes = fromBase64(dem.slope);
  // Non-enumerable so the cache never reaches storage or a JSON export.
  Object.defineProperty(dem, '_bytes', { value: bytes, configurable: true, enumerable: false });
  return bytes;
}

/* --------------------------------------------------------------- build ---- */

/**
 * Everything above, in one call: a stored elevation record for a course.
 *
 * The result is plain JSON so it goes through lib/db unchanged, and the slope
 * grid is one byte per cell so a 1.5 km course costs a few hundred kilobytes
 * rather than the tens of megabytes the source file weighs.
 */
export async function buildDem(arrayBuffer, { fileName = '', maxCells = MAX_DEM_CELLS } = {}) {
  const src = await readGeoTiff(arrayBuffer);
  const grid = resampleToLngLat(src, maxCells);
  const slope = slopeGrid(grid);

  if (!grid.coverage) {
    throw new Error('Every pixel in this file is marked as no data. Check the export and try again.');
  }

  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const v of grid.elev) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; n++;
  }

  return {
    version: 1,
    fileName,
    cols: grid.cols, rows: grid.rows,
    west: grid.west, south: grid.south, east: grid.east, north: grid.north,
    cellM: Math.round(((grid.cellXM + grid.cellYM) / 2) * 100) / 100,
    sourceM: Math.round(grid.nativeM * 100) / 100,
    sourceEpsg: src.epsg,
    sourceCrs: src.proj.name,
    sourcePixels: src.width * src.height,
    coverage: Math.round(grid.coverage * 1000) / 1000,
    elevMin: n ? Math.round(min * 10) / 10 : null,
    elevMax: n ? Math.round(max * 10) / 10 : null,
    elevMean: n ? Math.round((sum / n) * 10) / 10 : null,
    bytes: slope.length,
    slope: toBase64(slope),
    createdAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------- read out -- */

/** Grid column and row for a longitude and latitude, or null if outside. */
export function cellAt(dem, [lng, lat]) {
  if (!dem) return null;
  const c = Math.floor(((lng - dem.west) / (dem.east - dem.west)) * dem.cols);
  const r = Math.floor(((dem.north - lat) / (dem.north - dem.south)) * dem.rows);
  if (c < 0 || r < 0 || c >= dem.cols || r >= dem.rows) return null;
  return { c, r };
}

/**
 * Slope in degrees under a point, or null where there is no reading.
 *
 * null means "we do not know", and callers must say so rather than treating it
 * as flat ground.
 */
export function slopeAt(dem, lngLat) {
  const cell = cellAt(dem, lngLat);
  if (!cell) return null;
  const v = slopeBytes(dem)?.[cell.r * dem.cols + cell.c];
  if (v == null || v === SLOPE_NO_DATA) return null;
  return v * SLOPE_STEP_DEG;
}

/** How much of the covered ground a tripod could be levelled on. */
export function suitability(dem, limitDeg) {
  const bytes = slopeBytes(dem);
  if (!bytes) return null;
  const limit = limitDeg / SLOPE_STEP_DEG;
  let known = 0, flat = 0;
  for (const v of bytes) {
    if (v === SLOPE_NO_DATA) continue;
    known++;
    if (v <= limit) flat++;
  }
  if (!known) return null;
  return { known, flat, fraction: flat / known, cellM: dem.cellM, areaM2: known * dem.cellM ** 2 };
}

/** Does this file actually cover the course? Guards against the wrong upload. */
export function coversPoint(dem, [lng, lat]) {
  return !!dem && lng >= dem.west && lng <= dem.east && lat >= dem.south && lat <= dem.north;
}

/** Roughly how far a point is from the file's area, for the wrong-file warning. */
export function distanceToCoverageM(dem, [lng, lat]) {
  if (!dem) return null;
  if (coversPoint(dem, [lng, lat])) return 0;
  const midLat = (dem.south + dem.north) / 2;
  const dx = Math.max(dem.west - lng, 0, lng - dem.east) * mPerDegLng(midLat);
  const dy = Math.max(dem.south - lat, 0, lat - dem.north) * mPerDegLat(midLat);
  return Math.hypot(dx, dy);
}
