import { useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { SNAP_PX, PAN_STEP_PX } from '../data/constants.js';

/**
 * Everything the mouse and keyboard do on the map.
 *
 *   click               place the active tool, or select what you clicked
 *   click (cable tool)  add a point, snapping to a nearby node
 *   right-click         finish the run you are drawing or extending
 *   drag an item        move it; cable points pinned to it follow
 *   drag a handle       move that point (grabbing a pinned one unpins it,
 *                       and never moves the node underneath)
 *   click the (+)       carry the run on from that end
 *   click the line      in edit mode, insert a joint where you clicked
 *   right-click a handle  remove that point
 *   W A S D             pan
 *   Escape              cancel / stop editing / deselect
 */
export function useMapInteractions(mapRef, ready, setCursor, setHover) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const store = useStore.getState;
    const canvas = map.getCanvas();
    const entities = () => store().plan?.entities ?? [];
    const cableById = (id) => entities().find((e) => e.id === id);

    /**
     * What a cable point can pin to: any camera or switch, plus the ends of
     * other cables. Returns { id, coords } or null.
     */
    const snapTarget = (point, ignoreCableId = null) => {
      let best = null;
      let bestDist = SNAP_PX;
      const consider = (id, coords) => {
        const p = map.project(coords);
        const d = Math.hypot(p.x - point.x, p.y - point.y);
        if (d < bestDist) { bestDist = d; best = { id, coords: coords.slice() }; }
      };
      for (const e of entities()) {
        if (e.kind === 'camera' || e.kind === 'switch') consider(e.id, e.coords);
        else if (e.kind === 'cable' && e.id !== ignoreCableId) {
          consider(e.id, e.coords[0]);
          consider(e.id, e.coords[e.coords.length - 1]);
        }
      }
      return best;
    };

    /** Closest point on a run to a screen position, and which segment it is on. */
    const nearestOnRun = (cable, point) => {
      let best = null;
      for (let i = 1; i < cable.coords.length; i++) {
        const a = map.project(cable.coords[i - 1]);
        const b = map.project(cable.coords[i]);
        const vx = b.x - a.x, vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        const t = len2 ? Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / len2)) : 0;
        const px = a.x + t * vx, py = a.y + t * vy;
        const d = Math.hypot(point.x - px, point.y - py);
        if (!best || d < best.d) best = { d, index: i, x: px, y: py };
      }
      return best;
    };

    const anyHandleAt = (point) =>
      map.queryRenderedFeatures(point, { layers: ['vertex-hit', 'vertex-plus'] }).length > 0;

    /* ---------------------------------------------------------- click --- */
    const onClick = (ev) => {
      const s = store();
      const here = [ev.lngLat.lng, ev.lngLat.lat];

      // Laying out the course takes priority over everything else.
      if (s.layout) { s.setHolePoint(s.hole ?? 1, s.layout.target, here); return; }

      // A Move started from the entity panel consumes the next click.
      if (s.moveId) { s.finishMove(here); return; }

      // The (+) above either end carries the run on from there.
      const plus = map.queryRenderedFeatures(ev.point, { layers: ['vertex-plus'] })[0];
      if (plus && s.editingCableId) {
        s.startExtend(s.editingCableId, plus.properties.end);
        setCursor(null);
        return;
      }

      if (s.extending) {
        const snap = snapTarget(ev.point, s.extending.cableId);
        s.extendRun(snap ? snap.coords : here, snap?.id ?? null);
        return;
      }

      if (s.tool === 'cable') {
        const snap = snapTarget(ev.point);
        const coords = snap ? snap.coords : here;
        if (!s.draft) s.startCable(coords, snap?.id ?? null);
        else s.extendCable(coords, snap?.id ?? null);
        return;
      }
      if (s.tool === 'camera') return void s.addCamera(here);
      if (s.tool === 'switch') return void s.addSwitch(here);
      if (s.tool === 'marker') return void s.addMarker(here);

      // In edit mode, clicking the run itself drops a new joint there.
      if (s.editingCableId && !anyHandleAt(ev.point)) {
        const onLine = map.queryRenderedFeatures(ev.point, { layers: ['cable-hit'] })
          .some((f) => f.properties.id === s.editingCableId);
        if (onLine) {
          const cable = cableById(s.editingCableId);
          const near = cable && nearestOnRun(cable, ev.point);
          if (near) {
            const at = map.unproject([near.x, near.y]);
            s.insertCablePoint(s.editingCableId, near.index, [at.lng, at.lat]);
            return;
          }
        }
      }

      const hits = map.queryRenderedFeatures(ev.point, { layers: ['item-hit', 'cable-hit'] });
      s.select(hits.length ? hits[0].properties.id : null);
    };

    const onContextMenu = (ev) => {
      const s = store();
      if (s.draft) { ev.preventDefault(); s.finishCable(); setCursor(null); return; }
      if (s.extending) { ev.preventDefault(); s.stopExtend(); setCursor(null); return; }
      if (s.editingCableId) {
        const hit = map.queryRenderedFeatures(ev.point, { layers: ['vertex-hit'] })[0];
        if (hit) { ev.preventDefault(); s.removeCablePoint(s.editingCableId, hit.properties.index); }
      }
    };

    const onMouseMove = (ev) => {
      const s = store();
      if (s.draft || s.extending) {
        const snap = snapTarget(ev.point, s.extending?.cableId);
        canvas.style.cursor = snap ? 'cell' : 'crosshair';
        setCursor(snap ? snap.coords : [ev.lngLat.lng, ev.lngLat.lat]);
      } else if (s.tool) {
        canvas.style.cursor = 'crosshair';
      }
    };

    /* ------------------------------------------------------ item drag --- */
    // preventDefault() on the Mapbox event is what stops the map panning while
    // something is being dragged. Without it the two fight each other.
    let dragId = null;
    const onItemDown = (ev) => {
      const s = store();
      if (s.tool || s.moveId || s.extending) return;
      // A cable handle sitting over a camera wins — otherwise dragging the
      // handle would drag the camera underneath it too.
      if (s.editingCableId && anyHandleAt(ev.point)) return;
      const feature = ev.features?.[0];
      if (!feature) return;
      ev.preventDefault();
      dragId = feature.properties.id;
      s.select(dragId);
      canvas.style.cursor = 'grabbing';
      map.on('mousemove', onItemDragMove);
      map.once('mouseup', onItemDragEnd);
    };
    const onItemDragMove = (ev) => {
      if (dragId) store().moveEntity(dragId, [ev.lngLat.lng, ev.lngLat.lat]);
    };
    const onItemDragEnd = () => {
      map.off('mousemove', onItemDragMove);
      canvas.style.cursor = '';
      dragId = null;
    };

    /* ---------------------------------------------- cable point drag ---- */
    let vertex = null;
    const onVertexDown = (ev) => {
      const s = store();
      if (!s.editingCableId || s.extending) return;
      const feature = ev.features?.[0];
      if (!feature) return;
      ev.preventDefault();
      vertex = { cableId: s.editingCableId, index: feature.properties.index };
      // Grabbing a pinned point detaches it straight away, so the drag moves
      // the cable and leaves the camera or switch where it is.
      s.unpinCablePoint(vertex.cableId, vertex.index);
      canvas.style.cursor = 'grabbing';
      map.on('mousemove', onVertexDragMove);
      map.once('mouseup', onVertexDragEnd);
    };
    const onVertexDragMove = (ev) => {
      if (!vertex) return;
      const snap = snapTarget(ev.point, vertex.cableId);
      canvas.style.cursor = snap ? 'cell' : 'grabbing';
      store().moveCablePoint(vertex.cableId, vertex.index,
        snap ? snap.coords : [ev.lngLat.lng, ev.lngLat.lat], snap?.id ?? null);
    };
    const onVertexDragEnd = () => {
      map.off('mousemove', onVertexDragMove);
      canvas.style.cursor = '';
      vertex = null;
    };

    const onEnter = () => { if (!store().tool) canvas.style.cursor = 'grab'; };
    const onLeave = () => { if (!store().tool) canvas.style.cursor = ''; };
    const onPlusEnter = () => { canvas.style.cursor = 'copy'; };

    /* Hovering anything with a note shows it beside the cursor. */
    const onHover = (ev) => {
      const feature = ev.features?.[0];
      const entity = feature && entities().find((e) => e.id === feature.properties.id);
      if (!entity?.notes?.trim() || dragId || vertex) return setHover(null);
      setHover({ id: entity.id, label: entity.label, notes: entity.notes.trim(),
                 x: ev.point.x, y: ev.point.y });
    };
    const clearHover = () => setHover(null);

    map.on('click', onClick);
    map.on('contextmenu', onContextMenu);
    map.on('mousemove', onMouseMove);
    map.on('mousedown', 'vertex-hit', onVertexDown);   // handles win over items
    map.on('mousedown', 'item-hit', onItemDown);
    map.on('mouseenter', 'item-hit', onEnter);
    map.on('mouseleave', 'item-hit', onLeave);
    map.on('mouseenter', 'vertex-hit', onEnter);
    map.on('mouseleave', 'vertex-hit', onLeave);
    map.on('mouseenter', 'vertex-plus', onPlusEnter);
    map.on('mouseleave', 'vertex-plus', onLeave);
    map.on('mousemove', 'item-hit', onHover);
    map.on('mouseleave', 'item-hit', clearHover);
    map.on('mousemove', 'cable-hit', onHover);
    map.on('mouseleave', 'cable-hit', clearHover);
    map.on('mousedown', clearHover);

    /* ------------------------------------------------------ WASD + Esc --- */
    const held = new Set();
    let frame = null;

    const step = () => {
      let dx = 0, dy = 0;
      if (held.has('w')) dy -= 1;
      if (held.has('s')) dy += 1;
      if (held.has('a')) dx -= 1;
      if (held.has('d')) dx += 1;
      if (dx || dy) map.panBy([dx * PAN_STEP_PX * 0.12, dy * PAN_STEP_PX * 0.12], { duration: 0 });
      frame = held.size ? requestAnimationFrame(step) : null;
    };

    const onKeyDown = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        const s = store();
        if (s.layout) { s.stopLayout(); }
        else if (s.draft) { s.cancelCable(); setCursor(null); }
        else if (s.extending) { s.stopExtend(); setCursor(null); }
        else if (s.editingCableId) s.stopEditingCable();
        else s.select(null);
        return;
      }
      if (k === 'enter') {
        const s = store();
        if (s.draft) { s.finishCable(); setCursor(null); return; }
        if (s.extending) { s.stopExtend(); setCursor(null); return; }
      }
      if (!'wasd'.includes(k)) return;
      e.preventDefault();
      held.add(k);
      if (!frame) frame = requestAnimationFrame(step);
    };
    const onKeyUp = (e) => held.delete(e.key.toLowerCase());

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      map.off('click', onClick);
      map.off('contextmenu', onContextMenu);
      map.off('mousemove', onMouseMove);
      map.off('mousedown', 'vertex-hit', onVertexDown);
      map.off('mousedown', 'item-hit', onItemDown);
      map.off('mouseenter', 'item-hit', onEnter);
      map.off('mouseleave', 'item-hit', onLeave);
      map.off('mouseenter', 'vertex-hit', onEnter);
      map.off('mouseleave', 'vertex-hit', onLeave);
      map.off('mouseenter', 'vertex-plus', onPlusEnter);
      map.off('mouseleave', 'vertex-plus', onLeave);
      map.off('mousemove', 'item-hit', onHover);
      map.off('mouseleave', 'item-hit', clearHover);
      map.off('mousemove', 'cable-hit', onHover);
      map.off('mouseleave', 'cable-hit', clearHover);
      map.off('mousedown', clearHover);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mapRef, ready, setCursor, setHover]);
}
