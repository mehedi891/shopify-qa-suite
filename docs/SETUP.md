# Setup Guide

What must exist before the first `qa run`. Several items need someone with
Shopify/Google admin rights — start these early, they gate Phase 1.

---

## 0. What I need from you to start (access checklist)

Design is done; these are the only blockers. Items marked ⏳ need someone with
Shopify or Google admin rights, so start them first — they take longer than the code.

**Shopify**
- [ ] ⏳ Dev store domain (`*.myshopify.com`) — dedicated to QA, not a demo store
- [ ] App installed on it, theme app extension enabled on the active theme
- [ ] App handle (the `/apps/<handle>` segment) and the app's URL host
- [ ] ⏳ QA staff account on that store — **2FA disabled if policy allows**
- [ ] Storefront password (Online Store → Preferences)
- [ ] Baseline data: a product `Test Product`, a collection `Test Collection`

**Google**
- [ ] Existing QA sheet? If yes, send the link — the column spec adapts to it
      rather than forcing a rewrite. If no, I generate the template.
- [ ] ⏳ Service account JSON key (Sheets API enabled)
- [ ] ⏳ Sheet shared with the service account email as **Editor**

**Other**
- [ ] `ANTHROPIC_API_KEY` for the planner
- [ ] Slack webhook (optional, for run summaries)

**Decisions**
- [ ] Planner model + per-run call budget (default: `claude-sonnet-5`, 100 calls)
- [ ] One shared dev store, or one per developer?

Work that does **not** need any of the above and can start immediately: Phase 0
(scaffolding, CLI), Phase 2 (sheet parser + `qa validate`, developed against a
local CSV), and the step-grammar unit tests.

---

## 0b. Testing several apps

A Shopify admin **session is per store, not per app**. Two apps on the same dev
store share one `qa auth` login.

For one app, `.env` is enough. For several, create `qa.apps.json` (copy
`qa.apps.example.json`):

```json
{
  "default": "discount-banner",
  "apps": {
    "discount-banner": {
      "store": "my-dev-store.myshopify.com",
      "appHandle": "discount-banner",
      "appHost": "discount-banner.example.com",
      "sheetId": "1AbC…",
      "sheetTab": "Test Cases"
    },
    "second-app": { "store": "my-dev-store.myshopify.com", "appHandle": "second-app",
                    "appHost": "second-app.example.com", "sheetId": "1XyZ…" }
  }
}
```

Then select one per command:

```bash
qa apps                       # list profiles and session status
qa auth --app second-app      # log in for that profile's store
qa run  --app second-app --tag smoke
qa validate --app second-app
```

Each app may point at its own Google Sheet. `qa.apps.json` is gitignored — it
names your real stores.

**`appHost` is the important field.** It is the host of the app iframe's `src`,
and it is how the tool finds your embedded app inside the admin. To read it off
a real store: open the app in the admin, right-click inside it → Inspect, and
look at the enclosing `<iframe src="…">`.

---

## 1. Prerequisites

- Node.js 24+
- A Shopify **development store** with our app installed
- The theme app extension enabled on the store's active theme
- Access to the QA Google Sheet
- A Google Cloud project (for a service account)

## 2. Shopify dev store

