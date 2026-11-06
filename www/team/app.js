'use strict';
/* CarWise Venture Validation — mobile app (PWA / Capacitor shell).
   Local-only: no network calls, no partner APIs. State lives in localStorage on this device. */

const STORE_KEY = 'carwise_validation_v1';
const ENVELOPE = 1200000;
const LOG_LIMIT = 500;

// ---------- Static definitions (unchanged from the validation dashboard) ----------
const icons = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  experiments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/></svg>',
  funding: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 9h20M16 15h2"/></svg>',
  evidence: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v16h14V5a2 2 0 0 0-2-2h-3"/><rect x="8" y="2" width="4" height="4" rx="1"/><path d="M7 11h6M7 15h6"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>'
};
const screens = [
  ['overview', 'Overview', 'Executive Overview'],
  ['experiments', 'Experiments', 'Validation Experiments'],
  ['funding', 'Funding', 'Stage-gated Funding'],
  ['evidence', 'Evidence', 'Evidence Register'],
  ['review', 'Review', 'Independent Review']
];
const defs = [
  { id: 'E01', short: 'Customer', title: 'Customer Problem & Decision Utility', owner: 'Customer Research Lead', time: 'Day 1–30', desc: 'สัมภาษณ์กลุ่มเป้าหมาย 30 คน และวัดการลงมือทำจริง เทียบวิธีตัดสินใจเดิมกับ CarWise', target: '≥60% complete decision journey; ≥30% meaningful next-step', evidence: 'Recruitment log, task observations, comprehension, denominator and negative cases', risk: 'Selection bias; stated interest is not a real action' },
  { id: 'E02', short: 'Partner', title: 'Partner Willingness to Pay', owner: 'Commercial Lead', time: 'Day 10–60', desc: 'สัมภาษณ์ผู้มีอำนาจตัดสินใจ 8–10 องค์กร ทดสอบราคาและเงื่อนไข Success Fee / Lead Fee', target: '≥2 design partners with commercial path; ≥1 budget or paid-pilot commitment', evidence: 'Named budget owner, partner feedback, documented scope, price and terms', risk: 'LOI without budget or merely verbal interest' },
  { id: 'E03', short: 'Data', title: 'Data & Decision Accuracy', owner: 'Tech / Data Lead', time: 'Day 20–60', desc: 'เปรียบเทียบ Equity / Valuation กับข้อมูลอ้างอิงที่ได้รับอนุญาต พร้อมระบุ Error Distribution', target: '0 critical calculation defects; tolerance pre-agreed before test', evidence: 'Data rights, as-of dates, baseline, error distribution and exception log', risk: 'No valid data rights; estimation too inaccurate' },
  { id: 'E04', short: 'Unit econ', title: 'Unit Economics & Acquisition', owner: 'Finance Analyst', time: 'Day 31–90', desc: 'ทดลองช่องทางหาลูกค้าและกระทบยอด Funnel, CAC, Lead Acceptance และ Costs', target: 'Evidence-backed path to positive contribution, not mocked profit', evidence: 'Spend records, cohort funnel, paid/contracted revenue, operating costs', risk: 'Negative contribution when founder time and costs are included' },
  { id: 'E05', short: 'Regulatory', title: 'Regulatory, Privacy & Conduct', owner: 'External Legal / Privacy Advisor', time: 'Day 1–90', desc: 'วิเคราะห์กิจกรรม referral, data sharing, privacy, partner conduct และ conflict-of-interest', target: '0 unresolved critical legal/privacy issues for activities performed', evidence: 'Legal perimeter memo, data map, partner agreements, risk and remediation register', risk: 'Unlicensed activity or harmful / biased advice' }
];
const gates = [
  { id: 'G0', day: 'Day 1', name: 'Discovery authorization', cap: 300000, color: '#197969', prev: null, cond: 'Research protocol · initial legal scope · role assignment · IP check' },
  { id: 'G1', day: 'Day 30', name: 'Problem / demand evidence', cap: 420000, color: '#51a394', prev: 'G0', cond: 'Early customer observations · partner signals · spend reconciliation' },
  { id: 'G2', day: 'Day 60', name: 'Controlled pilot authorization', cap: 300000, color: '#83bdb0', prev: 'G1', cond: 'Partner scope · acceptable data accuracy · legal/privacy clearance' },
  { id: 'Reserve', day: 'Conditional', name: 'Discretionary reserve', cap: 180000, color: '#c9d6d1', prev: null, cond: 'Separate documented approval; never automatic' }
];
const ladder = [
  ['A', 'Observed & Verifiable', 'Paid pilot, actual attributable transaction, verified cost'],
  ['B', 'Documented Commitment', 'Signed pilot terms, budget-holder confirmation'],
  ['C', 'Observed Behavior', 'User performs meaningful action during testing'],
  ['D', 'Stated Interest', 'Interview enthusiasm, non-binding LOI'],
  ['E', 'Synthetic', 'Mock data, demo quote, illustrative economics']
];
const DECISION_GRADE = new Set(['A', 'B', 'C']);
const reviewDefs = [['problem', 'Problem–Solution Fit'], ['commercial', 'Commercial Viability'], ['financial', 'Financial Integrity'], ['technical', 'Technical & Data'], ['regulatory', 'Regulatory & Conduct'], ['moat', 'Strategic Defensibility']];
const checklist = ['Customer behavior observed beyond statements of interest', 'Partner budget and commercial path documented', 'Revenue and costs reconciled to evidence', 'Data accuracy and rights assessed', 'Legal/privacy/consumer conduct cleared for actual activities', 'Independent challenger opinion documented'];
const statusLabel = { notstarted: 'Not started', progressing: 'In progress', done: 'Evidence recorded', blocked: 'Blocked' };
const gateLabel = { pending: 'Pending', approved: 'Approved (demo)', hold: 'Hold', rejected: 'Rejected' };
const concernLabel = { unreviewed: 'Not independently reviewed', low: 'Low concern (self-assessed)', medium: 'Medium concern', high: 'High concern', critical: 'Critical concern' };

