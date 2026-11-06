'use strict';
/* CarWise — customer trial app (E01: Customer Problem & Decision Utility).
   Local-only: no server, no partner API, no personal data collected.
   Valuations use a SYNTHETIC illustrative model — not market data (data rights = E03, not yet cleared). */

const STORE = 'carwise_customer_v1';
const NOW_YEAR = new Date().getFullYear();

// ---------- Synthetic catalogue: illustrative new-car reference prices (THB), NOT market data ----------
// type: car | pickup | ev  → different illustrative depreciation curves
const CATALOG = {
  Toyota: [['Yaris', 560000, 'car'], ['Yaris Ativ', 600000, 'car'], ['Corolla Altis', 950000, 'car'], ['Corolla Cross', 1050000, 'car'], ['Camry', 1650000, 'car'], ['Hilux Revo', 750000, 'pickup'], ['Fortuner', 1550000, 'pickup']],
  Honda: [['City', 650000, 'car'], ['Civic', 1050000, 'car'], ['HR-V', 1100000, 'car'], ['CR-V', 1600000, 'car'], ['Accord', 1700000, 'car']],
  Isuzu: [['D-Max', 700000, 'pickup'], ['MU-X', 1350000, 'pickup']],
  Mazda: [['Mazda2', 650000, 'car'], ['Mazda3', 1000000, 'car'], ['CX-30', 1100000, 'car'], ['CX-5', 1400000, 'car']],
  Nissan: [['Almera', 600000, 'car'], ['Kicks e-Power', 950000, 'car'], ['Navara', 800000, 'pickup']],
  Mitsubishi: [['Mirage', 450000, 'car'], ['Attrage', 500000, 'car'], ['Xpander', 850000, 'car'], ['Triton', 750000, 'pickup'], ['Pajero Sport', 1450000, 'pickup']],
  Ford: [['Ranger', 900000, 'pickup'], ['Everest', 1600000, 'pickup']],
  MG: [['MG ZS', 750000, 'car'], ['MG4 Electric', 900000, 'ev']],
  BYD: [['Dolphin', 700000, 'ev'], ['Atto 3', 1000000, 'ev'], ['Seal', 1300000, 'ev']]
};
const CONDITIONS = [
  ['excellent', 'ดีมาก', 'ไม่มีรอย ไม่เคยชน ศูนย์ตลอด', 0.04],
  ['good', 'ดี', 'มีรอยเล็กน้อยตามการใช้งาน', 0],
  ['fair', 'พอใช้', 'มีรอย/ซ่อมสีบางจุด', -0.07],
  ['repair', 'ต้องซ่อม', 'เคยชนหนัก หรือมีจุดต้องซ่อม', -0.18]
];
const NEXT_STEPS = [
  ['expert', '🔍', 'อยากให้ผู้เชี่ยวชาญเช็กราคาจริง', true],
  ['refinance', '💳', 'อยากเทียบข้อเสนอรีไฟแนนซ์', true],
  ['trade', '🔁', 'อยากรู้ราคาขาย/เทิร์นจากเต็นท์', true],
  ['later', '🔖', 'บันทึกไว้ดูทีหลัง', false],
  ['none', '✋', 'ยังไม่ทำอะไรตอนนี้', false]
];

// ---------- State ----------
const blank = () => ({ consent: null, research: false, cars: [], events: [], feedback: [], draft: null });
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v && Array.isArray(v.cars) && Array.isArray(v.events)) return Object.assign(blank(), v);
  } catch (e) { /* ignore */ }
  return blank();
}
let db = load();
function save() { try { localStorage.setItem(STORE, JSON.stringify(db)); } catch (e) { toast('บันทึกข้อมูลในเครื่องไม่ได้'); } }
const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).toUpperCase();

// Anonymous on-device research log (only with consent). No PII is ever stored.
function track(ev, p = {}) {
  if (!db.research) return;
  db.events.push({ t: new Date().toISOString(), sid: db.draft ? db.draft.sid : null, ev, p });
  if (db.events.length > 2000) db.events.splice(0, db.events.length - 2000);
  save();
}

