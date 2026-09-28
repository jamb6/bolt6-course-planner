import { useState } from 'react';
import { geocode } from '../lib/geocode.js';
import { newId } from '../lib/db/index.js';

/**
 * Add a course: give it a name, then find it on the map. Searching uses
 * Mapbox geocoding; if that misses, coordinates can be typed in directly.
 */
export default function AddCourse({ token, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [results, setResults] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [manual, setManual] = useState({ lng: '', lat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const search = async () => {
    const term = [name, place].filter(Boolean).join(', ');
    if (!term.trim()) return;
    setBusy(true); setError(null);
    try {
      const found = await geocode(term, token);
      setResults(found);
      if (!found.length) setError('Nothing found. Type the coordinates instead.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const lngLat = chosen?.lngLat
    ?? (manual.lng !== '' && manual.lat !== '' ? [Number(manual.lng), Number(manual.lat)] : null);

  const save = () => {
    if (!name.trim() || !lngLat) return;
    onSave({
      id: newId(), name: name.trim(), place: place.trim() || chosen?.full || '',
      event: '', dates: '', lngLat, holes: null, seeded: false,
    });
  };

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="card modal">
        <h2>Add a course</h2>

        <div className="field">
          <label htmlFor="ac-name">Course name</label>
          <input id="ac-name" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Pelican Golf Club" />
        </div>
        <div className="field">
          <label htmlFor="ac-place">Town / country (helps the search)</label>
          <input id="ac-place" value={place} onChange={(e) => setPlace(e.target.value)}
                 placeholder="Belleair, Florida" />
        </div>

        <button className="btn" onClick={search} disabled={busy || !name.trim()}>
          {busy ? 'Searching…' : 'Find on the map'}
        </button>

        {error && <div className="banner warn">{error}</div>}

        {results?.length > 0 && (
          <div className="list">
            {results.map((r) => (
              <button key={r.full} className="item" aria-pressed={chosen?.full === r.full}
                      onClick={() => setChosen(r)}
                      style={chosen?.full === r.full ? { borderColor: 'var(--accent)' } : undefined}>
                <div className="grow">
                  <b>{r.name}</b>
                  <small>{r.full}</small>
                </div>
                <span className="num tag">{r.lngLat[1].toFixed(4)}, {r.lngLat[0].toFixed(4)}</span>
              </button>
            ))}
          </div>
        )}

        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>
            Or type the coordinates
          </summary>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="ac-lat">Latitude</label>
              <input id="ac-lat" inputMode="decimal" value={manual.lat}
                     onChange={(e) => { setManual({ ...manual, lat: e.target.value }); setChosen(null); }}
                     placeholder="27.9345" />
            </div>
            <div className="field">
              <label htmlFor="ac-lng">Longitude</label>
              <input id="ac-lng" inputMode="decimal" value={manual.lng}
                     onChange={(e) => { setManual({ ...manual, lng: e.target.value }); setChosen(null); }}
                     placeholder="-82.8175" />
            </div>
          </div>
        </details>

        <div className="row">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!name.trim() || !lngLat}>
            Add course
          </button>
        </div>
      </div>
    </div>
  );
}