// ---------- State ----------
const blank = () => ({
  experiments: Object.fromEntries(defs.map(d => [d.id, { status: 'notstarted', count: 0, notes: '' }])),
  gates: {}, expenses: [], evidence: [], review: {}, decision: '', reviewNotes: '', log: []
});

function load() {
  const parse = s => { try { return JSON.parse(s || 'null'); } catch (e) { return null; } };
  let v = null;
  try { v = parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* storage blocked */ }
  if (!v) { try { v = parse(sessionStorage.getItem(STORE_KEY)); } catch (e) { /* ignore */ } } // migrate from web dashboard
  if (!(v && v.experiments && v.gates && Array.isArray(v.expenses) && Array.isArray(v.evidence) && v.review)) return blank();
  defs.forEach(d => { if (!v.experiments[d.id] || !statusLabel[v.experiments[d.id].status]) v.experiments[d.id] = { status: 'notstarted', count: 0, notes: '' }; });
  if (!Array.isArray(v.log)) v.log = [];
  v.expenses.forEach(e => { if (!e.id) e.id = uid(); });
  v.evidence.forEach(e => { if (!e.id) e.id = uid(); });
  return v;
}
function uid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase(); }

let db = load();
let current = 'overview';

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('Storage unavailable — changes stay only until the app closes'); }
}
// Append-only change log (kept in export). Deleting records does not delete their log lines.
function logEvent(action, detail) {
  db.log.push({ at: new Date().toISOString(), action, detail: String(detail ?? '').slice(0, 240) });
  if (db.log.length > LOG_LIMIT) db.log.splice(0, db.log.length - LOG_LIMIT);
}
function commit(action, detail) { if (action) logEvent(action, detail); save(); render(); }

// ---------- Helpers ----------
const el = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');
const compact = n => n >= 1e6 ? '฿' + (n / 1e6).toFixed(n % 1e6 ? 2 : 1).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? '฿' + Math.round(n / 1e3) + 'K' : money(n);
const totalSpend = () => db.expenses.reduce((a, e) => a + Number(e.amount), 0);
const gateSpend = id => db.expenses.filter(x => x.gate === id).reduce((a, x) => a + Number(x.amount), 0);
const gateState = id => db.gates[id] || 'pending';
const evidenceFor = id => db.evidence.filter(e => e.experiment === id);
// Unambiguous local timestamp (YYYY-MM-DD HH:mm, Gregorian) for audit readability.
const fmtTime = iso => { const d = new Date(iso); if (isNaN(d)) return String(iso ?? ''); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function toast(s) {
  const t = el('toast'); t.textContent = s; t.classList.add('show');
  clearTimeout(window._toastTimer); window._toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}
function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* noop */ } }

// ---------- Control checks (surface gaps instead of silently allowing them) ----------
function controlAlerts() {
  const a = [];
  const crit = reviewDefs.filter(([k]) => db.review[k] === 'critical').map(([, n]) => n);
  const high = reviewDefs.filter(([k]) => db.review[k] === 'high').map(([, n]) => n);
  const unreviewed = reviewDefs.some(([k]) => !db.review[k] || db.review[k] === 'unreviewed');
  if (crit.length) a.push(['high', `Critical concern: ${crit.join(', ')} — stop affected activities; no gate release.`]);
  if (high.length) a.push(['med', `High concern: ${high.join(', ')} — hold relevant gate until mitigation is independently reviewed.`]);
  gates.forEach(g => {
    const s = gateSpend(g.id);
    if (s > g.cap) a.push(['high', `${g.id} recorded spend ${money(s)} exceeds release cap ${money(g.cap)}.`]);
    if (s > 0 && gateState(g.id) !== 'approved') a.push(['med', `${g.id} has ${money(s)} spend recorded but gate is ${gateLabel[gateState(g.id)]}.`]);
    if (g.prev && gateState(g.id) === 'approved' && gateState(g.prev) !== 'approved') a.push(['med', `${g.id} approved before ${g.prev} — gate sequence broken.`]);
  });
  if (totalSpend() > ENVELOPE) a.push(['high', `Total recorded spend ${money(totalSpend())} exceeds ฿1.2M envelope.`]);
  const noRef = db.expenses.filter(e => !e.ref).length;
  if (noRef) a.push(['med', `${noRef} expense line(s) without receipt / approval reference.`]);
  defs.forEach(d => {
    if (db.experiments[d.id].status === 'done' && !evidenceFor(d.id).some(e => DECISION_GRADE.has(e.level)))
      a.push(['med', `${d.id} marked "Evidence recorded" but has no level A–C evidence.`]);
  });
  if (db.decision === 'GO' && (unreviewed || crit.length || high.length)) a.push(['high', 'Proposed GO while review is incomplete or has high/critical concerns.']);
  return a;
}

