import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist-test');
const OVERPASS = fs.readFileSync('tests/overpass.json', 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(DIST, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(DIST, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8801);

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  cond ? (pass++, console.log('  PASS', msg, extra)) : (fail++, console.log('  FAIL', msg, extra));
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('overpass')) return route.fulfill({ status: 200, contentType: 'application/json', body: OVERPASS });
  if (u.includes('api.mapbox.com/geocoding')) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ features: [{ text: 'Test Club', place_name: 'Test Club, Somewhere', center: [-82.8, 27.9] }] }) });
  }
  if (u.startsWith('http://localhost:8801')) return route.continue();
  return route.fulfill({ status: 204, body: '' });
});

/** Autosave runs a second after the last edit; wait for the UI's own signal. */
const plan = async () => {
  await page.waitForSelector('.tag:has-text("Saved")', { timeout: 6000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('b6.plans'))[0]);
};
const src = (name) => page.evaluate((n) => window.__map.getSource(n).data.features, name);
const clearTool = () => page.keyboard.press('Escape');
// Escape usually closes the panel already, so the Close click is optional —
// give it a short timeout or the catch waits out the full default.
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.click('.panel-head button:has-text("Close")', { timeout: 600 }).catch(() => {});
};
/** The group buttons toggle, so click until the child we want is on screen. */
const openGroup = async (group, child) => {
  for (let i = 0; i < 3; i++) {
    if (await page.locator(`.tool-btn:has-text("${child}")`).count()) return;
    await page.click(`.tool-btn:has-text("${group}")`);
    await page.waitForTimeout(80);
  }
};

console.log('\n=== Setup ===');
await page.goto('http://localhost:8801/');
await page.waitForSelector('#token');
await page.fill('#token', 'pk.headless-test');
await page.click('button[type=submit]');
await page.waitForSelector('.item');
ok(await page.$$eval('.item', (e) => e.length) === 32, 'LPGA 2027 schedule seeded');

console.log('\n=== Kits ===');
await page.click('.btn:has-text("Kits")');
await page.waitForSelector('input[id^="kit-out-"]');
ok(await page.$$eval('.card', (e) => e.length) === 1, 'one kit to start with');
await page.click('.btn:has-text("Add a kit")');
await page.waitForTimeout(150);
ok(await page.$$eval('.card', (e) => e.length) === 2, 'more kits can be added');

const outField = page.locator('input[id^="kit-out-"]').first();
await outField.fill('2, 4-5, 61, 0');
await page.waitForTimeout(200);
const kitStored = await page.evaluate(() => JSON.parse(localStorage.getItem('b6.kits'))[0]);
ok(JSON.stringify(kitStored.unavailable) === '[2,4,5]',
   'ranges parse and out-of-range numbers are dropped', JSON.stringify(kitStored.unavailable));
const hint = await page.textContent('.hint');
ok(/57.*of 60/.test(hint), 'the kit reports how many cameras are left', hint.replace(/\s+/g, ' ').trim());
await page.click('.btn:has-text("Back")');
await page.waitForSelector('.item');

await page.click('.item:has-text("Pelican Golf Club")');
await page.waitForSelector('#plan-name', { timeout: 15000 });
await page.fill('#owner', 'Jam');
await page.fill('#plan-name', 'ANNIKA 2027 — camera plan');
ok(await page.locator('#plan-kit option').count() === 2, 'the plan picks a kit');
ok(await page.locator('.banner.warn', { hasText: '2, 4, 5' }).count() === 1,
   'the unavailable cameras are called out before the plan is made');
await page.click('button:has-text("Create")');
await page.waitForSelector('.planner');
ok(true, 'planner opens');

console.log('\n=== Hole selector ===');
const holeBtns = await page.$$('.hole-btn:not(.wide)');
ok(holeBtns.length === 18, 'all 18 holes are shown', `${holeBtns.length} buttons`);
ok(await page.locator('.hole-btn.wide').count() === 1, 'an "All" option replaces the dropdown');
ok(await page.locator('select').count() === 0, 'the hole dropdown is gone');
const belowTools = await page.evaluate(() => {
  const tools = document.querySelector('.build-stack').getBoundingClientRect();
  const holes = document.querySelector('.hole-bar').getBoundingClientRect();
  return holes.top >= tools.bottom - 1;
});
ok(belowTools, 'the hole row sits under the build buttons');
const dimmedBefore = await page.$$eval('.hole-btn[data-empty="yes"]', (e) => e.length);
ok(dimmedBefore === 18, 'every hole starts dimmed', `${dimmedBefore} dimmed`);

