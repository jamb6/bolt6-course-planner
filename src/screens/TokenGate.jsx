import { useState } from 'react';
import { useStore } from '../store/useStore.js';

/** Asked once, kept in localStorage. Never committed to the repo. */
export default function TokenGate() {
  const setToken = useStore((s) => s.setToken);
  const [value, setValue] = useState('');
  const looksWrong = value.length > 0 && !value.trim().startsWith('pk.');

  return (
    <div className="modal-bg">
      <form className="card modal" onSubmit={(e) => { e.preventDefault(); setToken(value.trim()); }}>
        <h2>Mapbox token</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          The planner needs a Mapbox public token to draw satellite imagery. It is kept in this
          browser only. You can also put it in a <code>.env</code> file as <code>VITE_MAPBOX_TOKEN</code>.
        </p>
        <div className="field">
          <label htmlFor="token">Public token</label>
          <input id="token" autoComplete="off" spellCheck="false" placeholder="pk.eyJ1Ijoi…"
                 value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {looksWrong && <div className="banner warn">Public tokens start with <code>pk.</code></div>}
        <button className="btn primary" type="submit" disabled={!value.trim()}>Continue</button>
      </form>
    </div>
  );
}
