import { useStore, useSelected } from '../store/useStore.js';
import { CAMERA_TYPES, CABLE_TYPES, MARKER_TYPES, POSITIONS_PER_HOLE, HOLES_PER_ROUND } from '../data/constants.js';
import { duplicateNumbers, duplicatePositions, positionId, takenPositions } from '../lib/cameraNumber.js';
import { isAvailable, formatNumberList } from '../lib/kits.js';
import { fmtM } from '../lib/geo.js';

/**
 * Right-hand panel. Opens when you click something on the map; the fields
 * change with what you clicked. Notes live here for every entity type.
 */
export default function EntityPanel({ onMove }) {
  const entity = useSelected();
  const patch = useStore((s) => s.patch);
  const remove = useStore((s) => s.remove);
  const select = useStore((s) => s.select);
  const entities = useStore((s) => s.plan?.entities ?? []);
  const holes = useStore((s) => s.course?.holes ?? []);
  const kit = useStore((s) => s.kit);
  const editingCableId = useStore((s) => s.editingCableId);
  const editCablePoints = useStore((s) => s.editCablePoints);
  const stopEditingCable = useStore((s) => s.stopEditingCable);

  if (!entity) return null;

  const set = (changes) => patch(entity.id, changes);
  const clashes = entity.kind === 'camera' && duplicateNumbers(entities).has(entity.number);
  const posClash = entity.kind === 'camera'
    && duplicatePositions(entities).has(positionId(entity.hole, entity.position));
  const holeNumbers = Array.from({ length: HOLES_PER_ROUND }, (_, i) => i + 1);

  return (
    <aside className="panel" aria-label={`${entity.kind} details`}>
      <div className="panel-head">
        <b style={{ flex: 1 }}>{entity.label}</b>
        <button className="btn ghost" onClick={() => select(null)}>Close</button>
      </div>

      <div className="panel-body">
        {entity.kind === 'camera' && (
          <>
            <div className="row">
              <div className="field">
                <label htmlFor="cam-hole">Hole</label>
                <select id="cam-hole" value={entity.hole ?? ''}
                        onChange={(e) => set({ hole: Number(e.target.value) })}>
                  {entity.hole == null && <option value="">Not set</option>}
                  {holeNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cam-position">Position</label>
                <select id="cam-position" value={entity.position ?? ''}
                        onChange={(e) => set({ position: Number(e.target.value) })}>
                  {entity.position == null && <option value="">Not set</option>}
                  {Array.from({ length: POSITIONS_PER_HOLE }, (_, i) => i + 1).map((n) => {
                    const held = takenPositions(entities, entity.hole, entity.id).has(n);
                    return (
                      <option key={n} value={n}>
                        g{String(n).padStart(2, '0')}
                        {n === 1 ? ' — left' : n === 2 ? ' — middle' : ' — right'}
                        {held ? ' (taken)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <p className="hint">
              Clockwise from the left of the green. Every camera needs a hole and a position
              or it cannot appear on the rigging sheet.
              {positionId(entity.hole, entity.position)
                ? <> This one is <b>{positionId(entity.hole, entity.position)}</b>.</>
                : null}
            </p>
            {(entity.hole == null || entity.position == null) && (
              <div className="banner bad">
                This camera has no {entity.hole == null ? 'hole' : 'position'}, so it will be left
                off the rigging sheet.
              </div>
            )}
            {posClash && (
              <div className="banner warn">
                {positionId(entity.hole, entity.position)} is used by another camera.
              </div>
            )}

            <div className="field">
              <label htmlFor="cam-number">
                Camera number{kit ? ` — ${kit.name}` : ''}
              </label>
              <select id="cam-number" value={entity.number ?? ''}
                      onChange={(e) => set({ number: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {Array.from({ length: kit?.size ?? 60 }, (_, i) => i + 1).map((n) => {
                  const out = !isAvailable(kit, n);
                  const usedBy = entities.find((e) => e.kind === 'camera' && e.number === n && e.id !== entity.id);
                  return (
                    <option key={n} value={n} disabled={out}>
                      {n}
                      {out ? ' — broken or missing' : usedBy ? ` — on ${usedBy.label}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            {entity.number != null && !isAvailable(kit, entity.number) && (
              <div className="banner bad">
                Camera {entity.number} is not available in {kit?.name ?? 'this kit'}. Pick another.
              </div>
            )}
            {clashes && <div className="banner warn">Camera {entity.number} is used more than once.</div>}

            <div className="field">
              <label htmlFor="cam-type">Mounting</label>
              <select id="cam-type" value={entity.camType}
                      onChange={(e) => set({ camType: e.target.value })}>
                {CAMERA_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>

          </>
        )}

        {entity.kind === 'switch' && (
          <div className="field">
            <label htmlFor="sw-hole">Hole</label>
            <select id="sw-hole" value={entity.hole ?? ''}
                    onChange={(e) => set({ hole: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Course-wide</option>
              {holeNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}

        {entity.kind === 'marker' && (
          <div className="field">
            <label htmlFor="mk-type">Marker</label>
            <select id="mk-type" value={entity.markerType}
                    onChange={(e) => set({ markerType: e.target.value })}>
              {MARKER_TYPES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        )}

        {entity.kind === 'cable' && (
          <>
            <div className="field">
              <label htmlFor="cb-type">Cable type</label>
              <select id="cb-type" value={entity.cableType}
                      onChange={(e) => set({ cableType: e.target.value })}>
                {CABLE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="banner">
              <b className="num" style={{ fontSize: 20, color: 'var(--text)' }}>{fmtM(entity.lengthM)} m</b>
              <div style={{ marginTop: 4 }}>
                {entity.coords.length} points · {(entity.attach ?? []).filter(Boolean).length} pinned to nodes
              </div>
            </div>

            {editingCableId === entity.id
              ? <div className="banner warn">
                  Drag a point to move it — grabbing a pinned point unpins it and leaves the
                  camera or switch where it is. Drop a point on a camera, switch or cable end to
                  pin it there; pinned points follow whatever they are attached to.
                  Click the run to drop a joint in, right-click a point to remove it, and use the
                  <b> +</b> above either end to carry the run on.
                </div>
              : null}
            {(() => {
              const max = CABLE_TYPES.find((t) => t.id === entity.cableType)?.maxRunM;
              return max && entity.lengthM > max
                ? <div className="banner bad">Over the {max} m limit for {entity.cableType}.</div>
                : null;
            })()}
          </>
        )}

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" value={entity.notes ?? ''} placeholder="Anything the rigging crew needs to know."
                    onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>

      <div className="panel-foot">
        <button className="btn danger" onClick={() => remove(entity.id)}>Delete</button>
        {entity.kind === 'cable' ? (
          editingCableId === entity.id
            ? <button className="btn primary" onClick={stopEditingCable}>Done editing</button>
            : <button className="btn" onClick={() => editCablePoints(entity.id)}>Edit points</button>
        ) : (
          <button className="btn" onClick={() => onMove(entity.id)}>Move</button>
        )}
      </div>
    </aside>
  );
}
