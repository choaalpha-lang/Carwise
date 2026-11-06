# CarWise — Customer Trial App

Mobile app for **car owners** to test hypothesis **E01 – Customer Problem & Decision Utility**:
*does seeing “car value vs. remaining loan” help people decide (sell / trade-in / refinance / keep)?*

Live: https://choaalpha-lang.github.io/Carwise/ · Team tracker: https://choaalpha-lang.github.io/Carwise/team/

**Trial safeguards** — no backend, no partner API, no transactions; no name / phone / ID / plate
collected; valuations come from a **synthetic illustrative model** (not market data — data rights
are E03); partner-interest choices are a disclosed “fake door” (nothing is sent). Research logging
is opt-in, anonymous and stays on the device until the facilitator exports it.

## Customer journey (5 steps)

| Step | Screen | Logged event (opt-in) |
|---|---|---|
| 0 | Consent sheet (first launch) | — |
| 1 | Car: brand, model, year, mileage, condition | `journey_start`, `step_complete:car` |
| 2 | Loan: payoff amount, or installment × months remaining | `step_complete:loan` |
| 3 | Result: value range, equity (value − payoff), confidence, “why this number” | `result_view` |
| 4 | Options: sell / trade-in / refinance / keep — neutral, with risks | `option_view` |
| 5 | Next step + 3-question feedback | `next_step_select`, `journey_complete` |

Settings → *สำหรับผู้ดำเนินการทดลอง* shows the on-device funnel against E01 targets
(≥60% complete journey, ≥30% meaningful next step) and exports JSON for the evidence register.
Internal menus (Funding, Review, Evidence) were removed from the customer app and live only in
`/team/`.

## AI price check (PoC · Claude API + web search)

On the result screen, a facilitator device with an API key can run **“ค้นราคาด้วย AI”**:
`claude-opus-5-5` searches Thai listings (`web_search`) and returns a range + sources through a
strict tool (`report_price_estimate`). The app sanity-checks the answer (numeric range, http(s)
sources, divergence > 25% vs. the synthetic model is flagged) before showing it.

- Source `src/ai.mjs` → bundle `www/ai.js` via `npm run build:ai` (CI fails if they drift).
- Key: Settings → *AI ประเมินราคา* — stored only in that device's `localStorage`, never exported.
  Use a dedicated key with a low spend limit, on team devices only (moderated sessions).
- Sent to Anthropic: brand, model, year, mileage, condition — no personal data.
- Refusal fallback enabled (`fallbacks: "default"`); `pause_turn` resumed up to 3 times.
- Not production-ready: a browser-held key is acceptable only for a moderated PoC; production
  needs a backend proxy, rate limiting and an accuracy evaluation (E03).

## E03 accuracy evaluation (`eval/`)

Measures the AI price check — and the synthetic model as a baseline — against cars with known prices.

1. Copy `eval/reference-template.csv` → `eval/reference.csv` (git-ignored) and fill ≥ 30 cars.
   Prefer `transaction` prices; `listing` (asking price) is weaker evidence. No plates / VINs / owner data.
2. Agree the thresholds in `eval/e03-protocol.json` and fill `approval` **before** the first live run
   (pre-registration). Put the sites your reference prices came from in `blocked_domains` (leakage control).
3. `npm run e03 -- --ref eval/reference.csv` → dry run (validates inputs, no cost).
4. `ANTHROPIC_API_KEY=… npm run e03 -- --ref eval/reference.csv --live --confirm` → runs, resumable
   (`eval/runs/<protocol-id>/results.jsonl`), then writes `report.md` + `summary.json`.

Metrics: MAPE, median / P90 absolute % error, bias, range coverage, range width, invalid-output rate,
split by reference type, vehicle age and stated confidence (calibration); token / web-search usage and
cost. The report records SHA-256 of the protocol and the reference file. `--draft` allows a trial
run on an unapproved protocol, but the report is marked DRAFT and is not valid evidence.

## Run

| Target | How |
|---|---|
| Browser / PWA | `npm run serve` → open `http://localhost:8080` on the phone (same Wi-Fi) → **Add to Home Screen**. Works offline after the first load (service worker). PWA install needs HTTPS or localhost. |
| Android (native) | `npm install` → `npm run cap:add:android` → `npm run cap:sync` → `npm run cap:open:android` (Android Studio) → Build APK/AAB |
| iOS (native) | `npm install` → `npm run cap:add:ios` → `npm run cap:sync` → `npm run cap:open:ios` (Xcode, macOS only) |
| Tests | `npm test` — customer journey (Pixel 7) + team tracker (iPhone 13), Playwright |

## GitHub Pages

`.github/workflows/pages.yml` runs the smoke test on every PR and push, then deploys `www/` to
GitHub Pages on push to `main` (test must pass first).

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Live URL after the first deploy: `https://choaalpha-lang.github.io/Carwise/` (HTTPS, so
“Add to Home Screen” installs it as an app). Note: GitHub Pages sites are public — the app
contains no data, but users must not treat it as a place to store confidential evidence;
entries stay in each device's local storage only.

## Structure

```
www/                 customer app (no build step, no runtime dependencies)
  index.html, styles.css, app.js   wizard, synthetic valuation, research log
  sw.js, manifest.webmanifest, icons/
www/team/            internal validation tracker (experiments, funding gates, evidence, review)
capacitor.config.json  native wrapper config (appId com.carwise.validation)
tests/customer.test.js customer journey, consent, funnel stats, export
tests/team.test.js     team tracker control rules
```

## Team tracker (`/team/`): controls added vs. the web dashboard

| Area | Web dashboard | Mobile app |
|---|---|---|
| Experiment status "Evidence recorded" | selectable with no evidence | requires ≥1 level A–C evidence for that experiment; auto-reverts if that evidence is removed |
| "Experiments with evidence" KPI | counted any level incl. E (Synthetic) | counts A–C only; shows any-level count separately |
| Gate approval | always allowed | blocked while a *Critical* review concern is open; out-of-sequence approval (G1 before G0, G2 before G1) needs confirmation and is flagged |
| Spend vs. cap | no check | alerts when gate spend > cap, spend on non-approved gate, total > ฿1.2M, or missing receipt/approval ref |
| Proposed GO | no check | confirmation + alert when review is incomplete or has High/Critical concerns |
| Deletions | silent | confirmation; append-only change log (in JSON export) |
| Header status pill | hard-coded "CONDITIONAL GO" | reflects actual proposed decision |
| HTML escaping | `'` rendered as `undefined` | fixed |
| CSV export | raw text | formula-injection neutralised (`=`, `+`, `-`, `@`) |
| Storage | `sessionStorage` (lost when app closes) | `localStorage` (persists on device; Reset in ⋯ menu) |

The change log is local and editable by anyone with device access — it is **not** a
tamper-evident audit trail. Gate approvals, review ratings and checklists remain self-reported
demo controls, not funding authorisation or independent assurance.
