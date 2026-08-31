# Test Case Sheet Specification

How QA writes test cases in the Google Sheet, and how the tool reads them.

Design rule: **a QA engineer who has never seen the code must be able to write a
passing test case.** No CSS selectors required, no code, no git.

---

## 1. Sheet structure

One spreadsheet, tab **`Test Cases`**. One row per test case.

| Column | Header | Required | Meaning |
|---|---|---|---|
| A | `ID` | ✅ | Unique, e.g. `TC-014`. Used for filtering and result write-back. |
| B | `Title` | ✅ | Human summary: "Discount banner appears on product page when enabled". |
| C | `Suite` | ✅ | Grouping: `settings`, `widget`, `onboarding`, `billing`. |
| D | `Tags` | | Comma-separated: `smoke, cross-surface, p0`. |
| E | `Surface` | ✅ | Starting surface: `admin` \| `storefront`. |
| F | `Precondition` | | Free text; also runnable as steps if written in step syntax. |
| G | `Steps` | ✅ | One step per line (Alt+Enter in Sheets). See §2. |
| H | `Expected Result` | ✅ | Final assertion(s), one per line. |
| I | `Teardown` | | Steps to restore state; always run, even on failure. |
| J | `Enabled` | | `TRUE`/`FALSE`. Blank = enabled. |
| K | `Status` | 🔒 | **Written by the tool.** `PASSED` / `FAILED` / `SKIPPED` / `ERROR`. |
| L | `Last Run` | 🔒 | Timestamp written by the tool. |
| M | `Duration` | 🔒 | Seconds. |
| N | `Failure Reason` | 🔒 | Failing step number + message. |
| O | `Artifacts` | 🔒 | Link to the run's report/screenshots. |

🔒 = tool-owned. Anything a human types there is overwritten.

## 2. Step syntax

Steps are **plain English, one per line**. The engine resolves the target element
from the page itself, so no selectors are needed.

```
open the app
click "Settings" in the sidebar
turn on "Enable discount banner"
fill "Banner text" with "Free shipping over $50"
click "Save"
expect toast "Settings saved"
```

### 2.1 Recognised verbs

| Verb | Example |
|---|---|
| `open` / `go to` | `go to the product page for "Test Product"` |
| `click` | `click "Save"` |
| `fill … with …` | `fill "Banner text" with "Summer sale"` |
| `select … in …` | `select "Percentage" in "Discount type"` |
| `turn on` / `turn off` | `turn on "Enable widget"` |
| `check` / `uncheck` | `check "Show on collection pages"` |
| `upload … to …` | `upload "fixtures/logo.png" to "Logo"` |
| `wait for` | `wait for "Settings saved"` |
| `reload` | `reload the page` |
| `switch to` | `switch to storefront` (see §3) |
| `save … as …` | `save the value of "Banner text" as bannerText` |

### 2.2 Assertions

Any line starting with `expect` / `assert` / `should` is an assertion.

```
expect "Free shipping over $50" to be visible
expect "Discount banner" to be hidden
expect the value of "Banner text" to be "Summer sale"
expect 3 products in the list
expect the url to contain "/settings"
expect toast "Settings saved"
```

A failed assertion fails the test at that step; remaining steps are skipped and
teardown still runs.

### 2.3 Explicit selectors (escape hatch)

For an element that plain English cannot disambiguate, address it directly. This
skips the planner entirely and is the fastest, most deterministic path — use it
for critical smoke steps.

```
click [data-test="save-settings"]
fill #banner-text with "Summer sale"
expect .discount-banner to be visible
```

### 2.4 Variables

`{name}` interpolates a saved variable or a config value.

```
save the value of "Banner text" as bannerText
switch to storefront
expect "{bannerText}" to be visible
```

Built-ins: `{store}`, `{storefrontUrl}`, `{adminUrl}`, `{runId}`,
`{timestamp}`, `{random}` — `{random}` is useful for unique test data:
`fill "Title" with "QA test {random}"`.

## 3. Cross-surface test cases

`switch to storefront` / `switch to admin` moves execution between the two live
browser contexts. Admin state is preserved; the storefront stays anonymous.

**Example — TC-021, the canonical cross-surface case:**

| Column | Value |
|---|---|
| ID | `TC-021` |
| Title | Banner text set in admin appears on the storefront product page |
| Suite | `widget` |
| Tags | `smoke, cross-surface, p0` |
| Surface | `admin` |
| Steps | ```open the app```<br>```click "Settings"```<br>```turn on "Enable discount banner"```<br>```fill "Banner text" with "Free shipping over $50 {random}"```<br>```click "Save"```<br>```expect toast "Settings saved"```<br>```save the value of "Banner text" as bannerText```<br>```switch to storefront```<br>```go to the product page for "Test Product"``` |
| Expected Result | ```expect "{bannerText}" to be visible```<br>```expect the discount banner to be above the add-to-cart button``` |
| Teardown | ```switch to admin```<br>```turn off "Enable discount banner"```<br>```click "Save"``` |

Note the teardown: without it, the next run starts from a dirty store.

## 4. Writing good test cases

**Do**

- Refer to elements by their **visible label** — that is what the planner and a
  human both see.
- Make each case independent; never rely on the case above it having run.
- Always write teardown for anything that mutates store or app state.
- Use `{random}` for values that must be unique per run.
- Keep a case to one behaviour. A 40-step case that fails at step 31 tells you little.

**Don't**

- Don't put credentials in the sheet — the whole team can read it. Secrets live in `.env`.
- Don't write timing steps (`wait 5 seconds`). Assertions auto-wait; a fixed sleep
  is either flake or wasted time. Use `wait for "<something visible>"`.
- Don't assert on Shopify's own admin chrome; test our app.
- Don't chain unrelated behaviours to save rows.

## 5. Validation

`qa validate` checks the sheet without running a browser:

- required columns present and non-empty
- IDs unique
- every step line parses to a known verb or an assertion
- `switch to` targets are valid surfaces
- referenced variables are saved before use
- fixture files referenced by `upload` exist

Errors are reported per row and per line so a QA engineer can fix the sheet
directly. `qa run` refuses to start on a sheet with parse errors — better to fail
in two seconds than 20 minutes in.