// ---------- Rendering ----------
function renderTabs() {
  const alerts = controlAlerts().length;
  el('tabbar').innerHTML = '<div class="tabbar-inner">' + screens.map(([id, label]) =>
    `<button class="tab ${id === current ? 'active' : ''}" data-action="nav" data-target="${id}" aria-label="${label}" ${id === current ? 'aria-current="page"' : ''}>
      <span class="ico">${icons[id]}${id === 'overview' && alerts ? `<span class="badge">${alerts}</span>` : ''}</span><span>${label}</span></button>`).join('') + '</div>';
}

function renderHeader() {
  const s = screens.find(x => x[0] === current);
  el('pageTitle').textContent = s[2];
  const p = el('decisionPill');
  p.textContent = db.decision || 'PENDING';
  p.title = db.decision ? 'Proposed decision (draft, not approved)' : 'No decision proposed';
  p.className = 'pill ' + (db.decision ? db.decision.toLowerCase() : '');
}

function renderOverview() {
  const decisionGradeExp = new Set(db.evidence.filter(e => DECISION_GRADE.has(e.level)).map(e => e.experiment));
  const anyExp = new Set(db.evidence.map(e => e.experiment));
  const spent = totalSpend();
  const alerts = controlAlerts();
  const bars = defs.map(d => {
    const e = db.experiments[d.id];
    const val = { done: 100, progressing: 50, blocked: 15, notstarted: 0 }[e.status];
    return `<div class="barrow"><span>${d.id} · ${esc(d.short)}</span><div class="progress"><span style="width:${val}%;${e.status === 'blocked' ? 'background:#c65050' : ''}"></span></div><b>${statusLabel[e.status].replace('Evidence recorded', 'Recorded')}</b></div>`;
  }).join('');
  el('screen-overview').innerHTML = `
    <div class="hero">
      <div class="eyebrow">90-DAY VENTURE VALIDATION</div>
      <h2>Prove the business.<br>Not just the product.</h2>
      <p>พิสูจน์ Customer Value, Partner Willingness to Pay, Data Accuracy และ Unit Economics ก่อนลงทุนขยาย CarWise โดยไม่สมมติว่าผลทดลองสำเร็จแล้ว</p>
      <div class="hero-auth"><div><span>Current authorization</span><strong>Validation only</strong></div><span style="text-align:right">No commercial scale<br>No live API</span></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="label">Investment envelope · assumption</div><div class="value">฿1.2M</div><strong>Stage-gated ceiling</strong></div>
      <div class="kpi"><div class="label">Experiments with A–C evidence</div><div class="value">${decisionGradeExp.size} / 5</div><strong>${anyExp.size} with any entry · not yet verified</strong></div>
      <div class="kpi ${spent > ENVELOPE ? 'bad' : ''}"><div class="label">Recorded spend · demo</div><div class="value">${compact(spent)}</div><strong>Manual entry only</strong></div>
      <div class="kpi"><div class="label">Proposed decision</div><div class="value" style="font-size:20px">${esc(db.decision || 'Pending')}</div><strong>Day 90 independent gate</strong></div>
    </div>
    <h3 class="sectiontitle">Control Alerts <span class="tag ${alerts.some(x => x[0] === 'high') ? 'blocked' : alerts.length ? 'progressing' : 'done'}">${alerts.length || 'None'}</span></h3>
    <div class="card">${alerts.length ? alerts.map(([sev, msg]) => `<div class="alert ${sev}"><span class="dot"></span><span>${esc(msg)}</span></div>`).join('') : '<div class="empty">No control exceptions detected from entered data. Absence of alerts ≠ assurance.</div>'}</div>
    <h3 class="sectiontitle">Experiment Readiness <button class="linkbtn" data-action="nav" data-target="experiments">Manage →</button></h3>
    <div class="card">${bars}<p class="small" style="margin:6px 0 0">แถบแสดงสถานะที่ผู้ใช้เลือก ไม่ใช่ผลประเมินคุณภาพจริง</p></div>
    <h3 class="sectiontitle">Funding Gates <button class="linkbtn" data-action="nav" data-target="funding">Review →</button></h3>
    <div class="card">${gates.map(g => `<div class="gate"><div class="gatecircle">${g.id === 'Reserve' ? 'R' : g.id}</div><div class="gatebody"><div class="row"><b>${g.day} · ${esc(g.name)}</b><span class="tag ${gateState(g.id)}">${gateLabel[gateState(g.id)]}</span></div><p>${money(g.cap)} cap · ${esc(g.cond)}</p></div></div>`).join('')}</div>
    <h3 class="sectiontitle">Watch Items</h3>
    <div class="card"><div class="eyebrow">CUSTOMER</div><b>Evidence before enthusiasm</b><p class="small" style="margin:4px 0 0">Interview opinions are not the same as observed user actions. Check the denominator and recruitment bias.</p></div>
    <div class="card"><div class="eyebrow">COMMERCIAL</div><b>Partner interest ≠ revenue</b><p class="small" style="margin:4px 0 0">Demand should be linked to a decision-maker, pilot scope, budget and an attributable payable event.</p></div>
    <div class="card"><div class="eyebrow">RISK</div><b>Hard-stop conditions</b><p class="small" style="margin:4px 0 0">No real financial transactions, data sharing or partner integration without specific clearance.</p></div>`;
}