1. Create a dev store in the Partner dashboard (or reuse the existing QA store).
2. Install the app under test on it.
3. Add the theme app extension block to the theme (product page, plus wherever
   else it's meant to appear).
4. **Create a dedicated QA staff account** — do not use a personal account:
   - Give it only the permissions the app needs.
   - **Turn 2FA off for this account.** With 2FA on, every session refresh needs a
     human with the phone. If org policy forbids disabling 2FA, expect to re-run
     `qa auth` manually whenever the session expires, and CI cannot self-recover.
5. Note the storefront password (Online Store → Preferences).
6. Create baseline test data: a product named `Test Product`, a collection named
   `Test Collection`.

⚠️ Use a store nobody demos from. The suite mutates settings and data.

## 3. Google service account (Sheets access)

1. Google Cloud Console → your project → enable the **Google Sheets API**.
2. Create a **service account**; create a JSON key; download it.
3. Copy the service account's email (`…@….iam.gserviceaccount.com`).
4. **Share the QA sheet with that email** — Editor (the tool writes results back).
   This is the step people forget; without it every read 404s.
5. Store the JSON as `GOOGLE_SERVICE_ACCOUNT_JSON` (whole JSON, one line) or point
   `GOOGLE_APPLICATION_CREDENTIALS` at the file. Never commit it.

## 4. Environment

`.env` at the repo root (gitignored):

```bash
# Shopify
SHOPIFY_STORE_DOMAIN=my-dev-store.myshopify.com
SHOPIFY_APP_HANDLE=our-app
SHOPIFY_STOREFRONT_PASSWORD=xxxxx
SHOPIFY_QA_EMAIL=qa@example.com          # used by `qa auth` prompt only

# Google Sheets
QA_SHEET_ID=1AbC…                         # from the sheet URL
QA_SHEET_TAB=Test Cases
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",…}

# Planner
ANTHROPIC_API_KEY=sk-ant-…

# Optional
SLACK_WEBHOOK_URL=https://hooks.slack.com/…
```

`.env.example` ships in the repo with the keys and no values.

## 5. Install

```bash
npm install
npx playwright install chromium
```

## 6. One-time authentication

```bash
npm run auth
```

A real Chromium window opens on the Shopify login page. Log in as the QA staff
account, complete 2FA if enabled, and wait until the admin dashboard loads. The
session is saved to `.auth/admin.json` and reused by every later run.

Re-run this when a run fails with `Session expired`. Sessions typically last
weeks. **`.auth/` is gitignored — that file is a live credential.**

## 7. Verify

```bash
npm run qa -- validate            # parses the sheet, no browser
npm run qa -- run --id TC-021 --headed   # one case, visible browser
```

Watching the headed run is the fastest way to confirm admin login, iframe entry,
and the storefront hop all work.

## 8. Everyday commands

| Command | Purpose |
|---|---|
| `qa run` | Run every enabled case. |
| `qa run --tag smoke` | Run one tag. |
| `qa run --suite settings` | Run one suite. |
| `qa run --id TC-021 --headed` | Debug a single case in a visible browser. |
| `qa run --only-failed` | Re-run what failed last time. |
| `qa validate` | Parse-check the sheet. |
| `qa auth` | Refresh the admin session. |
| `qa report` | Open the last HTML report. |
| `qa fixtures reset` | Restore store data to baseline. |

## 9. CI

GitHub Actions, nightly plus `workflow_dispatch`:

- Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHOPIFY_STOREFRONT_PASSWORD`,
  `ANTHROPIC_API_KEY`, `ADMIN_STORAGE_STATE` (the contents of `.auth/admin.json`).
- Write `ADMIN_STORAGE_STATE` to `.auth/admin.json` in a step before the run.
- Run headless; upload `artifacts/<runId>/` on failure.
- The job fails on a non-zero exit, and the Slack summary links the report.

Note the operational reality: `ADMIN_STORAGE_STATE` expires and a human must
refresh it via `qa auth`. This is the strongest practical argument for a QA staff
account with 2FA disabled.

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Session expired` | Run `npm run auth`. |
| Every admin step times out | The App Bridge iframe selector changed, or the app isn't installed on the store. Run `--headed` and look. |
| Sheet read 404 | The sheet isn't shared with the service account email. |
| Storefront shows the password page | `SHOPIFY_STOREFRONT_PASSWORD` is wrong or unset. |
| Storefront doesn't reflect an admin change | Theme extension caching — the case needs a hard reload / `wait for` step. |
| A step is flagged `healed` in the report | The cached locator broke and was re-planned. Check whether the UI changed intentionally. |
| Planner budget exceeded | Too many cache misses — usually a UI overhaul. Review, then let the cache rebuild. |
