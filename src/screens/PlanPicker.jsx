import { useState, useEffect } from 'react';
import * as db from '../lib/db/index.js';
import { buildTotals } from '../lib/exportPlan.js';
import { useStore } from '../store/useStore.js';
import { formatNumberList } from '../lib/kits.js';

/** Plans for one course: open, duplicate, delete, share, or start a new one. */
export default function PlanPicker({ course, onOpen, onBack }) {
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const [plans, setPlans] = useState(() => db.getPlansForCourse(course.id));
  const [name, setName] = useState('');
  const kits = db.getKits();
  const [kitId, setKitId] = useState(kits[0].id);
  const [toast, setToast] = useState(null);

  const refresh = () => setPlans(db.getPlansForCourse(course.id));

  const [busy, setBusy] = useState(false);

  /* Pull the shared workspace when this screen opens, so you see plans other
     people have made or changed since you were last here. */
  useEffect(() => {
    if (!db.isRemote()) return;
    setBusy(true);
    db.refresh().then(refresh).catch((e) => setToast(e.message)).finally(() => setBusy(false));
  }, []);

  const reload = async () => {
    setBusy(true);
    try { await db.refresh(); refresh(); setToast('Up to date'); }
    catch (err) { setToast(err.message); }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (!name.trim()) return;
    const plan = await db.createPlan({
      courseId: course.id, name: name.trim(), owner: user || 'Unassigned', kitId,
    });
    setName('');
    refresh();
    onOpen(plan);
  };

  const share = (plan) => {
    const text = JSON.stringify({ version: 1, course, plan }, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.name.replace(/\W+/g, '-').toLowerCase()}.b6plan.json`;
    a.click();
    setToast('Plan file downloaded. Whoever you send it to imports it from this screen.');
  };

  const importPlan = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (!data.plan) throw new Error('That file has no plan in it');
      await db.savePlan({ ...data.plan, id: db.newId(), courseId: course.id });
      refresh();
      setToast(`Imported “${data.plan.name}”`);
    } catch (err) {
      setToast(err.message);
    }
  };

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="head">
          <div className="grow">
            <h1>{course.name}</h1>
            <p>{[course.event, course.place].filter(Boolean).join(' · ')}</p>
          </div>
          {db.isRemote() && (
            <button className="btn" onClick={reload} disabled={busy}>
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          <button className="btn" onClick={onBack}>All courses</button>
        </div>

        <div className="field">
          <label htmlFor="owner">Your name (recorded as the plan owner)</label>
          <input id="owner" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Jam" />
        </div>

        <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 240px' }}>
            <label htmlFor="plan-name">New plan</label>
            <input id="plan-name" value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="ANNIKA 2027 — camera plan"
                   onKeyDown={(e) => e.key === 'Enter' && create()} />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="plan-kit">Camera kit</label>
            <select id="plan-kit" value={kitId} onChange={(e) => setKitId(e.target.value)}>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}{k.unavailable?.length ? ` — ${k.unavailable.length} out` : ''}
                </option>
              ))}
            </select>
          </div>
          <button className="btn primary" onClick={create} disabled={!name.trim()}>Create</button>
        </div>
        {(() => {
          const kit = kits.find((k) => k.id === kitId);
          return kit?.unavailable?.length
            ? <div className="banner warn">
                {kit.name}: cameras {formatNumberList(kit.unavailable)} are broken or missing and
                will not be assigned.
              </div>
            : null;
        })()}

        {toast && <div className="banner">{toast}</div>}

        <div className="list">
          {plans.map((p) => {
            const t = buildTotals(p.entities);
            return (
              <div key={p.id} className="item">
                <div className="grow">
                  <b>{p.name}</b>
                  <small>
                    {p.owner} · created {new Date(p.createdAt).toLocaleDateString()} ·{' '}
                    {db.getKit(p.kitId)?.name ?? 'no kit'} ·{' '}
                    {t.cameras} cameras on {t.holesWithCamera} holes
                  </small>
                </div>
                <button className="btn" onClick={() => onOpen(p)}>Open</button>
                <button className="btn ghost" title="Duplicate"
                        onClick={async () => { await db.duplicatePlan(p, user || p.owner); refresh(); }}>Copy</button>
                <button className="btn ghost" title="Share as a file" onClick={() => share(p)}>Share</button>
                <button className="btn ghost danger" title="Delete"
                        onClick={async () => { await db.deletePlan(p.id); refresh(); }}>Delete</button>
              </div>
            );
          })}
          {!plans.length && <div className="empty">No plans for this course yet.</div>}
        </div>

        <div className="field">
          <label htmlFor="import">Import a shared plan file</label>
          <input id="import" type="file" accept=".json,application/json"
                 onChange={(e) => e.target.files?.[0] && importPlan(e.target.files[0])} />
        </div>
      </div>
    </div>
  );
}
