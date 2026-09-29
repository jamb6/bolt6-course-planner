import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST = path.resolve('dist-test');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0]; const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200,{'Content-Type':'text/html'}); return r.end(fs.readFileSync(path.join(DIST,'index.html'))); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(8803);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
page.setDefaultTimeout(8000);
await page.route('**/*', r => r.request().url().startsWith('http://localhost:8803') ? r.continue() : r.fulfill({ status: 204, body: '' }));
await page.goto('http://localhost:8803/');
await page.fill('#token', 'pk.x'); await page.click('button[type=submit]');
await page.waitForSelector('.item');
await page.click('.btn:has-text("Kits")');
await page.waitForSelector('input[id^="kit-out-"]');
await page.locator('input[id^="kit-out-"]').first().fill('7, 23, 41-44');
await page.click('.btn:has-text("Add a kit")');
await page.waitForTimeout(250);
await page.screenshot({ path: 'tests/shot-kits.png' });
await b.close(); srv.close(); console.log('shot written');
