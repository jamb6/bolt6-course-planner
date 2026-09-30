import { useEffect, useRef, useState } from 'react';
import * as db from '../lib/db/index.js';
import { buildDem, suitability, distanceToCoverageM } from '../lib/dem.js';
import { MAST_SLOPE_RANGE } from '../data/constants.js';

/**
 * Elevation for a course: upload a GeoTIFF, set the mast floor limit.
 *
 * Reached from a plan row, but stored against the course — the ground does not
 * change between plans, so one upload serves all of them.
 *
 * Deliberately short. The two warnings are the exception: they show only when
 * something is wrong with the file itself, and a wrong file here means somebody
 * plans a mast position against the wrong hillside.
 */
export default function CourseElevation({ course, onClose }) {
  const [dem, setDem] = useState(() => db.peekDem(course.id));
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [limit, setLimit] = useState(db.getSlopeLimit());
  const fileRef = useRef(null);

  useEffect(() => {
    if (db.hasDemLoaded(course.id)) return;
    let live = true;
    db.loadDem(course.id)
      .then((d) => { if (live) setDem(d); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [course.id]);

  const take = async (file) => {
    if (!file) return;
    setError(null);
    setProgress('Reading…');
    try {
      const buffer = await file.arrayBuffer();
      setProgress('Computing slope…');
      await new Promise((r) => setTimeout(r, 0));     // let the message paint
      // The course centre is what the file gets cropped to, so a whole survey
      // tile still yields metre-scale cells over the course itself.
      const built = await buildDem(buffer, { fileName: file.name, centre: course.lngLat });
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

  return (
    <div className="modal-bg" role="dialog" aria-label="Course elevation"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal">
        <div className="head">
          <div className="grow">
            <h2 style={{ margin: 0 }}>Elevation — {course.name}</h2>
            <p style={{ margin: '4px 0 0' }}>Applies to every plan on this course.</p>
          </div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>

        {error && <div className="banner bad">{error}</div>}
        {progress && <div className="banner">{progress}</div>}

        <div className="row">
          <input ref={fileRef} type="file" accept=".tif,.tiff,image/tiff" style={{ display: 'none' }}
                 onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="btn primary" disabled={!!progress} onClick={() => fileRef.current?.click()}>
            {dem ? 'Replace GeoTIFF' : 'Upload GeoTIFF'}
          </button>
          {dem && <button className="btn danger" disabled={!!progress} onClick={clear}>Remove</button>}
        </div>

        {dem && (
          <div className="banner">
            <b style={{ color: 'var(--text)' }}>{dem.fileName || 'Elevation'}</b> · {dem.cellM} m cells ·{' '}
            {Math.round(dem.coverage * 100)}% covered
            {dem.effectiveM != null && <> · detail to {dem.effectiveM} m</>}
            {stats && (
              <> · <b style={{ color: 'var(--text)' }}>{Math.round(stats.fraction * 100)}%</b> mast-suitable</>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="dem-limit">Mast floor limit — {limit}°</label>
          <input id="dem-limit" type="range"
                 min={MAST_SLOPE_RANGE[0]} max={MAST_SLOPE_RANGE[1]} step={0.5} value={limit}
                 onChange={(e) => changeLimit(Number(e.target.value))} />
        </div>

        {offBy > 500 && (
          <div className="banner bad">
            This file covers ground {(offBy / 1000).toFixed(1)} km from {course.name} — probably the
            wrong tile.
          </div>
        )}
        {dem && dem.sourceM > 5 && (
          <div className="banner warn">
            The source is {dem.sourceM} m, too coarse to show the undulation a mast sits on. Treat the
            shading as a hint.
          </div>
        )}

        {/* A header says what the cell size is, not whether the cells mean
            anything. This is measured from the data itself — but smooth ground
            and resampled data look alike, so it reports rather than accuses. */}
        {dem && dem.effectiveM != null && dem.effectiveM >= dem.cellM * 4 && (
          <div className="banner warn">
            The detail in this file only goes down to about {dem.effectiveM} m, even though it is
            stored at {dem.cellM} m cells. Either it was resampled up from a coarser product, or this
            ground really is that smooth. Worth checking where it came from before trusting the
            shading on small features.
          </div>
        )}

        <p className="hint">
          <b>Where to get one:</b> 3DEP via OpenTopography (US), Environment Agency National LiDAR
          (England), AHN (Netherlands), IGN LiDAR HD (France). Anywhere else, a drone flight. Ask for
          1 m, bare earth, and EPSG:4326 if you get the choice.
        </p>
      </div>
    </div>
  );
}
