# CarWise — Venture Validation Mobile App

Mobile app version of the CarWise *Venture Validation Command Center*: a 90-day, stage-gated
validation tracker (experiments E01–E05, funding gates G0/G1/G2/Reserve, evidence register,
independent review and Go / Pivot / Stop).

**Local-only prototype.** No backend, no partner API, no real transactions. All data stays in
`localStorage` on the device. The app migrates existing data from the web dashboard
(same `carwise_validation_v1` key) on first launch.

## Run

| Target | How |
|---|---|
| Browser / PWA | `npm run serve` → open `http://localhost:8080` on the phone (same Wi-Fi) → **Add to Home Screen**. Works offline after the first load (service worker). PWA install needs HTTPS or localhost. |
| Android (native) | `npm install` → `npm run cap:add:android` → `npm run cap:sync` → `npm run cap:open:android` (Android Studio) → Build APK/AAB |
| iOS (native) | `npm install` → `npm run cap:add:ios` → `npm run cap:sync` → `npm run cap:open:ios` (Xcode, macOS only) |
| Smoke test | `npm test` (Playwright + Chromium, iPhone 13 viewport) |

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
www/                 web app (no build step, no runtime dependencies)
  index.html         shell, CSP, PWA meta
  styles.css         mobile-first UI (bottom tab bar, bottom sheets, safe-area insets)
  app.js             state, rendering, control checks, export
  sw.js              offline app-shell cache (bump VERSION per release)
  manifest.webmanifest, icons/
capacitor.config.json  native wrapper config (appId com.carwise.validation)
tests/smoke.test.js    end-to-end test of the control rules below
```

## Controls added vs. the web dashboard

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
