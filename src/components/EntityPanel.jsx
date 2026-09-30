import { useStore, useSelected } from '../store/useStore.js';
import { CAMERA_TYPES, CABLE_TYPES, MARKER_TYPES, POSITIONS_PER_HOLE, HOLES_PER_ROUND } from '../data/constants.js';
import { duplicateNumbers, duplicatePositions, positionId, takenPositions } from '../lib/cameraNumber.js';
import { isAvailable, formatNumberList } from '../lib/kits.js';
import { fmtM } from '../lib/geo.js';
import { slopeAt, coversPoint } from '../lib/dem.js';
import { slopeBand } from '../map/slopeLayer.js';

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
  const dem = useStore((s) => s.dem);
  const demState = useStore((s) => s.demState);
  const slopeLimit = useStore((s) => s.slopeLimit);

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
            {/* No standing explainer here. The position ids are self-describing
                in the dropdown (g01 — left, g02 — middle), the panel title
                already shows the rig position, and the banner below says what
                is missing at the moment it is actually missing. */}
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

            {/* Ground slope only decides anything for a mast. A tower, an LED
                board or a hospitality position carries its own levelling. */}
            {entity.camType === 'mast' && (
              <GroundSlope dem={dem} demState={demState} limit={slopeLimit} coords={entity.coords} />
            )}

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

/**
 * What the ground is doing under one mast.
 *
 * Four outcomes, and the two "no reading" ones are the point of the thing: a
 * camera outside the uploaded file's area, or over a gap in it, gets told so
 * rather than being quietly treated as standing on the flat.
 */
function GroundSlope({ dem, demState, limit, coords }) {
  if (demState === 'loading') return <div className="banner">Checking the ground…</div>;

  if (!dem) {
    return (
      <div className="banner">
        No elevation for this course, so nothing is known about the ground here.
        Upload a GeoTIFF from the course list to shade it.
      </div>
    );
  }

  if (!coversPoint(dem, coords)) {
    return (
      <div className="banner warn">
        This position is outside the area the elevation file covers — the ground here
        has not been measured.
      </div>
    );
  }

  const deg = slopeAt(dem, coords);
  if (deg == null) {
    return (
      <div className="banner warn">
        The elevation file has no reading at this spot, so the slope is unknown. Water and
        dense tree cover often drop out of a LiDAR ground model.
      </div>
    );
  }

  const band = slopeBand(deg, limit);
  const cls = band === 'steep' ? 'banner bad' : band === 'near' ? 'banner warn' : 'banner';
  return (
    <div className={cls}>
      <b className="num" style={{ fontSize: 18, color: 'inherit' }}>{deg.toFixed(1)}°</b>{' '}
      ground slope, against a {limit}° limit.
      <div style={{ marginTop: 4 }}>
        {band === 'steep'
          ? 'Too steep for a mast here — move it or change the mounting.'
          : band === 'near'
            ? 'Close to the limit. Worth a look on the ground before you commit to it.'
            : 'A mast will level here.'}
        {' '}Measured over {dem.cellM} m cells.
      </div>
    </div>
  );
}
