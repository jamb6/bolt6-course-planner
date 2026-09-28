import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('dist-test');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0]; const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200,{'Content-Type':'text/html'}); return r.end(fs.readFileSync(path.join(DIST,'index.html'))); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(8805);

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? (pass++, console.log('  PASS', m, x)) : (fail++, console.log('  FAIL', m, x)); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

// Overpass returns nothing, so the course starts with no hole layout at all —
// which is the situation the editor exists for.
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('overpass')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' });
  if (u.startsWith('http://localhost:8805')) return route.continue();
  return route.fulfill({ status: 204, body: '' });
});

await page.goto('http://localhost:8805/');
await page.fill('#token', 'pk.x');
await page.click('button[type=submit]');
await page.waitForSelector('.item');
await page.click('.item:has-text("Pelican Golf Club")');
await page.waitForSelector('#plan-name', { timeout: 20000 });
await page.fill('#owner', 'Jam');
await page.fill('#plan-name', 'Layout test');
await page.click('button:has-text("Create")');
await page.waitForSelector('.planner');

const course = async () => page.evaluate(() =>
  JSON.parse(localStorage.getItem('b6.courses')).find((c) => c.name.includes('Pelican')));

console.log('\n=== Starting with no layout ===');
ok(((await course()).holes ?? []).length === 0, 'the course has no holes to begin with');
await page.click('.top-right button:has-text("Menu")');
ok(/none set/.test(await page.textContent('button:has-text("Set up hole layout")')),
   'the menu says no layout is set');
await page.click('button:has-text("Set up hole layout")');
await page.waitForSelector('.layout-tag');
ok(true, 'layout mode opens');

console.log('\n=== Tap the tee, tap the green ===');
ok(await page.getAttribute('.tool-btn:has-text("Tee")', 'aria-pressed') === 'true',
   'the tee is armed first');
ok(/Click where the tee of hole 1 is/.test(await page.textContent('.toast')),
   'and it says what to click', (await page.textContent('.toast')).trim());

await page.evaluate(() => window.__map.fire('click', { x: 500, y: 300 }));
await page.waitForTimeout(200);
ok(await page.getAttribute('.tool-btn:has-text("Green")', 'aria-pressed') === 'true',
   'setting the tee arms the green');

await page.evaluate(() => window.__map.fire('click', { x: 760, y: 560 }));
await page.waitForTimeout(250);
let c = await course();
const h1 = c.holes.find((h) => h.number === 1);
ok(h1?.tee?.length === 2 && h1?.green?.length === 2, 'hole 1 has a tee and a green');
ok(typeof h1.playBearing === 'number' && h1.bounds?.length === 2,
   'bearing and bounds are derived from them', `${Math.round(h1.playBearing)}°`);
ok(h1.source === 'manual', 'the hole is marked as hand-placed');

const holeNow = await page.evaluate(() => document.querySelector('.hole-btn[aria-pressed="true"]').textContent);
ok(holeNow === '2', 'it moves on to the next hole by itself', `now on hole ${holeNow}`);
ok(await page.getAttribute('.tool-btn:has-text("Tee")', 'aria-pressed') === 'true',
   'with the tee armed again');

console.log('\n=== Par, progress and correcting a mistake ===');
await page.selectOption('.build-bar select', '4');
await page.waitForTimeout(200);
ok((await course()).holes.find((h) => h.number === 2)?.par === 4, 'par is set per hole');

await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Green")');
const greenBefore = (await course()).holes.find((h) => h.number === 1).green.slice();
await page.evaluate(() => window.__map.fire('click', { x: 900, y: 620 }));
await page.waitForTimeout(250);
const greenAfter = (await course()).holes.find((h) => h.number === 1).green;
ok(greenAfter[0] !== greenBefore[0], 'tapping again corrects a point');

const drawn = await page.evaluate(() => window.__map.getSource('holes').data.features.length);
ok(drawn > 0, 'the layout draws on the map as it is built', `${drawn} features`);

console.log('\n=== Leaving layout mode ===');
await page.click('.build-bar .btn.primary:has-text("Done")');
await page.waitForTimeout(200);
ok(await page.locator('.layout-tag').count() === 0, 'Done returns to the build tools');
ok(await page.locator('.tool-btn:has-text("Camera")').count() === 1, 'the camera tool is back');

await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 620, y: 420 }));
await page.waitForSelector('.tag:has-text("Saved")', { timeout: 5000 });
const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('b6.plans'))[0]);
ok(plan.entities.some((e) => e.kind === 'camera' && e.hole === 1),
   'and cameras can be placed on the holes you just set up');

await page.reload();
await page.waitForTimeout(600);
ok(((await course()).holes ?? []).length >= 2, 'the layout survives a reload');

ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
