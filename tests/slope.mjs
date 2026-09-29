/**
 * Ground slope: projections, slope maths, storage, and the map overlay.
 *
 * The first half runs in plain Node against real GeoTIFFs, because the maths is
 * where a wrong answer would be invisible — shading that looks plausible and
 * puts a mast on a bank. Reference figures come from pyproj and from an
 * independent numpy implementation of the same Horn method; the values below
 * are pinned so a future change has to justify itself.
 *
 * The second half drives the real app in a browser: upload a file, shade the
 * map, read a camera's slope, and check that no elevation means no shading.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { projectorFor } from '../src/lib/proj.js';
import { buildDem, slopeAt, slopeBytes, suitability, cellAt, coversPoint, distanceToCoverageM } from '../src/lib/dem.js';
import { slopeBand } from '../src/map/slopeLayer.js';
import { buildSlopeRows, toCSV } from '../src/lib/exportPlan.js';
import { migrateEntity, migratePlan, migratePlans } from '../src/lib/migrate.js';

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? (pass++, console.log('  PASS', m, x)) : (fail++, console.log('  FAIL', m, x)); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, m, `${a} vs ${b} (tol ${tol})`);

const FIX = path.resolve('tests/fixtures');
const buf = (f) => { const b = fs.readFileSync(path.join(FIX, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

/* ======================================================= 1. projections === */
console.log('\nprojections (reference: pyproj 3.7.2)');

// Each row: epsg, lng, lat, expected easting, expected northing.
for (const [epsg, lng, lat, ex, ey, label] of [
  [32617, -82.7801, 27.9245, 324838.3059, 3090113.4325, 'UTM 17N at Pelican'],
  [32610, -122.41, 37.77, 551962.0197, 4180460.4104, 'UTM 10N at San Francisco'],
  [32755, 151.21, -33.87, 889509.3425, 6244274.1310, 'UTM 55S at Sydney'],
  [26917, -82.7801, 27.9245, 324838.3059, 3090113.4324, 'NAD83 UTM 17N'],
  [27700, -0.1278, 51.5074, 530028.7469, 180380.0943, 'British National Grid at London'],
  [27700, -4.2026, 57.4778, 268025.0819, 845202.2363, 'British National Grid at Inverness'],
  [3857, 100.5018, 13.7563, 11187809.1998, 1546272.2150, 'Web Mercator at Bangkok'],
]) {
  const p = projectorFor(epsg);
  const [x, y] = p.forward([lng, lat]);
  // 5 mm: five times better than the finest DEM anyone will upload.
  near(Math.hypot(x - ex, y - ey), 0, 0.005, `EPSG:${epsg} forward — ${label}`);
  const [bl, ba] = p.inverse([x, y]);
  near(Math.hypot((bl - lng) * 111320 * Math.cos(lat * Math.PI / 180), (ba - lat) * 110574), 0, 0.01,
    `EPSG:${epsg} round trip — ${label}`);
}

ok(projectorFor(5070) === null, 'an unsupported projection is refused rather than guessed (Albers 5070)');
ok(projectorFor(null) === null, 'a file with no projection is refused');
ok(projectorFor(4326).degrees === true, 'EPSG:4326 is flagged as degrees, so cell sizes are measured in metres');
ok(projectorFor(32617).degrees === false, 'a projected grid is not flagged as degrees');

/* ============================================================ 2. slope ==== */
console.log('\nslope maths');

// A grid with an exactly known gradient: 10%, which is atan(0.1) = 5.7106 deg.
const ramp = await buildDem(buf('ramp-10pct-4326.tif'), { fileName: 'ramp.tif' });
{
  const b = slopeBytes(ramp);
  const seen = new Set();
  for (let r = 1; r < ramp.rows - 1; r++) {
    for (let c = 1; c < ramp.cols - 1; c++) {
      const v = b[r * ramp.cols + c];
      if (v !== 255) seen.add(v * 0.25);
    }
  }
  ok(seen.size === 1, 'a constant gradient reads the same everywhere', `values: ${[...seen]}`);
  // Stored to a quarter degree, rounded up: 5.7106 -> 5.75.
  near([...seen][0], 5.75, 0.001, 'a 10% grade reads 5.75 deg (atan(0.1) = 5.7106, rounded up)');
  ok(suitability(ramp, 5).fraction === 0, 'a 10% grade is entirely out at a 5 deg limit');
  ok(suitability(ramp, 6).fraction === 1, 'the same grade is entirely in at 6 deg');
}

