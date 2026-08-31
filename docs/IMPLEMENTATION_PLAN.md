# Implementation Plan

Six phases. Each ends with something demonstrable — no phase is pure scaffolding.

Rough sizing assumes one developer. Adjust freely; the ordering matters more than
the estimates.

---

## Phase 0 — Foundation (0.5 day)

- `npm init`, TypeScript strict, `tsx` for dev, `vitest` for the tool's own unit tests.
- Install `playwright`, `googleapis`, `commander`, `zod`, `dotenv`, `chalk`.
- `npx playwright install chromium`.
- `qa.config.ts` + zod-validated env loading.
- `.gitignore`: `.auth/`, `.cache/`, `artifacts/`, `.env`.

**Done when:** `npm run qa -- --help` prints the command list.

## Phase 1 — Shopify access (1–1.5 days)

The riskiest part. Do it first: if admin session reuse doesn't work, everything
downstream changes.

- `qa auth` — headed login, save `storageState()` to `.auth/admin.json`.
- `AdminSurface`: load session, probe validity, open `/apps/<handle>`, return the
  App Bridge `FrameLocator`, expose `hostLocator()` for Polaris toasts/modals.
- `StorefrontSurface`: fresh anonymous context, storefront password bypass,
  navigate to product/collection/home.
- Clear error on expired session: *"Session expired — run `npm run auth`"*.

**Done when:** a hardcoded script logs in once, opens the embedded app, clicks a
button inside the iframe, then opens the storefront anonymously and reads a
theme-extension block. **Spike this before writing the engine.**

## Phase 2 — Sheet ingestion (1 day)

- Google service-account auth; read the `Test Cases` tab.
- `parser.ts`: row → `TestCase`; step grammar per [TEST_CASE_SPEC.md](TEST_CASE_SPEC.md)
  (verbs, assertions, explicit selectors, `{variables}`, `switch to`).
- `CsvSource` implementing the same interface, for offline dev and CI.
- `qa validate` with per-row, per-line error messages.
- Unit tests for the parser — it is pure logic and cheap to test properly.

**Done when:** `qa validate` prints a clean parse of the real sheet, and a
deliberately broken row produces a precise, actionable error.

## Phase 3 — Step engine (2 days)

- `actions.ts` and `assertions.ts` over Playwright locators.
- `LocatorCache` keyed by `(testCaseId, stepIndex, stepText)`, persisted to `.cache/locators.json`.
- `Planner`: a11y snapshot of the current frame + step text → candidate locator,
  verified to resolve before caching. One re-plan on runtime failure → mark `healed`.
- Explicit-selector fast path.
- Variable bag: `save … as`, `{interpolation}`.
- Per-run planner call budget.

**Done when:** a single cross-surface case (TC-021) passes end to end, and a
second run of it makes zero planner calls.

## Phase 4 — Runner + reporting (1.5 days)

- `Runner`: iterate cases, fresh context per case, retries, `finally` teardown,
  continue-on-crash.
- Artifacts: per-step screenshots, trace + video on failure, per-run directory.
- `HtmlReporter`: timeline, screenshots, locator source per step.
- `SheetReporter`: batch write-back of the tool-owned columns.
- Filters: `--id`, `--tag`, `--suite`, `--only-failed`; `--headed` for debugging.
- Non-zero exit on failure.

**Done when:** `qa run --tag smoke` executes the real suite, writes results to the
sheet, and produces a report a non-developer can read.

## Phase 5 — Hardening (1 day)

- Fixture seed/reset (`qa fixtures reset`).
- Slack summary reporter.
- GitHub Actions workflow: nightly + `workflow_dispatch`; session state from an
  encrypted secret; artifacts uploaded.
- Flake hunt: run the suite three times, fix what wobbles.
- `README.md` and the seeded example sheet.

**Done when:** three consecutive nightly runs are green with no manual touch.

---

## Build order rationale

Phase 1 before everything because Shopify auth and the App Bridge iframe are where
this project either works or doesn't. Every other phase is conventional
engineering we can estimate confidently; that one is discovery. If session reuse
proves impossible on your store setup, we learn it on day one, not day five.

## Milestone checklist

- [ ] M1 — Embedded app and storefront both reachable from a script (Phase 1)
- [ ] M2 — Real sheet parses clean (Phase 2)
- [ ] M3 — One cross-surface case passes, cached (Phase 3)
- [ ] M4 — Full suite runs, results in the sheet (Phase 4)
- [ ] M5 — Green in CI three nights running (Phase 5)

## Deliberately deferred

Parallel workers · cross-browser · visual regression · a web dashboard ·
auto-generated test cases. Each is a real want; none belongs in v1.
