/**
 * The note attached to whatever the mouse is over, shown beside the cursor.
 * Position is in map-container pixels and gets clamped so the box never runs
 * off the right or bottom edge.
 */
export default function NoteTooltip({ hover }) {
  if (!hover) return null;

  const WIDTH = 260;
  const left = Math.min(hover.x + 18, window.innerWidth - WIDTH - 16);
  const top = Math.min(hover.y + 18, window.innerHeight - 120);

  return (
    <div className="note-tip" style={{ left, top, width: WIDTH }} role="tooltip">
      <b>{hover.label}</b>
      <p>{hover.notes}</p>
    </div>
  );
}
