import { useStore } from '../store/useStore.js';
import { HOLES_PER_ROUND } from '../data/constants.js';

/**
 * All 18 holes, along the bottom under the build tools. A hole with no cameras
 * on it is dimmed, so it is obvious at a glance which ones are still to do.
 */
export default function HoleSelector() {
  const hole = useStore((s) => s.hole);
  const setHole = useStore((s) => s.setHole);
  const entities = useStore((s) => s.plan?.entities ?? []);
  const holes = useStore((s) => s.course?.holes ?? []);
  const layout = useStore((s) => s.layout);

  const numbers = Array.from({ length: HOLES_PER_ROUND }, (_, i) => i + 1);

  // Dim by whatever the current job is: holes still to lay out, or holes with
  // no camera on them yet.
  const done = layout
    ? new Set(holes.filter((h) => h.tee && h.green).map((h) => h.number))
    : new Set(entities.filter((e) => e.kind === 'camera' && e.hole).map((e) => e.hole));

  const step = (delta) => {
    const i = hole == null ? -1 : numbers.indexOf(hole);
    setHole(numbers[Math.min(numbers.length - 1, Math.max(0, i + delta))] ?? numbers[0]);
  };

  return (
    <div className="bar hole-bar">
      <button className="btn ghost hole-nav" onClick={() => step(-1)} aria-label="Previous hole">‹</button>

      <button className="hole-btn wide" aria-pressed={hole == null} onClick={() => setHole(null)}>
        All
      </button>

      {numbers.map((n) => (
        <button key={n} className="hole-btn" aria-pressed={hole === n} data-hole={n}
                data-empty={done.has(n) ? 'no' : 'yes'}
                aria-label={`Hole ${n}${done.has(n) ? '' : layout ? ', not laid out yet' : ', no cameras yet'}`}
                onClick={() => setHole(n)}>
          {n}
        </button>
      ))}

      <button className="btn ghost hole-nav" onClick={() => step(1)} aria-label="Next hole">›</button>
    </div>
  );
}
