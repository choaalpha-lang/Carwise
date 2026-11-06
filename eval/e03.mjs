#!/usr/bin/env node
// E03 — Data & Decision Accuracy: measure the AI price check (and the synthetic baseline) against
// reference prices. Pre-registered protocol, resumable, cost-aware.
//
//   node eval/e03.mjs --ref eval/reference.csv                 # dry run: validates inputs, no API calls
//   ANTHROPIC_API_KEY=... node eval/e03.mjs --ref eval/reference.csv --live --confirm
//   node eval/e03.mjs --ref eval/reference.csv --report-only   # rebuild report from saved results
//
// Options: --protocol <file> (default eval/e03-protocol.json) · --out <dir> (default eval/runs/<protocol-id>)
//          --max-cars N · --concurrency N (default 1) · --draft (allow an unapproved protocol, marks report DRAFT)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { estimate } from '../src/ai.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { CATALOG, valuate } = createRequire(import.meta.url)('../www/valuation.js');

// ---------- CLI ----------
export function parseArgs(argv) {
  const a = { protocol: path.join(here, 'e03-protocol.json'), concurrency: 1, live: false, confirm: false, draft: false, reportOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--ref') a.ref = v(); else if (k === '--protocol') a.protocol = v(); else if (k === '--out') a.out = v();
    else if (k === '--max-cars') a.maxCars = Number(v()); else if (k === '--concurrency') a.concurrency = Math.max(1, Number(v()) || 1);
    else if (k === '--live') a.live = true; else if (k === '--confirm') a.confirm = true; else if (k === '--draft') a.draft = true;
    else if (k === '--report-only') a.reportOnly = true; else throw new Error(`Unknown option ${k}`);
  }
  if (!a.ref) throw new Error('--ref <reference.csv> is required');
  return a;
}

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const lines = rows.filter(r => r.some(x => x.trim() !== '') && !String(r[0]).startsWith('#'));
  const head = lines.shift().map(h => h.trim());
  return lines.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const REF_TYPES = ['transaction', 'appraisal', 'listing'];
