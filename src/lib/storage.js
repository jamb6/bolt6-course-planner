/**
 * Everything persists to localStorage. One place, so swapping in a real API
 * later means rewriting this file and nothing else.
 */
import { LPGA_SCHEDULE, LPGA_SEASON } from '../data/lpgaCourses.js';

const KEYS = {
  token: 'b6.token',
  user: 'b6.user',
  courses: 'b6.courses',
  plans: 'b6.plans',
  kits: 'b6.kits',
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const newId = () =>
  'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* -------------------------------------------------------------- token --- */
export const getToken = () => import.meta.env.VITE_MAPBOX_TOKEN || read(KEYS.token, null);
export const setToken = (t) => write(KEYS.token, t);
export const clearToken = () => localStorage.removeItem(KEYS.token);

/* --------------------------------------------------------------- user --- */
export const getUser = () => read(KEYS.user, '');
export const setUser = (name) => write(KEYS.user, name);

/* ------------------------------------------------------------ courses --- */
/** First run seeds the LPGA schedule. After that the stored list is the truth. */
export function getCourses() {
  const stored = read(KEYS.courses, null);
  if (stored) return stored;
  const seeded = LPGA_SCHEDULE.map((c) => ({
    id: newId(),
    name: c.venue,
    event: c.event,
    place: c.place,
    dates: `${c.dates} ${LPGA_SEASON}`,
    major: !!c.major,
    tbc: !!c.tbc,
    lngLat: c.lngLat ?? null,
    holes: null,       // filled from OpenStreetMap on first open
    seeded: true,
  }));
  write(KEYS.courses, seeded);
  return seeded;
}

export function saveCourse(course) {
  const all = getCourses();
  const i = all.findIndex((c) => c.id === course.id);
  if (i >= 0) all[i] = course;
  else all.push(course);
  write(KEYS.courses, all);
  return course;
}

export function deleteCourse(id) {
  write(KEYS.courses, getCourses().filter((c) => c.id !== id));
}

/* --------------------------------------------------------------- kits --- */
/** One kit on first run; add more in Settings. */
export function getKits() {
  const stored = read(KEYS.kits, null);
  if (stored?.length) return stored;
  const seeded = [{ id: newId(), name: 'Kit 1', size: 60, unavailable: [], notes: '' }];
  write(KEYS.kits, seeded);
  return seeded;
}

export function saveKit(kit) {
  const all = getKits();
  const i = all.findIndex((k) => k.id === kit.id);
  if (i >= 0) all[i] = kit;
  else all.push(kit);
  write(KEYS.kits, all);
  return kit;
}

export function deleteKit(id) {
  const left = getKits().filter((k) => k.id !== id);
  write(KEYS.kits, left.length ? left : getKits());   // never leave zero kits
}

export const getKit = (id) => getKits().find((k) => k.id === id) ?? null;

/* -------------------------------------------------------------- plans --- */
export const getPlans = () => read(KEYS.plans, []);

export const getPlansForCourse = (courseId) =>
  getPlans().filter((p) => p.courseId === courseId);

export function savePlan(plan) {
  const all = getPlans();
  const i = all.findIndex((p) => p.id === plan.id);
  const next = { ...plan, updatedAt: new Date().toISOString() };
  if (i >= 0) all[i] = next;
  else all.push(next);
  write(KEYS.plans, all);
  return next;
}

export function deletePlan(id) {
  write(KEYS.plans, getPlans().filter((p) => p.id !== id));
}

export function createPlan({ courseId, name, owner, kitId }) {
  return savePlan({
    id: newId(),
    courseId,
    name,
    owner,
    kitId: kitId ?? getKits()[0].id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entities: [],
  });
}

export function duplicatePlan(plan, owner) {
  return savePlan({
    ...plan,
    id: newId(),
    name: `${plan.name} (copy)`,
    owner,
    createdAt: new Date().toISOString(),
    entities: plan.entities.map((e) => ({ ...e, id: newId() })),
  });
}
