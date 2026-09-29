/**
 * The only place the app talks to storage.
 *
 * One of two drivers sits behind this: `local` (localStorage, one browser) or
 * `supabase` (shared Postgres, the whole team). Which one is decided by
 * whether VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time.
 *
 * Everything is loaded into memory once by init(), so reads are synchronous
 * and the screens stay simple. Writes are asynchronous and write through to
 * the driver, updating the cache as they go.
 */
import * as local from './local.js';
import * as supabase from './supabase.js';
import { LPGA_SCHEDULE, LPGA_SEASON } from '../../data/lpgaCourses.js';
import { MAST_MAX_SLOPE_DEG, MAST_SLOPE_RANGE } from '../../data/constants.js';
import { migratePlans } from '../migrate.js';

const useRemote = supabase.configured();
const driver = useRemote ? supabase : local;

let cache = { courses: [], plans: [], kits: [] };
let ready = false;

export const isRemote = () => useRemote;
export const driverName = driver.name;

/** UUIDs both drivers accept — Postgres needs them, localStorage does not care. */
export const newId = () =>
  (crypto.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);

/* ---------------------------------------------------- device-local bits -- */
/* The Mapbox token and your name stay on the device: the token is personal and
   the name is just who to credit on a plan. */
const readLocal = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const getToken = () => import.meta.env.VITE_MAPBOX_TOKEN || readLocal('b6.token', null);
export const setToken = (t) => writeLocal('b6.token', t);
export const clearToken = () => localStorage.removeItem('b6.token');
export const getUser = () => readLocal('b6.user', '');
export const setUser = (n) => writeLocal('b6.user', n);

/**
 * The mast slope limit, in degrees. Device-local on purpose: it describes the
 * heads and legs actually in front of you, so a rigger carrying a heavy box on
 * a tall column and a planner at a desk can each hold the figure their own kit
 * manages. Clamped on read, so a hand-edited value cannot produce a plan shaded
 * against a nonsense limit.
 */
export const getSlopeLimit = () => {
  const v = Number(readLocal('b6.slopeLimit', MAST_MAX_SLOPE_DEG));
  const [lo, hi] = MAST_SLOPE_RANGE;
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : MAST_MAX_SLOPE_DEG;
};
export const setSlopeLimit = (deg) => writeLocal('b6.slopeLimit', deg);

/* ----------------------------------------------------------------- init -- */
const seedCourses = () =>
  LPGA_SCHEDULE.map((c) => ({
    id: newId(), name: c.venue, event: c.event, place: c.place,
    dates: `${c.dates} ${LPGA_SEASON}`, major: !!c.major, tbc: !!c.tbc,
    lngLat: c.lngLat ?? null, holes: null, seeded: true,
  }));

/**
 * Loads everything. Seeds the LPGA schedule and a first kit when the store is
 * empty — on Supabase that happens once, for whoever signs in first.
 */
export async function init() {
  const loaded = await driver.load();
  cache = {
    courses: loaded.courses ?? [],
    // Older plans carry field values the code has since renamed. One pass here
    // means nothing downstream has to know the old names existed.
    plans: migratePlans(loaded.plans ?? []),
    kits: loaded.kits ?? [],
  };

  if (!cache.courses.length) {
    cache.courses = seedCourses();
    if (useRemote) await Promise.all(cache.courses.map((c) => driver.saveCourse(c)));
    else await local.putCourses(cache.courses);
  }
  if (!cache.kits.length) {
    const kit = { id: newId(), name: 'Kit 1', size: 60, unavailable: [], notes: '' };
    cache.kits = [kit];
    if (useRemote) await driver.saveKit(kit);
    else await local.putKits(cache.kits);
  }
  ready = true;
  return { remote: useRemote };
}

/** Pull the shared workspace again — how you see other people's changes. */
export async function refresh() {
  const loaded = await driver.load();
  cache = { courses: loaded.courses ?? [], plans: migratePlans(loaded.plans ?? []), kits: loaded.kits ?? [] };
  return cache;
}

export const isReady = () => ready;

/* ------------------------------------------------------ reads (in memory) -- */
export const getCourses = () => cache.courses;
export const getCourse = (id) => cache.courses.find((c) => c.id === id) ?? null;
export const getPlans = () => cache.plans;
export const getPlansForCourse = (courseId) => cache.plans.filter((p) => p.courseId === courseId);
export const getPlan = (id) => cache.plans.find((p) => p.id === id) ?? null;
export const getKits = () => cache.kits;
export const getKit = (id) => cache.kits.find((k) => k.id === id) ?? null;

