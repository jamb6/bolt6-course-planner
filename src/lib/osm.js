/**
 * Hole geometry from OpenStreetMap.
 *
 * WHAT THIS GIVES YOU: the club's everyday routing — hole centrelines, green
 * polygons, tee boxes.
 *
 * WHAT IT DOES NOT: the tournament layout. Temporary tees, moved pins,
 * reversed nines and altered pars are not published anywhere machine-readable;
 * they live in tournament media-guide PDFs. Treat OSM as the baseline and
 * expect to nudge greens and tees by hand once the tournament layout is known.
 */
import { centroid, bounds, bearing, distance } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Per-attempt ceiling. The public Overpass endpoint queues requests when it
 *  is busy rather than refusing them, so without this a fetch can sit open for
 *  minutes and the app just looks frozen. */
export const ATTEMPT_TIMEOUT_MS = 12000;

const query = ([lng, lat], radius = 1600) => `[out:json][timeout:25];
( way(around:${radius},${lat},${lng})["golf"];
  relation(around:${radius},${lat},${lng})["golf"]; );
out geom tags;`;

const holeNumber = (tags) => {
  const match = String(tags.ref ?? tags.name ?? '').match(/\d{1,2}/);
  const n = match ? parseInt(match[0], 10) : NaN;
  return n >= 1 && n <= 18 ? n : null;
};

/** Turn an Overpass response into hole records. Returns [] if it can't. */
export function parseHoles(elements) {
  const found = new Map();
  const slot = (n) => {
    if (!found.has(n)) found.set(n, { number: n, tees: [], greens: [], line: null, par: null });
    return found.get(n);
  };

  for (const el of elements) {
    const tags = el.tags || {};
    const coords = (el.geometry || []).map((p) => [p.lon, p.lat]);
    const n = holeNumber(tags);
    if (!coords.length || !n) continue;

    if (tags.golf === 'hole') {
      const hole = slot(n);
      hole.line = coords;
      if (tags.par) hole.par = parseInt(tags.par, 10);
    } else if (tags.golf === 'green') {
      slot(n).greens.push(centroid(coords));
    } else if (tags.golf === 'tee') {
      slot(n).tees.push(centroid(coords));
    }
  }

  const holes = [];
  for (const [n, raw] of [...found.entries()].sort((a, b) => a[0] - b[0])) {
    if (!raw.line) continue;
    const green = raw.greens.length ? centroid(raw.greens) : raw.line[raw.line.length - 1];

    // OSM does not guarantee the centreline runs tee -> green, so orient it by
    // whichever end sits closer to the green.
    const line =
      distance(raw.line[0], green) < distance(raw.line[raw.line.length - 1], green)
        ? [...raw.line].reverse()
        : raw.line;

    const tee = raw.tees.length
      ? raw.tees.reduce((best, p) => (distance(p, line[0]) < distance(best, line[0]) ? p : best))
      : line[0];

    holes.push({
      number: n,
      par: raw.par,
      tee,
      green,
      line,
      bounds: bounds([...line, tee, green], 45),
      playBearing: bearing(tee, green),
    });
  }
  return holes;
}

/** Fetch and parse. Throws if every endpoint fails. */
/**
 * Fetch and parse. Tries both mirrors, POST then GET, each with its own
 * timeout so a stalled endpoint cannot hang the app. `onProgress` is called
 * with a human-readable line before each attempt, and `signal` lets the caller
 * give up entirely.
 *
 * Throws if every attempt fails, with the last real reason attached.
 */
export async function fetchHoles(lngLat, { onProgress, signal } = {}) {
  const ql = query(lngLat);
  const attempts = ENDPOINTS.flatMap((url) => [
    { url, verb: 'POST' },
    { url, verb: 'GET' },
  ]);
  let lastError;

  for (const [i, { url, verb }] of attempts.entries()) {
    if (signal?.aborted) throw new Error('Cancelled');
    const host = new URL(url).hostname;
    onProgress?.(`Asking ${host} (${verb}, try ${i + 1} of ${attempts.length})…`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);

    try {
      const res =
        verb === 'POST'
          ? await fetch(url, {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ data: ql }).toString(),
            })
          : await fetch(`${url}?data=${encodeURIComponent(ql)}`, { signal: controller.signal });

      if (res.status === 429 || res.status === 504) throw new Error(`${host} is busy (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`${host} returned HTTP ${res.status}`);

      const json = await res.json();
      const holes = parseHoles(json.elements || []);
      if (!holes.length) throw new Error('No golf holes are mapped here in OpenStreetMap');
      return holes;
    } catch (err) {
      lastError = signal?.aborted
        ? new Error('Cancelled')
        : err.name === 'AbortError'
          ? new Error(`${host} did not answer within ${ATTEMPT_TIMEOUT_MS / 1000}s`)
          : err;
      if (signal?.aborted) throw lastError;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastError ?? new Error('OpenStreetMap could not be reached');
}