// Rounding direction: the stored figure must never read flatter than the ground.
{
  const b = slopeBytes(ramp);
  const stored = b[Math.floor(ramp.rows / 2) * ramp.cols + Math.floor(ramp.cols / 2)] * 0.25;
  ok(stored >= 5.7106, 'quantising rounds up, so a stored slope never understates the ground',
    `${stored} >= 5.7106`);
}

// The realistic surface, both projections. Reference: numpy Horn on the native
// 1 m grid gave max 14.61 deg, mean 1.19, and 97.68% at or under 5 deg.
const utmDem = await buildDem(buf('pelican-synthetic-utm17n.tif'), { fileName: 'pelican-3dep-1m.tif' });
const geoDem = await buildDem(buf('pelican-synthetic-4326.tif'), { fileName: 'pelican-4326.tif' });

for (const [dem, label] of [[utmDem, 'UTM source'], [geoDem, 'EPSG:4326 source']]) {
  const b = slopeBytes(dem);
  let max = 0, sum = 0, n = 0;
  for (const v of b) { if (v === 255) continue; const d = v * 0.25; if (d > max) max = d; sum += d; n++; }
  near(max, 14.61, 0.3, `${label}: steepest ground agrees with the numpy reference`);
  near(sum / n, 1.193, 0.08, `${label}: mean slope agrees with the numpy reference`);
  near(suitability(dem, 5).fraction * 100, 97.68, 0.2, `${label}: share under 5 deg agrees with the reference`);
}

// The two projections describe the same ground, so they must agree with each
// other far more tightly than either agrees with the reference.
near(suitability(utmDem, 5).fraction, suitability(geoDem, 5).fraction, 0.005,
  'the UTM and lon/lat paths reach the same answer for the same ground');

// Raising the limit can only ever include more ground.
{
  let monotone = true, prev = -1;
  for (const lim of [1, 2, 3, 5, 8, 12, 20]) {
    const f = suitability(utmDem, lim).fraction;
    if (f < prev - 1e-9) monotone = false;
    prev = f;
  }
  ok(monotone, 'a higher mast limit never shrinks the suitable area');
}

/* ======================================================== 3. no data ===== */
console.log('\nno data stays no data');

ok(utmDem.coverage > 0.9 && utmDem.coverage < 1,
  'the no-data patch in the fixture is reported as missing coverage', `${utmDem.coverage}`);

// The fixture has a -9999 rectangle. Inside it, slope must be unknown, not zero.
{
  const b = slopeBytes(utmDem);
  let unknown = 0;
  for (const v of b) if (v === 255) unknown++;
  ok(unknown > 0, 'cells with no reading are stored as no data, never as flat', `${unknown} cells`);

  // The gap must not invent a cliff at its own edge. The elevation fixture drops
  // from real ground to nothing in one step, so if a gap were treated as a
  // height the border cells would read as near-vertical. Instead every cell
  // whose 3x3 window touches the gap has no reading at all — which is what the
  // maximum slope agreeing with the reference already showed, and this pins the
  // mechanism: the steepest cell anywhere near the gap is an ordinary slope.
  let worstNearGap = 0;
  for (let r = 1; r < utmDem.rows - 1; r++) {
    for (let c = 1; c < utmDem.cols - 1; c++) {
      const v = b[r * utmDem.cols + c];
      if (v === 255) continue;
      const touchesGap = [
        b[(r - 1) * utmDem.cols + c], b[(r + 1) * utmDem.cols + c],
        b[r * utmDem.cols + c - 1], b[r * utmDem.cols + c + 1],
      ].includes(255);
      if (touchesGap) worstNearGap = Math.max(worstNearGap, v * 0.25);
    }
  }
  ok(worstNearGap < 20,
    'a gap does not become a cliff — the cells beside it read as ordinary ground',
    `steepest cell bordering a gap: ${worstNearGap} deg`);
}