console.log('\n=== Cameras ===');
await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 620, y: 380 }));
await page.waitForTimeout(80);
await page.evaluate(() => window.__map.fire('click', { x: 820, y: 460 }));
let p = await plan();
ok(p.entities.filter((e) => e.kind === 'camera').length === 2, 'two cameras placed');
ok(p.entities[0].number === 1 && p.entities[1].number === 3,
   'hole 1 skips camera 2, which is broken', `CAM ${p.entities[0].number}, CAM ${p.entities[1].number}`);
ok(p.entities[0].position === 1 && p.entities[1].position === 2,
   'positions count up within the hole', `g0${p.entities[0].position}, g0${p.entities[1].position}`);
ok(p.entities[0].label === 'h01-g01', 'a camera is named by its position', p.entities[0].label);
ok(!('isTripod' in p.entities[0]), 'the tripod boolean is gone');
ok(p.entities[0].camType === 'tripod', 'camera defaults to the tripod type');

const dimmedAfter = await page.$$eval('.hole-btn[data-empty="yes"]', (e) => e.length);
ok(dimmedAfter === 17, 'the worked hole is no longer dimmed', `${dimmedAfter} still dimmed`);

const feats = await src('items');
const colours = await page.evaluate(() =>
  window.__map.getLayer('item-dot').paint['circle-color']);
ok(typeof colours === 'string', 'cameras are a single colour regardless of type', colours);
ok(feats.every((f) => f.properties.badge === 'T'), 'tripod cameras carry a T badge');

await clearTool();
await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features[0];
  m.fire('click', m.project(f.geometry.coordinates));
});
await page.waitForSelector('#cam-type');
ok(await page.locator('.check input[type=checkbox]').count() === 0, 'no tripod checkbox in the panel');
await page.selectOption('#cam-type', 'tower');
await plan();
ok((await src('items'))[0].properties.badge === '▲', 'tower cameras carry a ▲ badge');

await page.fill('#notes', 'Scaff behind the green');
await plan();
const noteOffset = await page.evaluate(() => window.__map.getLayer('item-note').layout['text-offset']);
ok(Array.isArray(noteOffset) && noteOffset[0] === 'case', 'notes badge sits below the type badge');

console.log('\n=== Hovering shows the note ===');
await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features[0];
  m.fire('mousemove', m.project(f.geometry.coordinates), 'item-hit');
});
await page.waitForSelector('.note-tip', { timeout: 3000 });
const tip = await page.textContent('.note-tip');
ok(/Scaff behind the green/.test(tip), 'the note pops up beside the item', tip.trim());
ok(/h01-g01/.test(tip), 'the tooltip names the item it belongs to');
const boxed = await page.evaluate(() => {
  const el = document.querySelector('.note-tip');
  const r = el.getBoundingClientRect();
  return { inView: r.right <= window.innerWidth && r.bottom <= window.innerHeight,
           clickThrough: getComputedStyle(el).pointerEvents === 'none' };
});
ok(boxed.inView, 'the tooltip stays inside the window');
ok(boxed.clickThrough, 'the tooltip does not swallow clicks');

await page.evaluate(() => {
  const m = window.__map;
  const f = m.getSource('items').data.features.find((x) => x.properties.hasNotes === 0);
  m.fire('mousemove', m.project(f.geometry.coordinates), 'item-hit');
});
await page.waitForTimeout(150);
ok(await page.locator('.note-tip').count() === 0, 'nothing pops up for an item with no note');

