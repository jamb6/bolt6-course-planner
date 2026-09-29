import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST = path.resolve('dist-test'), OV = fs.readFileSync('tests/overpass.json', 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0]; const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200, {'Content-Type':'text/html'}); return r.end(fs.readFileSync(path.join(DIST,'index.html'))); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(8802);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await b.newContext({ viewport: { width: 1500, height: 880 } })).newPage();
page.setDefaultTimeout(8000);
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.includes('overpass')) return r.fulfill({ status: 200, contentType: 'application/json', body: OV });
  if (u.startsWith('http://localhost:8802')) return r.continue();
  return r.fulfill({ status: 204, body: '' });
});
await page.goto('http://localhost:8802/');
await page.fill('#token', 'pk.x'); await page.click('button[type=submit]');
await page.waitForSelector('.item');
await page.click('.item:has-text("Pelican Golf Club")');
await page.waitForSelector('#plan-name', { timeout: 15000 });
await page.fill('#owner', 'Jam'); await page.fill('#plan-name', 'ANNIKA 2027 — camera plan');
await page.click('button:has-text("Create")');
await page.waitForSelector('.planner');

await page.click('.hole-btn[data-hole="1"]'); await page.waitForTimeout(200);
await page.click('.tool-btn:has-text("Camera")');
for (const [x, y] of [[520, 380], [700, 300], [880, 470]]) {
  await page.evaluate(([x, y]) => window.__map.fire('click', { x, y }), [x, y]);
  await page.waitForTimeout(60);
}
await page.keyboard.press('Escape');
await page.click('.hole-btn[data-hole="2"]'); await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
await page.evaluate(() => window.__map.fire('click', { x: 600, y: 600 }));
await page.keyboard.press('Escape');
await page.click('.hole-btn[data-hole="1"]'); await page.waitForTimeout(150);

await page.click('.tool-btn:has-text("Markers")'); await page.waitForTimeout(150); await page.screenshot({ path: 'tests/shot-popup.png' }); await page.click('.tool-btn:has-text("Markers")'); await page.click('.tool-btn:has-text("Connections")'); await page.waitForTimeout(120);
await page.click('.tool-btn:has-text("Cat6 cable")');
await page.evaluate(() => {
  const m = window.__map, f = m.getSource('items').data.features;
  const a = m.project(f[0].geometry.coordinates), c = m.project(f[2].geometry.coordinates);
  m.fire('click', { x: a.x + 2, y: a.y + 2 });
  m.fire('click', { x: (a.x + c.x) / 2, y: a.y + 150 });
  m.fire('click', { x: c.x - 2, y: c.y + 2 });
  m.fire('contextmenu', { x: 5, y: 5 });
});
await page.waitForTimeout(300);
await page.click('.panel-foot button:has-text("Edit points")').catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: 'tests/shot-planner.png' });
await b.close(); srv.close(); console.log('shot written');