ok(slopeAt(utmDem, [0, 0]) === null, 'slope outside the file is null, not zero');
ok(cellAt(utmDem, [0, 0]) === null, 'a point outside the grid has no cell');
ok(coversPoint(utmDem, [-82.8175, 27.9345]), 'the fixture covers the venue it was made for');
ok(!coversPoint(utmDem, [-82.9, 27.9345]), 'a point west of the file is not covered');
near(distanceToCoverageM(utmDem, [-82.8175, 27.9345]), 0, 1, 'distance to coverage is zero inside the file');
ok(distanceToCoverageM(utmDem, [-83.2, 27.9345]) > 30000,
  'a file for the wrong venue reports a large distance, so the warning can fire');

/* ======================================================== 4. bands ======= */
console.log('\nbands and the tuneable limit');

ok(slopeBand(null, 5) === null, 'an unknown slope has no band — it is not shaded');
ok(slopeBand(0.5, 5) === 'flat', '0.5 deg is fine at a 5 deg limit');
ok(slopeBand(3.9, 5) === 'flat', '3.9 deg is fine');
ok(slopeBand(4.5, 5) === 'near', '4.5 deg is within a degree of the limit');
ok(slopeBand(5.0, 5) === 'near', 'exactly at the limit reads as marginal, not comfortable');
ok(slopeBand(5.1, 5) === 'steep', 'just over the limit is too steep');
ok(slopeBand(5.1, 8) === 'flat', 'the same ground is fine once the limit is raised to 8 deg');
ok(slopeBand(12, 8) === 'steep', 'and still too steep at 12 deg');

/* ======================================================== 5. sizes ======= */
console.log('\nstored size');

ok(utmDem.cols * utmDem.rows <= 1440000,
  'the stored grid stays inside the cell budget', `${utmDem.cols}x${utmDem.rows}`);
ok(utmDem.slope.length < 2.5 * 1024 * 1024,
  'the encoded grid is small enough to carry in a row', `${Math.round(utmDem.slope.length / 1024)} kB`);
near(utmDem.cellM, 1.0, 0.1, 'cell size is derived from the area, not hard coded');
ok(utmDem.sourceM <= utmDem.cellM + 0.01,
  'the grid is never finer than the source it came from', `${utmDem.sourceM} -> ${utmDem.cellM}`);
ok(utmDem.sourceCrs === 'UTM zone 17N', 'the source projection is recorded for the audit trail');
ok(JSON.parse(JSON.stringify(utmDem)).slope === utmDem.slope,
  'the record survives a JSON round trip, so both storage drivers can hold it');
ok(!('_bytes' in JSON.parse(JSON.stringify(utmDem))),
  'the decoded cache is not serialised into storage');

/* ============================================ 5a. a whole survey tile ==== */
console.log('\na 4 km survey tile, cropped to the course');