console.log('\n=== Position is separate from the camera number ===');
await closePanel();
await page.click('.hole-btn[data-hole="2"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 520, y: 600 }));
let p2 = await plan();
const camH2 = p2.entities.find((e) => e.hole === 2);
ok(camH2?.number === 6, 'hole 2 skips 4 and 5 and lands on 6', `CAM ${camH2?.number}`);
ok(camH2?.position === 1 && camH2?.label === 'h02-g01',
   'positions restart at g01 on a new hole', camH2?.label);
ok((await src('items')).some((f) => f.properties.posId === 'h02-g01'),
   'the position id is drawn under the camera');

const disabled = await page.$$eval('#cam-number option:disabled', (els) => els.map((e) => e.value));
ok(JSON.stringify(disabled) === '["2","4","5"]',
   'broken cameras are greyed out in the picker', disabled.join(', '));
ok(await page.textContent('#cam-number option[value="2"]').then((t) => /broken or missing/.test(t)),
   'and say why they cannot be picked');

await page.selectOption('#cam-number', '7');
p2 = await plan();
ok(p2.entities.find((e) => e.id === camH2.id).label === 'h02-g01',
   'changing the physical camera leaves the position name alone');

await page.selectOption('#cam-position', '3');
p2 = await plan();
const moved = p2.entities.find((e) => e.id === camH2.id);
ok(moved.label === 'h02-g03' && moved.number === 7,
   'position and camera number are independent', `${moved.label} / CAM ${moved.number}`);
ok((await src('items')).some((f) => f.properties.posId === 'h02-g03' && f.properties.number === '7'),
   'the map carries both identifiers');

ok(await page.locator('#cam-hole option', { hasText: 'Course-wide' }).count() === 0,
   'a camera can no longer be left off a hole');
ok(await page.locator('#cam-position option').count() === 3,
   'exactly three positions per hole');
await closePanel();
await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);

console.log('\n=== A camera needs a hole and a free position ===');
await page.click('.hole-btn.wide');                 // "All" — no hole selected
await page.waitForTimeout(150);
const countBefore = (await plan()).entities.filter((e) => e.kind === 'camera').length;
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 400, y: 400 }));
await page.waitForTimeout(250);
ok((await page.evaluate(() => JSON.parse(localStorage.getItem('b6.plans'))[0]))
     .entities.filter((e) => e.kind === 'camera').length === countBefore,
   'no camera is placed while the course view is on');
ok(/Pick a hole first/.test(await page.textContent('.toast')), 'and it says why',
   (await page.textContent('.toast')).trim());

await page.keyboard.press('Escape');
await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 980, y: 520 }));   // third on hole 1
await page.waitForTimeout(200);
await closePanel();
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 1020, y: 560 }));  // fourth — refused
await page.waitForTimeout(250);
const hole1 = (await page.evaluate(() => JSON.parse(localStorage.getItem('b6.plans'))[0]))
  .entities.filter((e) => e.kind === 'camera' && e.hole === 1);
ok(hole1.length === 3, 'a hole holds three cameras and no more', `${hole1.length} on hole 1`);
ok(/all three positions/.test(await page.textContent('.toast')), 'and the fourth is explained',
   (await page.textContent('.toast')).trim());
ok(JSON.stringify(hole1.map((c) => c.position).sort()) === '[1,2,3]',
   'they hold g01, g02 and g03');
await page.keyboard.press('Escape');

console.log('\n=== Tools are either/or ===');
await closePanel();
await page.click('.tool-btn:has-text("Camera")');
ok(await page.getAttribute('.tool-btn:has-text("Camera")', 'aria-pressed') === 'true', 'camera arms');
await page.click('.tool-btn:has-text("Connections")');
ok(await page.getAttribute('.tool-btn:has-text("Camera")', 'aria-pressed') === 'false',
   'opening Connections puts the camera away');
await page.click('.tool-btn:has-text("Cat6 cable")');
const cableArmed = await page.evaluate(() =>
  !!document.querySelector('.tool-btn[aria-pressed="true"]')?.textContent.includes('Cat6'));
ok(cableArmed, 'picking a cable type arms the cable, ready to place');
await page.click('.tool-btn:has-text("Camera")');
ok(await page.getAttribute('.tool-btn:has-text("Camera")', 'aria-pressed') === 'true',
   'arming the camera again closes the cable');

