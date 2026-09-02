# Shopify QA Suite — context for Claude

An automated QA tool for our Shopify apps. It drives **your real Chrome**, already
logged into Shopify, across two surfaces that most tools can only do one of:

- the **embedded admin app** — our app rendered inside Shopify's cross-origin
  App Bridge iframe
- the **storefront** — the customer-facing theme

and across the seam between them, which is where most real bugs live: change a
setting in the admin, then prove the storefront actually changed.

There is **no API key and no service account**. A human logs into Chrome; the
agent drives that session. Never add a flow that needs stored Shopify
credentials — that decision was made deliberately.

## The flow

Work starts from a **ClickUp task id** and ends in a **report sheet**. Three phases:

| Phase | Who does it | Output |
|---|---|---|
| 1. Generate | Agent reads the ClickUp task + its TIN doc, **reads the live app for the real labels**, then writes the cases and their steps | `Test Result/<TASK-ID>/cases.csv` + a Google Sheet |
| 2. Verify | `./qa suite --task <TASK-ID>` drives the browser through every case | a verdict per case |
| 3. Report | `./qa results --task <TASK-ID>`, then upload | `Test Result/<TASK-ID>/<stamp>/` + a report sheet |

The doc says what the feature should do; only the running app says what its
controls are called. Both go into the cases — a step written against an
invented label fails for a reason that is not a bug.

The full procedure is the **`qa-from-clickup` skill** — read it before starting
any of this. It has the ClickUp lookup order, the sheet upload calls, and the
rules for writing cases that actually run.

**A Google Sheet lives in Drive, not on disk.** So every sheet has a local CSV
twin under `Test Result/`, and the sheet's link is recorded in
`Test Result/<TASK-ID>/task.json`. The CSV is what the runner reads; the sheet
is what people read. They are generated from the same file, so they cannot
disagree.

## Layout

```
Test Result/
├── screenshots/                  ← scratch shots taken mid-run
└── TIN-1234/                     ← one folder per ClickUp task
    ├── task.json                 ← title, ClickUp link, sheet links
    ├── cases.csv                 ← generated cases = the cases sheet
    └── 2026-09-02T14-31-07/      ← one folder per run
        ├── report.html
        ├── results.csv           ← = the report sheet
        └── screenshots/
```

`Test Result/` is gitignored — results belong to a run, not to the code.
`docs/` is gitignored too, so **shared context belongs in this file and in
`.claude/`**, not in `docs/`.

## Commands

```bash
./qa start                        # open Chrome; the human logs in
./qa detect                       # read store, app handle and iframe host
./qa task TIN-1234                # what exists for this task
./qa validate --task TIN-1234     # parse-check the cases, ~2s, no browser
./qa suite --task TIN-1234        # run them all
./qa do 'click "Save"'            # one step, for exploring
./qa snapshot --frame app         # accessibility tree of the app iframe
./qa results --task TIN-1234      # table + CSV + HTML report folder
./qa stop
```

On Windows use `qa` with no `./`. `qa` routes session commands through a
zero-dependency fast path (~0.1s) and everything else through tsx (~2.7s).

## Things that will trip you up

These were all learned the hard way in live runs. They are not theoretical.

- **Editing `src/session/server.ts` does nothing until you restart.** The
  session is a long-lived daemon holding the old code: `./qa stop && ./qa start`.
- **App Bridge components render in the *host* frame, not the app frame.**
  `ui-modal`, `ui-save-bar`, `ui-nav-menu` and `shopify.toast.show()` all live in
  Shopify's admin page. Add ` in host` to a step when a target is not found where
  you expect it.
- **`expect X to be hidden` passes when X is absent.** Absent is hidden. Do not
  read a pass here as proof the element exists somewhere.
- **A fast pass can be a race.** An assertion that resolves in single-digit
  milliseconds may have run before the app finished painting. If a result
  surprises you, re-check it with a `wait for` in front.
- **Polaris hides the real `<input>` behind a styled span.** `check`/`turn on`
  fall back to clicking the associated label; that is deliberate, don't "fix" it.
- **Deletes in our app have not always persisted.** Reload before declaring
  anything cleaned up or removed.
- **Two "Add to cart" buttons is normal** (the sticky bar is the second one). A
  passing assertion may have found the wrong one — target it explicitly.

## Non-negotiables

- **Never commit** `.env`, `.auth/`, `qa.apps.json`, `.qa-profile/`,
  `Test Result/`, `*.service-account.json`. `.auth/admin.json` and `.qa-profile/`
  hold a **live Shopify session** — they are credentials.
- **Redact `id_token`, `session` and `hmac`** from any embedded-app URL before it
  reaches the terminal, a log, a report or CI. `redactUrl()` exists for this.
- **Never put a password in a test-case sheet.** The whole QA team can read it.
- Check staged files for leaks before every commit.

## Reporting rules

The point of this tool is a trustworthy verdict, so:

- **A screenshot or nothing.** Every FAIL gets a screenshot and the failing step.
- **Report what happened, not what should have happened.** If a case was
  blocked, say BLOCKED — do not infer a PASS.
- **Verify before you claim a bug.** Reload, re-run, and rule out the tooling
  first. A false bug report costs the team more than a missed one.
- **Retract cleanly.** If a finding does not reproduce after a tooling fix, say
  so plainly and withdraw it.
