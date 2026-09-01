# Interactive Mode — Agent-Driven QA

Run the suite from a Claude Code (or Codex) chat, with **no API key, no service
account, and no stored credentials.** You log in; the agent drives.

---

## Why this mode exists

The unattended design needs three secrets: a Google service account to read the
sheet, an Anthropic API key to resolve elements the heuristics miss, and a saved
Shopify session. Interactive mode removes all three, because a human and an
agent are already present:

| Job | Unattended | Interactive |
|---|---|---|
| Read the test cases | Google service account | The agent reads the sheet/doc URL with its own tools |
| Find an element the heuristics miss | Anthropic API call | The agent reads `qa snapshot` and decides |
| Shopify login | Saved session file | You log in, in a real window |
| Store / app / iframe host | `.env` | Detected from the open browser |

`.env` can be completely empty.

## The loop

```bash
git clone https://github.com/mehedi891/shopify-qa-suite
cd shopify-qa-suite
npm install && npx playwright install chromium
npx tsx src/cli/index.ts start      # a browser window opens
```

1. **You** log into the Shopify admin in that window, and open the app.
2. **Agent** runs `qa detect` — reads the store, app handle and app-iframe host
   straight off the live browser.
3. **You** paste the Google Sheet or Doc URL.
4. **Agent** reads it, then for each case runs the steps and records a verdict.
5. **Agent** runs `qa results` — a table in chat and a CSV on disk.

## Which browser it drives

`qa start` uses **your installed Google Chrome** with a persistent profile at
`.qa-profile/`, and strips the flags that mark a browser as automated.

That matters because Playwright's *bundled* Chromium gets rejected by Shopify
login — and by Google SSO especially, which refuses it with "this browser or app
may not be secure". Bundled Chromium sets `navigator.webdriver`, carries an
"automation controlled" flag, and lacks real Chrome's branding and codecs.

With the default mode: `navigator.webdriver` is `false`, the user agent is real
Chrome's, and plugins are present.

**You log in once, ever.** The profile directory keeps your cookies, so every
later `qa start` is already signed in. `.qa-profile/` is gitignored — it holds a
live session.

### If login is still blocked

Escalate in this order:

**1. Default — your Chrome, dedicated profile** (try this first)

```bash
qa start
```

**2. Attach to a Chrome you started yourself.** Nothing about the browser is
automated; Playwright only connects after the fact. This is the most reliable
option, and the one to use if SSO still refuses.

```bash
# start Chrome yourself, once
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.qa-chrome-profile"

# log into Shopify in that window, then:
qa start --attach
```

The `--user-data-dir` is required, not optional: **since Chrome 136, remote
debugging is refused on the default profile directory.** Use a dedicated one and
log in there once — it persists, so this is a one-time step. `qa stop` detaches
without closing your browser.

**3. Bundled Chromium** — only if you have no Chrome installed:

```bash
qa start --chromium
```

## Commands

| Command | What it does |
|---|---|
| `qa start` | Opens your Chrome with a persistent profile |
| `qa start --attach` | Attaches to a Chrome you started yourself |
| `qa start --chromium` | Bundled Chromium (last resort) |
| `qa detect` | Reads store, app handle and iframe host from the open page |
| `qa status` | Current store, app, surface and URL |
| `qa snapshot [--frame app\|host]` | Accessibility tree per frame — **how the agent sees the page** |
| `qa frames` | Every frame URL, for debugging the app iframe |
| `qa play [steps...]` | **Run a whole case in one call**, screenshot on failure, record the verdict |
| `qa do '<step>'` | Run one step — for exploring, not for running known cases |
| `qa admin [target]` / `qa storefront [target]` | Switch surface, optionally navigate |
| `qa shot <path>` | Screenshot the current surface |
| `qa vars-reset` | Clear saved variables between cases |
| `qa record <id> <PASS\|FAIL\|BLOCKED\|SKIPPED>` | Log a verdict |
| `qa results [--csv path]` | Table in chat + CSV file |
| `qa stop` | Close the browser |

## Why it is fast (and what was slow)

