/**
 * Marker and switch icons, drawn once on a canvas and registered with Mapbox
 * as images. Real shapes rather than coloured dots, so a hazard reads as a
 * hazard at a glance on grass.
 */
const SIZE = 36;          // device-independent px, drawn at 2x
const SCALE = 2;

/** Each icon is a draw function over a 36×36 box, centred on (18, 18). */
const SHAPES = {
  'marker-flag': (c, colour) => {
    c.strokeStyle = colour; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(11, 6); c.lineTo(11, 30); c.stroke();
    c.fillStyle = colour;
    c.beginPath(); c.moveTo(12, 7); c.lineTo(28, 12); c.lineTo(12, 17); c.closePath(); c.fill();
  },
  'marker-warning': (c, colour) => {
    c.fillStyle = colour;
    c.beginPath(); c.moveTo(18, 5); c.lineTo(32, 30); c.lineTo(4, 30); c.closePath(); c.fill();
    c.fillStyle = '#0B1017';
    c.beginPath(); c.moveTo(16.5, 13); c.lineTo(19.5, 13); c.lineTo(19, 23); c.lineTo(17, 23); c.closePath(); c.fill();
    c.beginPath(); c.arc(18, 26.5, 1.6, 0, Math.PI * 2); c.fill();
  },
  'marker-power': (c, colour) => {
    c.fillStyle = colour;
    c.beginPath();
    c.moveTo(21, 4); c.lineTo(10, 19); c.lineTo(17, 19); c.lineTo(15, 32);
    c.lineTo(27, 16); c.lineTo(20, 16); c.closePath();
    c.fill();
  },
  'marker-info': (c, colour) => {
    c.fillStyle = colour;
    c.beginPath(); c.arc(18, 18, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0B1017';
    c.beginPath(); c.arc(18, 11.5, 2, 0, Math.PI * 2); c.fill();
    c.fillRect(16.4, 15.5, 3.2, 11);
  },
  'cable-plus': (c, colour) => {
    c.fillStyle = '#0B1017';
    c.beginPath(); c.arc(18, 18, 15, 0, Math.PI * 2); c.fill();
    c.strokeStyle = colour; c.lineWidth = 2.5;
    c.beginPath(); c.arc(18, 18, 15, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(18, 10); c.lineTo(18, 26); c.moveTo(10, 18); c.lineTo(26, 18); c.stroke();
  },

  'node-switch': (c, colour) => {
    c.fillStyle = colour;
    c.beginPath(); c.roundRect(6, 10, 24, 16, 3); c.fill();
    c.fillStyle = '#0B1017';
    for (let i = 0; i < 4; i++) c.fillRect(9 + i * 5.5, 20, 3, 3);
    c.fillRect(9, 14, 18, 2.5);
  },
};

/** Registers every icon on the map. Safe to call again after a style change. */
export function addIcons(map, markerTypes, switchColour) {
  const colours = Object.fromEntries(markerTypes.map((m) => [`marker-${m.id}`, m.colour]));
  colours['node-switch'] = switchColour;
  colours['cable-plus'] = '#42C6FF';

  for (const [name, draw] of Object.entries(SHAPES)) {
    if (map.hasImage?.(name)) continue;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE * SCALE;
    canvas.height = SIZE * SCALE;
    const c = canvas.getContext('2d');
    if (!c) continue;
    c.scale(SCALE, SCALE);

    // A dark outline so every icon holds up over bright sand and fairway.
    c.shadowColor = 'rgba(0,0,0,0.85)';
    c.shadowBlur = 3;
    draw(c, colours[name] ?? '#FFFFFF');

    const { data, width, height } = c.getImageData(0, 0, canvas.width, canvas.height);
    map.addImage(name, { width, height, data }, { pixelRatio: SCALE });
  }
}
