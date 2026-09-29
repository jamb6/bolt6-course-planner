/**
 * Just enough map projection to read a GeoTIFF.
 *
 * Elevation files almost never arrive in plain longitude/latitude. USGS 3DEP
 * hands out UTM, the Environment Agency uses British National Grid, and a tile
 * cut from a web map is Web Mercator. To turn any of those into slope we have
 * to know where each pixel actually is, so this file converts between
 * longitude/latitude and the three grid families we can support.
 *
 * Everything here is WGS84 unless a projection says otherwise. British National
 * Grid is on Airy 1830, so it carries its own ellipsoid and a Helmert shift.
 *
 * Deliberately not a projection library. If a file arrives in anything else —
 * Albers, a state plane, a Lambert conformal — lib/dem.js says so plainly and
 * asks for the file again in EPSG:4326. A wrong answer about where the ground
 * is would be worse than no answer.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/* ------------------------------------------------------ transverse Mercator */

/**
 * Snyder's series for the transverse Mercator, good to a few millimetres
 * within a zone's own width — far beyond what a 1 m elevation grid can carry.
 * Both UTM and British National Grid are this projection with different
 * numbers, so they share the maths.
 */
function transverseMercator({ a, f, k0, lon0, lat0 = 0, x0, y0 }) {
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lam0 = lon0 * D2R;

  /** Meridional arc from the equator to latitude phi. */
  const arc = (phi) =>
    a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi
      - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
      + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
      - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  /**
   * Northings are measured from the projection's own origin latitude, not the
   * equator. UTM starts at the equator so this is zero and invisible; British
   * National Grid starts at 49°N, where leaving it out puts the whole country
   * 5427 km too far north.
   */
  const arc0 = arc(lat0 * D2R);

  return {
    forward([lon, lat]) {
      const phi = lat * D2R;
      const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
      const N = a / Math.sqrt(1 - e2 * sin * sin);
      const T = tan * tan;
      const C = ep2 * cos * cos;
      // Wrap the longitude difference so a zone straddling ±180° still works.
      let dl = lon * D2R - lam0;
      while (dl > Math.PI) dl -= 2 * Math.PI;
      while (dl < -Math.PI) dl += 2 * Math.PI;
      const A = dl * cos;

      const x = x0 + k0 * N * (A
        + ((1 - T + C) * A ** 3) / 6
        + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
      const y = y0 + k0 * (arc(phi) - arc0 + N * tan * ((A * A) / 2
        + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
        + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
      return [x, y];
    },

    inverse([x, y]) {
      const M = (y - y0) / k0 + arc0;
      const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
      const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
      const phi1 = mu
        + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
        + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
        + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
        + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

      const sin = Math.sin(phi1), cos = Math.cos(phi1), tan = Math.tan(phi1);
      const C1 = ep2 * cos * cos;
      const T1 = tan * tan;
      const s = 1 - e2 * sin * sin;
      const N1 = a / Math.sqrt(s);
      const R1 = (a * (1 - e2)) / (s * Math.sqrt(s));
      const D = (x - x0) / (N1 * k0);

      const phi = phi1 - ((N1 * tan) / R1) * ((D * D) / 2
        - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
        + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
      const lam = lam0 + (D
        - ((1 + 2 * T1 + C1) * D ** 3) / 6
        + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / cos;

      return [lam * R2D, phi * R2D];
    },
  };
}

/* ---------------------------------------------------------------- families */

const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const AIRY1830 = { a: 6377563.396, f: 1 - 6356256.909 / 6377563.396 };

const utm = (zone, south) =>
  transverseMercator({
    ...WGS84, k0: 0.9996, lon0: zone * 6 - 183,
    x0: 500000, y0: south ? 10000000 : 0,
  });

/**
 * OSGB36 / British National Grid. Coordinates are on Airy 1830, so a WGS84
 * longitude and latitude has to be shifted onto that datum before projecting.
 * The seven-parameter Helmert below is the Ordnance Survey's own, good to
 * about 20 cm across Great Britain — a tenth of a DEM pixel.
 */
const OSGB_TM = transverseMercator({
  ...AIRY1830, k0: 0.9996012717, lon0: -2, lat0: 49, x0: 400000, y0: -100000,
});

// tx ty tz in metres, rx ry rz in seconds of arc, s in parts per million.
const OSGB_HELMERT = { tx: -446.448, ty: 125.157, tz: -542.060, rx: -0.1502, ry: -0.2470, rz: -0.8421, s: 20.4894 };

const toCartesian = ([lon, lat], { a, f }, h = 0) => {
  const phi = lat * D2R, lam = lon * D2R;
  const e2 = f * (2 - f);
  const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [
    (nu + h) * Math.cos(phi) * Math.cos(lam),
    (nu + h) * Math.cos(phi) * Math.sin(lam),
    (nu * (1 - e2) + h) * Math.sin(phi),
  ];
};

const fromCartesian = ([x, y, z], { a, f }) => {
  const e2 = f * (2 - f);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 8; i++) {                    // converges in three or four
    const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z + e2 * nu * Math.sin(phi), p);
  }
  return [Math.atan2(y, x) * R2D, phi * R2D];
};

const helmert = ([x, y, z], h, invert) => {
  const sgn = invert ? -1 : 1;
  const s = 1 + (sgn * h.s) / 1e6;
  const rx = (sgn * h.rx * Math.PI) / (180 * 3600);
  const ry = (sgn * h.ry * Math.PI) / (180 * 3600);
  const rz = (sgn * h.rz * Math.PI) / (180 * 3600);
  return [
    sgn * h.tx + s * (x - rz * y + ry * z),
    sgn * h.ty + s * (rz * x + y - rx * z),
    sgn * h.tz + s * (-ry * x + rx * y + z),
  ];
};

const osgb = {
  forward(lngLat) {
    const shifted = helmert(toCartesian(lngLat, WGS84), OSGB_HELMERT, false);
    return OSGB_TM.forward(fromCartesian(shifted, AIRY1830));
  },
  inverse(xy) {
    const airy = OSGB_TM.inverse(xy);
    const shifted = helmert(toCartesian(airy, AIRY1830), OSGB_HELMERT, true);
    return fromCartesian(shifted, WGS84);
  },
};

/** Web Mercator, as used by every slippy map. */
const webMercator = {
  forward([lon, lat]) {
    const phi = Math.max(-85.05112878, Math.min(85.05112878, lat)) * D2R;
    return [WGS84.a * lon * D2R, WGS84.a * Math.log(Math.tan(Math.PI / 4 + phi / 2))];
  },
  inverse([x, y]) {
    return [
      (x / WGS84.a) * R2D,
      (2 * Math.atan(Math.exp(y / WGS84.a)) - Math.PI / 2) * R2D,
    ];
  },
};

/** Already longitude and latitude — nothing to do. */
const identity = { forward: (p) => [p[0], p[1]], inverse: (p) => [p[0], p[1]] };

/* ----------------------------------------------------------------- lookup */

/**
 * Returns a projector for an EPSG code, or null if we cannot place the pixels
 * with confidence. `degrees: true` means the grid is already in longitude and
 * latitude, which changes how cell sizes are measured.
 */
export function projectorFor(epsg) {
  const code = Number(epsg);
  if (!code) return null;

  if (code === 4326 || code === 4979 || code === 4269) {
    // 4269 is NAD83. Its difference from WGS84 is around a metre in the US and
    // under a pixel of a 1 m grid, so we treat it as longitude and latitude.
    return { epsg: code, name: code === 4269 ? 'NAD83 (lon/lat)' : 'WGS84 (lon/lat)', degrees: true, ...identity };
  }
  if (code === 3857 || code === 900913 || code === 3785) {
    return { epsg: code, name: 'Web Mercator', degrees: false, ...webMercator };
  }
  if (code === 27700) {
    return { epsg: code, name: 'British National Grid', degrees: false, ...osgb };
  }
  if (code >= 32601 && code <= 32660) {
    return { epsg: code, name: `UTM zone ${code - 32600}N`, degrees: false, ...utm(code - 32600, false) };
  }
  if (code >= 32701 && code <= 32760) {
    return { epsg: code, name: `UTM zone ${code - 32700}S`, degrees: false, ...utm(code - 32700, true) };
  }
  // NAD83 UTM zones, treated as their WGS84 twins for the reason above.
  if (code >= 26901 && code <= 26923) {
    return { epsg: code, name: `UTM zone ${code - 26900}N (NAD83)`, degrees: false, ...utm(code - 26900, false) };
  }
  return null;
}

/** For the error message, so the user knows what we could not read. */
export const SUPPORTED_CRS =
  'WGS84/NAD83 longitude and latitude (EPSG:4326, 4269), UTM (32601–32660, 32701–32760, 26901–26923), '
  + 'Web Mercator (3857) and British National Grid (27700)';
