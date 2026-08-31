# shopify-qa-suite

Automated QA for our Shopify app. Reads test cases from a Google Sheet and runs
them in a **real browser** across both surfaces — the embedded admin app and the
storefront — including cross-surface flows where a setting changed in admin is
asserted on the storefront.

QA authors test cases in plain English in the sheet. No selectors, no code, no git.

```
Steps:            open the app
                  click "Settings"
                  turn on "Enable discount banner"
                  fill "Banner text" with "Free shipping {random}"
                  click "Save"
                  save the value of "Banner text" as bannerText
                  switch to storefront
                  go to the product page for "Test Product"

Expected Result:  expect "{bannerText}" to be visible

Teardown:         switch to admin
                  turn off "Enable discount banner"
                  click "Save"
```

## Status

Early. Built in phases — see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffolding, CLI, config | ✅ done |
| 2 | Sheet ingestion, step grammar, `qa validate` | ✅ done |
| 3 | Step engine, locator cache, planner | ✅ done |
| 1 | Shopify session reuse, App Bridge iframe, storefront | ⏸ blocked on dev-store access |
| 4 | Runner, reporting, sheet write-back | ⏳ next |
| 5 | Fixtures, Slack, CI | ⏳ |

Phase 1 needs credentials — see the access checklist in [docs/SETUP.md](docs/SETUP.md#0-what-i-need-from-you-to-start-access-checklist).

## Try it now (no credentials needed)

```bash
npm install
npm run validate -- --csv fixtures/sample-test-cases.csv --verbose
npx playwright install chromium
npm test        # includes browser tests against local fixture pages
```

The engine tests run a real Chromium against fixture pages that mimic the Shopify
admin — a host frame, an embedded app iframe, and a storefront — so iframe
traversal, host-vs-app resolution and cross-surface variable passing are all
verified without needing a dev store.

`qa validate` parses the sheet and reports every problem with row, column and
line number — without opening a browser:

```
7 errors:
  TC-001 (row 3, ID) Duplicate ID — also used on row 2.
  TC-003 (row 6, Steps line 1) Could not understand step: "frobnicate the widget".
  TC-004 (row 7, Steps) Uses {nope} but nothing saved it earlier.
```

## Commands

| Command | Purpose |
|---|---|
| `qa validate` | Parse-check the sheet. Instant, no browser. |
| `qa run` | Run every enabled case. |
| `qa run --tag smoke` | Run one tag. |
| `qa run --id TC-021 --headed` | Debug one case in a visible browser. |
| `qa run --only-failed` | Re-run last run's failures. |
| `qa auth` | Log into Shopify once; session reused afterwards. |
| `qa report` | Open the last HTML report. |

## Docs

| Doc | What's in it |
|---|---|
| [PRD.md](docs/PRD.md) | Problem, scope, requirements, risks |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, layers, and the Shopify-specific hard parts |
| [TEST_CASE_SPEC.md](docs/TEST_CASE_SPEC.md) | Sheet columns and step grammar — **the doc for QA** |
| [COVERAGE.md](docs/COVERAGE.md) | What's reachable: App Bridge modals, dialogs, forced error states |
| [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phases and milestones |
| [SETUP.md](docs/SETUP.md) | Dev store, service account, env, CI |

## Stack

TypeScript · [Playwright](https://playwright.dev) (real Chromium) · Google Sheets API

Playwright rather than Cypress specifically because the embedded app renders in a
cross-origin iframe — see [ARCHITECTURE.md §5.2](docs/ARCHITECTURE.md).

## Security

`.env` and `.auth/` are gitignored and must stay that way. `.auth/admin.json` is a
**live Shopify session** — treat it as a credential. Never put passwords in the
test-case sheet; the whole QA team can read it.
