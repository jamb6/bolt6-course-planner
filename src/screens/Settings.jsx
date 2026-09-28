import { useState } from 'react';
import * as db from '../lib/db/index.js';
import { parseNumberList, formatNumberList, newKit } from '../lib/kits.js';

/**
 * Kit setup. Each kit holds a numbered set of cameras; anything broken or
 * missing is typed in as a list so it never gets handed out to a plan.
 */
export default function Settings({ onBack }) {
  const [kits, setKits] = useState(db.getKits);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(db.getKits().map((k) => [k.id, formatNumberList(k.unavailable ?? [])]))
  );

  const refresh = () => setKits(db.getKits());

  const [note, setNote] = useState(null);

  const patch = async (kit, changes) => {
    try { await db.saveKit({ ...kit, ...changes }); refresh(); }
    catch (err) { setNote(`Could not save: ${err.message}`); }
  };

  const setUnavailable = (kit, text) => {
    setDrafts((d) => ({ ...d, [kit.id]: text }));
    patch(kit, { unavailable: parseNumberList(text, kit.size ?? 60) });
  };

  const addKit = async () => {
    const kit = { id: db.newId(), ...newKit(`Kit ${kits.length + 1}`) };
    await db.saveKit(kit);
    setDrafts((d) => ({ ...d, [kit.id]: '' }));
    refresh();
  };

  /** Push whatever this browser built before the shared workspace existed. */
  const importLocal = async () => {
    setNote('Importing…');
    try {
      const { plans = 0, courses = 0 } = await db.importLocalWorkspace();
      refresh();
      setNote(plans || courses
        ? `Imported ${plans} plan(s) and ${courses} course(s) from this browser.`
        : 'Nothing found in this browser to import.');
    } catch (err) {
      setNote(`Import failed: ${err.message}`);
    }
  };

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="head">
          <div className="grow">
            <h1>Kits</h1>
            <p>
              Each kit is a numbered set of cameras. List anything broken or missing and those
              numbers stop being offered — the auto-assigner skips them and the number picker
              greys them out.
            </p>
          </div>
          <button className="btn" onClick={onBack}>Back</button>
        </div>

        {note && <div className="banner">{note}</div>}

        <div className="banner">
          Storage: <b>{db.isRemote() ? 'shared workspace' : 'this browser only'}</b>.{' '}
          {db.isRemote()
            ? 'Courses, plans and kits are the same for everyone signed in.'
            : 'Nobody else can see these plans. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to share them.'}
          {db.isRemote() && (
            <> <button className="btn ghost" style={{ minHeight: 0, padding: '2px 8px' }}
                       onClick={importLocal}>Import this browser's old data</button></>
          )}
        </div>

        <div className="list">
          {kits.map((kit) => {
            const out = kit.unavailable ?? [];
            const size = kit.size ?? 60;
            return (
              <div key={kit.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row">
                  <div className="field" style={{ flex: 2 }}>
                    <label htmlFor={`kit-name-${kit.id}`}>Kit name</label>
                    <input id={`kit-name-${kit.id}`} value={kit.name}
                           onChange={(e) => patch(kit, { name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`kit-size-${kit.id}`}>Cameras in the kit</label>
                    <input id={`kit-size-${kit.id}`} type="number" min="1" max="200" value={size}
                           onChange={(e) => patch(kit, { size: Number(e.target.value) || 60 })} />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`kit-out-${kit.id}`}>Broken or missing</label>
                  <input id={`kit-out-${kit.id}`} value={drafts[kit.id] ?? ''}
                         placeholder="7, 23, 41-44"
                         onChange={(e) => setUnavailable(kit, e.target.value)} />
                </div>
                <p className="hint">
                  Commas, spaces or ranges. {out.length
                    ? <><b>{size - out.length}</b> of {size} cameras available — out: <b>{formatNumberList(out)}</b>.</>
                    : <>All <b>{size}</b> cameras available.</>}
                </p>

                <div className="field">
                  <label htmlFor={`kit-notes-${kit.id}`}>Notes</label>
                  <input id={`kit-notes-${kit.id}`} value={kit.notes ?? ''}
                         placeholder="Where the kit lives, who owns it"
                         onChange={(e) => patch(kit, { notes: e.target.value })} />
                </div>

                {kits.length > 1 && (
                  <div>
                    <button className="btn danger" style={{ flex: 'none' }}
                            onClick={() => { db.deleteKit(kit.id); refresh(); }}>
                      Delete {kit.name}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button className="btn primary" onClick={addKit}>Add a kit</button>
      </div>
    </div>
  );
}