Driving the browser from a chat has two costs: the browser work, and the cost of
*asking* for it. The second one dominated.

| | Time |
|---|---|
| Node boot | 0.035s |
| **TypeScript (tsx) boot** | **1.64s** |
| One command, before | **2.75s** |
| One command, now | **0.47s** |

Every command was paying ~2.7s to start a TypeScript process before touching the
browser at all. Session commands now go through `bin/fast.mjs` — plain
JavaScript, no TypeScript, no dependencies — which reads `.qa-session.json`,
POSTs to the already-running browser, prints, and exits.

Commands that need the parser, the sheet sources or the reporters
(`validate`, `suite`, `results`, `start`) still take the TypeScript path, where
1.6s of startup does not matter. `./qa` routes automatically; nothing to think
about.

The other half is batching: `qa play` runs a whole case in **one** call rather
than one per step. Both together are the difference between a case taking half a
minute and a few seconds.

## When a step fails, everything needed is already captured

A failure automatically records three things at the moment it happens:

- a **screenshot** of the page
- the **accessibility tree** of every frame searched, saved beside it
- the first 60 lines of that tree **inline in the output**

So the next question — "what was actually on the page?" — is answered before it
is asked, with no second command. This matters more than it sounds: asking
afterwards reads a page that has already moved on. The toast has gone, the modal
has closed, the spinner has finished.

Failures are slower than passes by design, because a failing locator waits for
the element to appear before giving up. When you expect a step might fail — while
exploring an unfamiliar page — say so:

```bash
qa play --timeout 2000 'click "Maybe This Exists"'
```

That cuts a failing step from ~26s to ~9s. A passing step is unaffected
(~0.1s): the timeout is a ceiling, not a delay.

## Run a whole case in one command

`qa do` runs one step. Driving a ten-step case that way costs ten process spawns
and ten round trips, which dominates the actual browser time. **`qa play` runs
the whole case server-side in one call** and records the verdict:

```bash
qa play --case TC-021 --record --title "Banner appears on the storefront" --suite widget \
  'open the app' \
  'click "Settings"' \
  'turn on "Enable discount banner"' \
  'fill "Banner text" with "Free shipping {random}"' \
  'click "Save"' \
  'expect toast "Settings saved"' \
  'save the value of "Banner text" as bannerText' \
  'switch to storefront' \
  'go to the product page for "Test Product"' \
  'expect "{bannerText}" to be visible'
```

```console
✓ switch to storefront 1172ms
✓ go to the product page for "Mix & Match #1" 586ms
✓ expect "1 orders remaining today" to be visible · page:text="1 orders remaining today" 88ms
✗ expect "Your cart is empty" to be hidden
    Expected "Your cart is empty" to be hidden, but it was visible.
    screenshot: .cache/shots/TC-003-step-04-failed.png
```

It stops at the first failure (`--keep-going` to continue), **screenshots the
moment of failure automatically** — asking for a screenshot afterwards is too
late, the page has moved on — and with `--record` writes the verdict straight
into the results. `--file steps.txt` reads steps from a file, `--shots`
captures every step, not just failures.

Reach for `qa play` by default. Use `qa do` and `qa snapshot` when you are
exploring a page or diagnosing a failure, not when running a known case.

## A real sequence

```console
$ qa admin
$ qa do 'turn on "Enable discount banner"'
✓ turn on "Enable discount banner"  (planned · app:role=switch[name="Enable discount banner"], 341ms)

$ qa do 'click "Save"'
✓ click "Save"  (planned · app:role=button[name="Save"], 65ms)

$ qa do 'expect toast "Settings saved"'
✓ expect toast "Settings saved"  (planned · host:text="Settings saved", 187ms)
```

Note the third line resolved in the **host** frame while the others resolved in
the **app** frame — the App Bridge split, handled automatically.

```console
$ qa storefront 'the product page for "Test Product"'
$ qa do 'expect "{bannerText}" to be visible'
✓ expect "{bannerText}" to be visible  (planned · page:text="Free shipping over $50", 44ms)
```

## When a step cannot find its element

