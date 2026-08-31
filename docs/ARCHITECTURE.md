# Architecture — Shopify QA Automation Suite

Companion to [PRD.md](PRD.md). This is the *how*.

---

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 24) | Same language as the app; Playwright's first-class binding. |
| Browser driver | **Playwright** (Chromium) | Real browser, auto-waiting, native iframe support, storage-state reuse, trace viewer. The trace viewer alone is worth it for debugging failures. |
| Test source | **Google Sheets API v4** | Team already lives in the sheet; read live, write results back. |
| Planner | LLM via a single `Planner` interface | Turns plain-English steps into locators on cache miss only. |
| Reporting | Custom HTML report + Playwright traces | Sheet gets the verdict; HTML gets the detail. |
| Config | `.env` + `qa.config.ts` | Secrets in env, everything else in code and reviewable. |

**Why not raw Playwright Test?** Its runner expects tests in `.spec.ts` files.
Ours arrive at runtime from a sheet. We use Playwright as a *library* and own the
runner loop.

## 2. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ CLI                  qa run · qa auth · qa validate          │
├──────────────────────────────────────────────────────────────┤
│ Runner       suite orchestration · retries · reporting       │
├──────────────────────────────────────────────────────────────┤
│ Test Source  Sheets adapter → TestCase[] (+ CSV for CI)      │
├──────────────────────────────────────────────────────────────┤
│ Step Engine  parse → resolve locator → execute → assert      │
│              ├─ Locator cache (hit: fast path)               │
│              └─ Planner (miss: a11y snapshot → locator)      │
├──────────────────────────────────────────────────────────────┤
│ Surfaces     AdminSurface · StorefrontSurface                │
│              (auth, iframe entry, password bypass)           │
├──────────────────────────────────────────────────────────────┤
│ Playwright   browser · contexts · pages · frames             │
└──────────────────────────────────────────────────────────────┘
```

Each layer only knows the one below it. The step engine never touches Sheets; the
surfaces never know a test case exists.

## 3. Directory layout

```
test-suite/
├── docs/
├── src/
│   ├── cli/                 # commander entrypoints
│   ├── config/              # env loading + qa.config.ts schema
│   ├── source/
│   │   ├── TestCaseSource.ts    # interface
│   │   ├── SheetsSource.ts      # Google Sheets adapter
│   │   ├── CsvSource.ts         # offline/CI fallback
│   │   └── parser.ts            # row → TestCase, step grammar
│   ├── surfaces/
│   │   ├── Surface.ts           # common contract
│   │   ├── AdminSurface.ts      # admin login, App Bridge iframe
│   │   └── StorefrontSurface.ts # password bypass, theme extension
│   ├── engine/
│   │   ├── StepEngine.ts        # execute one step
│   │   ├── actions.ts           # click, fill, select, wait, navigate…
│   │   ├── assertions.ts        # visible, text, value, count, url…
│   │   ├── LocatorCache.ts
│   │   └── Planner.ts           # LLM: a11y snapshot → locator
│   ├── runner/
│   │   ├── Runner.ts            # suite loop, isolation, retries
│   │   ├── Context.ts           # per-test variable bag
│   │   └── artifacts.ts         # screenshots, traces, videos
│   └── report/
│       ├── HtmlReporter.ts
│       ├── SheetReporter.ts     # write results back
│       └── SlackReporter.ts
├── fixtures/                # seed data, teardown scripts
├── .auth/                   # storageState.json (gitignored)
├── .cache/locators.json
├── artifacts/<runId>/       # screenshots, traces, report.html
└── qa.config.ts
```

## 4. Core data model

```ts
type SurfaceName = 'admin' | 'storefront';

interface TestCase {
  id: string;              // "TC-014"
  title: string;
  suite: string;           // "settings" | "widget" | …
  tags: string[];
  surface: SurfaceName;    // starting surface
  precondition?: string;
  steps: Step[];
  teardown: Step[];
  enabled: boolean;
  rowIndex: number;        // for writing results back
}

