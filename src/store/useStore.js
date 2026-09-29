/**
 * The whole app's state, in one store.
 *
 * Three groups: what you have open (course/plan), what is on the plan
 * (entities), and what the toolbar is doing right now (tool/draft/selection).
 * Anything that should survive a refresh goes through lib/storage.js.
 */
import { create } from 'zustand';
import * as db from '../lib/db/index.js';
import { pathLength, bearing, bounds as bboxOf } from '../lib/geo.js';
import { nextCameraNumber, nextPosition, cameraLabel } from '../lib/cameraNumber.js';
import { CABLE_TYPES, MARKER_TYPES } from '../data/constants.js';

const countOf = (entities, kind) => entities.filter((e) => e.kind === kind).length + 1;
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/**
 * A cable point can be pinned to a camera, a switch, or another cable's end.
 * `attach` runs parallel to `coords`: attach[i] is the id that point follows,
 * or null for a free point. When the thing it follows moves, the point moves
 * with it and the run re-measures itself.
 */
function followMovedNode(entities, movedId, coords) {
  return entities.map((e) => {
    if (e.kind !== 'cable' || !e.attach?.includes(movedId)) return e;
    const next = e.coords.map((c, i) => (e.attach[i] === movedId ? coords.slice() : c));
    return { ...e, coords: next, lengthM: pathLength(next) };
  });
}

