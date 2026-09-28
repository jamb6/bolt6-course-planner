/**
 * Distances on the WGS84 ellipsoid.
 *
 * Vincenty's inverse formula, not haversine. Haversine (what @turf/turf uses)
 * treats the earth as a sphere and runs ~0.04% long, which is fine for a 50 m
 * cable and wrong by 7 m over 10 km. PostGIS ST_Length(geography) is
 * ellipsoidal, so this is also the version the server will agree with.
 */
const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const R_SPHERE = 6371008.8;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Metres between two [lng, lat] points. */
export function distance(p, q) {
  const L = rad(q[0] - p[0]);
  const U1 = Math.atan((1 - F) * Math.tan(rad(p[1])));
  const U2 = Math.atan((1 - F) * Math.tan(rad(q[1])));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1);
  const sU2 = Math.sin(U2), cU2 = Math.cos(U2);

  let lambda = L, prev, i = 0;
  let sinSigma, cosSigma, sigma, sinAlpha, cos2SigmaM, C;

  do {
    const sL = Math.sin(lambda), cL = Math.cos(lambda);
    sinSigma = Math.hypot(cU2 * sL, cU1 * sU2 - sU1 * cU2 * cL);
    if (sinSigma === 0) return 0;
    cosSigma = sU1 * sU2 + cU1 * cU2 * cL;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cU1 * cU2 * sL) / sinSigma;
    const cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sU1 * sU2) / cosSqAlpha;
    C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    prev = lambda;
    lambda =
      L +
      (1 - C) * F * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
  } while (Math.abs(lambda - prev) > 1e-12 && ++i < 200);

  const uSq = (1 - sinAlpha ** 2) * ((A * A - B * B) / (B * B));
  const Ac = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bc = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const dSigma =
    Bc * sinSigma *
    (cos2SigmaM +
      (Bc / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (Bc / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return B * Ac * (sigma - dSigma);
}

/** Total metres along a list of [lng, lat] points. */
export function pathLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distance(coords[i - 1], coords[i]);
  return total;
}

/** Degrees clockwise from true north, p -> q. */
export function bearing(p, q) {
  const p1 = rad(p[1]), p2 = rad(q[1]), dl = rad(q[0] - p[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `metres` away from `origin` on the given bearing. */
export function destination(origin, metres, brg) {
  const d = metres / R_SPHERE, t = rad(brg);
  const p1 = rad(origin[1]), l1 = rad(origin[0]);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1),
                             Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((deg(l2) + 540) % 360) - 180, deg(p2)];
}

/** Bounding box [[w,s],[e,n]] of some points, padded by `padM` metres. */
export function bounds(coords, padM = 0) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  if (!padM) return [[w, s], [e, n]];
  return [
    [destination([w, s], padM, 270)[0], destination([w, s], padM, 180)[1]],
    [destination([e, n], padM, 90)[0],  destination([e, n], padM, 0)[1]],
  ];
}

export const centroid = (coords) => [
  coords.reduce((sum, c) => sum + c[0], 0) / coords.length,
  coords.reduce((sum, c) => sum + c[1], 0) / coords.length,
];

/** Metres, formatted the way an engineer reads them. */
export const fmtM = (m) => (m < 10 ? m.toFixed(1) : Math.round(m).toString());
