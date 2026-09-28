import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('dist-test');
const OVERPASS = fs.readFileSync('tests/overpass.json', 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0]; const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200,{'Content-Type':'text/html'}); return r.end(fs.readFileSync(path.join(DIST,'index.html'))); }
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(fs.readFileSync(f));
}).listen(8807);

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? (pass++, console.log('  PASS', m, x)) : (fail++, console.log('  FAIL', m, x)); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('overpass')) return route.fulfill({ status: 200, contentType: 'application/json', body: OVERPASS });
  if (u.startsWith('http://localhost:8807')) return route.continue();
  return route.fulfill({ status: 204, body: '' });
});

await page.goto('http://localhost:8807/');
await page.fill('#token', 'pk.x');
await page.click('button[type=submit]');
await page.waitForSelector('.item');
await page.click('.item:has-text("Pelican Golf Club")');
await page.waitForSelector('#plan-name', { timeout: 20000 });
await page.fill('#owner', 'Jam');
await page.fill('#plan-name', 'Write batching');
await page.click('button:has-text("Create")');
await page.waitForSelector('.planner');

const state = () => page.evaluate(() => {
  const s = window.__b6.store.getState();
  return { dirty: [...s.dirty], removed: [...s.removed], saved: s.saved, planDirty: s.planDirty,
           entities: s.plan.entities.map((e) => e.id) };
});
const settle = () => page.waitForSelector('.tag:has-text("Saved")', { timeout: 6000 });

console.log('\n=== Only what changed gets written ===');
await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
for (const [x, y] of [[520, 380], [700, 300], [880, 470]]) {
  await page.evaluate(([x, y]) => window.__map.fire('click', { x, y }), [x, y]);
  await page.waitForTimeout(70);
}
let s = await state();
ok(s.dirty.length === 3, 'three new cameras queue three writes', `${s.dirty.length} dirty`);
await settle();
s = await state();
ok(s.dirty.length === 0 && s.saved, 'the queue clears once saved');

// touch exactly one camera
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features[1];
  m.fire('click', m.project(f.geometry.coordinates));
});
await page.waitForSelector('#cam-number');
await page.selectOption('#cam-type', 'tower');
await page.waitForTimeout(120);
s = await state();
ok(s.dirty.length === 1, 'editing one camera queues one write, not the whole plan',
   `${s.dirty.length} dirty of ${s.entities.length} entities`);
ok(s.dirty[0] === s.entities[1], 'and it is the camera that changed');
await settle();

console.log('\n=== Moving one thing does not dirty its neighbours ===');
await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features[0];
  const p0 = m.project(f.geometry.coordinates);
  m.fire('mousedown', p0, 'item-hit');
  m.fire('mousemove', { x: p0.x + 120, y: p0.y + 80 });
  m.fire('mouseup', { x: p0.x + 120, y: p0.y + 80 });
});
await page.waitForTimeout(150);
s = await state();
ok(s.dirty.length === 1, 'a drag writes one entity', `${s.dirty.length} dirty`);
await settle();

console.log('\n=== Deletes are tracked separately ===');
await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features[2];
  m.fire('click', m.project(f.geometry.coordinates));
});
await page.waitForSelector('.panel-foot .btn.danger');
const doomed = (await state()).entities[2];
await page.click('.panel-foot .btn.danger:has-text("Delete")');
await page.waitForTimeout(150);
s = await state();
ok(s.removed.includes(doomed), 'a delete queues a delete, not a rewrite', `${s.removed.length} removed`);
ok(!s.dirty.includes(doomed), 'and the deleted entity is not also queued for writing');
await settle();
s = await state();
ok(s.removed.length === 0 && s.entities.length === 2, 'the delete lands');

console.log('\n=== Changing the kit marks the plan, not the entities ===');
await page.click('.top-right button:has-text("Menu")');
await page.selectOption('#menu-kit', { index: 0 });
await page.waitForTimeout(120);
s = await state();
ok(s.dirty.length === 0, 'switching kit does not rewrite every camera', `${s.dirty.length} dirty`);

console.log('\n=== Storage driver ===');
const drv = await page.evaluate(() => ({ remote: window.__b6.db.isRemote(), name: window.__b6.db.driverName }));
ok(drv.remote === false && drv.name === 'local',
   'with no Supabase configured it runs on localStorage', drv.name);

ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
