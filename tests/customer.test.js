// End-to-end test of the customer trial app on a phone viewport.
// Run: npm test   ·   SHOTS=/dir npm test  → saves screenshots.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'th-TH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const shots = process.env.SHOTS;
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
  const next = () => page.click('.footerbar .btn:not(.secondary)');

  await page.goto(base);
  // First launch → consent sheet, research logging opt-in
  await page.waitForSelector('#sheet:not([hidden])');
  await shot('c01-consent');
  await page.check('#researchOk');
  await page.click('[data-action="consent"]');
  assert.ok(await page.isHidden('#sheet'));
  // Internal menus are gone from the customer app
  const tabs = await page.$$eval('.tab', b => b.map(x => x.textContent.trim()));
  assert.deepEqual(tabs, ['หน้าแรก', 'รถของฉัน', 'ตั้งค่า']);
  await shot('c02-home');

  // Step 1: car
  await page.click('[data-action="start"]');
  assert.ok(await page.isDisabled('.footerbar .btn'), 'next disabled until car complete');
  await page.selectOption('[data-car="brand"]', 'Honda');
  await page.selectOption('[data-car="model"]', 'City');
  await page.selectOption('[data-car="year"]', String(new Date().getFullYear() - 4));
  await page.fill('[data-car="mileage"]', '80000');
  assert.equal(await page.inputValue('[data-car="mileage"]'), '80,000');
  await page.click('[data-cond="good"]');
  await shot('c03-car');
  await next();

  // Step 2: loan (estimate payoff from installment)
  await page.click('[data-has="yes"]');
  assert.ok(await page.isDisabled('.footerbar .btn'));
  await page.fill('[data-loan="installment"]', '9500');
  await page.fill('[data-loan="months"]', '30');
  await shot('c04-loan');
  await next();

  // Result
  await page.waitForSelector('.resulthead');
  const res = await page.textContent('#view');
  assert.match(res, /มูลค่าตลาดโดยประมาณ/);
  assert.match(res, /ส่วนต่าง/);
  assert.match(res, /ประมาณจากค่างวด/);
  await shot('c05-result');
  await next();

  // Options
  await page.click('details[data-opt="refinance"] summary');
  assert.match(await page.textContent('details[data-opt="refinance"]'), /เป็นหนี้เพิ่ม/);
  await shot('c06-options');
  await next();

  // Next step + feedback; partner interest shows "no data sent" disclosure
  assert.ok(await page.isDisabled('.footerbar .btn'));
  await page.click('[data-next="refinance"]');
  assert.match(await page.textContent('#view'), /ยังไม่มีการส่งข้อมูลของคุณให้พาร์ทเนอร์/);
  await page.click('[data-rate="useful"][data-v="4"]');
  await page.click('[data-rate="clear"][data-v="5"]');
  await page.click('[data-again="yes"]');
  await page.fill('[data-comment]', 'อยากเห็นราคาจากหลายแหล่ง');
  await shot('c07-next');
  await next();
  assert.match(await page.textContent('#view'), /ขอบคุณ/);

  // Garage + saved result
  await page.click('[data-go="garage"]');
  assert.match(await page.textContent('#view'), /Honda City/);
  await page.click('[data-open]');
  assert.match(await page.textContent('#view'), /มูลค่าตลาดโดยประมาณ/);
  await shot('c08-saved');

  // Settings: research funnel stats
  await page.click('.tab[data-go="settings"]');
  const st = await page.textContent('#view');
  assert.match(st, /เริ่มประเมิน\s*1/);
  assert.match(st, /100% · เป้า ≥60%/);
  assert.match(st, /100% · เป้า ≥30%/);
  await shot('c09-settings');

  // Export contains no free-form PII fields beyond the optional comment, and has events
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.equal(data.synthetic_valuation, true);
  assert.ok(data.events.some(e => e.ev === 'journey_complete' && e.p.nextStep === 'refinance'));
  assert.ok(data.events.some(e => e.ev === 'option_view' && e.p.option === 'refinance'));

  // Negative equity path, no consent prompt again, persistence
  await page.reload();
  assert.ok(await page.isHidden('#sheet'), 'consent shown only once');
  await page.click('.tab[data-go="home"]');
  await page.click('.hero [data-action="start"]');
  await page.selectOption('[data-car="brand"]', 'BYD');
  await page.selectOption('[data-car="model"]', 'Seal');
  await page.selectOption('[data-car="year"]', String(new Date().getFullYear() - 2));
  await page.fill('[data-car="mileage"]', '60000');
  await page.click('[data-cond="fair"]');
  await next();
  await page.click('[data-has="yes"]');
  await page.fill('[data-loan="balance"]', '1,200,000');
  await next();
  assert.match(await page.textContent('.equity'), /หาเงินเพิ่ม/);
  await shot('c10-negative');

  // Team tracker still reachable but not in customer navigation
  const team = await page.request.get(base + 'team/');
  assert.equal(team.status(), 200);

  assert.deepEqual(errors, [], 'no console/page errors');
  await browser.close(); server.close();
  console.log('✓ customer app test passed');
})().catch(e => { console.error('✗', e); server.close(); process.exit(1); });
