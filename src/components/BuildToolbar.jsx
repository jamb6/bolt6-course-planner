import { useState, useRef, useLayoutEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { CABLE_TYPES, MARKER_TYPES, CAMERA_COLOUR } from '../data/constants.js';
import StatsBar from './StatsBar.jsx';

/**
 * The build tools. One tool is active at a time — opening Connections or
 * Markers puts the camera away, and arming a camera closes both groups.
 *
 * Cable type is part of the cable control rather than a separate dropdown:
 * picking Cat6 or Fibre arms the cable, ready to place.
 *
 * A group's buttons pop up flush against the top of the bar, only as wide as
 * they need, centred on whichever root button opened them.
 */
export default function BuildToolbar() {
  const [group, setGroup] = useState(null);         // 'connections' | 'markers' | null
  const [popLeft, setPopLeft] = useState(0);

  const stackRef = useRef(null);
  const popRef = useRef(null);
  const rootRefs = { connections: useRef(null), markers: useRef(null) };

  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const cableType = useStore((s) => s.cableType);
  const armCable = useStore((s) => s.armCable);
  const markerType = useStore((s) => s.markerType);
  const armMarker = useStore((s) => s.armMarker);
  const draft = useStore((s) => s.draft);
  const finishCable = useStore((s) => s.finishCable);

  const pickCamera = () => { setGroup(null); setTool(tool === 'camera' ? null : 'camera'); };
  const switchTool = () => setTool(tool === 'switch' ? null : 'switch');

  const openGroup = (next) => {
    setGroup(group === next ? null : next);
    if (tool === 'camera') setTool(null);           // either/or, never both
  };

  /* Centre the popup on its root button, then nudge it back inside the window. */
  useLayoutEffect(() => {
    if (!group) return;
    const button = rootRefs[group].current;
    const stack = stackRef.current;
    const pop = popRef.current;
    if (!button || !stack || !pop) return;

    const centre = button.offsetLeft + button.offsetWidth / 2;
    const halfPop = pop.offsetWidth / 2;
    const stackLeft = stack.getBoundingClientRect().left;
    const min = 8 - stackLeft + halfPop;
    const max = window.innerWidth - 8 - stackLeft - halfPop;
    setPopLeft(Math.max(min, Math.min(max, centre)));
  }, [group]);

  return (
    <div className="build-stack" ref={stackRef}>
      {group && (
        <div className="bar group-pop" ref={popRef} style={{ left: popLeft }}>
          {group === 'connections' && (
            <>
              {CABLE_TYPES.map((t) => (
                <button key={t.id} className="tool-btn"
                        aria-pressed={tool === 'cable' && cableType === t.id}
                        onClick={() => armCable(t.id)}>
                  <span className="swatch" style={{ background: t.colour }} />
                  {t.label} cable
                </button>
              ))}
              <span className="divider" />
              <button className="tool-btn" aria-pressed={tool === 'switch'} onClick={switchTool}>
                <span className="swatch square" /> Switch
              </button>
            </>
          )}

          {group === 'markers' && MARKER_TYPES.map((m) => (
            <button key={m.id} className="tool-btn"
                    aria-pressed={tool === 'marker' && markerType === m.id}
                    onClick={() => armMarker(m.id)}>
              <span className="swatch" style={{ background: m.colour }} /> {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="bar build-bar">
        <button className="tool-btn" aria-pressed={tool === 'camera'} onClick={pickCamera}>
          <span className="swatch" style={{ background: CAMERA_COLOUR }} /> Camera
        </button>
        <button className="tool-btn" ref={rootRefs.connections}
                aria-pressed={group === 'connections' || tool === 'cable' || tool === 'switch'}
                onClick={() => openGroup('connections')}>
          Connections {group === 'connections' ? '▾' : '▴'}
        </button>
        <button className="tool-btn" ref={rootRefs.markers}
                aria-pressed={group === 'markers' || tool === 'marker'}
                onClick={() => openGroup('markers')}>
          Markers {group === 'markers' ? '▾' : '▴'}
        </button>

        {draft && (
          <button className="btn primary" onClick={finishCable}>
            Finish cable ({draft.coords.length})
          </button>
        )}

        <StatsBar scope="hole" />
      </div>
    </div>
  );
}