// ---------- Helpers ----------
const el = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1k = n => Math.round(n / 1000) * 1000;
const baht = n => (n < 0 ? '−' : '') + '฿' + Math.abs(Math.round(n)).toLocaleString('en-US');
const bahtRange = (a, b) => `${baht(a)} – ${baht(b)}`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function toast(s) { const t = el('toast'); t.textContent = s; t.classList.add('show'); clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.remove('show'), 2800); }
// ---------- AI price check (PoC, Claude API + web search) ----------
// The API key lives only in this device's localStorage under its own key: never in db, never exported.
const AI_KEY = 'carwise_ai_key';
const aiKey = () => { try { return localStorage.getItem(AI_KEY) || ''; } catch (e) { return ''; } };
let aiBusy = false, aiController = null;
function loadAI() {
  if (window.CarWiseAI) return Promise.resolve(window.CarWiseAI);
  return new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'ai.js'; sc.onload = () => ok(window.CarWiseAI); sc.onerror = () => bad(new Error('โหลดโมดูล AI ไม่ได้ (ต้องต่ออินเทอร์เน็ต)')); document.head.appendChild(sc); });
}
// Sanity checks before anything from the model is shown as a number.
function checkAI(a, model) {
  const issues = [];
  const okNum = n => Number.isInteger(n) && n > 10000 && n < 50000000;
  if (!okNum(a.low_thb) || !okNum(a.high_thb) || a.low_thb > a.high_thb) issues.push('ช่วงราคาที่ได้ไม่สมเหตุสมผล');
  const sources = (Array.isArray(a.sources) ? a.sources : []).filter(x => /^https?:\/\//i.test(String(x.url || ''))).slice(0, 8);
  if (!sources.length) issues.push('ไม่มีแหล่งอ้างอิงที่ตรวจสอบได้');
  const mid = (a.low_thb + a.high_thb) / 2;
  const divergence = model.mid ? (mid - model.mid) / model.mid : 0;
  if (Math.abs(divergence) > 0.25) issues.push(`ต่างจากแบบจำลองเดิม ${divergence > 0 ? '+' : ''}${Math.round(divergence * 100)}%`);
  const valid = okNum(a.low_thb) && okNum(a.high_thb) && a.low_thb <= a.high_thb && sources.length > 0;
  return { low: r1k(a.low_thb), high: r1k(a.high_thb), confidence: a.confidence, comparables: a.comparable_count, summary: String(a.summary_th || '').slice(0, 600), sources, divergence, issues, valid, model: a.model, at: new Date().toISOString() };
}
async function runAI(target) {
  if (aiBusy) return;
  const key = aiKey(); if (!key) { toast('ยังไม่ได้ตั้งค่า API key ในหน้า “ตั้งค่า”'); return; }
  aiBusy = true; aiController = new AbortController(); render();
  const t0 = Date.now();
  try {
    const mod = await loadAI();
    const raw = await mod.estimate(target.car, key, { signal: aiController.signal });
    target.ai = checkAI(raw, target.result);
    track('ai_estimate', { ok: true, ms: Date.now() - t0, valid: target.ai.valid, confidence: target.ai.confidence, comparables: target.ai.comparables, divergence: Math.round(target.ai.divergence * 100) });
  } catch (err) {
    const E = window.CarWiseAI && window.CarWiseAI.errors;
    const msg = aiController && aiController.signal.aborted ? 'ยกเลิกแล้ว'
      : E && err instanceof E.AuthenticationError ? 'API key ไม่ถูกต้อง' : E && err instanceof E.RateLimitError ? 'เรียกใช้ถี่เกินไป ลองใหม่ภายหลัง'
      : E && err instanceof E.APIConnectionError ? 'เชื่อมต่อ AI ไม่ได้' : (err.message || 'เกิดข้อผิดพลาด');
    target.ai = { error: msg, at: new Date().toISOString() };
    track('ai_estimate', { ok: false, ms: Date.now() - t0, error: msg });
  } finally { aiBusy = false; aiController = null; save(); render(); }
}
function aiCard(d, canRun) {
  const a = d.ai;
  if (!aiKey() && !a) return '';
  if (aiBusy) return `<div class="card aicard"><div class="row"><b>🤖 AI กำลังค้นราคาตลาด…</b><button class="btn ghost" style="width:auto" data-action="ai-cancel">ยกเลิก</button></div><div class="aiprogress"><span></span></div><p class="tiny">ค้นจากประกาศขายและแหล่งราคาในไทย อาจใช้เวลา 20–60 วินาที</p></div>`;
  if (!a) return canRun ? `<div class="card aicard"><b>🤖 เช็กราคาตลาดด้วย AI (ทดลอง)</b><p class="small" style="margin:4px 0 10px">AI จะค้นประกาศขายรถรุ่นนี้ในไทยแล้วสรุปช่วงราคา พร้อมแหล่งอ้างอิง — ส่งเฉพาะ ยี่ห้อ/รุ่น/ปี/ไมล์/สภาพ</p><button class="btn secondary" data-action="ai-run">ค้นราคาด้วย AI</button></div>` : '';
  if (a.error) return `<div class="card aicard"><b>🤖 AI ประเมินไม่สำเร็จ</b><p class="small" style="margin:4px 0 10px">${esc(a.error)}</p>${canRun ? '<button class="btn secondary" data-action="ai-run">ลองอีกครั้ง</button>' : ''}</div>`;
  const conf = { high: ['good', 'สูง'], medium: ['mid', 'ปานกลาง'], low: ['low', 'ต่ำ'] }[a.confidence] || ['low', '—'];
  return `<div class="card aicard">
    <div class="row"><b>🤖 ราคาตลาดจาก AI</b><span class="chip ${conf[0]}">ความมั่นใจ ${conf[1]}</span></div>
    ${a.valid ? `<div class="num" style="font-size:24px;margin:6px 0 2px">${bahtRange(a.low, a.high)}</div><div class="tiny">อ้างอิง ${Number(a.comparables) || 0} รายการ · ส่วนต่างหลังหักหนี้ ${bahtRange(a.low - d.result.payoff, a.high - d.result.payoff)}</div>` : '<p class="small" style="margin:6px 0">ผลจาก AI ไม่ผ่านการตรวจสอบ จึงไม่แสดงเป็นตัวเลข</p>'}
    ${a.issues.length ? `<div class="notice warn" style="margin:10px 0 0">${a.issues.map(esc).join(' · ')} — ควรตรวจราคาจริงก่อนตัดสินใจ</div>` : ''}
    ${a.summary ? `<p class="small" style="margin-top:10px">${esc(a.summary)}</p>` : ''}
    ${a.sources.length ? `<details style="margin-top:8px"><summary class="small"><b>แหล่งอ้างอิง (${a.sources.length})</b></summary><ul class="srclist">${a.sources.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(x.title || x.url)}</a>${Number.isInteger(x.price_thb) ? ` · ${baht(x.price_thb)}` : ''}${x.note ? `<div class="tiny">${esc(x.note)}</div>` : ''}</li>`).join('')}</ul></details>` : ''}
    <p class="tiny" style="margin-top:8px">สรุปโดย AI จากข้อมูลบนเว็บ อาจคลาดเคลื่อน ไม่ใช่ราคาประเมินอย่างเป็นทางการ</p>
  </div>`;
}

const icon = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>',
  garage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 16h14l-1.5-5.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5Z"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/><path d="M4 16v3M20 16v3"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>'
};

// ---------- Valuation (synthetic, transparent) ----------
function valuate(car, loan) {
  const model = (CATALOG[car.brand] || []).find(m => m[0] === car.model);
  const [, newPrice, type] = model;
  const age = Math.max(0, NOW_YEAR - car.year);
  const yearly = { car: 0.90, pickup: 0.92, ev: 0.85 }[type];
  const dep = age === 0 ? 0.88 : Math.max(0.15, 0.82 * Math.pow(yearly, age - 1));
  const expectedKm = Math.max(1, age) * 20000;
  const kmAdj = clamp(-((car.mileage - expectedKm) / 5000) * 0.01, -0.12, 0.06);
  const cond = CONDITIONS.find(c => c[0] === car.condition);
  const mid = newPrice * dep * (1 + kmAdj + cond[3]);
  const spread = age > 10 ? 0.12 : age > 5 ? 0.09 : 0.07;
  const low = r1k(mid * (1 - spread)), high = r1k(mid * (1 + spread));
  let payoff = 0, payoffEstimated = false;
  if (loan.has === 'yes') {
    if (Number.isFinite(loan.balance) && loan.balance > 0) payoff = loan.balance;
    else { payoff = r1k(loan.installment * loan.months * 0.9); payoffEstimated = true; }
  }
  // Confidence refers to the car value only; an estimated loan payoff is flagged separately.
  const confidence = age > 12 || car.condition === 'repair' ? 'low' : age > 6 ? 'mid' : 'good';
  return {
    type, newPrice, age, low, high, mid: r1k(mid), payoff, payoffEstimated,
    eqLow: low - payoff, eqHigh: high - payoff, confidence, yearlyLoss: r1k(mid * (1 - yearly)),
    factors: [
      ['อายุรถ ' + (age || 'ไม่ถึง 1') + ' ปี', -(1 - dep)],
      ['เลขไมล์ ' + car.mileage.toLocaleString('en-US') + ' กม. (เฉลี่ย ' + expectedKm.toLocaleString('en-US') + ')', kmAdj],
      ['สภาพรถ: ' + cond[1], cond[3]]
    ]
  };
}

function options(res, loan) {
  const p = res.payoff;
  const remaining = loan.has === 'yes' && loan.installment && loan.months ? loan.installment * loan.months : 0;
  return [
    { id: 'sell', icon: '🏷️', title: 'ขายเอง', net: [r1k(res.low - p), r1k(res.high - p)], netLabel: 'เงินที่น่าจะเหลือหลังปิดหนี้', time: '2–6 สัปดาห์',
      pros: ['มักได้ราคาสูงที่สุดในทุกทางเลือก'], cons: ['ใช้เวลาและต้องคุยกับผู้ซื้อเอง', 'ถ้ายังติดไฟแนนซ์ ต้องปิดบัญชีก่อนโอน', 'ระวังมิจฉาชีพ: รับเงินครบก่อนส่งมอบรถ'] },
    { id: 'trade', icon: '🔁', title: 'ขายเต็นท์ / เทิร์นรถ', net: [r1k(res.mid * 0.85 - p), r1k(res.mid * 0.92 - p)], netLabel: 'เงินที่น่าจะเหลือหลังปิดหนี้', time: '1–3 วัน',
      pros: ['เร็ว เต็นท์ช่วยจัดการปิดไฟแนนซ์และเอกสาร'], cons: ['ราคามักต่ำกว่าขายเองประมาณ 8–15%', 'ควรเทียบราคาจากหลายเต็นท์'] },
    { id: 'refinance', icon: '💳', title: 'รีไฟแนนซ์ / สินเชื่อทะเบียนรถ', net: [Math.max(0, r1k(res.low * 0.7 - p)), Math.max(0, r1k(res.mid * 0.8 - p))], netLabel: 'เงินสดที่อาจได้ (เป็นหนี้ใหม่ ไม่ใช่รายได้)', time: '1–7 วัน',
      pros: ['ยังได้ใช้รถต่อ', 'อาจลดค่างวดได้ถ้าได้ดอกเบี้ยต่ำกว่าเดิม'], cons: ['เป็นหนี้เพิ่ม ต้องจ่ายดอกเบี้ย', 'ถ้าผ่อนไม่ไหว เสี่ยงถูกยึดรถ', 'ไม่ควรใช้เพื่อการบริโภคทั่วไป'], warn: true },
    { id: 'keep', icon: '🚗', title: 'เก็บไว้ใช้ต่อ', net: null, netLabel: remaining ? 'ค่างวดที่ยังต้องจ่ายทั้งหมด' : 'ไม่มีค่างวดคงเหลือ', costTotal: remaining, time: '—',
      pros: ['ไม่ต้องหารถใหม่ ไม่มีค่าใช้จ่ายในการเปลี่ยนรถ'], cons: [`มูลค่ารถอาจลดลงอีกประมาณ ${baht(res.yearlyLoss)} ในปีหน้า (ค่าประมาณ)`] }
  ];
}

// ---------- Router ----------
const WIZARD = ['car', 'loan', 'result', 'options', 'next'];
let route = 'home';
let carStep = 0; // sub-steps inside "car"

function go(r, push = true) {
  route = r;
  if (push) history.pushState({ r }, '', '#' + r);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  el('view').focus({ preventScroll: true });
}

function render() {
  if (WIZARD.includes(route) && !db.draft) route = 'home';
  if (['result', 'options', 'next'].includes(route) && !(db.draft && db.draft.result)) route = db.draft ? 'car' : 'home';
  const wizard = WIZARD.includes(route) || route === 'done';
  el('view').className = 'content view-enter' + (wizard ? ' wizard' : '');
  el('tabbar').hidden = wizard;
  renderBar(wizard);
  ({ home: vHome, car: vCar, loan: vLoan, result: vResult, options: vOptions, next: vNext, done: vDone, garage: vGarage, settings: vSettings, view: vSaved })[route]();
  el('tabbar').innerHTML = '<div class="tabbar-inner">' + [['home', 'หน้าแรก'], ['garage', 'รถของฉัน'], ['settings', 'ตั้งค่า']].map(([id, label]) =>
    `<button class="tab ${route === id ? 'active' : ''}" data-go="${id}" ${route === id ? 'aria-current="page"' : ''}>${icon[id]}<span>${label}</span></button>`).join('') + '</div>';
}

function renderBar(wizard) {
  const titles = { car: 'ข้อมูลรถ', loan: 'ไฟแนนซ์', result: 'ผลประเมิน', options: 'ทางเลือกของคุณ', next: 'ขั้นต่อไป', done: 'เสร็จแล้ว', garage: 'รถของฉัน', settings: 'ตั้งค่า', view: 'ผลประเมินที่บันทึกไว้' };
  if (route === 'home') { el('appbar').innerHTML = '<div class="brand"><div class="brandmark">C</div><div class="brandname">car<span>wise</span></div></div>'; return; }
  const back = wizard && route !== 'done' ? `<button class="iconbtn" data-action="back" aria-label="ย้อนกลับ">${icon.back}</button>` : route === 'view' ? `<button class="iconbtn" data-go="garage" aria-label="ย้อนกลับ">${icon.back}</button>` : '';
  const close = wizard ? `<button class="iconbtn" data-action="quit" aria-label="ออกจากการประเมิน">${icon.close}</button>` : '';
  el('appbar').innerHTML = `${back}<h1>${titles[route]}</h1>${close}`;
}

const progress = idx => `<div class="progress" aria-label="ขั้นที่ ${idx + 1} จาก 5">${[0, 1, 2, 3, 4].map(i => `<span class="${i <= idx ? 'on' : ''}"></span>`).join('')}</div>`;
const footer = (label, action, disabled = false, secondary = '') => `<div class="footerbar"><div class="inner">${secondary}<button class="btn" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button></div></div>`;

// ---------- Views ----------
function vHome() {
  const last = db.cars[0];
  el('view').innerHTML = `
    <section class="hero">
      <div class="eyebrow">CarWise · Beta</div>
      <h2>รถของคุณมีมูลค่าเท่าไหร่<br>เมื่อเทียบกับหนี้ที่เหลือ?</h2>
      <p>รู้ “ส่วนต่าง” ก่อนตัดสินใจขาย เทิร์น หรือรีไฟแนนซ์ ใช้เวลาประมาณ 2 นาที ไม่ต้องกรอกชื่อ เบอร์โทร หรือทะเบียนรถ</p>
      <button class="btn" data-action="start">เริ่มประเมินรถของฉัน →</button>
    </section>
    ${last ? `<div class="card"><div class="row"><div><div class="tiny">ประเมินล่าสุด</div><b>${esc(last.car.brand)} ${esc(last.car.model)} ${last.car.year}</b><div class="small">ส่วนต่าง ${bahtRange(last.result.eqLow, last.result.eqHigh)}</div></div><button class="btn secondary" style="width:auto;min-height:44px" data-open="${esc(last.id)}">ดู</button></div></div>` : ''}
    <div class="section">ทำงานอย่างไร</div>
    <div class="card steps3">
      <div class="step3"><b>1</b><div><b>บอกข้อมูลรถ</b><div class="small">ยี่ห้อ รุ่น ปี เลขไมล์ และสภาพรถ</div></div></div>
      <div class="step3"><b>2</b><div><b>บอกยอดไฟแนนซ์ (ถ้ามี)</b><div class="small">ยอดปิดบัญชี หรือค่างวดและจำนวนงวดที่เหลือ</div></div></div>
      <div class="step3"><b>3</b><div><b>ดูส่วนต่างและทางเลือก</b><div class="small">เทียบขายเอง เทิร์น รีไฟแนนซ์ หรือเก็บไว้ แบบเป็นกลาง</div></div></div>
    </div>
    <div class="notice warn">แอปนี้อยู่ในช่วงทดลอง ตัวเลขทั้งหมดเป็น<b>ค่าประมาณจากแบบจำลอง</b> ไม่ใช่ราคาประเมินจริง และไม่ใช่คำแนะนำทางการเงิน</div>`;
}

function vCar() {
  const c = db.draft.car;
  const models = c.brand ? CATALOG[c.brand] : [];
  const years = []; for (let y = NOW_YEAR; y >= NOW_YEAR - 20; y--) years.push(y);
  const ok = c.brand && c.model && c.year && Number.isFinite(c.mileage) && c.mileage >= 0 && c.mileage <= 1000000 && c.condition;
  el('view').innerHTML = progress(0) + `
    <div class="qtitle">รถของคุณคือคันไหน?</div>
    <div class="qsub">ใช้เพื่อประมาณมูลค่าเท่านั้น ไม่ต้องใส่ทะเบียนรถ</div>
    <label class="field">ยี่ห้อ<select data-car="brand"><option value="">เลือกยี่ห้อ</option>${Object.keys(CATALOG).map(b => `<option ${c.brand === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
    <label class="field">รุ่น<select data-car="model" ${c.brand ? '' : 'disabled'}><option value="">${c.brand ? 'เลือกรุ่น' : 'เลือกยี่ห้อก่อน'}</option>${models.map(m => `<option ${c.model === m[0] ? 'selected' : ''}>${m[0]}</option>`).join('')}</select>
      <span class="hint">ไม่เจอรุ่นของคุณ? ช่วงทดลองรองรับรุ่นยอดนิยมเท่านั้น</span></label>
    <label class="field">ปีที่จดทะเบียน<select data-car="year"><option value="">เลือกปี</option>${years.map(y => `<option value="${y}" ${c.year === y ? 'selected' : ''}>${y} (พ.ศ. ${y + 543})</option>`).join('')}</select></label>
    <label class="field">เลขไมล์ปัจจุบัน<div class="suffix"><input data-car="mileage" inputmode="numeric" placeholder="เช่น 65,000" value="${Number.isFinite(c.mileage) ? c.mileage.toLocaleString('en-US') : ''}"><i>กม.</i></div></label>
    <div class="field">สภาพรถ<div class="choices">${CONDITIONS.map(([id, t, d]) => `<button class="choice ${c.condition === id ? 'selected' : ''}" data-cond="${id}" aria-pressed="${c.condition === id}"><span class="dot"></span><span>${t}<small>${d}</small></span></button>`).join('')}</div></div>
  ` + footer('ถัดไป', 'to-loan', !ok);
}

function vLoan() {
  const l = db.draft.loan;
  const yes = l.has === 'yes';
  const hasBal = Number.isFinite(l.balance) && l.balance > 0;
  const hasInst = Number.isFinite(l.installment) && l.installment > 0 && Number.isFinite(l.months) && l.months > 0;
  const ok = l.has && (!yes || hasBal || hasInst);
  el('view').innerHTML = progress(1) + `
    <div class="qtitle">ตอนนี้รถยังติดไฟแนนซ์อยู่ไหม?</div>
    <div class="qsub">ใช้คำนวณ “ส่วนต่าง” ระหว่างมูลค่ารถกับหนี้ที่เหลือ</div>
    <div class="choices" style="margin-bottom:18px">${[['yes', 'ยังผ่อนอยู่'], ['paid', 'ผ่อนหมดแล้ว'], ['no', 'ซื้อเงินสด']].map(([v, t]) => `<button class="choice ${l.has === v ? 'selected' : ''}" data-has="${v}" aria-pressed="${l.has === v}"><span class="dot"></span>${t}</button>`).join('')}</div>
    ${yes ? `
      <label class="field">ยอดปิดบัญชี (ถ้าทราบ)<div class="suffix"><input data-loan="balance" inputmode="numeric" placeholder="เช่น 320,000" value="${hasBal ? l.balance.toLocaleString('en-US') : ''}"><i>บาท</i></div>
        <span class="hint">ดูได้จากแอปหรือคอลเซ็นเตอร์ของไฟแนนซ์ — แม่นยำที่สุด</span></label>
      <div class="small" style="margin:-4px 0 12px">ไม่ทราบยอดปิด? กรอกค่างวดแทน แล้วเราจะประมาณให้</div>
      <div class="choices two">
        <label class="field">ค่างวด/เดือน<div class="suffix"><input data-loan="installment" inputmode="numeric" placeholder="9,500" value="${Number.isFinite(l.installment) ? l.installment.toLocaleString('en-US') : ''}"><i>บาท</i></div></label>
        <label class="field">งวดที่เหลือ<div class="suffix"><input data-loan="months" inputmode="numeric" placeholder="36" value="${Number.isFinite(l.months) ? l.months : ''}"><i>งวด</i></div></label>
      </div>` : ''}
  ` + footer('ดูผลประเมิน', 'to-result', !ok);
}

function equityBox(r) {
  const cls = r.eqLow >= 0 ? 'pos' : r.eqHigh < 0 ? 'neg' : 'mixed';
  const msg = cls === 'pos' ? 'ถ้าขายในช่วงราคานี้ น่าจะปิดหนี้ได้และมีเงินเหลือ'
    : cls === 'neg' ? `มูลค่ารถน่าจะต่ำกว่าหนี้ที่เหลือ ถ้าขายตอนนี้อาจต้องหาเงินเพิ่มประมาณ ${bahtRange(-r.eqHigh, -r.eqLow)} เพื่อปิดหนี้`
    : 'ส่วนต่างใกล้ศูนย์ — ขึ้นอยู่กับราคาที่ขายได้จริง ควรเช็กราคาจริงก่อนตัดสินใจ';
  return `<div class="equity ${cls}"><div class="label">${r.payoff ? 'ส่วนต่าง (มูลค่ารถ − หนี้ที่เหลือ)' : 'รถของคุณปลอดหนี้'}</div><div class="num">${bahtRange(r.eqLow, r.eqHigh)}</div><p>${r.payoff ? msg : 'มูลค่าทั้งหมดเป็นของคุณ'}</p></div>`;
}

function resultBody(d, withCta, aiRun = withCta) {
  const r = d.result;
  const max = Math.max(r.high, r.payoff, 1);
  const conf = { good: ['good', 'ค่อนข้างดี'], mid: ['mid', 'ปานกลาง'], low: ['low', 'ต่ำ — ควรเช็กราคาจริง'] }[r.confidence];
  return `
    <div class="card resulthead">
      <div class="label">${esc(d.car.brand)} ${esc(d.car.model)} ${d.car.year} · มูลค่าตลาดโดยประมาณ</div>
      <div class="bigrange num">${bahtRange(r.low, r.high)}</div>
      <span class="chip ${conf[0]}">ความมั่นใจ: ${conf[1]}</span>
    </div>
    ${equityBox(r)}
    ${aiCard(d, aiRun)}
    <div class="card">
      <b>เทียบมูลค่ารถกับหนี้</b>
      <div class="compare">
        <div class="cbar"><span>มูลค่ารถ</span><div class="track"><div class="fill" style="width:${(r.mid / max * 100).toFixed(1)}%"></div></div><span class="val">${baht(r.mid)} (กลางช่วง)</span></div>
        <div class="cbar"><span>หนี้ที่เหลือ</span><div class="track"><div class="fill loan" style="width:${(r.payoff / max * 100).toFixed(1)}%"></div></div><span class="val">${baht(r.payoff)}${r.payoffEstimated ? ' (ประมาณจากค่างวด)' : ''}</span></div>
      </div>
    </div>
    <details class="card"><summary><b>ทำไมได้ตัวเลขนี้?</b></summary>
      <div style="margin-top:8px">
        <div class="factor"><span>ราคาอ้างอิงรถใหม่ (จำลอง)</span><b>${baht(r.newPrice)}</b></div>
        ${r.factors.map(([t, v]) => `<div class="factor"><span>${esc(t)}</span><b class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%</b></div>`).join('')}
        ${r.payoffEstimated ? '<p class="tiny" style="margin-top:8px">ยอดหนี้ประมาณจาก ค่างวด × งวดที่เหลือ × 90% (หักส่วนลดดอกเบี้ยเมื่อปิดก่อนกำหนดโดยประมาณ) — ยอดจริงให้สอบถามไฟแนนซ์</p>' : ''}
        <p class="tiny" style="margin-top:8px">ตัวเลขทั้งหมดมาจากแบบจำลองเพื่อการทดลอง ยังไม่ได้ใช้ข้อมูลราคาตลาดจริง</p>
      </div></details>
    ${withCta ? footer('ดูทางเลือกของฉัน', 'to-options', false, '<button class="btn secondary" data-action="back">แก้ไข</button>') : ''}`;
}

function vResult() { el('view').innerHTML = progress(2) + resultBody(db.draft, true); }

function vOptions() {
  const d = db.draft, opts = options(d.result, d.loan);
  el('view').innerHTML = progress(3) + `
    <div class="qtitle">ทางเลือกของคุณ</div>
    <div class="qsub">แตะแต่ละทางเลือกเพื่อดูรายละเอียด ลำดับไม่ได้หมายถึงคำแนะนำ</div>
    ${opts.map(o => `<details class="card option" data-opt="${o.id}"><summary><div class="oicon">${o.icon}</div><div><div class="otitle">${o.title}</div>
      <div class="onet">${o.net ? `${o.netLabel}: <b class="${o.net[1] < 0 ? 'neg' : ''}">${bahtRange(o.net[0], o.net[1])}</b>` : `${o.netLabel}${o.costTotal ? `: <b>${baht(o.costTotal)}</b>` : ''}`}</div></div><span class="chev">${icon.chev}</span></summary>
      <div class="obody">
        <div class="kv"><span class="muted">ระยะเวลาโดยประมาณ</span><b>${o.time}</b></div>
        <div style="margin-top:8px"><b>ข้อดี</b><ul>${o.pros.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div style="margin-top:6px"><b>ข้อควรระวัง</b><ul>${o.cons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        ${o.warn ? '<div class="notice warn" style="margin:10px 0 0">การกู้เพิ่มทำให้ภาระหนี้สูงขึ้น ควรเปรียบเทียบอัตราดอกเบี้ยที่แท้จริงต่อปี (Effective Rate) และค่าธรรมเนียมจากหลายแห่งก่อนตัดสินใจ</div>' : ''}
        ${o.net && o.net[1] < 0 ? '<div class="notice bad" style="margin:10px 0 0">ตัวเลขติดลบ หมายถึงคุณต้องหาเงินเพิ่มเพื่อปิดหนี้ให้ครบ</div>' : ''}
      </div></details>`).join('')}
    <p class="tiny">ในช่วงทดลอง CarWise ไม่ได้รับค่าตอบแทนจากทางเลือกใด หากในอนาคตมีค่าแนะนำจากพาร์ทเนอร์ เราจะแจ้งให้ทราบอย่างชัดเจนทุกครั้ง</p>
  ` + footer('ไปขั้นต่อไป', 'to-next');
}

function vNext() {
  const d = db.draft;
  const fb = d.fb || {};
  const ok = d.nextStep && fb.useful && fb.clear && fb.again;
  const rate = (k, lo, hi) => `<div class="rating" role="radiogroup">${[1, 2, 3, 4, 5].map(n => `<button role="radio" aria-checked="${fb[k] === n}" class="${fb[k] === n ? 'selected' : ''}" data-rate="${k}" data-v="${n}">${n}</button>`).join('')}</div><div class="ratinglabels"><span>${lo}</span><span>${hi}</span></div>`;
  const chosen = NEXT_STEPS.find(s => s[0] === d.nextStep);
  el('view').innerHTML = progress(4) + `
    <div class="qtitle">คุณอยากทำอะไรต่อ?</div>
    <div class="qsub">เลือก 1 ข้อที่ตรงกับคุณที่สุดตอนนี้</div>
    <div class="choices">${NEXT_STEPS.map(([id, ic, t]) => `<button class="choice ${d.nextStep === id ? 'selected' : ''}" data-next="${id}" aria-pressed="${d.nextStep === id}"><span style="font-size:20px">${ic}</span>${t}</button>`).join('')}</div>
    ${chosen && chosen[3] ? '<div class="notice" style="margin-top:12px">ขอบคุณที่สนใจ — ในช่วงทดลอง <b>ยังไม่มีการส่งข้อมูลของคุณให้พาร์ทเนอร์ใด ๆ</b> เราบันทึกเพียงว่าคุณสนใจบริการนี้ เพื่อใช้พัฒนาแอป</div>' : ''}
    <div class="section">ช่วยบอกเราหน่อย (ใช้เวลา 20 วินาที)</div>
    <div class="card">
      <div class="field">ผลประเมินนี้ช่วยให้คุณตัดสินใจได้ดีขึ้นไหม?${rate('useful', 'ไม่ช่วยเลย', 'ช่วยมาก')}</div>
      <div class="field">ตัวเลขและคำอธิบายเข้าใจง่ายไหม?${rate('clear', 'งงมาก', 'เข้าใจง่าย')}</div>
      <div class="field" style="margin-bottom:6px">ถ้ามีแอปนี้จริง คุณจะใช้อีกไหม?
        <div class="choices two" style="grid-template-columns:repeat(3,1fr)">${[['yes', 'ใช้แน่นอน'], ['maybe', 'อาจจะ'], ['no', 'ไม่ใช้']].map(([v, t]) => `<button class="choice ${fb.again === v ? 'selected' : ''}" style="justify-content:center;padding:10px 6px" data-again="${v}">${t}</button>`).join('')}</div></div>
      <label class="field" style="margin:12px 0 0">อยากให้ปรับอะไร (ไม่บังคับ)<textarea data-comment maxlength="500" placeholder="ห้ามใส่ชื่อ เบอร์โทร หรือทะเบียนรถ">${esc(fb.comment || '')}</textarea></label>
    </div>
  ` + footer('ส่งและบันทึกผล', 'finish', !ok);
}

function vDone() {
  el('view').innerHTML = `
    <div class="card" style="text-align:center;padding:30px 20px;margin-top:20px">
      <div style="font-size:48px">🙏</div>
      <h2 style="font-size:21px;margin:8px 0">ขอบคุณที่ช่วยทดลองใช้</h2>
      <p class="small">ผลประเมินถูกบันทึกไว้ใน “รถของฉัน” บนเครื่องนี้เท่านั้น คุณลบได้ทุกเมื่อ</p>
      <div class="btnstack"><button class="btn" data-go="garage">ดูรถของฉัน</button><button class="btn secondary" data-action="start">ประเมินอีกคัน</button><button class="btn ghost" data-go="home">กลับหน้าแรก</button></div>
    </div>`;
}

function vGarage() {
  el('view').innerHTML = `<div class="card">${db.cars.length ? db.cars.map(c => `<button class="carrow" data-open="${esc(c.id)}"><div class="cicon">🚗</div><div style="flex:1;min-width:0"><b>${esc(c.car.brand)} ${esc(c.car.model)} ${c.car.year}</b><div class="small">ส่วนต่าง ${bahtRange(c.result.eqLow, c.result.eqHigh)}</div><div class="tiny">ประเมินเมื่อ ${new Date(c.at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</div></div>${icon.chev.replace('m6 9 6 6 6-6', 'm9 6 6 6-6 6')}</button>`).join('')
    : '<div class="empty"><div class="big">🚗</div>ยังไม่มีรถที่บันทึกไว้<div class="btnstack"><button class="btn" data-action="start">เริ่มประเมิน</button></div></div>'}</div>
    ${db.cars.length ? '<p class="tiny">ราคารถเปลี่ยนตามเวลา ควรประเมินใหม่ทุก 3–6 เดือน</p>' : ''}`;
}

let viewing = null;
function vSaved() {
  const c = db.cars.find(x => x.id === viewing);
  if (!c) { route = 'garage'; return vGarage(); }
  el('view').innerHTML = resultBody(c, false, true) + `<p class="tiny" style="margin:4px 0 12px">ประเมินเมื่อ ${new Date(c.at).toLocaleString('th-TH')}</p>
    <div class="btnstack"><button class="btn secondary" data-action="reassess" data-id="${esc(c.id)}">ประเมินใหม่ด้วยข้อมูลเดิม</button><button class="btn danger" data-action="delcar" data-id="${esc(c.id)}">ลบรายการนี้</button></div>`;
}

function stats() {
  const s = new Set(db.events.filter(e => e.ev === 'journey_start').map(e => e.sid));
  const r = new Set(db.events.filter(e => e.ev === 'result_view').map(e => e.sid));
  const done = new Set(db.events.filter(e => e.ev === 'journey_complete').map(e => e.sid));
  const ns = new Set(db.events.filter(e => e.ev === 'journey_complete' && ['expert', 'refinance', 'trade'].includes(e.p.nextStep)).map(e => e.sid));
  return { started: s.size, result: r.size, done: done.size, nextStep: ns.size };
}

function vSettings() {
  const st = stats();
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
  el('view').innerHTML = `
    <div class="card">
      <button class="listbtn" data-action="toggle-research"><span>บันทึกการใช้งานเพื่อการวิจัย<small>ไม่ระบุตัวตน เก็บในเครื่องนี้เท่านั้น</small></span><span class="switch ${db.research ? 'on' : ''}" role="switch" aria-checked="${db.research}"></span></button>
      <button class="listbtn" data-action="about">เกี่ยวกับการทดลอง & ความเป็นส่วนตัว<small>เราเก็บอะไร และไม่เก็บอะไร</small></button>
      <button class="listbtn" data-action="install">ติดตั้งเป็นแอปบนหน้าจอ<small>ใช้งานได้แม้ไม่มีอินเทอร์เน็ต</small></button>
    </div>
    <div class="section">AI ประเมินราคา (ทดลอง · สำหรับเครื่องของทีม)</div>
    <div class="card">
      ${aiKey() ? `<div class="row"><span><b>เปิดใช้งานแล้ว</b><div class="tiny">key ลงท้าย …${esc(aiKey().slice(-4))} · เก็บในเครื่องนี้เท่านั้น</div></span><button class="btn danger" style="width:auto;min-height:40px" data-action="ai-forget">ลบ key</button></div>`
      : `<label class="field" style="margin-bottom:8px">Claude API key<input id="aiKeyInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-..."></label><button class="btn secondary" data-action="ai-save">บันทึก key</button>`}
      <p class="tiny" style="margin-top:10px">ใส่เฉพาะบนเครื่องที่ทีมใช้ทดสอบกับผู้ใช้ (moderated) ห้ามใส่บนเครื่องของผู้ใช้ทั่วไป · key ไม่ถูกส่งออกในไฟล์ JSON · ข้อมูลที่ส่งไป Anthropic: ยี่ห้อ รุ่น ปี ไมล์ สภาพรถ เท่านั้น · ควรตั้ง spend limit ของ key ให้ต่ำ</p>
    </div>
    <div class="section">สำหรับผู้ดำเนินการทดลอง</div>
    <div class="card">
      <div class="stat">
        <div><span class="tiny">เริ่มประเมิน</span><b>${st.started}</b></div>
        <div><span class="tiny">เห็นผลประเมิน</span><b>${st.result}</b><span class="tiny">${pct(st.result, st.started)}</span></div>
        <div><span class="tiny">ทำครบทุกขั้น</span><b>${st.done}</b><span class="tiny">${pct(st.done, st.started)} · เป้า ≥60%</span></div>
        <div><span class="tiny">เลือกขั้นต่อไปที่มีความหมาย</span><b>${st.nextStep}</b><span class="tiny">${pct(st.nextStep, st.started)} · เป้า ≥30%</span></div>
      </div>
      <p class="tiny" style="margin-top:10px">นับจากเครื่องนี้เท่านั้น (เฉพาะช่วงที่เปิดบันทึก) · ตัวหาร = จำนวนครั้งที่เริ่มประเมิน · คำตอบ “สนใจ” ในแอปเป็น Stated/Observed interest ไม่ใช่การซื้อจริง</p>
      <div class="btnstack"><button class="btn secondary" data-action="export">ส่งออกข้อมูลการทดลอง (JSON)</button></div>
    </div>
    <div class="card"><button class="listbtn danger" data-action="reset">ลบข้อมูลทั้งหมดในเครื่องนี้<small>รถที่บันทึก คำตอบ และบันทึกการใช้งาน</small></button></div>
    <p class="tiny">CarWise Beta · ต้องการบันทึกหลักฐานสำหรับทีม? ใช้ <a href="team/">Team tracker</a></p>`;
}

// ---------- Sheets ----------
function openSheet(html) { el('sheetBody').innerHTML = html; el('sheet').hidden = false; el('sheetBackdrop').hidden = false; document.body.style.overflow = 'hidden'; }
function closeSheet() { el('sheet').hidden = true; el('sheetBackdrop').hidden = true; document.body.style.overflow = ''; }
const aboutHtml = `
  <h3 id="sheetTitle">ก่อนเริ่มใช้งาน</h3>
  <p class="small">CarWise ช่วยให้คุณเห็นมูลค่ารถเทียบกับหนี้ที่เหลือ ก่อนตัดสินใจ</p>
  <ul>
    <li><b>เวอร์ชันทดลอง:</b> ตัวเลขเป็นค่าประมาณจากแบบจำลอง ไม่ใช่ราคาประเมินจริง</li>
    <li><b>ไม่ใช่คำแนะนำทางการเงิน</b> และไม่มีการทำธุรกรรมใด ๆ</li>
    <li><b>ไม่เก็บข้อมูลส่วนบุคคล:</b> ไม่ถามชื่อ เบอร์โทร เลขบัตร หรือทะเบียนรถ</li>
    <li><b>ไม่ส่งข้อมูลออกจากเครื่อง:</b> ไม่มีการส่งให้ไฟแนนซ์ เต็นท์รถ หรือพาร์ทเนอร์</li>
    <li>ถ้ากด “ค้นราคาด้วย AI” ข้อมูลรถ (ยี่ห้อ รุ่น ปี ไมล์ สภาพ) จะถูกส่งไปยังบริการ AI ของ Anthropic เพื่อค้นราคา — ไม่มีข้อมูลระบุตัวตน</li>
    <li>ลบข้อมูลทั้งหมดได้ทุกเมื่อที่หน้า “ตั้งค่า”</li>
  </ul>`;
function sheetConsent() {
  openSheet(aboutHtml + `
    <label class="check"><input type="checkbox" id="researchOk" ${db.research ? 'checked' : ''}><span><b>ยินยอมให้บันทึกการใช้งานแบบไม่ระบุตัวตน</b> (เช่น ทำถึงขั้นไหน เลือกทางเลือกใด) ไว้ในเครื่องนี้ เพื่อใช้ปรับปรุงแอป — ไม่บังคับ เปลี่ยนได้ภายหลัง</span></label>
    <div class="btnstack"><button class="btn" data-action="consent">เข้าใจแล้ว เริ่มใช้งาน</button></div>`);
}

// ---------- Actions ----------
function startJourney() {
  db.draft = { sid: uid(), car: { brand: '', model: '', year: null, mileage: NaN, condition: '' }, loan: { has: '', balance: NaN, installment: NaN, months: NaN }, result: null, nextStep: '', fb: {} };
  save(); track('journey_start'); go('car');
}
function computeResult() {
  const d = db.draft;
  d.result = valuate(d.car, d.loan);
  save();
  track('result_view', { brand: d.car.brand, model: d.car.model, age: d.result.age, condition: d.car.condition, loan: d.loan.has, equity: d.result.eqLow >= 0 ? 'pos' : d.result.eqHigh < 0 ? 'neg' : 'mixed', confidence: d.result.confidence });
}
function finish() {
  const d = db.draft;
  const entry = { id: d.sid, at: new Date().toISOString(), car: { ...d.car }, loan: { ...d.loan }, result: d.result, ai: d.ai || null };
  if (d.nextStep !== 'none') { db.cars = db.cars.filter(c => c.id !== entry.id); db.cars.unshift(entry); }
  db.feedback.push({ sid: d.sid, at: entry.at, nextStep: d.nextStep, useful: d.fb.useful, clear: d.fb.clear, again: d.fb.again, comment: (d.fb.comment || '').slice(0, 500) });
  track('journey_complete', { nextStep: d.nextStep, useful: d.fb.useful, clear: d.fb.clear, again: d.fb.again });
  db.draft = null; save(); go('done');
}
function exportData() {
  const out = { app: 'CarWise customer trial', version: 1, exportedAt: new Date().toISOString(), synthetic_valuation: true, pii: 'none collected', research_consent: db.research, summary: stats(), feedback: db.feedback, events: db.events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `carwise_trial_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

let deferredInstall = null;
let pendingStart = false;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

document.addEventListener('click', e => {
  if (e.target.id === 'sheetBackdrop') { if (db.consent) closeSheet(); return; }
  const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
  const o = e.target.closest('[data-open]'); if (o) { viewing = o.dataset.open; go('view'); return; }
  const d = db.draft;
  const c = e.target.closest('[data-cond]'); if (c && d) { d.car.condition = c.dataset.cond; save(); vCar(); return; }
  const h = e.target.closest('[data-has]'); if (h && d) { d.loan.has = h.dataset.has; save(); vLoan(); return; }
  const n = e.target.closest('[data-next]'); if (n && d) { d.nextStep = n.dataset.next; save(); track('next_step_select', { nextStep: d.nextStep }); vNext(); return; }
  const r = e.target.closest('[data-rate]'); if (r && d) { d.fb[r.dataset.rate] = Number(r.dataset.v); save(); vNext(); return; }
  const ag = e.target.closest('[data-again]'); if (ag && d) { d.fb.again = ag.dataset.again; save(); vNext(); return; }
  const t = e.target.closest('[data-action]'); if (!t) return;
  switch (t.dataset.action) {
    case 'start': if (!db.consent) { pendingStart = true; sheetConsent(); return; } startJourney(); break;
    case 'consent': db.consent = new Date().toISOString(); db.research = el('researchOk').checked; save(); closeSheet(); if (pendingStart) { pendingStart = false; startJourney(); } break;
    case 'back': history.back(); break;
    case 'quit': if (confirm('ออกจากการประเมิน? ข้อมูลที่กรอกไว้จะถูกลบ')) { track('journey_abandon', { at: route }); db.draft = null; save(); go('home'); } break;
    case 'to-loan': track('step_complete', { step: 'car' }); go('loan'); break;
    case 'to-result': track('step_complete', { step: 'loan' }); computeResult(); go('result'); break;
    case 'to-options': go('options'); break;
    case 'to-next': go('next'); break;
    case 'finish': finish(); break;
    case 'reassess': { const car = db.cars.find(x => x.id === t.dataset.id); if (!car) return; startJourney(); db.draft.car = { ...car.car }; db.draft.loan = { ...car.loan }; save(); vCar(); break; }
    case 'delcar': if (confirm('ลบผลประเมินนี้?')) { db.cars = db.cars.filter(x => x.id !== t.dataset.id); save(); go('garage'); } break;
    case 'toggle-research': db.research = !db.research; if (!db.consent) db.consent = new Date().toISOString(); save(); vSettings(); toast(db.research ? 'เปิดบันทึกการใช้งานแล้ว' : 'ปิดบันทึกการใช้งานแล้ว'); break;
    case 'about': openSheet(aboutHtml + '<div class="btnstack"><button class="btn secondary" data-action="close">ปิด</button></div>'); break;
    case 'close': closeSheet(); break;
    case 'install':
      if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
      else openSheet(`<h3 id="sheetTitle">ติดตั้ง CarWise</h3><ul><li><b>Android:</b> เมนู ⋮ ของเบราว์เซอร์ → “เพิ่มลงในหน้าจอหลัก” / “ติดตั้งแอป”</li><li><b>iPhone:</b> ปุ่มแชร์ ⬆️ ใน Safari → “เพิ่มไปยังหน้าจอโฮม”</li></ul><div class="btnstack"><button class="btn secondary" data-action="close">ปิด</button></div>`);
      break;
    case 'export': exportData(); toast('ส่งออกข้อมูลแล้ว (ไม่มีข้อมูลส่วนบุคคล)'); break;
    case 'ai-run': { const target = route === 'view' ? db.cars.find(x => x.id === viewing) : db.draft; if (target) runAI(target); break; }
    case 'ai-cancel': if (aiController) aiController.abort(); break;
    case 'ai-save': { const v = (el('aiKeyInput').value || '').trim(); if (!/^sk-ant-[\w-]{20,}$/.test(v)) { toast('รูปแบบ key ไม่ถูกต้อง'); return; } try { localStorage.setItem(AI_KEY, v); } catch (e) { toast('บันทึก key ไม่ได้'); return; } vSettings(); toast('บันทึก key แล้ว (เฉพาะเครื่องนี้)'); break; }
    case 'ai-forget': if (confirm('ลบ API key ออกจากเครื่องนี้?')) { try { localStorage.removeItem(AI_KEY); } catch (e) { /* noop */ } vSettings(); toast('ลบ key แล้ว'); } break;
    case 'reset': if (confirm('ลบข้อมูลทั้งหมดในเครื่องนี้?')) { db = blank(); try { localStorage.removeItem(AI_KEY); } catch (e) { /* noop */ } save(); go('home'); toast('ลบข้อมูลแล้ว'); } break;
  }
});

document.addEventListener('change', e => {
  const t = e.target, d = db.draft; if (!d) return;
  const k = t.dataset.car;
  if (k === 'brand') { d.car.brand = t.value; d.car.model = ''; save(); vCar(); }
  else if (k === 'model') { d.car.model = t.value; save(); vCar(); }
  else if (k === 'year') { d.car.year = Number(t.value) || null; save(); vCar(); }
});

document.addEventListener('input', e => {
  const t = e.target, d = db.draft; if (!d) return;
  if (t.dataset.car === 'mileage' || t.dataset.loan) {
    const raw = t.value.replace(/[^\d]/g, '').slice(0, 9);
    const n = raw === '' ? NaN : Number(raw);
    const pos = t.value.length - t.selectionStart;
    t.value = raw === '' ? '' : (t.dataset.loan === 'months' ? raw : Number(raw).toLocaleString('en-US'));
    try { t.setSelectionRange(t.value.length - pos, t.value.length - pos); } catch (err) { /* noop */ }
    if (t.dataset.car) d.car.mileage = n; else d.loan[t.dataset.loan] = t.dataset.loan === 'months' ? (n > 120 ? 120 : n) : n;
    save();
    const btn = document.querySelector('.footerbar .btn:not(.secondary)');
    if (btn) {
      if (route === 'car') { const c = d.car; btn.disabled = !(c.brand && c.model && c.year && Number.isFinite(c.mileage) && c.mileage <= 1000000 && c.condition); }
      if (route === 'loan') { const l = d.loan; btn.disabled = !(l.has && (l.has !== 'yes' || (l.balance > 0) || (l.installment > 0 && l.months > 0))); }
    }
  } else if (t.matches('[data-comment]')) { d.fb.comment = t.value.slice(0, 500); save(); }
});

window.addEventListener('popstate', e => {
  if (!el('sheet').hidden && db.consent) { closeSheet(); history.pushState({ r: route }, '', '#' + route); return; }
  go((e.state && e.state.r) || 'home', false);
});
document.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('details[data-opt]') && e.target.open) track('option_view', { option: e.target.dataset.opt }); }, true);

// ---------- Boot ----------
(function boot() {
  const h = location.hash.slice(1);
  route = ['home', 'garage', 'settings'].includes(h) || (WIZARD.includes(h) && db.draft) ? h : 'home';
  history.replaceState({ r: route }, '', '#' + route);
  render();
  if (!db.consent) sheetConsent();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // Reload once when an updated version takes over, so returning users don't stay on a stale cached build.
    if (navigator.serviceWorker.controller) { let done = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!done) { done = true; location.reload(); } }); }
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
