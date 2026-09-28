import { useStore } from '../store/useStore.js';

/**
 * Course setup. Replaces the build tools while hole layout is being set:
 * pick a hole, tap the tee, tap the green, and it moves on by itself.
 */
export default function LayoutBar() {
  const layout = useStore((s) => s.layout);
  const setLayoutTarget = useStore((s) => s.setLayoutTarget);
  const stopLayout = useStore((s) => s.stopLayout);
  const hole = useStore((s) => s.hole);
  const holes = useStore((s) => s.course?.holes ?? []);
  const setHolePar = useStore((s) => s.setHolePar);

  const current = holes.find((h) => h.number === hole);
  const done = holes.filter((h) => h.tee && h.green).length;

  const Point = ({ which, label }) => (
    <button className="tool-btn" aria-pressed={layout.target === which}
            onClick={() => setLayoutTarget(which)}>
      <span className="swatch" style={{
        background: current?.[which] ? '#00E5A0' : 'transparent',
        borderColor: current?.[which] ? '#00E5A0' : 'var(--dim)',
      }} />
      {label}{current?.[which] ? '' : ' — not set'}
    </button>
  );

  return (
    <div className="build-stack">
      <div className="bar build-bar">
        <span className="layout-tag">Hole layout</span>

        <Point which="tee" label="Tee" />
        <Point which="green" label="Green" />

        <select aria-label="Par" value={current?.par ?? ''}
                onChange={(e) => setHolePar(hole, e.target.value ? Number(e.target.value) : null)}
                style={{ height: 40, padding: '0 8px', background: 'var(--panel-2)',
                         border: '1px solid var(--line)', borderRadius: 8 }}>
          <option value="">Par</option>
          {[3, 4, 5, 6].map((p) => <option key={p} value={p}>Par {p}</option>)}
        </select>

        <div className="stats">
          <span className="stats-scope">Set</span>
          <div className="stat"><b>{done}</b><span>of 18</span></div>
        </div>

        <button className="btn primary" onClick={stopLayout}>Done</button>
      </div>
    </div>
  );
}