const CONDS = ['excellent', 'good', 'fair', 'repair'];
export function validateRef(rows) {
  const errors = [], ids = new Set();
  const cars = rows.map((r, i) => {
    const line = i + 2, e = m => errors.push(`row ${line} (${r.id || '?'}): ${m}`);
    if (!r.id) e('missing id'); else if (ids.has(r.id)) e('duplicate id'); ids.add(r.id);
    const car = { id: r.id, brand: r.brand, model: r.model, year: Number(r.year), mileage: Number(String(r.mileage_km).replace(/,/g, '')), condition: r.condition,
      truth: Number(String(r.reference_price_thb).replace(/,/g, '')), refType: r.reference_type, refSource: r.reference_source, asOf: r.as_of_date };
    if (!car.brand || !car.model) e('brand/model required');
    if (!Number.isInteger(car.year) || car.year < 1990 || car.year > new Date().getFullYear()) e('invalid year');
    if (!Number.isFinite(car.mileage) || car.mileage < 0) e('invalid mileage_km');
    if (!CONDS.includes(car.condition)) e(`condition must be one of ${CONDS.join('/')}`);
    if (!Number.isFinite(car.truth) || car.truth <= 0) e('invalid reference_price_thb');
    if (!REF_TYPES.includes(car.refType)) e(`reference_type must be one of ${REF_TYPES.join('/')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(car.asOf || '')) e('as_of_date must be YYYY-MM-DD');
    return car;
  });
  return { cars, errors };
}

// ---------- Metrics ----------
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const k = (s.length - 1) * p, f = Math.floor(k); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f); };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function scoreRange(low, high, truth) {
  const mid = (low + high) / 2;
  return { ape: Math.abs(mid - truth) / truth, err: (mid - truth) / truth, covered: low <= truth && truth <= high, width: (high - low) / truth };
}
function stats(scored) {
  const ok = scored.filter(Boolean);
  return { n: ok.length, mape: mean(ok.map(s => s.ape)), median_ape: pct(ok.map(s => s.ape), 0.5), p90_ape: pct(ok.map(s => s.ape), 0.9),
    bias: mean(ok.map(s => s.err)), coverage: mean(ok.map(s => s.covered ? 1 : 0)), mean_width: mean(ok.map(s => s.width)) };
}
const ageBand = (year, now) => { const a = now - year; return a <= 3 ? '0-3y' : a <= 7 ? '4-7y' : a <= 12 ? '8-12y' : '13y+'; };

export function evaluate(cars, results, protocol, now = new Date().getFullYear()) {
  const byId = new Map(results.map(r => [r.id, r]));
  const rows = cars.map(car => {
    const r = byId.get(car.id) || null;
    const aiValid = !!(r && r.ok && Number.isInteger(r.low_thb) && Number.isInteger(r.high_thb) && r.low_thb > 0 && r.low_thb <= r.high_thb && Array.isArray(r.sources) && r.sources.some(s => /^https?:\/\//.test(s.url)));
    const inCatalog = (CATALOG[car.brand] || []).some(m => m[0] === car.model);
    const base = inCatalog ? valuate(car, { has: 'no' }, now) : null;
    return { car, r, aiValid, ai: aiValid ? scoreRange(r.low_thb, r.high_thb, car.truth) : null, base: base ? scoreRange(base.low, base.high, car.truth) : null,
      seg: { ref: car.refType, age: ageBand(car.year, now), confidence: aiValid ? r.confidence : 'invalid' } };
  });
  const attempted = rows.filter(x => x.r);
  const segment = key => Object.fromEntries([...new Set(rows.map(x => x.seg[key]))].sort().map(v => [v, stats(rows.filter(x => x.seg[key] === v).map(x => x.ai))]));
  const ai = stats(rows.map(x => x.ai));
  const invalid = attempted.filter(x => !x.aiValid).length;
  const summary = {
    n_reference: cars.length, n_attempted: attempted.length, n_valid: attempted.length - invalid, invalid_rate: attempted.length ? invalid / attempted.length : null,
    ai, baseline_synthetic: stats(rows.map(x => x.base)), baseline_on_same_cars: stats(rows.filter(x => x.ai && x.base).map(x => x.base)),
    ai_on_same_cars: stats(rows.filter(x => x.ai && x.base).map(x => x.ai)),
    by_reference_type: segment('ref'), by_age: segment('age'), calibration_by_confidence: segment('confidence'),
    exceptions: attempted.filter(x => !x.aiValid).map(x => ({ id: x.car.id, error: x.r.error || 'invalid output' })),
    worst: rows.filter(x => x.ai).sort((a, b) => b.ai.ape - a.ai.ape).slice(0, 10).map(x => ({ id: x.car.id, car: `${x.car.brand} ${x.car.model} ${x.car.year}`, truth: x.car.truth, low: x.r.low_thb, high: x.r.high_thb, ape: x.ai.ape }))
  };
  // Cost
  const u = attempted.reduce((a, x) => { const k = x.r.usage || {}; for (const f of ['input_tokens', 'output_tokens', 'web_search_requests', 'requests']) a[f] += k[f] || 0; return a; }, { input_tokens: 0, output_tokens: 0, web_search_requests: 0, requests: 0 });
  const pr = protocol.pricing || {};
  const tokenCost = pr.input_per_mtok != null && pr.output_per_mtok != null ? u.input_tokens / 1e6 * pr.input_per_mtok + u.output_tokens / 1e6 * pr.output_per_mtok : null;
  const searchCost = pr.web_search_per_1k != null ? u.web_search_requests / 1000 * pr.web_search_per_1k : null;
  summary.usage = { ...u, est_cost_usd: tokenCost != null && searchCost != null ? tokenCost + searchCost : null, est_token_cost_usd: tokenCost };
  // Verdict against pre-registered thresholds
  const t = protocol.thresholds, checks = [];
  const chk = (name, val, op, lim) => checks.push({ name, value: val, limit: lim, op, pass: val == null ? false : op === '<=' ? val <= lim : val >= lim });
  if (t.min_cars != null) chk('valid cars evaluated', summary.n_valid, '>=', t.min_cars);
  if (t.max_invalid_rate != null) chk('invalid / failed outputs', summary.invalid_rate, '<=', t.max_invalid_rate);
  if (t.max_mape != null) chk('MAPE', ai.mape, '<=', t.max_mape);
  if (t.max_p90_ape != null) chk('P90 absolute % error', ai.p90_ape, '<=', t.max_p90_ape);
  if (t.max_abs_bias != null) chk('|bias|', ai.bias == null ? null : Math.abs(ai.bias), '<=', t.max_abs_bias);
  if (t.min_coverage != null) chk('range coverage', ai.coverage, '>=', t.min_coverage);
  if (t.max_mean_width != null) chk('mean range width', ai.mean_width, '<=', t.max_mean_width);
  summary.checks = checks;
  summary.verdict = checks.length && checks.every(c => c.pass) ? 'PASS' : 'FAIL';
  return { summary, rows };
}

// ---------- Report ----------
const P = x => x == null ? 'n/a' : (x * 100).toFixed(1) + '%';
const B = x => x == null ? 'n/a' : '฿' + Math.round(x).toLocaleString('en-US');
export function renderReport({ summary: s }, meta) {
  const line = (name, st) => `| ${name} | ${st.n} | ${P(st.mape)} | ${P(st.median_ape)} | ${P(st.p90_ape)} | ${P(st.bias)} | ${P(st.coverage)} | ${P(st.mean_width)} |`;
  const head = '| Group | n | MAPE | Median APE | P90 APE | Bias | Coverage | Mean width |\n|---|---|---|---|---|---|---|---|';
  const seg = obj => Object.entries(obj).map(([k, v]) => line(k, v)).join('\n');
  return `# E03 — AI price check accuracy report${meta.draft ? ' (DRAFT — protocol not approved)' : ''}

| Item | Value |
|---|---|
| Verdict | **${s.verdict}**${meta.draft ? ' (not valid as evidence: draft protocol)' : ''} |
| Protocol | ${meta.protocolId} · sha256 \`${meta.protocolHash.slice(0, 16)}…\` · approved by ${meta.approvedBy || '—'} on ${meta.approvedOn || '—'} |
| Reference set | ${meta.refFile} · sha256 \`${meta.refHash.slice(0, 16)}…\` · ${s.n_reference} cars |
| Model / run | ${meta.model} · generated ${meta.generatedAt} |
| Attempted / valid | ${s.n_attempted} / ${s.n_valid} (invalid ${P(s.invalid_rate)}) |
| Usage | ${s.usage.requests} requests · ${s.usage.input_tokens.toLocaleString()} in / ${s.usage.output_tokens.toLocaleString()} out tokens · ${s.usage.web_search_requests} web searches |
| Est. cost | ${s.usage.est_cost_usd != null ? '$' + s.usage.est_cost_usd.toFixed(2) : `UNKNOWN (tokens ≈ ${s.usage.est_token_cost_usd != null ? '$' + s.usage.est_token_cost_usd.toFixed(2) : 'n/a'}; set pricing.web_search_per_1k)`} |

## Pre-registered thresholds
| Check | Value | Limit | Result |
|---|---|---|---|
${s.checks.map(c => `| ${c.name} | ${c.name.includes('cars') ? c.value : P(c.value)} | ${c.op} ${c.name.includes('cars') ? c.limit : P(c.limit)} | ${c.pass ? '✅ pass' : '❌ fail'} |`).join('\n')}

## Accuracy
${head}
${line('AI (all valid)', s.ai)}
${line('AI — cars also in synthetic catalogue', s.ai_on_same_cars)}
${line('Synthetic baseline — same cars', s.baseline_on_same_cars)}
${line('Synthetic baseline — all catalogue cars', s.baseline_synthetic)}

APE = |range midpoint − reference| / reference · Bias = mean signed error (+ = over-estimate) · Coverage = share of references inside the range · Width = (high − low) / reference.

### By reference type
${head}
${seg(s.by_reference_type)}

### By vehicle age
${head}
${seg(s.by_age)}

### Calibration: does stated confidence match accuracy?
${head}
${seg(s.calibration_by_confidence)}

## Largest errors
| id | Car | Reference | AI range | APE |
|---|---|---|---|---|
${s.worst.map(w => `| ${w.id} | ${w.car} | ${B(w.truth)} | ${B(w.low)} – ${B(w.high)} | ${P(w.ape)} |`).join('\n') || '| — | | | | |'}

## Exception log
${s.exceptions.length ? s.exceptions.map(e => `- ${e.id}: ${e.error}`).join('\n') : 'None.'}

## Limitations
- Listing prices are asking prices, not transaction prices; results on \`listing\` references overstate real-world accuracy for decision use.
- Web results change over time; re-running later is not an exact replication. Each per-car result keeps its timestamp and sources.
- Reference sources listed in the protocol's \`blocked_domains\` were hidden from search to limit leakage; other sites may still mirror the same listing.
`;
}

// ---------- Run ----------
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); })); }

