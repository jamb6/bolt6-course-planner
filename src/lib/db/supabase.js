/**
 * Supabase driver — shared Postgres, everyone sees the same data.
 *
 * Entities are written one row at a time, so two people on the same plan touch
 * only what they changed instead of overwriting the whole document. Changes
 * appear when a plan is reopened or the workspace is refreshed.
 *
 * The client is imported lazily so a build with no Supabase configured never
 * loads it.
 */
let client = null;

export const name = 'supabase';
export const remote = true;

export const configured = () =>
  !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export async function getClient() {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );
  return client;
}

/* ----------------------------------------------------------------- auth -- */
export async function currentUser() {
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

/**
 * Email and password. Accounts are created in the Supabase dashboard rather
 * than signed up for in the app — this is an internal tool with a known set of
 * people, and it keeps email out of the critical path entirely. That matters
 * on an event build, where signing in over patchy course wifi should not
 * depend on an email arriving.
 */
export async function signInWithPassword(email, password) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Lets someone replace the password they were handed. */
export async function updatePassword(password) {
  const sb = await getClient();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
}

export async function onAuthChange(fn) {
  const sb = await getClient();
  return sb.auth.onAuthStateChange((_event, session) => fn(session?.user ?? null));
}

/* ------------------------------------------------------------- mapping --- */
const rowToCourse = (r) => ({
  id: r.id, name: r.name, event: r.event ?? '', place: r.place ?? '',
  dates: r.dates ?? '', major: !!r.major, tbc: !!r.tbc,
  lngLat: r.lng != null && r.lat != null ? [r.lng, r.lat] : null,
  holes: r.holes ?? null, seeded: !!r.seeded,
});

const courseToRow = (c) => ({
  id: c.id, name: c.name, event: c.event || null, place: c.place || null,
  dates: c.dates || null, major: !!c.major, tbc: !!c.tbc,
  lng: c.lngLat?.[0] ?? null, lat: c.lngLat?.[1] ?? null,
  holes: c.holes ?? null, seeded: !!c.seeded,
});

const rowToKit = (r) => ({
  id: r.id, name: r.name, size: r.size, unavailable: r.unavailable ?? [], notes: r.notes ?? '',
});
const kitToRow = (k) => ({
  id: k.id, name: k.name, size: k.size ?? 60,
  unavailable: k.unavailable ?? [], notes: k.notes || null,
});

/* ----------------------------------------------------------------- read -- */
export async function load() {
  const sb = await getClient();
  const [courses, kits, plans, entities] = await Promise.all([
    sb.from('course').select('*').order('name'),
    sb.from('kit').select('*').order('name'),
    sb.from('plan').select('*').order('created_at'),
    sb.from('plan_entity').select('id, plan_id, data'),
  ]);
  for (const r of [courses, kits, plans, entities]) if (r.error) throw r.error;

  const byPlan = new Map();
  for (const row of entities.data) {
    if (!byPlan.has(row.plan_id)) byPlan.set(row.plan_id, []);
    byPlan.get(row.plan_id).push({ ...row.data, id: row.id });
  }

  return {
    courses: courses.data.map(rowToCourse),
    kits: kits.data.map(rowToKit),
    plans: plans.data.map((p) => ({
      id: p.id, courseId: p.course_id, kitId: p.kit_id, name: p.name,
      owner: p.owner ?? '', createdAt: p.created_at, updatedAt: p.updated_at,
      entities: byPlan.get(p.id) ?? [],
    })),
  };
}

/* ---------------------------------------------------------------- write -- */
const fail = (error) => { if (error) throw error; };

export async function saveCourse(course) {
  const sb = await getClient();
  const { error } = await sb.from('course').upsert(courseToRow(course));
  fail(error);
  return course;
}

export async function saveKit(kit) {
  const sb = await getClient();
  const { error } = await sb.from('kit').upsert(kitToRow(kit));
  fail(error);
  return kit;
}

export async function deleteKit(id) {
  const sb = await getClient();
  fail((await sb.from('kit').delete().eq('id', id)).error);
}

/** Plan metadata only — entities have their own rows. */
export async function savePlan(plan) {
  const sb = await getClient();
  const { error } = await sb.from('plan').upsert({
    id: plan.id, course_id: plan.courseId, kit_id: plan.kitId ?? null,
    name: plan.name, owner: plan.owner || null,
  });
  fail(error);
  return plan;
}

export async function deletePlan(id) {
  const sb = await getClient();
  fail((await sb.from('plan').delete().eq('id', id)).error);   // entities cascade
}

export async function saveEntity(planId, entity) {
  const sb = await getClient();
  const { id, ...data } = entity;
  const { error } = await sb.from('plan_entity').upsert({ id, plan_id: planId, data });
  fail(error);
}

export async function deleteEntity(planId, entityId) {
  const sb = await getClient();
  fail((await sb.from('plan_entity').delete().eq('id', entityId)).error);
}

/** Used once, to push a browser's existing work into the shared workspace. */
export async function importAll({ courses, kits, plans }) {
  const sb = await getClient();
  if (kits?.length) fail((await sb.from('kit').upsert(kits.map(kitToRow))).error);
  if (courses?.length) fail((await sb.from('course').upsert(courses.map(courseToRow))).error);
  for (const plan of plans ?? []) {
    await savePlan(plan);
    const rows = (plan.entities ?? []).map((e) => {
      const { id, ...data } = e;
      return { id, plan_id: plan.id, data };
    });
    if (rows.length) fail((await sb.from('plan_entity').upsert(rows)).error);
  }
}