function renderExperiments() {
  el('screen-experiments').innerHTML = `<div class="notice orange">ค่าเริ่มต้นทุกการทดลองเป็น <b>Not started</b> ไม่มีการใส่ผลสำเร็จจำลอง สถานะ “Evidence recorded” เลือกได้เมื่อมีหลักฐานระดับ A–C ของการทดลองนั้นแล้วเท่านั้น</div>` +
    defs.map(d => {
      const x = db.experiments[d.id];
      const ev = evidenceFor(d.id);
      return `<details class="card exp" data-exp="${d.id}">
        <summary><div class="expnumber">${d.id}</div><div style="flex:1;min-width:0"><div class="exptitle">${esc(d.title)}</div>
          <div class="small">${esc(d.owner)} · ${esc(d.time)}</div>
          <div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap"><span class="tag ${x.status}">${statusLabel[x.status]}</span><span class="tag">${ev.length} evidence</span><span class="tag">n = ${Number(x.count) || 0}</span></div></div>
          <span class="chev">${icons.chev}</span></summary>
        <div class="expbody">
          <p>${esc(d.desc)}</p>
          <div class="kv"><div class="k">Proposed pass threshold</div><div class="v">${esc(d.target)}</div></div>
          <div class="kv"><div class="k">Evidence required</div><div class="v" style="font-weight:400">${esc(d.evidence)}</div></div>
          <div class="notice orange" style="margin:12px 0 0"><b>Falsification risk</b><br>${esc(d.risk)}</div>
          <div class="expcontrols">
            <label class="field">Status<select data-change="exp-status" data-id="${d.id}">${Object.entries(statusLabel).map(([v, t]) => `<option value="${v}" ${x.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <label class="field">Observed sample (n)<input type="number" inputmode="numeric" min="0" step="1" value="${Number(x.count) || 0}" data-change="exp-count" data-id="${d.id}"></label>
          </div>
          <label class="field" style="margin-top:10px">Working notes<textarea maxlength="1000" data-input="exp-notes" data-id="${d.id}" placeholder="บันทึกการทำงาน (ไม่ใช่หลักฐาน)">${esc(x.notes)}</textarea></label>
          <button class="btn secondary block" data-action="add-evidence" data-exp="${d.id}">+ Record evidence for ${d.id}</button>
        </div></details>`;
    }).join('');
}

function renderFunding() {
  const spent = totalSpend();
  const remaining = ENVELOPE - spent;
  el('screen-funding').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="label">Approved ceiling · assumption</div><div class="value">฿1.2M</div><strong>Not actual funding</strong></div>
      <div class="kpi ${spent > ENVELOPE ? 'bad' : ''}"><div class="label">Actual spend · entered</div><div class="value">${compact(spent)}</div><strong>Do not infer approvals</strong></div>
      <div class="kpi ${remaining < 0 ? 'bad' : ''}"><div class="label">Unspent planned envelope</div><div class="value">${remaining < 0 ? '−' + compact(-remaining) : compact(remaining)}</div><strong>Not necessarily available cash</strong></div>
      <div class="kpi"><div class="label">Reserve · uncommitted</div><div class="value">฿180K</div><strong>Separate approval required</strong></div>
    </div>
    <h3 class="sectiontitle">Budget by Release Gate</h3>
    <div class="card">
      <div class="budget">${gates.map(g => `<span style="width:${g.cap / ENVELOPE * 100}%;background:${g.color}"></span>`).join('')}</div>
      <div class="legend">${gates.map(g => `<span><i style="background:${g.color}"></i>${g.id} ${compact(g.cap)}</span>`).join('')}</div>
      ${gates.map(g => {
        const actual = gateSpend(g.id), pct = Math.min(100, actual / g.cap * 100);
        return `<div class="listitem"><div class="row"><b>${g.id} · ${g.day}</b><span class="tag ${gateState(g.id)}">${gateLabel[gateState(g.id)]}</span></div>
          <div class="small" style="margin:3px 0 8px">${esc(g.name)} · ${esc(g.cond)}</div>
          <div class="progress"><span style="width:${pct}%;${actual > g.cap ? 'background:#c65050' : ''}"></span></div>
          <div class="row small" style="margin:6px 0 10px"><span>Recorded ${money(actual)}</span><span>Cap ${money(g.cap)}</span></div>
          <label class="field" style="margin:0"><select aria-label="${g.id} gate decision" data-change="gate" data-id="${g.id}">${Object.entries(gateLabel).map(([v, t]) => `<option value="${v}" ${gateState(g.id) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>`;
      }).join('')}
    </div>
    <h3 class="sectiontitle">Spend Ledger <button class="btn small" data-action="add-expense">+ Add</button></h3>
    <div class="card">${db.expenses.length ? db.expenses.map(e => `<div class="listitem"><div class="row"><div class="title">${esc(e.purpose)}</div><div class="num" style="white-space:nowrap">${money(e.amount)}</div></div>
        <div class="row" style="margin-top:6px"><span class="small">${esc(e.gate)} · ${e.ref ? 'Ref: ' + esc(e.ref) : '<span style="color:#b96b22">No reference</span>'}${e.recordedAt ? ' · ' + esc(fmtTime(e.recordedAt)) : ''}</span>
        <button class="btn danger small" data-action="del-expense" data-id="${esc(e.id)}">Remove</button></div></div>`).join('')
      : '<div class="empty">No expenses recorded — not evidence of zero real-world spending.</div>'}
      <button class="btn secondary block" style="margin-top:12px" data-action="csv">Export ledger CSV</button>
    </div>
    <div class="notice orange">ตัวเลขที่กรอกคือข้อมูลสาธิตในเครื่องนี้ ไม่ใช่รายการใช้เงินจริงของโครงการ และการบันทึกไม่ได้อนุมัติงบประมาณหรือยืนยันการจ่ายเงิน</div>`;
}

function renderEvidence() {
  el('screen-evidence').innerHTML = `
    <button class="btn block" data-action="add-evidence" style="margin-bottom:12px">+ Record an evidence item</button>
    <details class="card exp"><summary><div style="flex:1"><b>Evidence Quality Ladder</b><div class="small">A–C count as decision-grade · D–E do not</div></div><span class="chev">${icons.chev}</span></summary>
      <div class="expbody" style="padding-top:8px">${ladder.map(x => `<div class="gate"><div class="gatecircle">${x[0]}</div><div class="gatebody"><b>${x[1]}</b><p>${x[2]}</p></div></div>`).join('')}</div></details>
    <h3 class="sectiontitle">Evidence Register <span class="small">${db.evidence.length} item(s)</span></h3>
    <div class="card">${db.evidence.length ? db.evidence.map(e => `<div class="listitem">
        <div class="row" style="align-items:flex-start"><div class="title">${esc(e.title)}</div><span class="tag lv${esc(e.level)}">${esc(e.level)}</span></div>
        <div class="small" style="margin-top:3px">${esc(e.experiment)}${e.ref ? ' · ' + esc(e.ref) : ''}${e.recordedAt ? ' · ' + esc(fmtTime(e.recordedAt)) : ''}</div>
        ${e.caveat ? `<div class="small" style="margin-top:6px;color:#875f30"><b>Caveat:</b> ${esc(e.caveat)}</div>` : '<div class="small" style="margin-top:6px;color:#b96b22">No caveat / counter-evidence recorded</div>'}
        <div style="text-align:right;margin-top:6px"><button class="btn danger small" data-action="del-evidence" data-id="${esc(e.id)}">Remove</button></div></div>`).join('')
      : '<div class="empty">No real-world evidence entered yet. Prototype acceptance does not prove market demand.</div>'}</div>
    <div class="notice">การบันทึกรายการยังไม่ถือเป็นการตรวจรับรองหลักฐาน ต้องตรวจเอกสารต้นทาง วิธีเก็บข้อมูลและคุณภาพตัวหารโดยผู้ประเมินอิสระ</div>`;
}

function renderReview() {
  const vals = reviewDefs.map(([k]) => db.review[k] || 'unreviewed');
  const critical = vals.includes('critical'), high = vals.includes('high'), unreviewed = vals.includes('unreviewed');
  const msg = critical ? 'Critical finding recorded. Stop affected activities and do not release funding.'
    : high ? 'High concern recorded. Hold relevant gate until mitigation is independently reviewed.'
    : unreviewed ? 'Review incomplete. No investment conclusion should be treated as validated.'
    : 'All review lenses have entries, but actual evidence and reviewer independence must still be checked.';
  const done = checklist.filter((_, i) => db.review['check' + i]).length;
  el('screen-review').innerHTML = `
    <div class="notice orange">Independent Review ในแอปนี้เป็นการฝึกตัดสินใจ ไม่ใช่ Independent Assurance จริง กรุณาให้ผู้ประเมินที่ไม่มีส่วนได้เสียตรวจข้อมูลและลงนามภายนอกระบบก่อนใช้ประกอบการลงทุน</div>
    <h3 class="sectiontitle">Six Challenge Lenses</h3>
    <div class="card">${reviewDefs.map(([id, name]) => `<label class="field"><span>${esc(name)}</span><select data-change="review" data-id="${id}">${Object.entries(concernLabel).map(([v, t]) => `<option value="${v}" ${(db.review[id] || 'unreviewed') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}</div>
    <h3 class="sectiontitle">Proposed Investment Outcome</h3>
    <div class="card">
      <div class="small" style="margin-bottom:10px">เลือกการตัดสินใจที่เสนอ ข้อมูลนี้ไม่ถือว่าเป็นอนุมัติจริง</div>
      <div class="segmented decision" role="radiogroup" aria-label="Proposed decision">${['GO', 'PIVOT', 'STOP'].map(v => `<button role="radio" aria-checked="${db.decision === v}" class="${db.decision === v ? 'selected' : ''}" data-action="decision" data-value="${v}">${v}</button>`).join('')}</div>
      ${db.decision ? '<div style="text-align:right"><button class="linkbtn" data-action="decision" data-value="">Clear selection</button></div>' : ''}
      <label class="field" style="margin-top:12px">Independent review rationale<textarea id="reviewNotes" data-input="review-notes" placeholder="เหตุผล เงื่อนไข และข้อมูลที่ยังขาด">${esc(db.reviewNotes)}</textarea></label>
      <div class="conclusion"><b>Suggested review hygiene</b><p class="small">${msg}</p><p class="small">Proposed decision: <b>${esc(db.decision || 'Not selected')}</b> · Demo only</p></div>
    </div>
    <h3 class="sectiontitle">Investment Gate Checklist <span class="small">${done} / ${checklist.length}</span></h3>
    <div class="card">${checklist.map((x, i) => `<label class="check"><input type="checkbox" ${db.review['check' + i] ? 'checked' : ''} data-change="check" data-id="${i}"><span>${esc(x)}</span></label>`).join('')}<p class="small" style="margin:8px 0 0">Checkboxes are self-reported demo controls; not a certification.</p></div>
    <button class="btn block" data-action="export">Export evidence & decision record (JSON)</button>
    <h3 class="sectiontitle">Change Log <span class="small">${db.log.length} event(s)</span></h3>
    <div class="card">${db.log.length ? db.log.slice(-25).reverse().map(l => `<div class="logitem"><time>${esc(fmtTime(l.at))}</time><span><b>${esc(l.action)}</b>${l.detail ? ' · ' + esc(l.detail) : ''}</span></div>`).join('') + (db.log.length > 25 ? '<p class="small" style="margin:8px 0 0">Showing latest 25 — full log is in the JSON export.</p>' : '') : '<div class="empty">No changes recorded yet.</div>'}
      <p class="small" style="margin:8px 0 0">Local log on this device; editable by anyone with device access — not a tamper-evident audit trail.</p></div>`;
}

function render() {
  renderHeader(); renderTabs();
  ({ overview: renderOverview, experiments: renderExperiments, funding: renderFunding, evidence: renderEvidence, review: renderReview })[current]();
}

function navigate(name, push = true) {
  if (!screens.some(s => s[0] === name)) return;
  current = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  if (push) history.pushState({ screen: name }, '', '#' + name);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- Bottom sheet ----------
let lastFocus = null;
function openSheet(html) {
  lastFocus = document.activeElement;
  el('sheetBody').innerHTML = html;
  el('sheet').hidden = false; el('sheetBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  const f = el('sheet').querySelector('input,select,textarea,button');
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
}
function closeSheet() {
  el('sheet').hidden = true; el('sheetBackdrop').hidden = true;
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

function sheetExpense() {
  openSheet(`<h3 id="sheetTitle">Add expense</h3>
    <label class="field">Expense / purpose<input id="spendPurpose" maxlength="200" placeholder="เช่น Research interviews"></label>
    <label class="field">Amount (THB)<input id="spendAmount" type="number" inputmode="numeric" min="1" step="1" placeholder="0"></label>
    <label class="field">Gate<select id="spendGate">${gates.map(g => `<option value="${g.id}">${g.id} · ${esc(g.name)} (${gateLabel[gateState(g.id)]})</option>`).join('')}</select></label>
    <label class="field">Evidence reference<input id="spendRef" maxlength="120" placeholder="Receipt / approval ID"><span class="hint">แนะนำให้ระบุ — รายการที่ไม่มี Ref จะแสดงเป็น Control Alert</span></label>
    <div class="btnrow"><button class="btn secondary" data-action="close-sheet">Cancel</button><button class="btn" data-action="save-expense">Save</button></div>`);
}
function saveExpense() {
  const purpose = el('spendPurpose').value.trim(), amount = Number(el('spendAmount').value), gate = el('spendGate').value, ref = el('spendRef').value.trim();
  if (!purpose || purpose.length > 200 || !Number.isSafeInteger(amount) || amount <= 0 || amount > ENVELOPE || !gates.some(g => g.id === gate)) {
    toast('Enter a valid purpose and whole THB amount (1 – 1,200,000)'); return;
  }
  db.expenses.push({ id: uid(), purpose, amount, gate, ref, recordedAt: new Date().toISOString() });
  closeSheet(); commit('Expense added', `${gate} ${money(amount)} — ${purpose}${ref ? ' [' + ref + ']' : ' [no ref]'}`); haptic();
  const g = gates.find(x => x.id === gate);
  if (gateSpend(gate) > g.cap) toast(`Recorded — ${gate} now exceeds its release cap`);
  else if (gateState(gate) !== 'approved') toast(`Recorded — note: ${gate} gate is not approved`);
  else toast('Recorded in local demo ledger (not paid or approved)');
}

function sheetEvidence(exp) {
  openSheet(`<h3 id="sheetTitle">Record evidence</h3>
    <label class="field">Experiment<select id="evExp">${defs.map(d => `<option value="${d.id}" ${d.id === exp ? 'selected' : ''}>${d.id} · ${esc(d.title)}</option>`).join('')}</select></label>
    <label class="field">Evidence level<select id="evLevel">${ladder.map(([k, n]) => `<option value="${k}">${k} — ${n}</option>`).join('')}</select></label>
    <label class="field">Title / observation<input id="evTitle" maxlength="180" placeholder="สิ่งที่พบ / หลักฐานที่เก็บได้"></label>
    <label class="field">Reference<input id="evRef" maxlength="220" placeholder="รหัสเอกสาร ไม่ต้องใส่ข้อมูลส่วนบุคคล"><span class="hint">PDPA: ห้ามใส่ชื่อ เบอร์โทร เลขบัตร หรือข้อมูลระบุตัวตน</span></label>
    <label class="field">Caveat / counter-evidence<textarea id="evCaveat" maxlength="600" placeholder="ข้อจำกัดของข้อมูลหรือผลที่ขัดกับสมมติฐาน"></textarea></label>
    <div class="btnrow"><button class="btn secondary" data-action="close-sheet">Cancel</button><button class="btn" data-action="save-evidence">Save</button></div>`);
}
function saveEvidence() {
  const experiment = el('evExp').value, level = el('evLevel').value, title = el('evTitle').value.trim(), ref = el('evRef').value.trim(), caveat = el('evCaveat').value.trim();
  if (!title) { toast('Please enter an observation or evidence title'); return; }
  if (!defs.some(d => d.id === experiment) || !ladder.some(l => l[0] === level)) return;
  db.evidence.push({ id: uid(), experiment, level, title, ref, caveat, recordedAt: new Date().toISOString() });
  closeSheet(); commit('Evidence added', `${experiment} level ${level} — ${title}`); haptic();
  toast(DECISION_GRADE.has(level) ? 'Evidence recorded — independent verification still required' : `Level ${level} recorded — not decision-grade evidence`);
}

let deferredInstall = null;
function sheetMore() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  openSheet(`<h3 id="sheetTitle">CarWise Validation</h3>
    <button class="menuitem" data-action="export">⇩<span>Export data (JSON)<small>Experiments, evidence, ledger, review & change log</small></span></button>
    <button class="menuitem" data-action="csv">⇩<span>Export spend ledger (CSV)<small>UTF-8 with BOM for Excel</small></span></button>
    ${!standalone && deferredInstall ? '<button class="menuitem" data-action="install">＋<span>Install app<small>Add CarWise to your home screen</small></span></button>' : ''}
    ${!standalone && !deferredInstall && /iphone|ipad|ipod/i.test(navigator.userAgent) ? '<div class="notice" style="margin:10px 0">ติดตั้งบน iPhone: กด Share → “Add to Home Screen”</div>' : ''}
    <button class="menuitem danger" data-action="reset">↻<span>Reset demo data<small>Deletes all local entries on this device</small></span></button>
    <p class="small" style="margin-top:10px">Local-only prototype · no server, no partner API, no real transactions.</p>`);
}

// ---------- Export ----------
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const stamp = () => new Date().toISOString().slice(0, 10);
function exportJSON() {
  logEvent('Export JSON', ''); save();
  const out = { prototype: 'CarWise Validation Command Center (mobile)', synthetic_demo: true, exportedAt: new Date().toISOString(), controlAlerts: controlAlerts().map(([s, m]) => ({ severity: s, message: m })), ...db };
  download(JSON.stringify(out, null, 2), `carwise_validation_export_${stamp()}.json`, 'application/json');
  render();
}
// Neutralise spreadsheet formula injection (=, +, -, @, tab, CR) in text cells.
const csvCell = x => { let s = String(x ?? ''); if (typeof x !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
function exportCSV() {
  logEvent('Export CSV', `${db.expenses.length} line(s)`); save();
  const rows = [['Purpose', 'Gate', 'Amount THB', 'Evidence ref', 'Recorded at'], ...db.expenses.map(e => [e.purpose, e.gate, Number(e.amount), e.ref, e.recordedAt || ''])];
  download('﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), `carwise_spend_ledger_${stamp()}.csv`, 'text/csv;charset=utf-8');
  render();
}

// ---------- Event wiring ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case 'nav': navigate(t.dataset.target); break;
    case 'more': sheetMore(); break;
    case 'close-sheet': closeSheet(); break;
    case 'add-expense': sheetExpense(); break;
    case 'save-expense': saveExpense(); break;
    case 'add-evidence': sheetEvidence(t.dataset.exp || 'E01'); break;
    case 'save-evidence': saveEvidence(); break;
    case 'del-expense': {
      const i = db.expenses.findIndex(x => x.id === t.dataset.id); if (i < 0) return;
      const x = db.expenses[i];
      if (!confirm(`Remove expense "${x.purpose}" (${money(x.amount)})? The removal is kept in the change log.`)) return;
      db.expenses.splice(i, 1); commit('Expense removed', `${x.gate} ${money(x.amount)} — ${x.purpose}`); break;
    }
    case 'del-evidence': {
      const i = db.evidence.findIndex(x => x.id === t.dataset.id); if (i < 0) return;
      const x = db.evidence[i];
      if (!confirm(`Remove evidence "${x.title}"? The removal is kept in the change log.`)) return;
      db.evidence.splice(i, 1);
      const st = db.experiments[x.experiment];
      if (st && st.status === 'done' && !evidenceFor(x.experiment).some(v => DECISION_GRADE.has(v.level))) { st.status = 'progressing'; toast(`${x.experiment} reverted to In progress — no A–C evidence left`); }
      commit('Evidence removed', `${x.experiment} level ${x.level} — ${x.title}`); break;
    }
    case 'decision': {
      const v = t.dataset.value;
      const unreviewed = reviewDefs.some(([k]) => !db.review[k] || db.review[k] === 'unreviewed');
      const severe = reviewDefs.some(([k]) => ['high', 'critical'].includes(db.review[k]));
      if (v === 'GO' && (unreviewed || severe) && !confirm('Review is incomplete or has high/critical concerns. Record a proposed GO anyway? It will be flagged as a control alert.')) return;
      db.decision = v; commit('Decision proposed', v || 'cleared'); haptic();
      toast(v ? 'Draft recommendation saved; independent approval still required' : 'Proposed decision cleared'); break;
    }
    case 'export': closeSheet(); exportJSON(); break;
    case 'csv': closeSheet(); exportCSV(); break;
    case 'install': closeSheet(); if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } break;
    case 'reset':
      if (!confirm('Reset all local experiment, evidence, expense, review entries and the change log on this device?')) return;
      db = blank(); logEvent('Demo data reset', ''); closeSheet(); save(); render(); toast('Demo data reset'); break;
  }
});

document.addEventListener('change', e => {
  const t = e.target; const k = t.dataset.change; if (!k) return;
  const id = t.dataset.id;
  if (k === 'exp-status') {
    const v = t.value; if (!statusLabel[v] || !db.experiments[id]) return;
    if (v === 'done' && !evidenceFor(id).some(x => DECISION_GRADE.has(x.level))) {
      toast(`Record at least one level A–C evidence item for ${id} first`); t.value = db.experiments[id].status; return;
    }
    const prev = db.experiments[id].status; db.experiments[id].status = v;
    commit('Experiment status', `${id}: ${statusLabel[prev]} → ${statusLabel[v]}`);
    const open = document.querySelector(`details[data-exp="${id}"]`); if (open) open.open = true;
  } else if (k === 'exp-count') {
    const n = Number(t.value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000) { toast('Sample count must be a whole number 0 – 100,000'); t.value = db.experiments[id].count; return; }
    db.experiments[id].count = n; logEvent('Sample count', `${id}: n = ${n}`); save();
  } else if (k === 'gate') {
    const v = t.value; if (!gateLabel[v]) return;
    const g = gates.find(x => x.id === id);
    if (v === 'approved') {
      if (reviewDefs.some(([r]) => db.review[r] === 'critical')) { toast('Blocked: a critical review concern is open — do not release funding'); t.value = gateState(id); return; }
      if (g.prev && gateState(g.prev) !== 'approved' && !confirm(`${g.prev} is not approved. Approve ${id} out of sequence? It will be flagged.`)) { t.value = gateState(id); return; }
    }
    const prev = gateState(id); db.gates[id] = v;
    commit('Gate status', `${id}: ${gateLabel[prev]} → ${gateLabel[v]}`);
    toast('Demo gate status recorded; not a funding authorization');
  } else if (k === 'review') {
    if (!concernLabel[t.value]) return;
    const prev = db.review[id] || 'unreviewed'; db.review[id] = t.value;
    commit('Review lens', `${reviewDefs.find(r => r[0] === id)[1]}: ${concernLabel[prev]} → ${concernLabel[t.value]}`);
  } else if (k === 'check') {
    db.review['check' + id] = t.checked;
    commit('Checklist', `${t.checked ? '☑' : '☐'} ${checklist[id]}`);
  }
});

let notesTimer = null;
document.addEventListener('input', e => {
  const t = e.target; const k = t.dataset.input; if (!k) return;
  if (k === 'review-notes') db.reviewNotes = t.value;
  else if (k === 'exp-notes' && db.experiments[t.dataset.id]) db.experiments[t.dataset.id].notes = t.value.slice(0, 1000);
  save();
  clearTimeout(notesTimer); notesTimer = setTimeout(() => { logEvent(k === 'review-notes' ? 'Review rationale edited' : 'Experiment notes edited', t.dataset.id || ''); save(); }, 1500);
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el('sheet').hidden) closeSheet(); });
window.addEventListener('popstate', e => {
  if (!el('sheet').hidden) { closeSheet(); history.pushState({ screen: current }, '', '#' + current); return; }
  navigate((e.state && e.state.screen) || 'overview', false);
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('storage', e => { if (e.key === STORE_KEY) { db = load(); render(); } });

// ---------- Boot ----------
(function boot() {
  const start = location.hash.slice(1);
  current = screens.some(s => s[0] === start) ? start : 'overview';
  history.replaceState({ screen: current }, '', '#' + current);
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + current));
  save(); // persists any sessionStorage migration
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache optional */ }));
  }
})();
