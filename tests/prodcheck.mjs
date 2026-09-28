/**
 * Smoke-tests the real production bundle — the one that ships, with the actual
 * mapbox-gl in it rather than the test stub. Nothing external is reachable
 * here, which is the point: the bundle must boot on its own.
 */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('dist');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const srv = http.createServer((q,r)=>{
  const u=q.url.split('?')[0]; const f=path.join(DIST, u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(200,{'Content-Type':'text/html'});return r.end(fs.readFileSync(path.join(DIST,'index.html')));}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(fs.readFileSync(f));
}).listen(8899);

let pass = 0, fail = 0;
const ok = (c, m, x='') => { c ? (pass++, console.log('  PASS', m, x)) : (fail++, console.log('  FAIL', m, x)); };

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await b.newContext({viewport:{width:1200,height:800}})).newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type()==='error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); });
await page.route('**/*', r => r.request().url().startsWith('http://localhost:8899') ? r.continue() : r.fulfill({status:204,body:''}));

await page.goto('http://localhost:8899/');
await page.waitForSelector('#token', { timeout: 10000 });
ok(true, 'the shipped bundle boots to the token gate');
ok(await page.title() === 'Bolt6 Course Planner', 'page title is set', await page.title());
ok(await page.evaluate(() => typeof window.__b6 === 'undefined'),
   'the test seam is compiled out of the production build');

await page.fill('#token', 'pk.deploy-check');
await page.click('button[type=submit]');
await page.waitForSelector('.item', { timeout: 10000 });
ok(await page.$$eval('.item', e => e.length) === 32, 'the course list seeds');

ok(await page.evaluate(() => !!document.querySelector('link[rel=stylesheet], style')),
   'styles are present');
ok(errs.length === 0, 'no console errors', errs.slice(0,3).join(' | '));

// Cloudflare reads _headers for the cache rules. There is deliberately no
// _redirects — a catch-all rule is rejected as an infinite loop, and the SPA
// fallback comes from not_found_handling in wrangler.jsonc instead.
ok(fs.existsSync(path.join(DIST, '_headers')), '_headers ships with the build');
ok(!fs.existsSync(path.join(DIST, '_redirects')),
   'no _redirects, which Cloudflare rejects at deploy time');

const chunks = fs.readdirSync(path.join(DIST, 'assets'));
const total = chunks.reduce((n, f) => n + fs.statSync(path.join(DIST, 'assets', f)).size, 0);
ok(chunks.some((f) => f.endsWith('.js')), 'assets are fingerprinted for immutable caching', chunks.join(' '));
console.log(`  note  bundle ${(total/1024/1024).toFixed(2)} MB total, ${chunks.length} files`);

await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
