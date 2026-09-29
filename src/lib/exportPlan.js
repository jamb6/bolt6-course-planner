/**
 * The rigging breakdown.
 *
 * This is the sheet the crew carries: for each hole, which camera numbers are
 * on it, how many masts to bring, and how much cable of each type.
 */
import { CABLE_TYPES, CABLE_BUCKETS, CAMERA_TYPES, POSITIONS_PER_HOLE,
         SLOPE_MARGIN_DEG, MAST_MAX_SLOPE_DEG } from '../data/constants.js';
import { fmtM } from './geo.js';
import { positionId } from './cameraNumber.js';
import { slopeAt, coversPoint } from './dem.js';

const bucketFor = (metres) =>
  CABLE_BUCKETS.find((b) => metres >= b.min && metres < b.max) ?? CABLE_BUCKETS[0];

/** One row per hole that has anything on it, plus a course-wide row. */
export function buildBreakdown(entities) {
  const rows = new Map();

  const row = (hole) => {
    const key = hole ?? 0; // 0 = not tied to a hole
    if (!rows.has(key)) {
      rows.set(key, {
        hole: key,
        cameraNumbers: [],
        positions: [],
        cameras: 0,
        masts: 0,
        switches: 0,
        markers: 0,
        cables: 0,
        cableMetres: Object.fromEntries(CABLE_TYPES.map((t) => [t.id, 0])),
        notes: [],
      });
    }
    return rows.get(key);
  };

  for (const e of entities) {
    const r = row(e.hole);
    if (e.kind === 'camera') {
      r.cameras += 1;
      if (e.number != null) r.cameraNumbers.push(e.number);
      if (e.position != null) r.positions.push(e.position);
      if (e.camType === 'mast') r.masts += 1;
    } else if (e.kind === 'switch') {
      r.switches += 1;
    } else if (e.kind === 'marker') {
      r.markers += 1;
    } else if (e.kind === 'cable') {
      r.cables += 1;
      r.cableMetres[e.cableType] = (r.cableMetres[e.cableType] || 0) + (e.lengthM || 0);
    }
    if (e.notes?.trim()) {
      r.notes.push(`${e.label || e.kind}: ${e.notes.trim()}`);
    }
  }

  return [...rows.values()]
    .map((r) => ({
      ...r,
      cameraNumbers: r.cameraNumbers.sort((a, b) => a - b),
      positions: r.positions.sort((a, b) => a - b),
    }))
    .sort((a, b) => a.hole - b.hole);
}

/** Totals across the whole plan, also used by the info bar. */
export function buildTotals(entities) {
  const cables = entities.filter((e) => e.kind === 'cable');
  const byBucket = Object.fromEntries(CABLE_BUCKETS.map((b) => [b.id, 0]));
  for (const c of cables) byBucket[bucketFor(c.lengthM || 0).id] += 1;

  return {
    cameras: entities.filter((e) => e.kind === 'camera').length,
    masts: entities.filter((e) => e.kind === 'camera' && e.camType === 'mast').length,
    switches: entities.filter((e) => e.kind === 'switch').length,
    markers: entities.filter((e) => e.kind === 'marker').length,
    cables: cables.length,
    cableBuckets: byBucket,
    holesWithCamera: new Set(
      entities.filter((e) => e.kind === 'camera' && e.hole).map((e) => e.hole)
    ).size,
    totalCableM: cables.reduce((sum, c) => sum + (c.lengthM || 0), 0),
  };
}

export function toCSV(plan, course, entities, kit, dem = null, limitDeg = MAST_MAX_SLOPE_DEG) {
  const rows = buildBreakdown(entities);
  const totals = buildTotals(entities);
  const cableCols = CABLE_TYPES.map((t) => `${t.label} (m)`);

  const lines = [
    `Plan,${JSON.stringify(plan.name)}`,
    `Course,${JSON.stringify(course.name)}`,
    `Owner,${JSON.stringify(plan.owner || '')}`,
    `Kit,${JSON.stringify(kit?.name || '')}`,
    `Cameras out of service,${JSON.stringify((kit?.unavailable ?? []).join(' '))}`,
    `Exported,${new Date().toISOString()}`,
    '',
    ['Hole', 'Positions', 'Camera numbers', 'Cameras', 'Masts', 'Switches', 'Markers', 'Cables', ...cableCols, 'Notes'].join(','),
  ];

  for (const r of rows) {
    lines.push(
      [
        r.hole === 0 ? 'Course-wide' : r.hole,
        JSON.stringify(r.positions.map((p) => positionId(r.hole, p) ?? `g${String(p).padStart(2, '0')}`).join(' ')),
        JSON.stringify(r.cameraNumbers.join(' ')),
        r.cameras,
        r.masts,
        r.switches,
        r.markers,
        r.cables,
        ...CABLE_TYPES.map((t) => Math.round(r.cableMetres[t.id] || 0)),
        JSON.stringify(r.notes.join(' | ')),
      ].join(',')
    );
  }

  lines.push('');
  lines.push(
    ['TOTAL', '', '', totals.cameras, totals.masts, totals.switches, totals.markers, totals.cables,
      ...CABLE_TYPES.map((t) =>
        Math.round(rows.reduce((sum, r) => sum + (r.cableMetres[t.id] || 0), 0))),
      JSON.stringify(`${fmtM(totals.totalCableM)} m of cable total`)].join(',')
  );

  const slope = buildSlopeRows(entities, dem, limitDeg);
  if (slope) {
    lines.push('');
    lines.push(['GROUND SLOPE',
      JSON.stringify(`mast limit ${slope.limitDeg} deg`),
      JSON.stringify(`${slope.dem.fileName || 'uploaded elevation'}, ${slope.dem.cellM} m cells`)].join(','));
    lines.push(['Position', 'Camera', 'Slope (deg)', 'Verdict'].join(','));
    for (const f of slope.flagged) {
      lines.push([
        JSON.stringify(positionId(f.entity.hole, f.entity.position) ?? f.entity.label ?? ''),
        f.entity.number ?? '',
        f.deg == null ? '' : f.deg.toFixed(1),
        JSON.stringify(f.verdict),
      ].join(','));
    }
    lines.push(['', '', '',
      JSON.stringify(`${slope.fine} mast position(s) comfortably inside the limit`)].join(','));
  } else {
    // Said out loud, because a missing section reads as "all clear".
    lines.push('');
    lines.push('GROUND SLOPE,"not checked - no elevation uploaded for this course"');
  }

  return lines.join('\n');
}

