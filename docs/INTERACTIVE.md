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
| `qa do '<step>'` | Run one plain-English step |
| `qa admin [target]` / `qa storefront [target]` | Switch surface, optionally navigate |
| `qa shot <path>` | Screenshot the current surface |
| `qa vars-reset` | Clear saved variables between cases |
| `qa record <id> <PASS\|FAIL\|BLOCKED\|SKIPPED>` | Log a verdict |
| `qa results [--csv path]` | Table in chat + CSV file |
| `qa stop` | Close the browser |

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

## Output

`qa results` prints a table into the chat:

| ID | Title | Status | Failed step | Reason |
|---|---|---|---|---|
| TC-001 | App loads in the Shopify admin | ✅ PASS | — | — |
| TC-021 | Banner set in admin appears on storefront | ✅ PASS | — | — |
| TC-030 | Validation rejects empty banner text | ❌ FAIL | `expect "Banner text is required" to be visible` | Save succeeded with an empty value |

…and writes `qa-results-YYYY-MM-DD.csv` with eleven columns (ID, Title, Suite,
Tags, Status, Failed Step, Reason, Duration, Screenshot, Notes, Run At), properly
quoted so a failure reason containing commas, quotes or newlines survives a
round trip into Sheets or Excel.

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
