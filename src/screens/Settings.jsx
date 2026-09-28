import { useState, useRef, useEffect } from 'react';
import * as db from '../lib/db/index.js';
import { parseNumberList, formatNumberList, newKit } from '../lib/kits.js';

/**
 * Kit setup. Each kit holds a numbered set of cameras; anything broken or
 * missing is typed in as a list so it never gets handed out to a plan.
 *
 * Every field edits a local draft and saves on a short debounce. Writing on
 * each keystroke means a network round trip per character against a shared
 * workspace, and replies landing out of order fight whatever you are typing.
 */
const SAVE_AFTER_MS = 600;

const draftOf = (kit) => ({
  name: kit.name ?? '',
  size: String(kit.size ?? 60),
  unavailable: formatNumberList(kit.unavailable ?? []),
  notes: kit.notes ?? '',
});
const seedDrafts = (kits) => Object.fromEntries(kits.map((k) => [k.id, draftOf(k)]));

export default function Settings({ onBack }) {
  const [kits, setKits] = useState(db.getKits);
  const [drafts, setDrafts] = useState(() => seedDrafts(db.getKits()));
  const [state, setState] = useState({});      // per kit: 'editing' | 'saved' | error text
  const [note, setNote] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [pwNote, setPwNote] = useState(null);

  const draftsRef = useRef(drafts);
  const timers = useRef({});
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);

  // Anything still pending when you leave still gets written.
  useEffect(() => () => {
    for (const id of Object.keys(timers.current)) {
      clearTimeout(timers.current[id]);
      commit(id);
    }
  }, []);

  const refresh = () => setKits(db.getKits());

  /** Turn a draft back into a kit and write it. */
  const commit = async (id) => {
    const d = draftsRef.current[id];
    if (!d) return;
    const size = Math.min(500, Math.max(1, Number(d.size) || 60));
    try {
      await db.saveKit({
        id,
        name: d.name.trim() || 'Untitled kit',
        size,
        unavailable: parseNumberList(d.unavailable, size),
        notes: d.notes,
      });
      refresh();
      setState((s) => ({ ...s, [id]: 'saved' }));
    } catch (err) {
      setState((s) => ({ ...s, [id]: `Not saved — ${err.message}` }));
    }
  };

  /** Types straight into the draft; the write follows once you pause. */
  const edit = (kit, changes) => {
    setDrafts((d) => ({ ...d, [kit.id]: { ...d[kit.id], ...changes } }));
    setState((s) => ({ ...s, [kit.id]: 'editing' }));
    clearTimeout(timers.current[kit.id]);
    timers.current[kit.id] = setTimeout(() => commit(kit.id), SAVE_AFTER_MS);
  };

  const addKit = async () => {
    const kit = { id: db.newId(), ...newKit(`Kit ${kits.length + 1}`) };
    try {
      await db.saveKit(kit);
      setDrafts((d) => ({ ...d, [kit.id]: draftOf(kit) }));
      refresh();
    } catch (err) {
      setNote(`Could not add a kit: ${err.message}`);
    }
  };

  const removeKit = async (kit) => {
    clearTimeout(timers.current[kit.id]);
    try {
      await db.deleteKit(kit.id);
      setDrafts((d) => { const next = { ...d }; delete next[kit.id]; return next; });
      refresh();
    } catch (err) {
      setNote(`Could not delete ${kit.name}: ${err.message}`);
    }
  };

  /** Push whatever this browser built before the shared workspace existed. */
  const importLocal = async () => {
    setNote('Importing…');
    try {
      const { plans = 0, courses = 0 } = await db.importLocalWorkspace();
      refresh();
      setDrafts(seedDrafts(db.getKits()));
      setNote(plans || courses
        ? `Imported ${plans} plan(s) and ${courses} course(s) from this browser.`
        : 'Nothing found in this browser to import.');
    } catch (err) {
      setNote(`Import failed: ${err.message}`);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 8) return setPwNote('Use at least 8 characters.');
    try {
      await db.auth.changePassword(newPassword);
      setNewPassword('');
      setPwNote('Password changed.');
    } catch (err) {
      setPwNote(err.message);
    }
  };

  const leave = async () => {
    for (const id of Object.keys(timers.current)) clearTimeout(timers.current[id]);
    await Promise.all(Object.keys(draftsRef.current).map(commit));
    onBack();
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
          <button className="btn" onClick={leave}>Back</button>
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
            const d = drafts[kit.id] ?? draftOf(kit);
            const size = Math.max(1, Number(d.size) || 60);
            const out = parseNumberList(d.unavailable, size);
            const status = state[kit.id];

            return (
              <div key={kit.id} className="card"
                   style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row">
                  <div className="field" style={{ flex: 2 }}>
                    <label htmlFor={`kit-name-${kit.id}`}>Kit name</label>
                    <input id={`kit-name-${kit.id}`} value={d.name}
                           placeholder="Kit 1"
                           onChange={(e) => edit(kit, { name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`kit-size-${kit.id}`}>Cameras in the kit</label>
                    <input id={`kit-size-${kit.id}`} type="number" min="1" max="500" value={d.size}
                           onChange={(e) => edit(kit, { size: e.target.value })} />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`kit-out-${kit.id}`}>Broken or missing</label>
                  <input id={`kit-out-${kit.id}`} value={d.unavailable}
                         placeholder="7, 23, 41-44"
                         onChange={(e) => edit(kit, { unavailable: e.target.value })} />
                </div>
                <p className="hint">
                  Commas, spaces or ranges. {out.length
                    ? <><b>{size - out.length}</b> of {size} cameras available — out: <b>{formatNumberList(out)}</b>.</>
                    : <>All <b>{size}</b> cameras available.</>}
                </p>

                <div className="field">
                  <label htmlFor={`kit-notes-${kit.id}`}>Notes</label>
                  <input id={`kit-notes-${kit.id}`} value={d.notes}
                         placeholder="Where the kit lives, who owns it"
                         onChange={(e) => edit(kit, { notes: e.target.value })} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {kits.length > 1 && (
                    <button className="btn danger" style={{ flex: 'none' }}
                            onClick={() => removeKit(kit)}>
                      Delete {kit.name}
                    </button>
                  )}
                  <span className="kit-state" data-bad={status && status !== 'editing' && status !== 'saved' ? '1' : '0'}>
                    {status === 'editing' ? 'Saving…' : status === 'saved' ? 'Saved' : status ?? ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <button className="btn primary" onClick={addKit}>Add a kit</button>

        {db.auth.enabled && (
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Your password</h2>
            <p className="hint" style={{ margin: 0 }}>
              Replace the one you were given. It only changes your own sign-in, not anyone else's.
            </p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="new-password">New password</label>
                <input id="new-password" type="password" autoComplete="new-password"
                       value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <button className="btn" style={{ flex: 'none' }}
                      onClick={changePassword} disabled={!newPassword}>Change</button>
            </div>
            {pwNote && <div className="banner">{pwNote}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