await openGroup('Markers', 'Warning');
const pop = await page.evaluate(() => {
  const g = document.querySelector('.group-pop').getBoundingClientRect();
  const bar = document.querySelector('.build-bar').getBoundingClientRect();
  const root = [...document.querySelectorAll('.build-bar .tool-btn')]
    .find((b) => b.textContent.includes('Markers')).getBoundingClientRect();
  return {
    gap: Math.abs(g.bottom - bar.top),
    narrower: g.width < bar.width,
    offCentre: Math.abs((g.left + g.width / 2) - (root.left + root.width / 2)),
  };
});
ok(pop.gap <= 1, 'the group popup is flush against the bar', `${pop.gap.toFixed(1)} px gap`);
ok(pop.narrower, 'the popup is only as wide as its buttons');
ok(pop.offCentre <= 1.5, 'the popup is centred over the button that opened it',
   `${pop.offCentre.toFixed(1)} px off`);
await page.keyboard.press('Escape');
await clearTool();

console.log('\n=== Cables: draw, snap, edit points ===');
await openGroup('Connections', 'Cat6 cable');
await page.click('.tool-btn:has-text("Cat6 cable")');
const ends = await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features;
  const a = m.project(f[0].geometry.coordinates), b = m.project(f[1].geometry.coordinates);
  m.fire('click', { x: a.x + 3, y: a.y + 2 });
  m.fire('click', { x: (a.x + b.x) / 2, y: a.y - 110 });
  m.fire('click', { x: b.x - 3, y: b.y + 2 });
  m.fire('contextmenu', { x: 20, y: 20 });
  return { a: f[0].geometry.coordinates, b: f[1].geometry.coordinates, ids: f.map((x) => x.properties.id) };
});
p = await plan();
let cable = p.entities.find((e) => e.kind === 'cable');
ok(cable?.coords.length === 3, 'cable drawn with three points');
ok(cable.attach[0] === ends.ids[0] && cable.attach[2] === ends.ids[1],
   'both ends pinned to the cameras they were dropped on');
const lengthAtDraw = cable.lengthM;

await page.click('.panel-foot button:has-text("Edit points")');
await page.waitForTimeout(150);
const handles = (await src('vertices'));
ok(handles.filter((f) => f.properties.role === 'point').length === 3,
   'Edit points shows a handle per point');
ok(handles.filter((f) => f.properties.role === 'plus').length === 2,
   'both ends get a (+) for extending');

await page.evaluate(() => {
  const m = window.__map, v = m.getSource('vertices').data.features[1];
  const p0 = m.project(v.geometry.coordinates);
  m.fire('mousedown', p0, 'vertex-hit');
  m.fire('mousemove', { x: p0.x + 160, y: p0.y + 90 });
  m.fire('mouseup', { x: p0.x + 160, y: p0.y + 90 });
});
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
ok(cable.lengthM !== lengthAtDraw, 'dragging a point re-measures the run',
   `${lengthAtDraw.toFixed(1)} m -> ${cable.lengthM.toFixed(1)} m`);

console.log('\n=== Grabbing a pinned point unpins it ===');
// Re-pin the first point to camera 1 so there is something to unpin.
await page.evaluate((id) => {
  const m = window.__map;
  const cam = m.getSource('items').data.features.find((x) => x.properties.id === id);
  const v = m.getSource('vertices').data.features.find((f) => f.properties.role === 'point' && f.properties.index === 0);
  const p0 = m.project(v.geometry.coordinates);
  const target = m.project(cam.geometry.coordinates);
  m.fire('mousedown', p0, 'vertex-hit');
  m.fire('mousemove', target);
  m.fire('mouseup', target);
}, ends.ids[0]);
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
ok(cable.attach[0] === ends.ids[0], 'dropping a point on a camera pins it there');

