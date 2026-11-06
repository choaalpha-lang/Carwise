// End-to-end smoke test on a phone viewport. Run: npm test  (needs Playwright + Chromium available)
// Optional: SHOTS=/some/dir npm test  → saves screenshots of each screen.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const shots = process.env.SHOTS;
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false }); };

  await page.goto(base);
  await page.waitForSelector('#screen-overview .kpi');
  assert.match(await page.textContent('#screen-overview'), /0 \/ 5/);
  assert.equal(await page.textContent('#decisionPill'), 'PENDING');
  await shot('01-overview');

  // Experiments: "done" is blocked without A–C evidence
  await page.click('.tab[data-target="experiments"]');
  await page.click('details[data-exp="E01"] summary');
  await page.selectOption('select[data-change="exp-status"][data-id="E01"]', 'done');
  assert.equal(await page.$eval('select[data-id="E01"][data-change="exp-status"]', s => s.value), 'notstarted', 'done must be blocked without evidence');
  await shot('02-experiments');

  // Add level C evidence via bottom sheet, then "done" is allowed
  await page.click('details[data-exp="E01"] [data-action="add-evidence"]');
  await page.fill('#evTitle', '18 of 30 users completed decision journey');
  await page.selectOption('#evLevel', 'C');
  await page.fill('#evRef', "DOC-E01-001 <b>'x'");
  await shot('03-evidence-sheet');
  await page.click('[data-action="save-evidence"]');
  assert.ok(await page.isHidden('#sheet'));
  await page.click('.tab[data-target="experiments"]');
  await page.click('details[data-exp="E01"] summary');
  await page.selectOption('select[data-change="exp-status"][data-id="E01"]', 'done');
  assert.equal(await page.$eval('select[data-id="E01"][data-change="exp-status"]', s => s.value), 'done');

  // Evidence register escapes HTML and apostrophes correctly
  await page.click('.tab[data-target="evidence"]');
  const reg = await page.textContent('#screen-evidence');
  assert.ok(reg.includes("DOC-E01-001 <b>'x'"), 'reference should render as literal text');
  await shot('04-evidence');

  // Funding: expense over cap on unapproved gate → alerts
  await page.click('.tab[data-target="funding"]');
  await page.click('[data-action="add-expense"]');
  await page.fill('#spendPurpose', '=HYPERLINK("x") research');
  await page.fill('#spendAmount', '350000');
  await page.selectOption('#spendGate', 'G0');
  await page.click('[data-action="save-expense"]');
  assert.match(await page.textContent('#screen-funding'), /฿350,000/);
  await shot('05-funding');

  // Review: critical concern blocks gate approval
  await page.click('.tab[data-target="review"]');
  await page.selectOption('select[data-change="review"][data-id="regulatory"]', 'critical');
  await page.click('.tab[data-target="funding"]');
  await page.selectOption('select[data-change="gate"][data-id="G0"]', 'approved');
  assert.equal(await page.$eval('select[data-change="gate"][data-id="G0"]', s => s.value), 'pending', 'approval must be blocked by critical concern');

  // Decision GO with incomplete review → recorded but flagged
  await page.click('.tab[data-target="review"]');
  await page.click('[data-action="decision"][data-value="GO"]');
  assert.equal(await page.textContent('#decisionPill'), 'GO');
  assert.match(await page.textContent('#screen-review'), /Decision proposed/);
  await shot('06-review');

  await page.click('.tab[data-target="overview"]');
  const ov = await page.textContent('#screen-overview');
  assert.match(ov, /1 \/ 5/);
  assert.match(ov, /exceeds release cap/);
  assert.match(ov, /without receipt/);
  assert.match(ov, /Critical concern/);
  assert.match(ov, /Proposed GO while review is incomplete/);
  await shot('07-overview-alerts');

  // CSV export neutralises formula injection
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportCSV())]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(csv.includes(`"'=HYPERLINK(""x"") research"`), 'CSV formula should be neutralised');

  // Persistence across reload (localStorage)
  await page.reload();
  await page.waitForSelector('#screen-overview .kpi');
  assert.match(await page.textContent('#screen-overview'), /1 \/ 5/);

  // Manifest + service worker
  const mf = await (await page.request.get(base + 'manifest.webmanifest')).json();
  assert.equal(mf.display, 'standalone');
  const swOk = await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active));
  assert.ok(swOk, 'service worker should activate');

  assert.deepEqual(errors, [], 'no console/page errors');
  await browser.close(); server.close();
  console.log('✓ smoke test passed');
})().catch(async e => { console.error('✗', e); server.close(); process.exit(1); });
