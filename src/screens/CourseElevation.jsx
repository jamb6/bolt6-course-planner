import { useEffect, useRef, useState } from 'react';
import * as db from '../lib/db/index.js';
import { buildDem, suitability, distanceToCoverageM } from '../lib/dem.js';
import { TRIPOD_SLOPE_RANGE, SLOPE_MARGIN_DEG } from '../data/constants.js';

/**
 * Per-course elevation: drop in a GeoTIFF, get slope shading on the map.
 *
 * Source-agnostic on purpose. A tripod question needs roughly a metre of
 * resolution, and no global elevation service offers that — so rather than wire
 * up one provider, this takes the file. USGS 3DEP for the American events, the
 * Environment Agency for England, a drone flight anywhere else. Half the 2027
 * schedule has open 1 m LiDAR; the rest will need flying, and until it is flown
 * those courses correctly show nothing at all.
 */
export default function CourseElevation({ course, onClose }) {
  const [dem, setDem] = useState(() => db.peekDem(course.id));
  const [state, setState] = useState(db.hasDemLoaded(course.id) ? 'ready' : 'loading');
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [limit, setLimit] = useState(db.getSlopeLimit());
  const fileRef = useRef(null);

  useEffect(() => {
    if (db.hasDemLoaded(course.id)) { setState('ready'); return; }
    let live = true;
    db.loadDem(course.id)
      .then((d) => { if (live) { setDem(d); setState('ready'); } })
      .catch((err) => { if (live) { setError(err.message); setState('ready'); } });
    return () => { live = false; };
  }, [course.id]);

  const take = async (file) => {
    if (!file) return;
    setError(null);
    setProgress(`Reading ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      setProgress('Computing slope…');
      // Let the message paint before the main thread goes away for a moment.
      await new Promise((r) => setTimeout(r, 0));
      const built = await buildDem(buffer, { fileName: file.name });

      setProgress('Saving…');
      await db.saveDem(course.id, built);
      setDem(built);
      setProgress(null);
    } catch (err) {
      setProgress(null);
      setError(err.message);
    }
  };

  const clear = async () => {
    setError(null);
    try { await db.deleteDem(course.id); setDem(null); }
    catch (err) { setError(err.message); }
  };

  const changeLimit = (deg) => { setLimit(deg); db.setSlopeLimit(deg); };

  const stats = dem ? suitability(dem, limit) : null;
  const offBy = dem && course.lngLat ? distanceToCoverageM(dem, course.lngLat) : null;
  const km2 = (m2) => (m2 / 1e6).toFixed(2);

  return (
    <div className="modal-bg" role="dialog" aria-label="Course elevation"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" style={{ width: 'min(560px, 100%)' }}>
        <div className="head">
          <div className="grow">
            <h2 style={{ margin: 0 }}>Elevation — {course.name}</h2>
            <p style={{ margin: '4px 0 0' }}>
              Upload a GeoTIFF and the map can shade the ground by how steep it is,
              so you can see where a tripod will level before anyone walks it.
            </p>
          </div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>

        {error && <div className="banner bad">{error}</div>}
        {progress && <div className="banner">{progress}</div>}

        <div className="field">
          <label htmlFor="dem-limit">
            Tripod limit — {limit}° {limit === 5 ? '(default)' : ''}
          </label>
          <input id="dem-limit" type="range" min={TRIPOD_SLOPE_RANGE[0]} max={TRIPOD_SLOPE_RANGE[1]}
                 step={0.5} value={limit}
                 onChange={(e) => changeLimit(Number(e.target.value))} />
          <p className="hint">
            The steepest ground your heads and legs can still be levelled on. Ground within{' '}
            {SLOPE_MARGIN_DEG}° of the limit is shaded amber rather than green, because a figure
            this close to the edge is worth a look on the ground. This is your setting, not the
            plan's — change it and every course reshades.
          </p>
        </div>

        {state === 'loading' && <div className="empty">Looking for elevation on this course…</div>}

        {state === 'ready' && !dem && (
          <>
            <div className="empty" style={{ padding: '18px 14px' }}>
              <b>No elevation for this course.</b>
              <div style={{ marginTop: 6 }}>
                The map will show no shading at all until a file is uploaded — rather than a smooth
                guess that looks trustworthy and is not.
              </div>
            </div>
            <p className="hint">
              Where to get one: <b>3DEP</b> via the OpenTopography API for US venues, the{' '}
              <b>Environment Agency National LiDAR Programme</b> for England, <b>AHN</b> for the
              Netherlands, <b>IGN LiDAR HD</b> for France. Anywhere else, a drone flight. Ask for
              1 m if you can and <b>EPSG:4326</b> if the tool offers a choice.
            </p>
          </>
        )}

        {dem && (
          <>
            <div className="banner">
              <b style={{ color: 'var(--text)' }}>{dem.fileName || 'Elevation'}</b>
              <div style={{ marginTop: 6, lineHeight: 1.7 }}>
                {dem.cellM} m cells · {dem.cols}×{dem.rows} grid · source {dem.sourceM} m,{' '}
                {dem.sourceCrs}
                <br />
                Ground {dem.elevMin}–{dem.elevMax} m · {Math.round(dem.coverage * 100)}% of the
                file has a reading
                <br />
                {stats && (
                  <>
                    <b className="num" style={{ color: 'var(--text)', fontSize: 18 }}>
                      {Math.round(stats.fraction * 100)}%
                    </b>{' '}
                    tripod-suitable at {limit}° — {km2(stats.areaM2)} km² measured
                  </>
                )}
              </div>
            </div>

            {dem.sourceM > 5 && (
              <div className="banner warn">
                The source is {dem.sourceM} m. Slope is the rate elevation changes, so it needs far
                more resolution than a height reading does — at this cell size the shading will
                show the lie of the land but will miss the undulation a tripod actually sits on.
                Treat it as a hint, not an answer.
              </div>
            )}

            {offBy > 500 && (
              <div className="banner bad">
                This file covers ground about {(offBy / 1000).toFixed(1)} km from{' '}
                {course.name}. That usually means the wrong tile — check it before planning
                against it.
              </div>
            )}

            {dem.coverage < 0.5 && (
              <div className="banner warn">
                Over half this file is marked as no data. The gaps are left unshaded, so a green
                patch still means measured ground — but you may want a fuller tile.
              </div>
            )}
          </>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <input ref={fileRef} type="file" accept=".tif,.tiff,image/tiff" style={{ display: 'none' }}
                 onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="btn primary" disabled={!!progress} onClick={() => fileRef.current?.click()}>
            {dem ? 'Replace GeoTIFF' : 'Upload GeoTIFF'}
          </button>
          {dem && <button className="btn danger" disabled={!!progress} onClick={clear}>Remove</button>}
        </div>
      </div>
    </div>
  );
}
