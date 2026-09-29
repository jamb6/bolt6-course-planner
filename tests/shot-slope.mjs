/**
 * Screenshots of the slope shading, desktop and phone.
 *
 * The bottom of the planner is already crowded — build tools, hole strip — and
 * every layout bug in this app so far has been one overlay covering another.
 * This exists to be looked at.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist-test');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(DIST, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
}).listen(8807);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const [label, viewport] of [
  ['desktop', { width: 1400, height: 950 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route('**/*', (r) =>
    r.request().url().startsWith('http://localhost:8807') ? r.continue() : r.fulfill({ status: 204, body: '' }));

  await page.goto('http://localhost:8807/');
  await page.fill('#token', 'pk.test');
  await page.click('button[type=submit]');
  await page.waitForSelector('.item');
  await page.fill('#course-search', 'Pelican');
  await page.waitForSelector('.item-row');

  await page.locator('.item-row button:has-text("Elevation")').first().click();
  await page.waitForSelector('[aria-label="Course elevation"]');
  await page.setInputFiles('[aria-label="Course elevation"] input[type=file]',
    path.resolve('tests/fixtures/pelican-synthetic-utm17n.tif'));
  await page.waitForSelector('text=tripod-suitable', { timeout: 30000 });
  await page.screenshot({ path: `tests/shot-slope-upload-${label}.png` });

  await page.locator('[aria-label="Course elevation"] button:has-text("Close")').click();
  await page.locator('.item-row .item').first().click();
  await page.waitForSelector('#plan-name');
  await page.fill('#plan-name', 'Slope');
  await page.click('button:has-text("Create")');
  await page.waitForSelector('.slope-bar');

  await page.locator('.slope-bar button').first().click();
  await page.waitForFunction(() => !!window.__map.getLayer('slope-fill'), null, { timeout: 20000 });
  await page.click('.hole-btn[data-hole="1"]');
  await page.waitForTimeout(200);
  await page.click('.tool-btn:has-text("Camera")');
  await page.evaluate(() => window.__map.fire('click', { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
  await page.waitForSelector('.panel');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `tests/shot-slope-${label}.png` });

  // 3D on, to check the top bar still fits and nothing is pushed off screen.
  await page.click('.top-right button:has-text("3D")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `tests/shot-3d-${label}.png` });
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.top-right');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), right: Math.round(r.right), vw: window.innerWidth,
             scrolls: b.scrollWidth > b.clientWidth + 1 };
  });
  console.log(`  ${label} top bar`, JSON.stringify(bar));
  await ctx.close();
  console.log('shot', label);
}

await browser.close();
server.close();
