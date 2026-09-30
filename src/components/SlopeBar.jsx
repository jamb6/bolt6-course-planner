import { useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { SLOPE_COLOURS, SLOPE_MARGIN_DEG, MAST_SLOPE_RANGE } from '../data/constants.js';

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

const Swatch = ({ colour, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
    <i style={{ width: 10, height: 10, borderRadius: 2, background: rgb(colour) }} />
    {children}
  </span>
);

/**
 * The slope switch, sized for the top bar next to 3D.
 *
 * Only the toggle lives up there. The limit and the colour key are a second
 * strip underneath, shown while shading is on — the top bar is already carrying
 * the course totals, the plan name and the menu, and a slider plus a four-item
 * key would push the lot off a phone.
 */
export function SlopeToggle() {
  const demState = useStore((s) => s.demState);
  const demError = useStore((s) => s.demError);
  const slopeOn = useStore((s) => s.slopeOn);
  const toggleSlope = useStore((s) => s.toggleSlope);
  const loadDem = useStore((s) => s.loadDem);
  const courseId = useStore((s) => s.course?.id);

  /* Find out whether this course has elevation without waiting to be asked, so
     the button can say what it will do before it is pressed. */
  useEffect(() => { if (courseId && demState === 'idle') loadDem(courseId); }, [courseId, demState, loadDem]);

  const title = demState === 'none'
    ? 'No elevation for this course — add a GeoTIFF from the plan list'
    : demState === 'error'
      ? `Elevation failed: ${demError}`
      : 'Shade the ground by how steep it is';

  return (
    <button className="btn ghost" aria-pressed={slopeOn} title={title}
            disabled={demState === 'loading' || demState === 'none' || demState === 'error'}
            onClick={toggleSlope}>
      {demState === 'loading' ? 'Slope…' : 'Slope'}
    </button>
  );
}

const [LIMIT_MIN, LIMIT_MAX] = MAST_SLOPE_RANGE;
const LIMIT_STEP = 0.5;

/** The mast floor limit, and what the colours mean. Only while shading. */
export function SlopeLegend() {
  const dem = useStore((s) => s.dem);
  const slopeOn = useStore((s) => s.slopeOn);
  const limit = useStore((s) => s.slopeLimit);
  const setSlopeLimit = useStore((s) => s.setSlopeLimit);
  const view3d = useStore((s) => s.view3d);

  if (!slopeOn || !dem) return null;

  // Rounded because 0.5 steps in binary floating point drift otherwise.
  const step = (by) =>
    setSlopeLimit(Math.round(Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, limit + by)) * 2) / 2);

  return (
    <div className="slope-bar">
      <div className="slope-step" title="Mast floor limit">
        <button className="btn ghost" aria-label="Lower the mast floor limit"
                disabled={limit <= LIMIT_MIN} onClick={() => step(-LIMIT_STEP)}>‹</button>
        {/* Always one decimal, in a fixed-width box. Letting it flip between
            "4°" and "3.5°" resized the row and shifted the buttons out from
            under the pointer between clicks. */}
        <span className="slope-step-value" aria-live="polite">{limit.toFixed(1)}°</span>
        <button className="btn ghost" aria-label="Raise the mast floor limit"
                disabled={limit >= LIMIT_MAX} onClick={() => step(LIMIT_STEP)}>›</button>
      </div>
      <span className="slope-key">
        <Swatch colour={SLOPE_COLOURS.flat}>fine</Swatch>
        <Swatch colour={SLOPE_COLOURS.near}>within {SLOPE_MARGIN_DEG}°</Swatch>
        <Swatch colour={SLOPE_COLOURS.steep}>too steep</Swatch>
      </span>
      {/* The 3D relief is a coarse global DEM and will not show a bank this
          shading calls too steep. Say which one to believe. */}
      {view3d && <span className="tag">shading is measured · relief is not</span>}
    </div>
  );
}
