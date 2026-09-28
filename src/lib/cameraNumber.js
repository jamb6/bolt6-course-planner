/**
 * Cameras carry two identifiers, and they mean different things.
 *
 *   number    the physical camera, 1–60. Three to a hole: hole 1 owns 1–3,
 *             hole 2 owns 4–6, up to hole 18 owning 52–54, with 55–60 spare
 *             for a fourth camera somewhere. This is the box you pick up.
 *
 *   position  where it stands on the hole, numbered clockwise from the left
 *             of the green: g01 left, g02 middle, g03 right. Written with the
 *             hole as h01-g03. This is the spot, not the kit — a camera can be
 *             swapped without the position changing.
 */
import { CAMS_PER_HOLE, POSITIONS_PER_HOLE } from '../data/constants.js';
import { isAvailable } from './kits.js';

/* ------------------------------------------------------ physical number -- */

/** The numbers reserved for a hole, e.g. hole 2 -> [4, 5, 6]. */
export function blockForHole(hole) {
  const first = (hole - 1) * CAMS_PER_HOLE + 1;
  return Array.from({ length: CAMS_PER_HOLE }, (_, i) => first + i);
}

/**
 * Lowest number for a hole that is free in this plan AND present in the kit:
 * the hole's own block first, then any spare. Broken or missing cameras are
 * skipped, so a kit with 7 down gives hole 3 numbers 8 and 9 instead of 7.
 * Returns null when the kit has nothing left.
 */
export function nextCameraNumber(entities, hole, kit) {
  const taken = new Set(
    entities.filter((e) => e.kind === 'camera' && e.number != null).map((e) => e.number)
  );
  const usable = (n) => !taken.has(n) && isAvailable(kit, n);

  if (hole) {
    const free = blockForHole(hole).find(usable);
    if (free) return free;
  }
  for (let n = 1; n <= (kit?.size ?? 60); n++) if (usable(n)) return n;
  return null;
}

/** Numbers used more than once, so the UI can flag them. */
export function duplicateNumbers(entities) {
  const seen = new Map();
  for (const e of entities) {
    if (e.kind !== 'camera' || e.number == null) continue;
    seen.set(e.number, (seen.get(e.number) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/* ------------------------------------------------------- rig position --- */

const pad = (n) => String(n).padStart(2, '0');

/** h01-g03. Null when the camera is not tied to a hole. */
export function positionId(hole, position) {
  if (!hole || !position) return null;
  return `h${pad(hole)}-g${pad(position)}`;
}

/** Which of the three positions on a hole are already claimed. */
export function takenPositions(entities, hole, exceptId = null) {
  return new Set(
    entities
      .filter((e) => e.kind === 'camera' && e.hole === hole && e.position != null && e.id !== exceptId)
      .map((e) => e.position)
  );
}

/**
 * Lowest free position on a hole, clockwise from the left of the green.
 * Returns null when all three are taken — a hole cannot hold a fourth.
 */
export function nextPosition(entities, hole) {
  if (!hole) return null;
  const taken = takenPositions(entities, hole);
  for (let p = 1; p <= POSITIONS_PER_HOLE; p++) if (!taken.has(p)) return p;
  return null;
}

/** Position ids used twice on the same hole. */
export function duplicatePositions(entities) {
  const seen = new Map();
  for (const e of entities) {
    if (e.kind !== 'camera') continue;
    const id = positionId(e.hole, e.position);
    if (!id) continue;
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/** What a camera is called: its position where it has one, else its number. */
export const cameraLabel = (camera) =>
  positionId(camera.hole, camera.position) ?? `CAM ${camera.number ?? '?'}`;