interface Step {
  index: number;
  raw: string;             // exactly what QA typed
  surface: SurfaceName;    // may switch mid-test
  kind: 'action' | 'assertion';
  action?: Action;         // parsed if explicit, else planned
  expectation?: string;    // for assertions
}

interface StepResult {
  step: Step;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  locatorSource: 'explicit' | 'cache' | 'planned' | 'healed';
  screenshot?: string;
  error?: string;
}
```

## 5. The Shopify-specific hard parts

These are the three things that make this project non-trivial. Everything else is
ordinary browser automation.

### 5.1 Admin authentication

Shopify admin login is interactive, rate-limited, and often 2FA-gated. Logging in
per test is not viable.

**Approach — one-time headed login, reused session:**

```
qa auth  →  headed browser opens accounts.shopify.com
         →  human logs in (incl. 2FA) once
         →  context.storageState() saved to .auth/admin.json
         →  every later run loads that state; zero logins
```

- Sessions last weeks. The runner probes the session on startup (load the admin
  dashboard, check for a redirect to login) and, if expired, exits immediately
  with `Session expired — run 'npm run auth'` rather than letting every test time
  out mysteriously.
- For CI, `.auth/admin.json` is stored as an encrypted secret and refreshed by a
  human when it expires. A dedicated QA staff account with 2FA disabled is
  strongly preferred — see [SETUP.md](SETUP.md).

### 5.2 Entering the embedded app iframe

Our app runs inside a cross-origin iframe injected by App Bridge. This is a
solved problem in Playwright — frames are first class and cross-origin frames are
not a special case, because Playwright drives the browser over CDP rather than
injecting script into the page. (It is also precisely where Cypress struggles,
and a reason not to use it here.)

Locate the frame by **our app's own URL**, not by a Shopify-owned attribute like
`name="app-iframe"` — the app domain is ours and will not change under us:

```ts
// AdminSurface.ts — the one place in the codebase that knows about the iframe
async openApp(handle: string): Promise<FrameLocator> {
  await this.page.goto(`${this.adminUrl}/apps/${handle}`);
  const frame = this.page.frameLocator(`iframe[src*="${this.appHost}"]`);
  // wait for the app itself, not just the frame element, to be ready
  await frame.locator('body').waitFor({ state: 'attached' });
  return frame;
}
```

Every admin step then resolves against this `FrameLocator` instead of `page`, and
normal locators work unchanged inside it:

```ts
await app.getByRole('button', { name: 'Save' }).click();
await expect(app.getByText('Settings saved')).toBeVisible();
```

Step authors never think about the iframe. Three follow-on details:

- **Some UI renders in the host admin frame, not ours.** The rule of thumb: App
  Bridge primitives (`ui-modal`, `ui-save-bar`, `shopify.toast.show()`) are drawn
  by the admin outside our iframe, while Polaris components rendered inside our
  React tree (`<Modal>`, `<Toast>`) stay inside it. The surface exposes both
  `appLocator()` and `hostLocator()`; an assertion that fails in one is retried
  against the other, and the resolved frame is cached with the locator so it is
  decided once.
- **Nested iframes** (an embedded checkout or Shopify-hosted picker inside our
  app) chain naturally: `app.frameLocator('iframe[...]')`.
- If Shopify does change the iframe's shape, `openApp()` is the only function to
  fix — nothing else in the codebase references a frame.

**Confirm this on the real store in Phase 1 before anything else is built.** The
mechanism is sound, but the exact iframe `src` and which components land in which
frame are store- and version-specific, and are worth ten minutes with a headed
browser and devtools.

### 5.3 Storefront access

Dev stores are password-protected and Shopify injects bot/preview parameters.

- Bypass the password page by posting the storefront password once per context and
  reusing the cookie, or by appending Shopify's preview bypass params.
- Always start the storefront in a **fresh, unauthenticated context** — a shopper
  is not a merchant. A leaked admin cookie makes theme-extension tests lie.
- Theme app extension blocks are located by their block wrapper
  (`[data-block-handle]` / the extension's own root id), not by theme CSS classes,
  which differ per theme.

## 6. Cross-surface flows

The signature test: *change a setting in admin, confirm the storefront reflects it.*

One test run holds **two browser contexts** simultaneously:

```
BrowserContext A (admin)      ← storageState: .auth/admin.json
BrowserContext B (storefront) ← clean, anonymous
        ↕
   shared Context (variable bag)
