import { useEffect, useState } from 'react';
import MapView from '../map/MapView.jsx';
import HoleSelector from '../components/HoleSelector.jsx';
import BuildToolbar from '../components/BuildToolbar.jsx';
import LayoutBar from '../components/LayoutBar.jsx';
import EntityPanel from '../components/EntityPanel.jsx';
import MenuSheet from '../components/MenuSheet.jsx';
import StatsBar from '../components/StatsBar.jsx';
import SlopeBar from '../components/SlopeBar.jsx';
import { useStore } from '../store/useStore.js';

/** The map screen. Composes the overlays; the map itself lives in MapView. */
export default function Planner({ onExit }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const plan = useStore((s) => s.plan);
  const course = useStore((s) => s.course);
  const saved = useStore((s) => s.saved);
  const save = useStore((s) => s.save);
  const tool = useStore((s) => s.tool);
  const draft = useStore((s) => s.draft);
  const moveId = useStore((s) => s.moveId);
  const panelOpen = useStore((s) => s.selectedId != null);
  const beginMove = useStore((s) => s.beginMove);
  const notice = useStore((s) => s.notice);
  const layout = useStore((s) => s.layout);
  const holeNow = useStore((s) => s.hole);
  const view3d = useStore((s) => s.view3d);
  const toggle3d = useStore((s) => s.toggle3d);

  const say = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  /* Refusals from the store (no hole selected, hole full) show as a toast. */
  useEffect(() => { if (notice) say(notice.text); }, [notice]);

  /* Autosave a second after the last change, so nothing is lost on a refresh. */
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(save, 1000);
    return () => clearTimeout(t);
  }, [saved, plan, save]);

  const hint =
    layout ? `Click where the ${layout.target} of hole ${holeNow ?? 1} is`
    : moveId ? 'Click the map to move it'
    : draft ? 'Click to extend · right-click or Enter to finish · Esc to cancel'
    : tool === 'camera' ? 'Click the map to place a camera'
    : tool === 'switch' ? 'Click the map to place a switch'
    : tool === 'marker' ? 'Click the map to place a marker'
    : tool === 'cable' ? 'Click to start the cable run'
    : null;

  return (
    <div className={panelOpen ? 'planner with-panel' : 'planner'}>
      <MapView />

      <div className="overlay top-right bar">
        <StatsBar scope="course" />
        <div style={{ padding: '0 6px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b style={{ fontSize: 13 }}>{plan?.name}</b>
          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{course?.name}</div>
        </div>
        <span className="tag">{saved ? 'Saved' : 'Saving…'}</span>
        <button className="btn ghost" aria-pressed={view3d}
                title="Tilt into a 3D view of the terrain — for looking at, not for measuring"
                onClick={() => {
                  // Said once, on the way in: the relief and the slope shading
                  // come from different data and can disagree.
                  if (!view3d) say('3D terrain is Mapbox\u2019s global elevation, for context only \u2014 slope shading is the measured one.');
                  toggle3d();
                }}>
          3D
        </button>
        <button className="btn ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>Menu</button>
      </div>

      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} onExit={onExit} onToast={say} />

      <div className="overlay bottom">
        <SlopeBar />
        {layout ? <LayoutBar /> : <BuildToolbar />}
        <HoleSelector />
      </div>

      <EntityPanel onMove={(id) => { beginMove(id); say('Click the map to move it'); }} />

      {(toast || hint) && <div className="toast">{toast ?? hint}</div>}
    </div>
  );
}