// This is the shape a real USGS 3DEP download takes: kilometres of ground at
// 1 m, most of it nowhere near the course. Three things have to hold — it must
// not read the whole raster into memory, it must crop to the course rather than
// spending the cell budget on the county, and the wrong tile must be refused.
{
  const PELICAN = [-82.8175, 27.9345];
  const t0 = Date.now();
  const big = await buildDem(buf('tile-4km-utm17n.tif'), { fileName: 'USGS_1M_17.tif', centre: PELICAN });
  const ms = Date.now() - t0;

  ok(big.windowPixels < big.sourcePixels * 0.6,
     'only the part of the tile around the course is read',
     `${(big.windowPixels / 1e6).toFixed(1)}M of ${(big.sourcePixels / 1e6).toFixed(1)}M px`);
  ok(big.windowPixels <= 3000 * 3000,
     'and never more than the read cap, whatever the file weighs',
     `${(big.windowPixels / 1e6).toFixed(1)}M px`);
  ok(big.cellM < 3.5,
     'cropping buys metre-scale cells instead of spreading the budget over the whole tile',
     `${big.cellM} m cells`);
  ok(big.sourceM < 1.5, 'and the source is still reported at its true resolution', `${big.sourceM} m`);
  ok(ms < 20000, 'a survey tile finishes in reasonable time', `${ms} ms`);

  // The crop is centred on the course, so the course must be well inside it.
  ok(coversPoint(big, PELICAN), 'the cropped grid covers the course');
  ok(slopeAt(big, PELICAN) != null, 'and has a real reading at the course centre');

  // The cap is what protects a sub-metre source, where the crop alone would
  // still be 6000 px across. Reading the whole tile exercises the same path:
  // 4096 px of source has to come back decimated, not whole.
  const whole = await buildDem(buf('tile-4km-utm17n.tif'), { fileName: 'whole.tif' });
  ok(whole.windowPixels <= 3000 * 3000 && whole.windowPixels < whole.sourcePixels,
     'a read wider than the cap is decimated rather than pulled in whole',
     `${(whole.windowPixels / 1e6).toFixed(1)}M of ${(whole.sourcePixels / 1e6).toFixed(1)}M px`);
  ok(whole.sourceM > big.sourceM,
     'and that decimation is reported honestly as a coarser source',
     `whole tile ${whole.sourceM} m vs cropped ${big.sourceM} m`);

  // Same tile, a course 40 km away: refused with something actionable.
  let refused = null;
  try { await buildDem(buf('tile-4km-utm17n.tif'), { centre: [-83.3, 27.9345] }); }
  catch (err) { refused = err.message; }
  ok(refused != null, 'a tile that misses the course is refused rather than shaded');
  ok(/wrong tile/i.test(refused ?? ''), 'and the message says what is probably wrong', refused);
}

/* ================================================ 5b. the rename ========= */
console.log('\nplans saved before the mast rename');

// Plans are stored as documents, so renaming the mount type in the code does
// not rename what is already in the database. Anything stored as a tripod has
// to keep working, or a season of plans silently loses its masts.
{
  const old = { id: 'x', kind: 'camera', camType: 'tripod', hole: 1, position: 1, number: 4 };
  ok(migrateEntity(old).camType === 'mast', 'a camera stored as a tripod reads back as a mast');
  ok(migrateEntity({ ...old, camType: 'tower' }).camType === 'tower', 'other mount types are untouched');
  ok(migrateEntity({ id: 'c', kind: 'cable', coords: [] }).kind === 'cable', 'non-cameras pass straight through');

  const plan = migratePlan({ id: 'p', entities: [old, { id: 'y', kind: 'camera', camType: 'led' }] });
  ok(plan.entities[0].camType === 'mast' && plan.entities[1].camType === 'led',
     'a whole plan migrates, leaving everything else alone');
  ok(migratePlans([]).length === 0, 'an empty workspace migrates to nothing');

  // The export is what the crew carries, so an old plan must count correctly.
  const rows = buildSlopeRows(plan.entities.map((e) => ({ ...e, coords: [-82.8175, 27.9345] })), utmDem, 5);
  ok(rows.flagged.length + rows.fine === 1,
     'and an old plan\u2019s masts are counted on the rigging sheet, not dropped');
}

/* ======================================================== 6. export ====== */
console.log('\nrigging export');