const camBefore = p.entities.find((e) => e.id === ends.ids[0]).coords.slice();
await page.evaluate(() => {
  const m = window.__map;
  const v = m.getSource('vertices').data.features.find((f) => f.properties.role === 'point' && f.properties.index === 0);
  const p0 = m.project(v.geometry.coordinates);
  m.fire('mousedown', p0, 'vertex-hit');
  m.fire('mousemove', { x: p0.x + 240, y: p0.y + 160 });   // well clear of the snap radius
  m.fire('mouseup', { x: p0.x + 240, y: p0.y + 160 });
});
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
const camAfter = p.entities.find((e) => e.id === ends.ids[0]).coords;
ok(cable.attach[0] === null, 'dragging a pinned point unpins it');
ok(camAfter[0] === camBefore[0] && camAfter[1] === camBefore[1],
   'the camera it was pinned to does not move');

console.log('\n=== The (+) extends a run ===');
const pointsBefore = cable.coords.length;
await page.evaluate(() => {
  const m = window.__map;
  const plus = m.getSource('vertices').data.features.find((f) => f.properties.end === 'end');
  const p0 = m.project(plus.geometry.coordinates);
  m.fire('click', { x: p0.x, y: p0.y - 42 });          // the (+) renders above the end
});
await page.waitForTimeout(120);
ok(await page.evaluate(() => !!window.__map), 'extend mode armed');
await page.evaluate(() => {
  const m = window.__map;
  m.fire('click', { x: 1180, y: 700 });
  m.fire('click', { x: 1240, y: 780 });
  m.fire('contextmenu', { x: 20, y: 20 });
});
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
ok(cable.coords.length === pointsBefore + 2, 'the (+) carries the run on from that end',
   `${pointsBefore} -> ${cable.coords.length} points`);

