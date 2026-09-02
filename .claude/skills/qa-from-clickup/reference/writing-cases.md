# Writing test cases that actually run

The runner reads a CSV whose columns match the sheet format. Same file, same
columns, whether it came from Drive or from disk.

## Columns

| Column | Required | What goes in it |
|---|---|---|
| `ID` | yes | `TC-001`, or `ISSUE-11A` when the case documents a specific bug. Unique. |
| `Title` | yes | What is being tested, in a sentence a human can check |
| `Suite` | | Grouping: `limits`, `checkout`, `settings` |
| `Tags` | | Comma-separated: `smoke,p0,bug,cross-surface` |
| `Surface` | | `admin` or `storefront` — where the case **starts** |
| `Precondition` | | State the case needs. Prose is allowed and produces a warning, not an error. |
| `Steps` | yes | One step per line, plain English |
| `Expected Result` | | Assertions, one per line |
| `Teardown` | | How to put the store back. Runs even on failure; never turns a pass into a fail. |
| `Enabled` | | `TRUE`/`FALSE` — `FALSE` records SKIPPED without running |

`Status`, `Last Run`, `Duration`, `Failure Reason` and `Artifacts` are written by
the tool. Never author them.

Multi-line cells are normal CSV: wrap in quotes, double any inner quote.

```csv
ID,Title,Suite,Tags,Surface,Precondition,Steps,Expected Result,Teardown,Enabled
TC-001,Daily limit shows on the product page,limits,"smoke,cross-surface",admin,,"open the app
go to ""/apps/<app-handle>/app/products""
click ""Individual Products""
fill ""Daily limit"" with ""5""
click ""Save""","expect toast ""Saved""",,TRUE
```

## Step grammar

Only these forms parse. Anything else is a parse error, caught by `qa validate`
in about two seconds — long before a browser opens.

**Doing things**

```
open the app
go to the product page for "Test Product"
click "Save"
fill "Banner text" with "Summer sale"
select "Percentage" in "Discount type"
turn on "Enable widget"          turn off "Enable widget"
check "Show on collection pages" uncheck "Show on collection pages"
upload "logo.png" to "Logo"
hover over "Info icon"
press "Enter"
wait for "Settings saved"
reload the page
switch to storefront             switch to admin
set viewport to mobile
save the value of "Banner text" as bannerText
```

**Checking things**

```
expect "Free shipping" to be visible
expect "Old banner" to be hidden
expect the value of "Banner text" to be "Summer sale"
expect the url to contain "/settings"
expect toast "Settings saved"
expect 3 products in the list
expect [data-testid="add-to-cart"] to be disabled
```

**Saved values** — this is how a cross-surface case proves itself:

```
save the value of "Banner text" as bannerText
switch to storefront
expect "{bannerText}" to be visible
```

`{random}` gives a fresh value each run, so repeated runs do not collide:
`fill "Banner text" with "Sale {random}"`.

**When a name is not enough**, point straight at the element:

```
click [data-testid="add-to-cart"]
fill #banner-text with "Hello"
```

**Frame hints** — append ` in host` or ` in app` when the default guess is
wrong. App Bridge components (`ui-modal`, `ui-save-bar`, `ui-nav-menu`, toasts)
render in the **host** admin frame, not in our app's iframe:

```
click "Delete" in host
```

## What separates a case that runs from one that only looks right

- **Assert something only the feature can make true.** "expect the page to load"
  passes on a broken feature. "expect `Limit: 5 per day` to be visible" does not.
- **`expect X to be hidden` passes when X is absent.** If a case's whole point is
  that something disappeared, first assert it was there.
- **Put a `wait for` before an assertion that follows a save.** An assertion that
  resolves in a few milliseconds may have beaten the app's own re-render — a
  pass that means nothing.
- **Prefer one strong assertion over five weak ones.** Five weak assertions still
  pass on a broken build.
- **Write the teardown as you write the steps**, not afterwards. A case that
  leaves a limit set breaks the next case, and the failure lands on the wrong id.
- **Do not chain cases.** Each one starts from a clean variable scope, on its own
  surface. If case B needs case A's state, say so in `Precondition` and set it up
  in B's own steps.
- **Checkout completion is manual.** Cover up to "add to cart" and the cart page;
  leave placing the order to a human and mark the case accordingly.

## Turning a doc into cases

- Every acceptance criterion becomes at least one case.
- Every "should not" becomes a negative case — those are the ones that catch
  missing validation.
- A criterion that spans admin and storefront becomes **one** cross-surface case
  with `save the value of …`, not two cases that hope they agree.
- **Items the doc marks resolved or "not valid" are still worth a case.** In this
  app, one such item reproduced.
