# PRD — Shopify App QA Automation Suite

**Status:** Draft v1 · **Owner:** app@efoli.com · **Last updated:** 2026-08-31

---

## 1. Problem

QA for our Shopify app is manual and repeated every release. A tester opens a
Google Sheet of test cases, logs into a dev store, clicks through the embedded
admin app, then opens the storefront to confirm the change actually took effect,
and finally types PASS/FAIL back into the sheet.

This is slow (a full pass is hours), inconsistent between testers, and skipped
under release pressure — which is exactly when regressions ship.

## 2. Goal

A CLI tool that reads test cases from the team's existing Google Sheet, executes
each one in a **real browser** against a real dev store — covering both the
embedded Shopify admin app and the storefront — and writes results back to the
sheet with screenshots and traces.

Non-goal: replacing the sheet with a new test-authoring UI. QA keeps working the
way they already do.

## 3. Users

| User | Need |
|---|---|
| **QA engineer** | Write a test case in plain English in the sheet; run the suite; get a readable failure report. |
| **Developer** | Run the suite locally against a branch before merging; reproduce a failure from a trace. |
| **Release manager** | One command in CI, one pass/fail summary, no browser knowledge required. |

## 4. Scope

### 4.1 In scope

**Surfaces** — a single run must cover all three:

1. **Embedded admin app** — our app rendered inside the Shopify admin iframe
   (`admin.shopify.com/store/<store>/apps/<handle>`). Requires an authenticated
   admin session and iframe traversal.
2. **Storefront** — theme app extension blocks/widgets on a dev store, viewed as
   an anonymous shopper.
3. **Cross-surface flows** — the important ones: change a setting in admin →
   assert the effect on the storefront within the same test case.

**Capabilities**

- Read test cases from a Google Sheet (live, via the Sheets API).
- Execute steps in a real Chromium browser (not API mocks — the admin app cannot
  be meaningfully tested any other way).
- Handle Shopify's auth realities: admin session reuse, storefront password
  bypass, App Bridge iframe.
- Cross-surface variable passing (a value produced in admin is asserted in the
  storefront).
- Per-step screenshots; Playwright trace + video on failure.
- Write results (status, duration, failure reason, artifact link) back to the
  sheet.
- Run headed (local debugging) or headless (CI).
- Filter runs by tag, suite, or test-case ID.
- Data cleanup so runs are repeatable (teardown steps + fixture reset).

### 4.2 Out of scope (v1)

- Cross-browser (Firefox/WebKit) and mobile emulation.
- Visual regression / pixel diffing.
- Load or performance testing.
- Testing Shopify's own admin functionality (we test *our* app).
- A web dashboard — the sheet plus the HTML report is the UI for v1.
- Auto-generating test cases from the app.

## 5. How a test case is expressed

**Decision:** steps are written in **plain English** in the sheet and executed by
an AI planner that drives Playwright against the live DOM, with a **locator cache**
so repeat runs are fast and deterministic.

Rationale: QA should not have to write CSS selectors, and Polaris/App Bridge
markup changes often enough that hand-written selectors rot. But a purely
AI-driven run is slow and non-reproducible, so:

- **First run** of a step: the planner reads an accessibility snapshot of the
  page, picks the element, and records the resolved locator in
  `.cache/locators.json`, keyed by `(testCaseId, stepIndex, step text)`.
- **Later runs**: the cached locator is used directly — no model call. If it
  fails to resolve, the planner re-plans once and updates the cache (self-healing),
  and the report flags the step as *healed* so someone can look at it.

A power user may also write an explicit step (`click [data-test=save]`) and the
parser will use it verbatim, skipping the planner entirely.

See [TEST_CASE_SPEC.md](TEST_CASE_SPEC.md) for the sheet columns and step grammar.

## 6. Requirements

### 6.1 Functional