console.log('\n=== Clicking the run inserts a joint ===');
const beforeInsert = cable.coords.length;
await page.evaluate(() => {
  const m = window.__map;
  const c = m.getSource('cables').data.features[0].geometry.coordinates;
  const a = m.project(c[0]), b = m.project(c[1]);
  m.fire('click', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
});
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
ok(cable.coords.length === beforeInsert + 1, 'a click on the line drops a joint in',
   `${beforeInsert} -> ${cable.coords.length} points`);
ok((await src('vertices')).filter((f) => f.properties.role === 'point').length === cable.coords.length,
   'the new joint gets its own draggable handle');

const preDrag = cable.coords[1].slice();
await page.evaluate(() => {
  const m = window.__map;
  const v = m.getSource('vertices').data.features.find((f) => f.properties.role === 'point' && f.properties.index === 1);
  const p0 = m.project(v.geometry.coordinates);
  m.fire('mousedown', p0, 'vertex-hit');
  m.fire('mousemove', { x: p0.x + 120, y: p0.y - 70 });
  m.fire('mouseup', { x: p0.x + 120, y: p0.y - 70 });
});
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
ok(cable.coords[1][0] !== preDrag[0], 'the inserted joint can be dragged');

console.log('\n=== Cables follow the nodes they are pinned to ===');
// Pin the first point back onto camera 1 before testing the follow behaviour.
await page.evaluate((id) => {
  const m = window.__map;
  const cam = m.getSource('items').data.features.find((x) => x.properties.id === id);
  const v = m.getSource('vertices').data.features.find((f) => f.properties.role === 'point' && f.properties.index === 0);
  const p0 = m.project(v.geometry.coordinates);
  const target = m.project(cam.geometry.coordinates);
  m.fire('mousedown', p0, 'vertex-hit');
  m.fire('mousemove', target);
  m.fire('mouseup', target);
}, ends.ids[0]);
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
const before = { end: cable.coords[0].slice(), len: cable.lengthM };
await page.keyboard.press('Escape');
await page.evaluate((id) => {
  const m = window.__map;
  const f = m.getSource('items').data.features.find((x) => x.properties.id === id);
  const p0 = m.project(f.geometry.coordinates);
  m.fire('mousedown', p0, 'item-hit');
  m.fire('mousemove', { x: p0.x - 200, y: p0.y - 130 });
  m.fire('mouseup', { x: p0.x - 200, y: p0.y - 130 });
}, ends.ids[0]);
p = await plan();
cable = p.entities.find((e) => e.kind === 'cable');
const cam = p.entities.find((e) => e.id === ends.ids[0]);
ok(cable.coords[0][0] === cam.coords[0] && cable.coords[0][1] === cam.coords[1],
   'moving a camera drags its pinned cable end with it');
ok(cable.coords[0][0] !== before.end[0], 'the pinned end actually moved');
ok(cable.lengthM !== before.len, 'the run re-measures when a node moves',
   `${before.len.toFixed(1)} m -> ${cable.lengthM.toFixed(1)} m`);

console.log('\n=== Switches and markers ===');
await closePanel();
await openGroup('Connections', 'Switch');
await page.click('.tool-btn:has-text("Switch")');
await page.evaluate(() => window.__map.fire('click', { x: 1000, y: 300 }));
await page.waitForTimeout(80);
await closePanel();
await openGroup('Markers', 'Warning');
await page.click('.tool-btn:has-text("Warning")');
await page.evaluate(() => window.__map.fire('click', { x: 300, y: 300 }));
p = await plan();
ok(p.entities.some((e) => e.kind === 'switch'), 'switch placed');
ok(p.entities.some((e) => e.kind === 'marker' && e.markerType === 'warning'), 'warning marker placed');

const images = await page.evaluate(() => window.__map.listImages());
ok(['marker-flag', 'marker-warning', 'marker-power', 'marker-info', 'node-switch']
     .every((n) => images.includes(n)), 'markers and switches are drawn shapes, not dots', images.join(', '));
const markerFeature = (await src('items')).find((f) => f.properties.kind === 'marker');
ok(markerFeature.properties.icon === 'marker-warning', 'each marker type uses its own icon');

console.log('\n=== Export and persistence ===');
await closePanel();
await page.click('.top-right button:has-text("Menu")');
const planDl = page.waitForEvent('download');
await page.click('button:has-text("Export camera plan")');
const gridCsv = await (await planDl).createReadStream().then(async (st) => {
  let out = ''; for await (const c of st) out += c; return out;
});
fs.writeFileSync('tests/camera-plan.csv', gridCsv);
const gridLines = gridCsv.split('\n');
ok(gridLines.some((l) => l === 'Hole,g01,g02,g03,Tripods'), 'the camera plan is a hole x position grid',
   gridLines.find((l) => l.startsWith('Hole,')) || '');
ok(gridLines.filter((l) => /^\d+,/.test(l)).length === 18, 'every hole gets a row, filled or not');
const row1 = gridLines.find((l) => l.startsWith('1,'));
ok(/^1,"\d+ [TLH^]","\d+ [TLH^]","\d+ [TLH^]",\d+$/.test(row1),
   'each cell carries the camera number and its mounting mark', row1);
const row5 = gridLines.find((l) => l.startsWith('5,'));
ok(row5 === '5,"","","",0', 'holes with nothing planned stay blank', row5);
ok(/Mounting,T tripod,L LED board,\^ tower,H hospitality/.test(gridCsv), 'the sheet carries a key');

await page.click('.top-right button:has-text("Menu")');
const dl = page.waitForEvent('download');
await page.click('button:has-text("Export rigging breakdown")');
const csv = await (await dl).createReadStream().then(async (s) => {
  let out = ''; for await (const c of s) out += c; return out;
});
ok(/Positions,Camera numbers,Cameras,Tripods/.test(csv), 'CSV has the rigging columns');
ok(/Hole,Positions,Camera numbers/.test(csv), 'CSV carries positions and camera numbers separately');
ok(/^Kit,/m.test(csv), 'the CSV names the kit it was built against',
   csv.split('\n').find((l) => l.startsWith('Kit,')) || '');
ok(/^Cameras out of service,"2 4 5"/m.test(csv), 'and lists what was out of service');
ok(/^1,"h01-g01 h01-g02 h01-g03","1 3 6",3,2,/m.test(csv), 'tripod count now comes from the camera type',
   csv.split('\n').find((l) => l.startsWith('1,')) || '');
fs.writeFileSync('tests/breakdown.csv', csv);

await page.reload();
await page.waitForSelector('.item, .planner', { timeout: 10000 });
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('b6.plans')));
ok(stored?.[0]?.entities.length >= 5, 'plan survives a reload', `${stored[0].entities.length} entities`);

ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
