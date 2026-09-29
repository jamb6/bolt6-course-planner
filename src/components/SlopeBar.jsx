import { useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { SLOPE_COLOURS, SLOPE_MARGIN_DEG, TRIPOD_SLOPE_RANGE } from '../data/constants.js';
import { suitability } from '../lib/dem.js';

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

const Swatch = ({ colour, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
    <i style={{ width: 10, height: 10, borderRadius: 2, background: rgb(colour) }} />
    {children}
  </span>
);

/**
 * Slope shading: the switch, the key, and the limit it is drawn against.
 *
 * The limit is adjustable from here rather than only from the course screen,
 * because the useful move is to drag it and watch the green retreat — that is
 * how you find out whether a position is comfortably fine or only just.
 */
export default function SlopeBar() {
  const dem = useStore((s) => s.dem);
  const demState = useStore((s) => s.demState);
  const demError = useStore((s) => s.demError);
  const slopeOn = useStore((s) => s.slopeOn);
  const limit = useStore((s) => s.slopeLimit);
  const toggleSlope = useStore((s) => s.toggleSlope);
  const setSlopeLimit = useStore((s) => s.setSlopeLimit);
  const loadDem = useStore((s) => s.loadDem);
  const courseId = useStore((s) => s.course?.id);
  const view3d = useStore((s) => s.view3d);

  /* Find out whether this course has elevation without waiting to be asked, so
     the button can say what it will do before it is pressed. */
  useEffect(() => { if (courseId && demState === 'idle') loadDem(courseId); }, [courseId, demState, loadDem]);

  const stats = dem && slopeOn ? suitability(dem, limit) : null;

  return (
    <div className="slope-bar">
      <button className="btn ghost" aria-pressed={slopeOn}
              disabled={demState === 'loading' || demState === 'none'}
              onClick={toggleSlope}
              title={demState === 'none'
                ? 'No elevation for this course — upload a GeoTIFF from the course list'
                : 'Shade the ground by how steep it is'}>
        {demState === 'loading' ? 'Slope…' : slopeOn ? 'Slope on' : 'Slope'}
      </button>

      {demState === 'none' && <span className="tag">No elevation</span>}
      {demState === 'error' && <span className="tag bad">Elevation failed: {demError}</span>}

      {slopeOn && dem && (
        <>
          <label htmlFor="slope-limit" className="slope-limit">
            <span>{limit}°</span>
            <input id="slope-limit" type="range"
                   min={TRIPOD_SLOPE_RANGE[0]} max={TRIPOD_SLOPE_RANGE[1]} step={0.5}
                   value={limit} onChange={(e) => setSlopeLimit(Number(e.target.value))} />
          </label>
          <span className="slope-key">
            <Swatch colour={SLOPE_COLOURS.flat}>fine</Swatch>
            <Swatch colour={SLOPE_COLOURS.near}>within {SLOPE_MARGIN_DEG}°</Swatch>
            <Swatch colour={SLOPE_COLOURS.steep}>too steep</Swatch>
            <span style={{ color: 'var(--dim)' }}>unshaded = no reading</span>
          </span>
          {stats && <span className="tag">{Math.round(stats.fraction * 100)}% at {limit}°</span>}
          {/* The 3D relief is a coarse global DEM and will not show a bank this
              shading calls too steep. Say which one to believe. */}
          {view3d && <span className="tag">shading is measured · relief is not</span>}
        </>
      )}
    </div>
  );
}