const cams = [
  { id: 'a', kind: 'camera', label: 'CAM 1', hole: 1, position: 1, number: 1, camType: 'mast', coords: [-82.8175, 27.9345] },
  { id: 'b', kind: 'camera', label: 'CAM 2', hole: 1, position: 2, number: 2, camType: 'tower',  coords: [-82.8175, 27.9345] },
  { id: 'c', kind: 'camera', label: 'CAM 3', hole: 2, position: 1, number: 3, camType: 'mast', coords: [0, 0] },
];
{
  const rows = buildSlopeRows(cams, utmDem, 5);
  ok(rows !== null, 'with elevation loaded the export gets a slope section');
  ok(!rows.flagged.some((f) => f.entity.id === 'b'),
    'a tower is left out — the ground has no say over a mounting that levels itself');
  const outside = rows.flagged.find((f) => f.entity.id === 'c');
  ok(outside && outside.verdict === 'Outside the elevation file',
    'a camera outside the file is flagged as unmeasured, not as suitable');
  ok(rows.flagged.length + rows.fine === 2, 'every mast is either flagged or counted as fine');

  ok(buildSlopeRows(cams, null, 5) === null, 'with no elevation there is no slope section to build');

  const plan = { name: 'P', owner: 'J' }, course = { name: 'Pelican' };
  const withDem = toCSV(plan, course, cams, null, utmDem, 5);
  ok(withDem.includes('GROUND SLOPE'), 'the CSV carries a ground slope section');
  ok(withDem.includes('mast limit 5 deg'), 'the CSV records which limit it was checked against');
  ok(withDem.includes('pelican-3dep-1m.tif'), 'the CSV names the file the slope came from');

  const without = toCSV(plan, course, cams, null, null, 5);
  ok(without.includes('not checked'),
    'with no elevation the CSV says so, rather than leaving a silence that reads as all clear');
}

/* ======================================================== 7. in the app == */
console.log('\nin the browser');

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
}).listen(8806);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fail++; console.log('  FAIL pageerror', e.message); });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('http://localhost:8806')) return route.continue();
  return route.fulfill({ status: 204, body: '' });     // no network in the suite
});

await page.goto('http://localhost:8806/');
await page.fill('#token', 'pk.test');
await page.click('button[type=submit]');
await page.waitForSelector('.item');

// Open a located course. Pelican is seeded with coordinates.
await page.fill('#course-search', 'Pelican');
await page.waitForSelector('.item');

ok(!(await page.locator('.item button:has-text("Elevation")').count()),
  'the course list no longer carries an Elevation button');

// Into the course, then make a plan. Elevation lives on the plan row now.
await page.locator('.item').first().click();
await page.waitForSelector('#plan-name', { timeout: 20000 });
await page.fill('#plan-name', 'Slope test');
await page.click('button:has-text("Create")');
await page.waitForSelector('.slope-bar', { timeout: 20000 });

// Back out to the course list, then into the course again — that is the plan
// list, where Elevation now lives.
await page.click('.top-right button:has-text("Menu")');
await page.click('button:has-text("Load a different course or plan")');
await page.waitForSelector('#course-search', { timeout: 20000 });
await page.fill('#course-search', 'Pelican');
await page.locator('.item').first().click();
await page.waitForSelector('.item button:has-text("Open")', { timeout: 20000 });
ok(await page.locator('.item button:has-text("Elevation")').first().isVisible(),
  'a plan row carries the Elevation button');

await page.locator('.item button:has-text("Elevation")').first().click();
await page.waitForSelector('[aria-label="Course elevation"]');
ok(await page.locator('text=Applies to every plan on this course').first().isVisible(),
  'and says the file is shared by every plan on the course, not owned by one');
ok(await page.locator('[aria-label="Course elevation"] button:has-text("Upload GeoTIFF")').isVisible(),
  'with nothing uploaded the button offers an upload');
ok(/mast floor limit/i.test(await page.locator('[aria-label="Course elevation"]').innerText()),
  'the slider is labelled Mast floor limit');

// Upload the real GeoTIFF through the real file input.
await page.setInputFiles('[aria-label="Course elevation"] input[type=file]',
  path.join(FIX, 'pelican-synthetic-utm17n.tif'));
await page.waitForSelector('text=mast-suitable', { timeout: 30000 });
const summary = await page.locator('[aria-label="Course elevation"] .banner').first().innerText();
ok(/\d+% covered/.test(summary), 'the summary reports coverage', summary.split('\n').join(' | '));
ok(/\d+% mast-suitable/.test(summary), 'and how much of it a mast can stand on');

