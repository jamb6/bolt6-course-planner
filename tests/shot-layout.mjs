import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST = path.resolve('dist-test');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0]; const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200,{'Content-Type':'text/html'}); return r.end(fs.readFileSync(path.join(DIST,'index.html'))); }
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(fs.readFileSync(f));
}).listen(8806);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await b.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
page.setDefaultTimeout(9000);
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.includes('overpass')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' });
  if (u.startsWith('http://localhost:8806')) return r.continue();
  return r.fulfill({ status: 204, body: '' });
});
await page.goto('http://localhost:8806/');
await page.fill('#token','pk.x'); await page.click('button[type=submit]');
await page.waitForSelector('.item');
await page.click('.item:has-text("Pelican Golf Club")');
await page.waitForSelector('#plan-name', { timeout: 20000 });
await page.fill('#owner','Jam'); await page.fill('#plan-name','ANNIKA 2027 — camera plan');
await page.click('button:has-text("Create")');
await page.waitForSelector('.planner');
await page.click('.top-right button:has-text("Menu")');
await page.click('button:has-text("Set up hole layout")');
await page.waitForSelector('.layout-tag');
// lay out a couple of holes so the progress counter has something in it
for (const [x,y] of [[480,300],[700,520],[760,330],[980,560]]) {
  await page.evaluate(([x,y]) => window.__map.fire('click',{x,y}), [x,y]);
  await page.waitForTimeout(120);
}
await page.click('.hole-btn[data-hole="3"]');
await page.waitForTimeout(250);
await page.screenshot({ path: 'tests/shot-layout.png' });
await b.close(); srv.close(); console.log('shot written');