export async function main(argv, { estimateFn = estimate, env = process.env, log = console.log } = {}) {
  const a = parseArgs(argv);
  const protoBuf = fs.readFileSync(a.protocol), protocol = JSON.parse(protoBuf);
  const refBuf = fs.readFileSync(a.ref);
  const { cars: allCars, errors } = validateRef(parseCSV(refBuf.toString('utf8')));
  if (errors.length) { errors.forEach(e => log('✗ ' + e)); throw new Error(`${errors.length} problem(s) in reference file`); }
  const approved = !!(protocol.approval && protocol.approval.approved_by && protocol.approval.approved_on);
  if (!approved && !a.draft) throw new Error('Protocol not approved: fill approval.approved_by / approved_on before running (pre-registration), or pass --draft for a non-evidential trial run.');
  const cars = a.maxCars ? allCars.slice(0, a.maxCars) : allCars;
  const out = a.out || path.join(here, 'runs', protocol.id);
  fs.mkdirSync(out, { recursive: true });
  const resultsFile = path.join(out, 'results.jsonl');
  const done = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const doneIds = new Set(done.map(r => r.id));
  const todo = a.reportOnly ? [] : cars.filter(c => !doneIds.has(c.id));
  log(`Reference: ${allCars.length} cars (${cars.length} in scope) · already done: ${doneIds.size} · to run: ${todo.length}`);

  if (todo.length && !a.live) { log('Dry run: inputs are valid. Add --live --confirm to call the API (costs money).'); return { dryRun: true, todo: todo.length }; }
  if (todo.length) {
    if (!a.confirm) throw new Error(`About to make ~${todo.length} AI calls (each may run several web searches). Re-run with --confirm.`);
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    let k = 0;
    await pool(todo, a.concurrency, async car => {
      const t0 = Date.now(); let rec;
      try {
        const res = await estimateFn({ brand: car.brand, model: car.model, year: car.year, mileage: car.mileage, condition: car.condition }, key, { blockedDomains: protocol.blocked_domains || [] });
        rec = { id: car.id, ok: true, ...res };
      } catch (err) { rec = { id: car.id, ok: false, error: String(err && err.message || err).slice(0, 300) }; }
      rec.ms = Date.now() - t0; rec.at = new Date().toISOString();
      fs.appendFileSync(resultsFile, JSON.stringify(rec) + '\n'); done.push(rec);
      log(`[${++k}/${todo.length}] ${car.id} ${rec.ok ? 'ok' : 'error: ' + rec.error}`);
    });
  }
  const evalRes = evaluate(cars, done, protocol);
  const meta = { draft: !approved, protocolId: protocol.id, protocolHash: sha(protoBuf), approvedBy: protocol.approval && protocol.approval.approved_by, approvedOn: protocol.approval && protocol.approval.approved_on,
    refFile: path.basename(a.ref), refHash: sha(refBuf), model: protocol.model || 'claude-opus-5-5', generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ meta, summary: evalRes.summary }, null, 2));
  fs.writeFileSync(path.join(out, 'report.md'), renderReport(evalRes, meta));
  log(`Verdict: ${evalRes.summary.verdict}${meta.draft ? ' (DRAFT)' : ''} · report: ${path.join(out, 'report.md')}`);
  return evalRes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { console.error('✗ ' + e.message); process.exit(1); });
}
