// Tests for the E03 evaluation script (no network, no API cost).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, evaluate, parseCSV, validateRef } from '../eval/e03.mjs';
import { estimate } from '../src/ai.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e03-'));
const ref = path.join(tmp, 'ref.csv');
fs.writeFileSync(ref, [
  '# comment line',
  'id,brand,model,year,mileage_km,condition,reference_price_thb,reference_type,reference_source,as_of_date',
  'C1,Honda,City,2022,"80,000",good,400000,transaction,Auction A,2026-10-01',
  'C2,Toyota,Hilux Revo,2019,120000,fair,500000,listing,Site B,2026-10-02',
  'C3,Tesla,Model 3,2021,40000,excellent,1000000,appraisal,Appraiser C,2026-10-03',
  'C4,Mazda,CX-5,2018,150000,good,550000,transaction,Auction A,2026-10-04'
].join('\n'));
const proto = JSON.parse(fs.readFileSync(new URL('../eval/e03-protocol.json', import.meta.url)));
proto.thresholds.min_cars = 3;
proto.blocked_domains = ['auction-a.example'];
const protoUnapproved = path.join(tmp, 'p0.json'); fs.writeFileSync(protoUnapproved, JSON.stringify(proto));
proto.approval = { approved_by: 'Test Reviewer', approved_on: '2026-11-01', role: 'IA' };
const protoFile = path.join(tmp, 'p1.json'); fs.writeFileSync(protoFile, JSON.stringify(proto));
const quiet = () => {};

// Reference validation catches bad rows
const bad = validateRef(parseCSV('id,brand,model,year,mileage_km,condition,reference_price_thb,reference_type,reference_source,as_of_date\nX,Honda,City,2022,1,shiny,0,rumour,s,2026/1/1\n'));
assert.equal(bad.errors.length, 4);

// Pre-registration: unapproved protocol refuses unless --draft
await assert.rejects(main(['--ref', ref, '--protocol', protoUnapproved, '--out', path.join(tmp, 'o0')], { log: quiet }), /not approved/);

// Dry run makes no calls; live without --confirm refuses; missing key refuses
let calls = 0;
const fake = async (car, key, opts) => {
  calls++;
  assert.deepEqual(opts.blockedDomains, ['auction-a.example']);
  assert.ok(!('id' in car) && !('truth' in car), 'reference price never sent to the model');
  if (car.model === 'Model 3') throw new Error('boom');
  const t = { City: [380000, 420000], 'Hilux Revo': [520000, 600000], 'CX-5': [500000, 540000] }[car.model];
  return { low_thb: t[0], high_thb: t[1], confidence: 'medium', comparable_count: 5, summary_th: '', sources: [{ title: 'x', url: 'https://e.x', price_thb: null, note: '' }],
    model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 200, web_search_requests: 3, requests: 1 } };
};
const out = path.join(tmp, 'o1');
const dry = await main(['--ref', ref, '--protocol', protoFile, '--out', out], { estimateFn: fake, log: quiet });
assert.equal(dry.dryRun, true); assert.equal(calls, 0);
await assert.rejects(main(['--ref', ref, '--protocol', protoFile, '--out', out, '--live'], { estimateFn: fake, log: quiet }), /--confirm/);
await assert.rejects(main(['--ref', ref, '--protocol', protoFile, '--out', out, '--live', '--confirm'], { estimateFn: fake, env: {}, log: quiet }), /ANTHROPIC_API_KEY/);

// Live run (mocked), then resume does not repeat calls
const env = { ANTHROPIC_API_KEY: 'sk-ant-test' };
const res = await main(['--ref', ref, '--protocol', protoFile, '--out', out, '--live', '--confirm', '--concurrency', '2'], { estimateFn: fake, env, log: quiet });
assert.equal(calls, 4);
await main(['--ref', ref, '--protocol', protoFile, '--out', out, '--live', '--confirm'], { estimateFn: fake, env, log: quiet });
assert.equal(calls, 4, 'resume skips cars already scored');

const s = res.summary;
assert.equal(s.n_attempted, 4); assert.equal(s.n_valid, 3); assert.equal(s.invalid_rate, 0.25);
// APEs: City 0/400k=0, Hilux 60k/500k=0.12, CX-5 30k/550k≈0.0545
assert.ok(Math.abs(s.ai.mape - (0 + 0.12 + 30000 / 550000) / 3) < 1e-9);
assert.equal(s.ai.coverage, 1 / 3);
assert.equal(s.usage.web_search_requests, 9);
assert.equal(s.usage.est_cost_usd, null, 'search price unknown → cost UNKNOWN');
assert.equal(s.verdict, 'FAIL', 'invalid rate 25% breaches 5%');
assert.ok(s.baseline_on_same_cars.n === 3, 'synthetic baseline scored on catalogue cars');
const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
assert.match(report, /\*\*FAIL\*\*/); assert.match(report, /C3: boom/); assert.match(report, /approved by Test Reviewer/);

// evaluate() PASS case
const pass = evaluate([{ id: 'a', brand: 'X', model: 'Y', year: 2020, truth: 100000, refType: 'transaction' }],
  [{ id: 'a', ok: true, low_thb: 95000, high_thb: 105000, confidence: 'high', sources: [{ url: 'https://x' }] }],
  { thresholds: { min_cars: 1, max_invalid_rate: 0, max_mape: 0.05, min_coverage: 1 }, pricing: {} });
assert.equal(pass.summary.verdict, 'PASS');

// Real estimate() wiring with a fake fetch: blocked domains + usage accumulate across pause_turn
const bodies = [];
const fakeFetch = async (url, init) => {
  bodies.push(JSON.parse(init.body));
  const first = bodies.length === 1;
  const msg = { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_sequence: null,
    stop_reason: first ? 'pause_turn' : 'tool_use',
    usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 2 } },
    content: first ? [{ type: 'text', text: 'searching' }] : [{ type: 'tool_use', id: 't', name: 'report_price_estimate', input: { low_thb: 1, high_thb: 2, confidence: 'low', comparable_count: 0, summary_th: '', sources: [] } }] };
  return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
};
const r = await estimate({ brand: 'Honda', model: 'City', year: 2022, mileage: 1, condition: 'good' }, 'sk-ant-test', { blockedDomains: ['a.example'], fetch: fakeFetch });
assert.equal(bodies.length, 2);
assert.deepEqual(bodies[0].tools[0].blocked_domains, ['a.example']);
assert.equal(bodies[1].messages.length, 2, 'pause_turn resumed with assistant content appended');
assert.deepEqual([r.usage.requests, r.usage.input_tokens, r.usage.web_search_requests], [2, 200, 4]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ e03 evaluation test passed');