// Move the limit and watch the figure change.
const before = Number(summary.match(/(\d+)%\s*mast-suitable/)?.[1] ?? -1);
await page.locator('#dem-limit').fill('2');
await page.waitForFunction((b) => {
  const m = document.querySelector('[aria-label="Course elevation"] .banner')?.textContent?.match(/(\d+)%\s*mast-suitable/);
  return m && Number(m[1]) !== b;
}, before, { timeout: 10000 });
const after = Number((await page.locator('[aria-label="Course elevation"] .banner').first().innerText())
  .match(/(\d+)%\s*mast-suitable/)?.[1] ?? -1);
ok(after < before, 'tightening the limit reduces the suitable area', `${before}% -> ${after}%`);
await page.locator('#dem-limit').fill('5');

await page.locator('[aria-label="Course elevation"] button:has-text("Close")').click();

// Open the plan we made.
await page.locator('.item button:has-text("Open")').first().click();
await page.waitForSelector('.slope-bar', { timeout: 20000 });

ok(await page.locator('.slope-bar button:has-text("Slope")').isEnabled(),
  'the planner offers slope shading once the course has elevation');
ok(!(await page.evaluate(() => !!window.__map.getLayer('slope-fill'))),
  'no overlay is on the map until it is asked for');

await page.locator('.slope-bar button').first().click();
await page.waitForFunction(() => !!window.__map.getLayer('slope-fill'), null, { timeout: 20000 });

const layer = await page.evaluate(() => {
  const m = window.__map;
  const s = m.getSource('slope');
  return {
    type: m.getLayer('slope-fill').type,
    before: m.getLayer('slope-fill').before,
    sourceType: s.type,
    corners: s.coordinates,
    isPng: (s.url || '').startsWith('data:image/png'),
    opacity: m.getLayer('slope-fill').paint['raster-opacity'],
  };
});
ok(layer.type === 'raster' && layer.sourceType === 'image', 'the overlay is one image, not a quarter million features');
ok(layer.isPng, 'the overlay image is generated in the browser');
ok(layer.before === 'hole-line', 'the shading sits under the holes, cables and cameras');
ok(layer.opacity === 1, 'the layer stays opaque so the image keeps its own transparency for no-data cells');
ok(layer.corners.length === 4 && Math.abs(layer.corners[0][0] - (-82.8221)) < 0.02,
  'the image is pinned to the elevation file\'s own bounds', JSON.stringify(layer.corners[0]));

// Moving the limit must repaint, because the limit decides the colours.
const updates0 = await page.evaluate(() => window.__map.getSource('slope').updates);
await page.locator('#slope-limit').fill('12');
await page.waitForFunction((n) => window.__map.getSource('slope').updates > n, updates0, { timeout: 10000 });
ok(true, 'changing the mast limit repaints the shading');

// A mast on the map reports its ground slope; a tower does not.
await page.locator('#slope-limit').fill('5');
await page.click('.hole-btn[data-hole="1"]');
await page.waitForTimeout(150);
await page.click('.tool-btn:has-text("Camera")');
// Centre of the viewport, which the mock projects to the course centre — well
// inside the elevation file, so the reading must be a real one.
await page.evaluate(() => window.__map.fire('click', { x: 700, y: 475 }));
await page.waitForSelector('.panel', { timeout: 10000 });

const camPanel = await page.locator('.panel').innerText();
ok(/ground slope/i.test(camPanel), 'a mast camera shows the ground slope under it',
  camPanel.split('\n').filter((l) => /°|level|steep/i.test(l)).join(' | '));

await page.selectOption('#cam-type', 'tower');
await page.waitForFunction(() => !/ground slope/i.test(document.querySelector('.panel')?.textContent ?? ''),
  null, { timeout: 5000 }).then(() => ok(true, 'switching to a tower drops the slope readout — it levels itself'))
  .catch(() => ok(false, 'switching to a tower should drop the slope readout'));

/* ---- 3D view: context only, and it must say so --------------------------- */
await page.selectOption('#cam-type', 'mast');
ok(await page.evaluate(() => window.__map.getTerrain() == null), 'the map starts flat');