```

- A step's `surface` column decides which context it executes in.
- Variables move between them explicitly:
  `save "Free shipping over {price}" as bannerText` in admin, then
  `assert storefront shows {bannerText}` later.
- Storefront pages are **hard-reloaded** after an admin change (theme extension
  settings are cached); a `wait for storefront to reflect` step polls with a
  bounded timeout instead of a blind sleep.

Both contexts are created lazily — a pure admin test never launches the
storefront context.

## 7. Step execution flow

Resolution is tiered, cheapest first. Each tier only runs if the one above it
missed:

```
step
 │
 ├─ 1. explicit selector?   ──yes──► use it verbatim         (free, not cached)
 │         │no
 ├─ 2. locator cache hit?   ──yes──► rebuild from spec       (free)
 │         │no
 ├─ 3. role / label / text heuristics                        (free)
 │      getByRole('button', {name:'Save'}) and friends,
 │      tried across each candidate frame until one matches
 │      uniquely ──► cache the winning spec
 │         │all missed
 └─ 4. Planner: ARIA snapshot + step text → LocatorSpec      (one model call)
            → verify it resolves → cache it
```

**Tier 3 is what keeps this affordable.** `click "Save"` is just
`getByRole('button', { name: 'Save' })` — no model needed, ever. In practice the
large majority of steps never reach the planner even on a cold cache, and a warm
cache is a pure-Playwright run.

Two details that matter:

- **Tiers 1–3 retry until the step timeout**, so asynchronously rendered UI
  resolves itself. Nobody writes a sleep.
- **A target containing a variable is never cached.** `expect "{bannerText}" to
  be visible` resolves to a different string every run, so persisting that
  locator would guarantee a miss next time. The step still resolves normally; it
  just re-resolves each run.

**Self-healing:** if a cached locator stops matching, it is dropped and the step
re-resolves from tier 3. The step is reported as `healed` so someone can check
whether the UI changed on purpose.

**Cost control:** a per-run planner budget is enforced. Exceeding it fails the
run with an explanation rather than quietly spending — a budget blowout almost
always means a UI overhaul invalidated many cached locators at once.

## 8. Isolation and cleanup

- **Fresh contexts per test case** — no cookie or localStorage bleed. The browser
  process is reused; only contexts are recycled, which keeps runs fast.
- **Teardown always runs**, including after a failure, in a `finally`. Teardown
  failures are reported but never mark the test itself failed.
- **Fixture reset** (`qa fixtures reset`) restores app settings and test products
  on the dev store to a known baseline before a suite.

## 9. Reporting

Three outputs from one run:

1. **Google Sheet** — status, duration, failed-step number, failure reason,
   artifact link, run timestamp, written back to each case's row.
2. **HTML report** (`artifacts/<runId>/report.html`) — per-test timeline, step
   screenshots, and the locator source per step so healed/planned steps are visible.
3. **Playwright trace** on failure — open with `npx playwright show-trace` for
   DOM-level, time-travel debugging.

Exit code is non-zero on any failure so CI gates on it.

## 10. Configuration

```ts
// qa.config.ts
export default {
  store: { domain: 'my-dev-store.myshopify.com', appHandle: 'our-app' },
  sheet: { spreadsheetId: process.env.QA_SHEET_ID!, tab: 'Test Cases' },
  run:   { headless: true, retries: 1, timeoutMs: 30_000, workers: 1 },
  planner: { model: 'claude-opus-5', maxCallsPerRun: 100 },
  artifacts: { screenshots: 'all', video: 'on-failure', trace: 'on-failure' },
};
```

Secrets stay in `.env`: `SHOPIFY_STORE_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_JSON`,
`ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`.

## 11. Concurrency

v1 runs **serially** (`workers: 1`). Parallel tests on one dev store corrupt each
other's data — two cases toggling the same app setting will flake constantly.
Parallelism is a later step and requires either per-worker stores or strict
data partitioning; noted, not built.