```console
$ qa do 'click "Publish changes"'
✗ Could not find "Publish changes" for step: click "Publish changes"
  Searched: app, host
  Tried: role=button[name="Publish changes"], role=link[...], …
  Run `qa snapshot` to see what is actually on the page, then either fix the
  label in the sheet or use an explicit selector, e.g. qa do 'click [data-test=save]'.
```

The agent then runs `qa snapshot`, reads the real accessibility tree, and either
retries with the correct label or uses an explicit selector. **This is the
planner tier — performed by the agent in the chat rather than by an API call.**

## Where results go, and where they are stored

`qa results` writes a **self-contained report folder** and prints a table:

```
reports/2026-08-31T12-01-02/
├── report.html          ← open in a browser; failures expanded, screenshots inline
├── results.csv          ← 11 columns, opens in Sheets or Excel
└── screenshots/         ← copies of every failure screenshot
    └── OR-001-step-05-failed.png
```

Three destinations from one command:

| Where | What | Lives |
|---|---|---|
| **The chat / terminal** | Markdown table, pass/fail per case | the transcript |
| **CSV** | Every column, quoted properly | `reports/<timestamp>/results.csv` |
| **HTML** | Failure reasons, failing step, screenshots inline | `reports/<timestamp>/report.html` |

Screenshots are **copied** into the folder, not linked, and referenced by
relative path — so the whole folder can be zipped and sent to someone, or
attached to a ticket, and still works.

`--csv <path>` puts the CSV somewhere specific (e.g. straight into a shared
drive); `--dir <path>` moves the whole folder. `reports/` is gitignored, since
a report is a run artifact rather than source.

Working state during a run lives in `.cache/` (`session-results.json`,
`shots/`, `session-locators.json`) — scratch, safe to delete between runs.

## Output

`qa results` prints a table into the chat:

| ID | Title | Status | Failed step | Reason |
|---|---|---|---|---|
| TC-001 | App loads in the Shopify admin | ✅ PASS | — | — |
| TC-021 | Banner set in admin appears on storefront | ✅ PASS | — | — |
| TC-030 | Validation rejects empty banner text | ❌ FAIL | `expect "Banner text is required" to be visible` | Save succeeded with an empty value |

…and writes a CSV built to be read, not just parsed:

| Column | Notes |
|---|---|
| ID, **Status**, Title | Status second — it is what you scan for |
| Suite, Tags | For filtering in Sheets |
| Duration (s) | One decimal |
| Failed Step, Reason | Collapsed to a single line |
| Screenshot, Notes, Run At | `2026-09-01 13:04`, not an ISO string |

Four details that make the difference between a file you can read and one you
fight:

- **Rows are ordered FAIL → BLOCKED → SKIPPED → PASS**, then by ID numerically
  (so `TC-9` precedes `TC-10`). What needs attention is at the top.
- **Multi-line reasons are flattened** to one line with ` · ` separators. A
  Playwright call log left intact makes one row tall enough to hide every other
  result. The complete text stays in the HTML report and in the `.txt` beside
  the screenshot.
- **A UTF-8 BOM** is written, so Excel reads currency symbols and accented text
  correctly instead of mangling them.
- **CRLF line endings** per RFC 4180, and every cell quoted properly — a reason
  containing commas, quotes and newlines round-trips intact.

Exit code is non-zero when anything failed.

## Reading the test cases

The agent reads your sheet or doc directly with its own tools — Google Drive,
a pasted export, or a local CSV. Nothing needs to be configured, and no
credential is shared with this repo.

Whatever the source, the step grammar is the same as
[TEST_CASE_SPEC.md](TEST_CASE_SPEC.md). If the sheet's columns differ from that
spec, the agent adapts to yours rather than the other way round.

## Trade-offs

Interactive mode is **not unattended**: an agent is in the loop, so it cannot
run nightly in CI. That is what the unattended path is for, and both share the
same engine, step grammar and locator cache.

A practical middle ground: run interactively while the suite is young, letting
the locator cache fill up. Cached locators need no planner at all — so once
warm, the same cases can run unattended with nothing but a Shopify session.
