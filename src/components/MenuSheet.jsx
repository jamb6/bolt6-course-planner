import { useStore } from '../store/useStore.js';
import { toCSV, toCameraPlanCSV, download } from '../lib/exportPlan.js';
import * as db from '../lib/db/index.js';
import { formatNumberList } from '../lib/kits.js';
import { HOLES_PER_ROUND } from '../data/constants.js';

/** Top-right menu: save, switch course or plan, export the rigging breakdown. */
export default function MenuSheet({ open, onClose, onExit, onToast }) {
  const plan = useStore((s) => s.plan);
  const course = useStore((s) => s.course);
  const save = useStore((s) => s.save);
  const saved = useStore((s) => s.saved);
  const kit = useStore((s) => s.kit);
  const holes = useStore((s) => s.course?.holes ?? []);
  const startLayout = useStore((s) => s.startLayout);
  const setKit = useStore((s) => s.setKit);

  if (!open) return null;
  const kits = db.getKits();

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const holeNumbers = Array.from({ length: HOLES_PER_ROUND }, (_, i) => i + 1);

  const exportCameraPlan = () => {
    download(`${slug(course.name)}-${slug(plan.name)}-camera-plan.csv`,
             toCameraPlanCSV(plan, course, plan.entities, kit, holeNumbers), 'text/csv');
    onToast('Camera plan downloaded');
    onClose();
  };

  const exportCSV = () => {
    download(`${slug(course.name)}-${slug(plan.name)}-rigging.csv`,
             toCSV(plan, course, plan.entities, kit), 'text/csv');
    onToast('Rigging breakdown downloaded');
    onClose();
  };

  const exportPlanFile = () => {
    download(`${slug(plan.name)}.b6plan.json`,
             JSON.stringify({ version: 1, course, plan }, null, 2), 'application/json');
    onToast('Plan file downloaded — send it to whoever needs it');
    onClose();
  };

  return (
    <div className="menu card" role="menu">
      <div className="menu-kit">
        <label htmlFor="menu-kit">Camera kit</label>
        <select id="menu-kit" value={kit?.id ?? ''} onChange={(e) => setKit(e.target.value)}>
          {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        {kit?.unavailable?.length
          ? <small>Out: {formatNumberList(kit.unavailable)}</small>
          : <small>All {kit?.size ?? 60} cameras available</small>}
      </div>
      <hr />
      <button role="menuitem" onClick={async () => { await save(); onToast('Saved'); onClose(); }}>
        Save {saved ? '' : '•'}
      </button>
      <button role="menuitem" onClick={() => { startLayout(); onClose(); }}>
        Set up hole layout{holes.filter((h) => h.tee && h.green).length
          ? ` (${holes.filter((h) => h.tee && h.green).length}/18 set)`
          : ' — none set'}
      </button>
      <hr />
      <button role="menuitem" onClick={exportCameraPlan}>Export camera plan (CSV)</button>
      <button role="menuitem" onClick={exportCSV}>Export rigging breakdown (CSV)</button>
      <button role="menuitem" onClick={exportPlanFile}>Export plan file (share)</button>
      <hr />
      <button role="menuitem" onClick={async () => { await save(); onExit(); }}>Load a different course or plan</button>
    </div>
  );
}
