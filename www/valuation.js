/* CarWise synthetic valuation model — shared by the app (browser global CarWiseValuation)
   and the E03 evaluation script (Node require). Illustrative only: NOT market data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CarWiseValuation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const r1k = n => Math.round(n / 1000) * 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
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

// ---------- Valuation (synthetic, transparent) ----------
function valuate(car, loan, nowYear = new Date().getFullYear()) {
  const model = (CATALOG[car.brand] || []).find(m => m[0] === car.model);
  const [, newPrice, type] = model;
  const age = Math.max(0, nowYear - car.year);
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

return { CATALOG, CONDITIONS, valuate };
});