/* ----------------------------------------------------------------- writes -- */
const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  return list;
};

export async function saveCourse(course) {
  upsert(cache.courses, course);
  await driver.saveCourse(course, cache.courses);
  return course;
}

export async function saveKit(kit) {
  upsert(cache.kits, kit);
  await driver.saveKit(kit, cache.kits);
  return kit;
}

export async function deleteKit(id) {
  if (cache.kits.length <= 1) return;            // never leave zero kits
  cache.kits = cache.kits.filter((k) => k.id !== id);
  await driver.deleteKit(id, cache.kits);
}

export async function savePlan(plan) {
  const next = { ...plan, updatedAt: new Date().toISOString() };
  upsert(cache.plans, next);
  await driver.savePlan(next, cache.plans);
  return next;
}

export async function deletePlan(id) {
  cache.plans = cache.plans.filter((p) => p.id !== id);
  await driver.deletePlan(id, cache.plans);
}

export async function createPlan({ courseId, name, owner, kitId }) {
  const plan = {
    id: newId(), courseId, name, owner,
    kitId: kitId ?? cache.kits[0]?.id ?? null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    entities: [],
  };
  cache.plans.push(plan);
  await driver.savePlan(plan, cache.plans);
  return plan;
}

export async function duplicatePlan(plan, owner) {
  const copy = {
    ...plan, id: newId(), name: `${plan.name} (copy)`, owner,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    entities: plan.entities.map((e) => ({ ...e, id: newId() })),
  };
  cache.plans.push(copy);
  await driver.savePlan(copy, cache.plans);
  for (const e of copy.entities) await driver.saveEntity(copy.id, e, cache.plans);
  return copy;
}

/* --- per entity: what keeps two people from overwriting each other ------- */
export async function saveEntity(planId, entity) {
  const plan = getPlan(planId);
  if (plan) upsert(plan.entities, entity);
  await driver.saveEntity(planId, entity, cache.plans);
}

export async function deleteEntity(planId, entityId) {
  const plan = getPlan(planId);
  if (plan) plan.entities = plan.entities.filter((e) => e.id !== entityId);
  await driver.deleteEntity(planId, entityId, cache.plans);
}

/* ------------------------------------------------------------- elevation -- */
/**
 * A course's slope grid, loaded on demand rather than with everything else —
 * it is a few hundred kilobytes and most sessions never open it.
 *
 * Cached per course once fetched. `null` is a real answer, meaning this course
 * has no elevation, and it is cached too so opening the map does not re-ask on
 * every hole change.
 */
const demCache = new Map();

export async function loadDem(courseId) {
  if (!courseId) return null;
  if (demCache.has(courseId)) return demCache.get(courseId);
  const dem = await driver.loadDem(courseId);
  demCache.set(courseId, dem ?? null);
  return dem ?? null;
}

/** What is already in hand, without going to storage. */
export const peekDem = (courseId) => demCache.get(courseId) ?? null;
export const hasDemLoaded = (courseId) => demCache.has(courseId);

export async function saveDem(courseId, dem) {
  await driver.saveDem(courseId, dem);
  demCache.set(courseId, dem);
  return dem;
}

export async function deleteDem(courseId) {
  await driver.deleteDem(courseId);
  demCache.set(courseId, null);
}

/* ------------------------------------------------------------------ auth -- */
export const auth = {
  enabled: useRemote,
  currentUser: () => (useRemote ? supabase.currentUser() : Promise.resolve(null)),
  signIn: (email, password) => supabase.signInWithPassword(email, password),
  changePassword: (password) => supabase.updatePassword(password),
  signOut: () => supabase.signOut(),
  onChange: (fn) => (useRemote ? supabase.onAuthChange(fn) : Promise.resolve(null)),
};

/** One-time push of whatever this browser already has into the shared store. */
export async function importLocalWorkspace() {
  const existing = await local.load();
  if (!existing.plans?.length && !existing.courses?.length) return { plans: 0 };
  await supabase.importAll({
    courses: existing.courses ?? [], kits: existing.kits ?? [], plans: existing.plans ?? [],
  });
  await refresh();
  return { plans: existing.plans?.length ?? 0, courses: existing.courses?.length ?? 0 };
}