/**
 * The mast slope section of the rigging breakdown.
 *
 * Only the positions that need a decision are listed: too steep, close to the
 * limit, or unmeasured. Everything that is comfortably fine is a count, because
 * a sheet that lists all sixty makes the four that matter harder to find.
 *
 * With no elevation loaded this returns nothing at all rather than a column of
 * blanks, which would read as though every position had been checked and passed.
 */
export function buildSlopeRows(entities, dem, limitDeg) {
  if (!dem) return null;
  const flagged = [];
  let fine = 0;

  for (const e of entities) {
    if (e.kind !== 'camera' || e.camType !== 'mast') continue;
    const outside = !coversPoint(dem, e.coords);
    const deg = outside ? null : slopeAt(dem, e.coords);

    if (deg == null) {
      flagged.push({ entity: e, deg: null, verdict: outside ? 'Outside the elevation file' : 'No reading' });
    } else if (deg > limitDeg) {
      flagged.push({ entity: e, deg, verdict: 'Too steep' });
    } else if (deg > limitDeg - SLOPE_MARGIN_DEG) {
      flagged.push({ entity: e, deg, verdict: 'Close to the limit' });
    } else {
      fine += 1;
    }
  }

  flagged.sort((a, b) => (b.deg ?? Infinity) - (a.deg ?? Infinity));
  return { flagged, fine, limitDeg, dem };
}

/** Trigger a browser download. */
export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ========================================================================= */

const markFor = (camType) => CAMERA_TYPES.find((t) => t.id === camType)?.mark ?? '?';

/**
 * The camera plan: a row per hole, a column per position, each cell holding
 * the camera number and its mounting mark (M mast, L LED, ^ tower,
 * H hospitality). Empty positions stay blank. This is the sheet the crew
 * works from, so it mirrors the paper layout rather than the data model.
 *
 * Cameras with no hole or no position cannot be placed on the grid; they are
 * listed underneath rather than dropped silently.
 */
export function buildCameraPlan(entities, holeNumbers) {
  const grid = new Map(holeNumbers.map((n) => [n, { hole: n, cells: [], masts: 0 }]));
  const orphans = [];

  for (const e of entities) {
    if (e.kind !== 'camera') continue;
    const row = grid.get(e.hole);
    if (!row || !e.position || e.position > POSITIONS_PER_HOLE) {
      orphans.push(e);
      continue;
    }
    row.cells[e.position - 1] = e.number != null
      ? `${e.number} ${markFor(e.camType)}`
      : `— ${markFor(e.camType)}`;
    if (e.camType === 'mast') row.masts += 1;
  }

  return { rows: [...grid.values()], orphans };
}

export function toCameraPlanCSV(plan, course, entities, kit, holeNumbers) {
  const { rows, orphans } = buildCameraPlan(entities, holeNumbers);
  const positions = Array.from({ length: POSITIONS_PER_HOLE }, (_, i) => `g${String(i + 1).padStart(2, '0')}`);

  const lines = [
    `Plan,${JSON.stringify(plan.name)}`,
    `Course,${JSON.stringify(course.name)}`,
    `Owner,${JSON.stringify(plan.owner || '')}`,
    `Kit,${JSON.stringify(kit?.name || '')}`,
    `Exported,${new Date().toISOString()}`,
    '',
    ['Hole', ...positions, 'Masts'].join(','),
  ];

  for (const r of rows) {
    const cells = Array.from({ length: POSITIONS_PER_HOLE }, (_, i) => JSON.stringify(r.cells[i] ?? ''));
    lines.push([r.hole, ...cells, r.masts].join(','));
  }

  const totalCams = rows.reduce((n, r) => n + r.cells.filter(Boolean).length, 0);
  const totalMasts = rows.reduce((n, r) => n + r.masts, 0);
  lines.push('');
  lines.push(['TOTAL', JSON.stringify(`${totalCams} cameras`), '', '', totalMasts].join(','));
  lines.push('');
  lines.push('Mounting,M mast,L LED board,^ tower,H hospitality');

  if (orphans.length) {
    lines.push('');
    lines.push(`NOT ON THE GRID,${JSON.stringify(`${orphans.length} camera(s) missing a hole or position`)}`);
    for (const o of orphans) {
      lines.push(['', JSON.stringify(o.label ?? ''), JSON.stringify(`hole ${o.hole ?? '—'}`),
                  JSON.stringify(`position ${o.position ?? '—'}`), JSON.stringify(`CAM ${o.number ?? '—'}`)].join(','));
    }
  }

  return lines.join('\n');
}