export const useStore = create((set, get) => ({
  /* ------------------------------------------------------------ session -- */
  token: db.getToken(),
  user: db.getUser(),
  course: null,
  plan: null,
  saved: true,
  saveError: null,
  dirty: new Set(),        // entity ids changed since the last flush
  removed: new Set(),      // entity ids deleted since the last flush
  planDirty: false,        // plan metadata (name, owner, kit) changed

  setToken: (t) => { db.setToken(t); set({ token: t }); },
  setUser: (name) => { db.setUser(name); set({ user: name }); },

  kit: null,               // the camera kit this plan is built against

  /* ------------------------------------------------------ hole layout -- */
  /**
   * Course setup: tap the tee, tap the green, move on. This is the only route
   * to a tournament layout — temporary tees and moved pins are in no public
   * dataset, so OpenStreetMap gives the club's everyday routing at best.
   */
  layout: null,            // { target: 'tee' | 'green' } while setting holes up

  startLayout: () =>
    set((state) => ({
      layout: { target: 'tee' },
      hole: state.hole ?? 1,
      tool: null, selectedId: null, draft: null, moveId: null, editingCableId: null,
    })),
  stopLayout: () => set({ layout: null }),
  setLayoutTarget: (target) => set({ layout: { target } }),

  /** Place the tee or the green of a hole, and derive what follows from it. */
  setHolePoint: (number, which, coords) => {
    const { course } = get();
    if (!course) return;

    const holes = [...(course.holes ?? [])];
    let i = holes.findIndex((h) => h.number === number);
    if (i < 0) { holes.push({ number, par: null, tee: null, green: null }); i = holes.length - 1; }

    const hole = { ...holes[i], [which]: coords.slice(), source: 'manual' };
    if (hole.tee && hole.green) {
      hole.line = [hole.tee, hole.green];
      hole.playBearing = bearing(hole.tee, hole.green);
      hole.bounds = bboxOf([hole.tee, hole.green], 45);
    } else {
      const only = hole.tee ?? hole.green;
      hole.line = [only, only];
      hole.playBearing = hole.playBearing ?? 0;
      hole.bounds = bboxOf([only], 90);
    }
    holes[i] = hole;
    holes.sort((a, b) => a.number - b.number);

    const next = { ...course, holes };
    db.saveCourse(next).catch((err) => get().setNotice(`Could not save the layout: ${err.message}`));

    // Tee then green, then straight on to the next hole.
    const advance = which === 'tee'
      ? { layout: { target: 'green' } }
      : { layout: { target: 'tee' }, hole: Math.min(18, number + 1) };
    set({ course: next, ...advance });
  },

  /** Par can be set before a hole has any geometry, so create the record. */
  setHolePar: (number, par) => {
    const { course } = get();
    if (!course) return;
    const holes = [...(course.holes ?? [])];
    const i = holes.findIndex((h) => h.number === number);
    if (i >= 0) holes[i] = { ...holes[i], par };
    else holes.push({ number, par, tee: null, green: null });
    holes.sort((a, b) => a.number - b.number);
    const next = { ...course, holes };
    db.saveCourse(next).catch((err) => get().setNotice(`Could not save par: ${err.message}`));
    set({ course: next });
  },

  /** One-line message for the planner to surface. Set by actions that refuse. */
  notice: null,
  setNotice: (text) => set({ notice: text ? { text, at: Date.now() } : null }),

  openPlan: (course, plan) =>
    set({ course, plan, kit: db.getKit(plan.kitId) ?? db.getKits()[0],
          selectedId: null, tool: null, draft: null, hole: null,
          editingCableId: null, moveId: null, saved: true }),

  /** Switch the plan to a different kit. Existing numbers are left alone; the
   *  panel flags any that the new kit cannot supply. */
  setKit: (kitId) =>
    set((state) => ({
      kit: db.getKit(kitId),
      plan: state.plan ? { ...state.plan, kitId } : null,
      saved: false, planDirty: true,
    })),

  closePlan: () => set({ course: null, plan: null, selectedId: null, tool: null, draft: null,
                         dem: null, demState: 'idle' }),

  /* ------------------------------------------------------- ground slope -- */
  /**
   * The course's slope grid, and whether it is shaded on the map.
   *
   * `dem` null with `demState` 'none' means this course has no elevation — a
   * real answer, and a different thing from not having looked yet. Nothing in
   * the app may treat either as flat ground.
   */
  dem: null,
  demState: 'idle',        // 'idle' | 'loading' | 'ready' | 'none' | 'error'
  demError: null,
  slopeOn: false,
  slopeLimit: db.getSlopeLimit(),

  /** Fetches the grid for whatever course is open. Safe to call repeatedly. */
  loadDem: async (courseId) => {
    const id = courseId ?? get().course?.id;
    if (!id) return null;
    if (db.hasDemLoaded(id)) {
      const cached = db.peekDem(id);
      set({ dem: cached, demState: cached ? 'ready' : 'none', demError: null });
      return cached;
    }
    set({ demState: 'loading', demError: null });
    try {
      const dem = await db.loadDem(id);
      // Guard against a slow fetch landing after the user moved on.
      if (get().course?.id !== id && courseId == null) return dem;
      set({ dem, demState: dem ? 'ready' : 'none', demError: null });
      return dem;
    } catch (err) {
      set({ dem: null, demState: 'error', demError: err.message });
      return null;
    }
  },

  setDem: (dem) => set({ dem, demState: dem ? 'ready' : 'none', demError: null }),

  /** Shading is pointless without a grid, so asking for it fetches one. */
  toggleSlope: async () => {
    const next = !get().slopeOn;
    set({ slopeOn: next });
    if (next && get().demState === 'idle') await get().loadDem();
  },

  setSlopeLimit: (deg) => { db.setSlopeLimit(deg); set({ slopeLimit: db.getSlopeLimit() }); },

  /**
   * Writes what changed, one entity at a time. Two people on the same plan
   * therefore touch only their own work instead of each saving the whole
   * document over the top of the other.
   */
  save: async () => {
    const { plan, dirty, removed, planDirty } = get();
    if (!plan) return;
    if (!dirty.size && !removed.size && !planDirty) { set({ saved: true }); return; }

    set({ dirty: new Set(), removed: new Set(), planDirty: false });
    try {
      for (const id of removed) await db.deleteEntity(plan.id, id);
      for (const id of dirty) {
        const entity = plan.entities.find((e) => e.id === id);
        if (entity) await db.saveEntity(plan.id, entity);
      }
      if (planDirty) await db.savePlan(plan);
      set({ saved: true, saveError: null });
    } catch (err) {
      // Put the work back so the next attempt retries it rather than losing it.
      set((s) => ({
        saved: false, saveError: err.message,
        dirty: new Set([...s.dirty, ...dirty]),
        removed: new Set([...s.removed, ...removed]),
        planDirty: s.planDirty || planDirty,
      }));
    }
  },

  /* ---------------------------------------------------------- selection -- */
  selectedId: null,
  hole: null,              // focused hole number, null = whole course
  moveId: null,            // Move button armed: the next click relocates this
  editingCableId: null,    // cable whose points are draggable
  extending: null,         // { cableId, end: 'start' | 'end' } while carrying a run on

  select: (id) => set({ selectedId: id, tool: null, draft: null, moveId: null,
                        editingCableId: null, extending: null }),
  setHole: (n) => set({ hole: n }),
  beginMove: (id) => set({ moveId: id, tool: null, draft: null }),
  editCablePoints: (id) => set({ editingCableId: id, selectedId: id, tool: null, draft: null }),
  stopEditingCable: () => set({ editingCableId: null, extending: null }),

  /* --------------------------------------------------------------- tool -- */
  tool: null,              // 'camera' | 'switch' | 'marker' | 'cable' | null
  markerType: MARKER_TYPES[0].id,
  cableType: CABLE_TYPES[0].id,
  draft: null,             // in-progress cable: { coords, attach }

  /** One tool at a time — arming any of them clears the rest. */
  setTool: (tool) => set({ tool, selectedId: null, draft: null, moveId: null, editingCableId: null }),

  /** Picking a cable type also arms the cable, ready to place. */
  armCable: (cableType) =>
    set({ cableType, tool: 'cable', selectedId: null, draft: null, moveId: null, editingCableId: null }),

  /** Picking a marker type also arms the marker. */
  armMarker: (markerType) =>
    set({ markerType, tool: 'marker', selectedId: null, draft: null, moveId: null, editingCableId: null }),

  /* ----------------------------------------------------------- entities -- */
  /**
   * All mutations funnel through here. It diffs old against new so the save
   * knows exactly which entities to write — anything whose object identity
   * changed is dirty, anything that disappeared is deleted.
   */
  update: (fn) =>
    set((state) => {
      if (!state.plan) return state;
      const before = state.plan.entities;
      const after = fn(before);

      const beforeById = new Map(before.map((e) => [e.id, e]));
      const dirty = new Set(state.dirty);
      const removed = new Set(state.removed);

      for (const e of after) {
        if (beforeById.get(e.id) !== e) { dirty.add(e.id); removed.delete(e.id); }
      }
      const afterIds = new Set(after.map((e) => e.id));
      for (const id of beforeById.keys()) {
        if (!afterIds.has(id)) { removed.add(id); dirty.delete(id); }
      }

      return { plan: { ...state.plan, entities: after }, saved: false, dirty, removed };
    }),

  /**
   * Cameras must land on a hole and take one of its three positions — the
   * rigging sheet is a grid of hole × position, and a camera outside that grid
   * cannot appear on it. So this refuses rather than creating something the
   * export would silently drop.
   */
  addCamera: (coords) => {
    const { hole, kit, update, setNotice } = get();
    const entities = get().plan.entities;

    if (!hole) {
      setNotice('Pick a hole first — every camera needs one for the rigging sheet');
      return null;
    }
    const position = nextPosition(entities, hole);
    if (!position) {
      setNotice(`Hole ${hole} already has all three positions filled`);
      return null;
    }

    const id = db.newId();
    const camera = {
      id, kind: 'camera', coords, hole, position,
      // Skips anything already used here and anything broken or missing in the kit.
      number: nextCameraNumber(entities, hole, kit),
      camType: 'tripod', notes: '',
    };
    update((list) => [...list, { ...camera, label: cameraLabel(camera) }]);
    set({ selectedId: id, notice: null });
    return id;
  },

  addSwitch: (coords) => {
    const { hole, update } = get();
    const id = db.newId();
    const n = countOf(get().plan.entities, 'switch');
    update((list) => [...list, { id, kind: 'switch', coords, hole, label: `SW ${n}`, notes: '' }]);
    set({ selectedId: id });
    return id;
  },

  addMarker: (coords) => {
    const { hole, markerType, update } = get();
    const id = db.newId();
    const n = countOf(get().plan.entities, 'marker');
    const label = `${MARKER_TYPES.find((m) => m.id === markerType)?.label ?? 'Marker'} ${n}`;
    update((list) => [...list, { id, kind: 'marker', coords, hole, markerType, label, notes: '' }]);
    set({ selectedId: id });
    return id;
  },

  /* ------------------------------------------------------ cable drawing -- */
  startCable: (coords, attachId = null) =>
    set({ tool: 'cable', selectedId: null, draft: { coords: [coords], attach: [attachId] } }),

  extendCable: (coords, attachId = null) =>
    set((state) => {
      if (!state.draft) return { draft: { coords: [coords], attach: [attachId] } };
      return { draft: { coords: [...state.draft.coords, coords], attach: [...state.draft.attach, attachId] } };
    }),

  /** Right-click, Enter or Finish. Fewer than two points and it is discarded. */
  finishCable: () => {
    const { draft, cableType, hole, update } = get();
    set({ draft: null });
    if (!draft || draft.coords.length < 2) return null;

    const id = db.newId();
    const n = countOf(get().plan.entities, 'cable');
    update((list) => [
      ...list,
      { id, kind: 'cable', coords: draft.coords, attach: draft.attach, hole, cableType,
        lengthM: pathLength(draft.coords),
        fromId: draft.attach[0] ?? null,
        toId: draft.attach[draft.attach.length - 1] ?? null,
        label: `${cableType.toUpperCase()} ${n}`, notes: '' },
    ]);
    set({ selectedId: id, tool: null });
    return id;
  },

  cancelCable: () => set({ draft: null, tool: null }),

  /* ------------------------------------------------- cable point editing -- */
  /** Drag one point of a cable. `attachId` pins it to a node, null frees it. */
  moveCablePoint: (cableId, index, coords, attachId = null) =>
    get().update((list) =>
      list.map((e) => {
        if (e.id !== cableId) return e;
        const next = e.coords.map((c, i) => (i === index ? coords.slice() : c));
        const attach = (e.attach ?? e.coords.map(() => null)).map((a, i) => (i === index ? attachId : a));
        return { ...e, coords: next, attach, lengthM: pathLength(next),
                 fromId: attach[0] ?? null, toId: attach[attach.length - 1] ?? null };
      })
    ),

  /** Unpin a point without moving it — used the moment a pinned handle is
   *  grabbed, so dragging it detaches rather than dragging the node it sits on. */
  unpinCablePoint: (cableId, index) =>
    get().update((list) =>
      list.map((e) => {
        if (e.id !== cableId || !e.attach?.[index]) return e;
        const attach = e.attach.map((a, i) => (i === index ? null : a));
        return { ...e, attach, fromId: attach[0] ?? null, toId: attach[attach.length - 1] ?? null };
      })
    ),

  /** Insert a joint mid-run — clicking the line in edit mode lands here. */
  insertCablePoint: (cableId, index, coords) =>
    get().update((list) =>
      list.map((e) => {
        if (e.id !== cableId) return e;
        const next = [...e.coords.slice(0, index), coords.slice(), ...e.coords.slice(index)];
        const old = e.attach ?? e.coords.map(() => null);
        const attach = [...old.slice(0, index), null, ...old.slice(index)];
        return { ...e, coords: next, attach, lengthM: pathLength(next),
                 fromId: attach[0] ?? null, toId: attach[attach.length - 1] ?? null };
      })
    ),

  /* ----------------------------------------------------- extending a run -- */
  startExtend: (cableId, end) =>
    set({ extending: { cableId, end }, editingCableId: cableId, selectedId: cableId,
          tool: null, draft: null, moveId: null }),

  stopExtend: () => set({ extending: null }),

  /** Adds a point to whichever end is being extended. */
  extendRun: (coords, attachId = null) => {
    const { extending } = get();
    if (!extending) return;
    get().update((list) =>
      list.map((e) => {
        if (e.id !== extending.cableId) return e;
        const old = e.attach ?? e.coords.map(() => null);
        const next = extending.end === 'start'
          ? [coords.slice(), ...e.coords]
          : [...e.coords, coords.slice()];
        const attach = extending.end === 'start' ? [attachId, ...old] : [...old, attachId];
        return { ...e, coords: next, attach, lengthM: pathLength(next),
                 fromId: attach[0] ?? null, toId: attach[attach.length - 1] ?? null };
      })
    );
  },

  /** Drop a point. A run needs two, so the last two cannot be removed. */
  removeCablePoint: (cableId, index) =>
    get().update((list) =>
      list.map((e) => {
        if (e.id !== cableId || e.coords.length <= 2) return e;
        const next = e.coords.filter((_, i) => i !== index);
        const attach = (e.attach ?? e.coords.map(() => null)).filter((_, i) => i !== index);
        return { ...e, coords: next, attach, lengthM: pathLength(next),
                 fromId: attach[0] ?? null, toId: attach[attach.length - 1] ?? null };
      })
    ),

  /* ------------------------------------------------------- edit / delete -- */
  patch: (id, changes) =>
    get().update((list) => {
      let moved = null;
      const next = list.map((e) => {
        if (e.id !== id) return e;
        const updated = { ...e, ...changes };
        if (updated.kind === 'camera') updated.label = cameraLabel(updated);
        if (updated.kind === 'cable' && changes.coords) updated.lengthM = pathLength(changes.coords);
        if (updated.kind !== 'cable' && changes.coords && !same(e.coords, changes.coords)) {
          moved = changes.coords;
        }
        return updated;
      });
      // Anything pinned to a node that just moved comes along with it.
      return moved ? followMovedNode(next, id, moved) : next;
    }),

  moveEntity: (id, coords) => get().patch(id, { coords }),

  /** Completes a Move started from the entity panel. */
  finishMove: (coords) => {
    const { moveId } = get();
    if (!moveId) return false;
    get().patch(moveId, { coords });
    set({ moveId: null });
    return true;
  },

  remove: (id) => {
    // Detach anything that was pinned to the thing being deleted.
    get().update((list) =>
      list
        .filter((e) => e.id !== id)
        .map((e) =>
          e.kind === 'cable' && e.attach?.includes(id)
            ? { ...e, attach: e.attach.map((a) => (a === id ? null : a)) }
            : e
        )
    );
    set({ selectedId: null, editingCableId: null });
  },
}));

/** Convenience selector — the currently selected entity, or null. */
export const useSelected = () =>
  useStore((s) => s.plan?.entities.find((e) => e.id === s.selectedId) ?? null);