| ID | Requirement | Priority |
|---|---|---|
| F1 | Read test cases from a configured Google Sheet + tab via service account. | P0 |
| F2 | Parse each row into an ordered step list with a target surface per step. | P0 |
| F3 | Execute steps in real Chromium via Playwright. | P0 |
| F4 | Authenticate to Shopify admin once and reuse the session across runs. | P0 |
| F5 | Enter the embedded app iframe and act inside it transparently. | P0 |
| F6 | Open the storefront as an anonymous shopper, bypassing the store password. | P0 |
| F7 | Switch surfaces mid-test and carry variables between them. | P0 |
| F8 | Support assertions: text present/absent, element visible/hidden, value equals, count, URL matches. | P0 |
| F9 | Capture a screenshot per step; trace + video on failure. | P0 |
| F10 | Write status, duration, failure reason and artifact path back to the sheet. | P0 |
| F11 | Generate a local HTML report with per-step timeline and screenshots. | P0 |
| F12 | Filter by test-case ID, tag or suite; support `--only-failed` re-runs. | P1 |
| F13 | Run teardown steps even when a test fails. | P1 |
| F14 | Retry a failed test once before marking it failed (configurable). | P1 |
| F15 | Post a run summary to Slack. | P2 |
| F16 | Seed/reset fixture data (products, settings) before a suite. | P2 |

### 6.2 Non-functional

- **Reproducibility** — a cached run makes zero model calls. Same input, same behaviour.
- **Speed** — target under 90s per typical cross-surface case on a warm cache;
  admin session is reused, not re-logged-in per test.
- **Isolation** — each test gets a fresh browser context; no cookie bleed between cases.
- **Secrets** — credentials only via `.env` / CI secrets, never in the sheet or repo.
  The sheet is readable by the whole QA team, so it must never hold a password.
- **Resilience** — one crashed test must not abort the run; it is recorded and the suite continues.
- **Cost** — planner calls only on cache miss; a budget cap per run, and the run
  fails loudly rather than silently spending.

## 7. Success metrics

- A full regression pass runs unattended in CI in under 20 minutes.
- ≥90% of the existing manual test cases are automatable without rewriting them.
- Flake rate under 5% across three consecutive nightly runs.
- Time from "release candidate" to "QA verdict" drops from hours to one CI run.

## 8. Key risks

| Risk | Mitigation |
|---|---|
| **Shopify admin login + 2FA** blocks automation | Use a dedicated staff account on a dev store with 2FA off; store the session state after a one-time headed login (`npm run auth`) and reuse. Detect an expired session and fail with a clear "re-run `npm run auth`" message rather than a confusing timeout. |
| App Bridge iframe changes shape | Iframe entry is isolated in one adapter module; a change is a one-file fix. |
| AI planner picks the wrong element | Locator cache reviewed in the report; `healed` steps flagged; explicit-selector escape hatch for critical steps. |
| Storefront theme changes break selectors | Prefer role/text-based locators and theme-extension block IDs over CSS classes. |
| Sheet edited into an invalid state | Validate on load and report row-level parse errors before executing anything. |
| Flaky async UI (toasts, saves) | Auto-waiting assertions only; no fixed sleeps except an explicit `wait` step. |
| Test data drift on the shared dev store | Teardown steps + a fixture reset command; recommend a dedicated store per environment. |

## 9. Open questions

1. Which dev store(s) are the targets — one shared, or one per developer?
2. Is there an existing Google Sheet to model the columns on, or do we define it fresh?
3. Do we have a staff account we can turn 2FA off for, or do we need a Partner test store?
4. Which model/provider for the planner, and is there a budget ceiling per run?
5. Does the theme app extension need to be tested on more than one theme?

## 10. Deliverables

1. `docs/` — this PRD, architecture, test-case spec, implementation plan, setup guide.
2. CLI: `qa run`, `qa auth`, `qa validate`, `qa report`.
3. Example Google Sheet template with 5 seeded cross-surface cases.
4. CI workflow for nightly + on-demand runs.
