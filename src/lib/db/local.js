/**
 * localStorage driver — one browser, one machine, no sharing.
 *
 * This is the fallback when Supabase is not configured, and it is what the
 * test suites run against. Same interface as the Supabase driver, so the rest
 * of the app cannot tell which one it is talking to.
 */
const KEYS = { courses: 'b6.courses', plans: 'b6.plans', kits: 'b6.kits' };

const read = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

export const name = 'local';
export const remote = false;

export async function load() {
  return {
    courses: read(KEYS.courses, null),
    plans: read(KEYS.plans, []),
    kits: read(KEYS.kits, null),
  };
}

/** Writes replace the whole collection; it is a single browser, nobody races. */
export async function putCourses(courses) { write(KEYS.courses, courses); }
export async function putKits(kits) { write(KEYS.kits, kits); }
export async function putPlans(plans) { write(KEYS.plans, plans); }

export async function saveCourse(course, all) { await putCourses(all); return course; }
export async function saveKit(kit, all) { await putKits(all); return kit; }
export async function deleteKit(id, all) { await putKits(all); }
export async function savePlan(plan, all) { await putPlans(all); return plan; }
export async function deletePlan(id, all) { await putPlans(all); }

/* Entity writes go to the same blob here — the per-entity interface exists for
   Supabase, where it is what stops two people overwriting each other. */
export async function saveEntity(planId, entity, all) { await putPlans(all); }
export async function deleteEntity(planId, entityId, all) { await putPlans(all); }
