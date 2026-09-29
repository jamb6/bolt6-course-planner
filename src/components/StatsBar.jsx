import { useStore } from '../store/useStore.js';
import { buildTotals } from '../lib/exportPlan.js';

/**
 * Kit counts. `scope="course"` totals the whole plan and sits by the plan
 * title; `scope="hole"` totals just the hole you are working on and sits in
 * the build bar.
 */
export default function StatsBar({ scope = 'course' }) {
  const entities = useStore((s) => s.plan?.entities ?? []);
  const hole = useStore((s) => s.hole);

  const forHole = scope === 'hole' && hole != null;
  const subset = forHole ? entities.filter((e) => e.hole === hole) : entities;
  const t = buildTotals(subset);

  const stats = [
    { value: t.cameras, label: 'Cameras' },
    { value: t.masts, label: 'Masts' },
    { value: t.cableBuckets.short, label: '0–50 m' },
    { value: t.cableBuckets.mid, label: '50–100 m' },
  ];
  if (t.cableBuckets.long) stats.push({ value: t.cableBuckets.long, label: '100 m +' });

  return (
    <div className={`stats stats-${scope}`}>
      <span className="stats-scope">
        {scope === 'course' ? 'Course' : forHole ? `Hole ${hole}` : 'All holes'}
      </span>
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <b>{s.value}</b>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