await page.click('.top-right button:has-text("3D")');
await page.waitForFunction(() => window.__map.getTerrain() != null, null, { timeout: 10000 });
const terrain = await page.evaluate(() => ({
  t: window.__map.getTerrain(),
  demType: window.__map.getSource('mapbox-dem')?.opts?.type,
  sky: !!window.__map.getLayer('sky'),
  pitch: window.__map.getPitch(),
}));
ok(terrain.demType === 'raster-dem', 'terrain comes from a raster-dem source');
ok(terrain.t.source === 'mapbox-dem', 'and from Mapbox\u2019s own elevation tileset, on the token already in use');
ok(terrain.t.exaggeration > 1, 'relief is exaggerated so a gently rolling course reads at all',
  `x${terrain.t.exaggeration}`);
ok(terrain.sky, 'a sky is added, so the horizon is not grey once the camera tilts');
ok(terrain.pitch === 60, 'the camera tilts', `pitch ${terrain.pitch}`);

// The two elevation sources can disagree, and the planner has to say which one
// is the measured one. This is the whole reason the 3D view is safe to ship.
const bar = await page.locator('.slope-bar').innerText();
ok(/shading is measured/i.test(bar),
  'with both on, the bar says the shading is measured and the relief is not', bar.replace(/\n/g, ' | '));
ok(await page.locator('.toast').innerText().then((t) => /context only/.test(t)).catch(() => false),
  'and turning 3D on says so once, in plain words');

// A stray click near the horizon must not drop a camera kilometres away. The
// tilted view makes the far half of the screen a long way off, so this is a
// real click a real planner can make, not a contrived one.
{
  const before = await page.evaluate(() => window.__b6.store.getState().plan.entities.length);
  // Arm the camera explicitly. Clicking the toolbar button would toggle it,
  // and it is still armed from the placement further up.
  await page.evaluate(() => window.__b6.store.getState().setTool('camera'));
  // Eight kilometres north of the course: roughly where the horizon sits at a
  // 60 degree pitch, and well past anything that could be part of the venue.
  await page.evaluate(() => {
    const c = window.__b6.store.getState().course.lngLat;
    window.__map.fire('click', { lng: c[0], lat: c[1] + 0.072 });
  });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__b6.store.getState().plan.entities.length) === before,
     'a click that lands off the course is refused, not placed miles away');
  ok(await page.locator('.toast').innerText().then((t) => /off the course/i.test(t)).catch(() => false),
     'and says why');

  // The same click just inside the limit still places normally, so the guard
  // is not quietly swallowing ordinary work at the edge of a course.
  await page.evaluate(() => {
    const s = window.__b6.store.getState();
    s.setTool('camera');
    const c = s.course.lngLat;
    window.__map.fire('click', { lng: c[0], lat: c[1] + 0.004 });
  });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__b6.store.getState().plan.entities.length) === before + 1,
     'a click 440 m out still places, so the guard is not over-eager');

  await page.evaluate(() => {
    const s = window.__b6.store.getState();
    s.select(s.plan.entities.find((e) => e.kind === 'camera').id);
  });
  await page.waitForSelector('#cam-type');
}

await page.click('.top-right button:has-text("3D")');
await page.waitForFunction(() => window.__map.getTerrain() == null, null, { timeout: 10000 });
ok(!(await page.evaluate(() => !!window.__map.getLayer('sky'))), 'turning 3D off removes the sky');
ok(await page.evaluate(() => window.__map.getPitch()) === 0, 'and flattens the camera back for planning');
ok(await page.evaluate(() => !!window.__map.getSource('mapbox-dem')),
  'the elevation source is kept, so toggling back does not refetch tiles');

// And with the elevation removed, the map must go back to showing nothing.
await page.selectOption('#cam-type', 'mast');
await page.evaluate(async () => {
  const s = window.__b6.store.getState();
  s.setDem(null);
});
await page.waitForFunction(() => !window.__map.getLayer('slope-fill'), null, { timeout: 10000 })
  .then(() => ok(true, 'removing the elevation takes the shading off the map'))
  .catch(() => ok(false, 'removing the elevation should take the shading off the map'));

const gone = await page.locator('.panel').innerText();
ok(/No elevation for this course/i.test(gone),
  'and the camera panel says the ground is unknown rather than showing a stale figure');

await browser.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
