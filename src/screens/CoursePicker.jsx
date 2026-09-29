import { useState, useRef } from 'react';
import * as db from '../lib/db/index.js';
import { geocode } from '../lib/geocode.js';
import { fetchHoles } from '../lib/osm.js';
import AddCourse from './AddCourse.jsx';
import CourseElevation from './CourseElevation.jsx';
import { LPGA_SEASON as season } from '../data/lpgaCourses.js';

/**
 * Pick a course, or add one.
 *
 * Seeded courses carry a venue name but no coordinates; the first time one is
 * opened we geocode it and pull the hole layout from OpenStreetMap, then cache
 * both on the course so it is instant next time.
 */
export default function CoursePicker({ token, user, onPick, onSettings }) {
  const [courses, setCourses] = useState(db.getCourses);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [elevationFor, setElevationFor] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);

  const visible = courses.filter((c) =>
    `${c.name} ${c.event} ${c.place}`.toLowerCase().includes(query.toLowerCase())
  );

  const refresh = () => setCourses(db.getCourses());

  const abortRef = useRef(null);
  const pendingRef = useRef(null);

  /** Open the course whatever happened, with whatever holes we managed to get. */
  const finish = async (course, holes) => {
    const next = { ...course, holes: holes ?? [] };
    try { await db.saveCourse(next); } catch (err) { setStatus(`Could not save: ${err.message}`); }
    refresh();
    setBusyId(null);
    setProgress(null);
    onPick(next);
  };

  const skip = () => {
    abortRef.current?.abort();
    if (pendingRef.current) finish(pendingRef.current, []);
  };

  const cancel = () => {
    abortRef.current?.abort();
    pendingRef.current = null;
    setBusyId(null);
    setProgress(null);
    setStatus('Cancelled.');
  };

  const open = async (course) => {
    if (course.tbc) {
      setStatus(`${course.event}: the tour has not announced a venue yet. Add it as a new course once it is confirmed.`);
      return;
    }
    setBusyId(course.id);
    setStatus(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let next = { ...course };

    try {
      if (!next.lngLat) {
        setProgress(`Locating ${next.name}…`);
        const found = await geocode(`${next.name}, ${next.place}`, token);
        if (!found.length) throw new Error(`Could not find ${next.name}. Add it manually with coordinates.`);
        next.lngLat = found[0].lngLat;
      }
      pendingRef.current = next;

      if (!next.holes) {
        setProgress(`Looking up the hole layout for ${next.name}…`);
        try {
          const holes = await fetchHoles(next.lngLat, {
            signal: controller.signal,
            onProgress: (line) => setProgress(line),
          });
          return finish(next, holes);
        } catch (err) {
          if (controller.signal.aborted) return;          // skip/cancel already handled it
          setStatus(`${next.name}: ${err.message}. Opening without hole data — the map still works, hole snapping will not.`);
          return finish(next, []);
        }
      }
      finish(next, next.holes);
    } catch (err) {
      if (!controller.signal.aborted) setStatus(err.message);
      setBusyId(null);
      setProgress(null);
    }
  };

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="head">
          <div className="grow">
            <h1>Courses</h1>
            <p>Seeded with the {season} LPGA schedule. Add anything that is missing.</p>
            {user && (
              <p style={{ marginTop: 6 }}>
                Signed in as <b style={{ color: 'var(--text)' }}>{user.email}</b>{' '}
                <button className="btn ghost" style={{ minHeight: 0, padding: '2px 8px' }}
                        onClick={async () => { await db.auth.signOut(); }}>
                  Sign out
                </button>
              </p>
            )}
          </div>
          <button className="btn" onClick={onSettings}>Kits</button>
          <button className="btn primary" onClick={() => setAdding(true)}>Add course</button>
        </div>

        <div className="field">
          <label htmlFor="course-search">Search</label>
          <input id="course-search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Course, event or place" />
        </div>

        {status && <div className="banner">{status}</div>}

        {progress && (
          <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 180 }}>{progress}</span>
            <button className="btn" style={{ flex: 'none' }} onClick={skip}>
              Open without hole data
            </button>
            <button className="btn ghost" style={{ flex: 'none' }} onClick={cancel}>Cancel</button>
          </div>
        )}

        <div className="list">
          {visible.map((c) => (
            <div key={c.id} className="item-row">
              <button className="item grow" onClick={() => open(c)} disabled={busyId != null}>
                <div className="grow">
                  <b>{c.name}</b>
                  <small>{[c.event, c.place, c.dates].filter(Boolean).join(' · ')}</small>
                </div>
                {c.major && <span className="tag accent">Major</span>}
                {c.tbc && <span className="tag">Venue TBC</span>}
                {c.holes?.length > 0 && <span className="tag">{c.holes.length} holes</span>}
                {!c.lngLat && <span className="tag">Not located</span>}
                <span>{busyId === c.id ? '…' : '›'}</span>
              </button>
              {/* Elevation needs the course located before a file can be checked
                  against it, so it only appears once there are coordinates. */}
              {c.lngLat && (
                <button className="btn ghost" title={`Elevation for ${c.name}`}
                        onClick={() => setElevationFor(c)}>
                  Elevation
                </button>
              )}
            </div>
          ))}
          {!visible.length && <div className="empty">No courses match “{query}”.</div>}
        </div>
      </div>

      {elevationFor && (
        <CourseElevation course={elevationFor} onClose={() => { setElevationFor(null); refresh(); }} />
      )}

      {adding && (
        <AddCourse token={token} onCancel={() => setAdding(false)}
                   onSave={async (course) => {
                     await db.saveCourse(course);
                     refresh();
                     setAdding(false);
                   }} />
      )}
    </div>
  );
}
