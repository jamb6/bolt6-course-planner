import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist-test');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0]; const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(200, {'Content-Type':'text/html'}); return res.end(fs.readFileSync(path.join(DIST,'index.html'))); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(8804);

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? (pass++, console.log('  PASS', m, x)) : (fail++, console.log('  FAIL', m, x)); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

/** overpass: 'busy' -> always 429, 'hang' -> never answers */
async function session(overpass) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  FAIL pageerror', e.message); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('overpass')) {
      if (overpass === 'busy') return route.fulfill({ status: 429, body: 'slow down' });
      return;                                   // hang: never settle
    }
    if (u.includes('api.mapbox.com/geocoding')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ features: [{ text: 'Lake Nona', place_name: 'Lake Nona, Orlando', center: [-81.25, 28.39] }] }) });
    }
    if (u.startsWith('http://localhost:8804')) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('http://localhost:8804/');
  await page.fill('#token', 'pk.x');
  await page.click('button[type=submit]');
  await page.waitForSelector('.item');
  return { page, ctx };
}

console.log('\n=== Overpass rate-limiting every attempt ===');
{
  const { page, ctx } = await session('busy');
  const started = Date.now();
  await page.click('.item:has-text("Lake Nona")');
  await page.waitForSelector('#plan-name', { timeout: 20000 });
  const took = Date.now() - started;
  ok(took < 15000, 'a busy Overpass does not stall the app', `${(took / 1000).toFixed(1)}s to open`);
  const course = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('b6.courses')).find((c) => c.name.includes('Lake Nona')));
  ok(Array.isArray(course.holes) && course.holes.length === 0,
     'the course opens with no hole data rather than hanging');
  ok(course.lngLat?.length === 2, 'the geocoded location is still saved');
  await ctx.close();
}

console.log('\n=== Overpass never answers ===');
{
  const { page, ctx } = await session('hang');
  await page.click('.item:has-text("Lake Nona")');
  await page.waitForSelector('button:has-text("Open without hole data")', { timeout: 8000 });
  const line = await page.textContent('.banner');
  ok(/Asking .*try 1 of 4/.test(line) || /Looking up the hole layout/.test(line),
     'the banner says what it is waiting on', line.trim());

  const started = Date.now();
  await page.click('button:has-text("Open without hole data")');
  await page.waitForSelector('#plan-name', { timeout: 6000 });
  ok(Date.now() - started < 3000, 'Open without hole data gets you straight in',
     `${Date.now() - started}ms`);
  await ctx.close();
}

console.log('\n=== Cancel ===');
{
  const { page, ctx } = await session('hang');
  await page.click('.item:has-text("Lake Nona")');
  await page.waitForSelector('button:has-text("Cancel")', { timeout: 8000 });
  await page.click('button:has-text("Cancel")');
  await page.waitForTimeout(400);
  ok(await page.locator('.item').count() > 0, 'Cancel returns you to the course list');
  ok(/Cancelled/.test(await page.textContent('.banner')), 'and says so');
  ok(await page.locator('.item:has-text("Lake Nona")').first().isEnabled(),
     'the list is usable again');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
