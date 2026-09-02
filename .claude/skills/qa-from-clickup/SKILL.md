---
name: qa-from-clickup
description: Run the QA flow for a Shopify app feature end to end, starting from a ClickUp task id (e.g. TIN-1234). Reads the task and its TIN doc, generates test cases into a Google Sheet, pulls that sheet back to run against the live store in a real browser, then produces a report sheet and an issues sheet with reproduction steps and screenshots. Use whenever someone gives a ClickUp task id, a TIN doc link, or asks to QA / test / verify a feature or a bug.
---

# QA a feature from its ClickUp task

Three phases. **Do not skip ahead** — running cases nobody has reviewed wastes a
browser session and produces a report nobody trusts.

Phase 1 ends with a sheet the human approves. Phase 2 runs it. Phase 3 reports.

---

## Phase 1 — Task → test cases → cases sheet

### 1a. Read the task

```
clickup_get_task(task_id: "TIN-1234", include: ["description", "attachments", "linked_tasks", "subtasks", "custom_fields"])
```

The description is where the spec usually is. If it is thin, the real spec is in
a **TIN doc** — find it in this order and stop at the first hit:

1. A `clickup.com/.../docs/` or `/v/dc/` link **in the task description or
   comments** (`clickup_get_task_comments`). The document id is the first id
   after `/docs/` or `/v/dc/`.
2. `clickup_search` for the task's feature name or the task id.
3. Ask the human for the doc link. Do not invent a spec from the task title.

Then:

```
clickup_list_document_pages(document_id: "…")      # page ids and structure
clickup_get_document_pages(document_id: "…", page_ids: [...], content_format: "text/md")
```

Read **every** page. Acceptance criteria, edge cases and "not valid" notes are
often on a later page than the summary.

### 1b. Look at the real app before writing a single step

**Required, not optional.** The doc tells you *what* to test. Only the app tells
you what the controls are actually called. A case written against a label you
imagined fails in Phase 2 for a reason that is not a bug — and every one of
those costs a browser session and a round of "is this real?".

```bash
./qa status                        # is a session already open?
./qa start                         # if not — the human logs in
./qa detect                        # store, app handle, iframe host
```

Then walk the feature the way the doc describes it, reading the page at each
stop:

```bash
./qa admin "/apps/<app-handle>/app/products"
./qa snapshot --frame app --max 4000     # our app's iframe
./qa snapshot --frame host               # modals, save bar, toasts
./qa do 'click "Individual Products"'
./qa snapshot --frame app
```

Take from the snapshot, verbatim:

- the **exact text** of every button, field, toggle and tab you will name
- which **frame** each one lives in — App Bridge modals, the save bar and
  toasts are in `host`, not `app`
- the real **success signal** after a save: the toast wording, or the value that
  changes on screen
- what the storefront actually renders, if the feature crosses surfaces:
  `./qa storefront "/products/<handle>"` then `./qa snapshot`

**Never invent a label.** If the doc names a control you cannot find in the
snapshot, that is itself worth reporting — either the doc is stale or the
feature is not built. Say which; do not paper over it with a guess.

If the human cannot give you a session right now, you may draft from the doc
alone — but say plainly in chat that the labels are **unverified** and must be
grounded before the run. Do not present a guessed label as a fact.

### 1c. Write the cases

Read **`reference/writing-cases.md`** in this skill folder for the column
format, the step grammar, and what separates a case that runs from one that
looks right and fails.

Each case is a row; its `Steps` cell is one step per line, in the grammar the
parser accepts. Use the labels you just read off the app, and add ` in host` to
any step whose target lives in Shopify's frame rather than ours.

Write to the task's own folder:

```bash
mkdir -p "Test Result/TIN-1234"
# write Test Result/TIN-1234/cases.csv
./qa validate --task TIN-1234
```

`validate` takes ~2 seconds and opens no browser. **Do not proceed until it is
clean.** Warnings on prose preconditions are fine; errors are not.

Record what you know about the task:

```bash
./qa task TIN-1234 --title "Daily order limits" --url "https://app.clickup.com/t/…"
```

### 1d. Upload the cases sheet

Read the CSV back and upload it. `text/csv` converts to a real Google Sheet by
default:

```
Google_Drive:create_file(
  title: "QA Cases · TIN-1234 · <feature name>",
  textContent: <the exact contents of cases.csv>,
  contentMimeType: "text/csv")
```

Then record the link so the folder stays self-describing:

```bash
./qa task TIN-1234 --cases-sheet "<the sheet url>"
```

**Show the human the sheet link and the case list, and wait.** They own the test
plan. This is the natural place for them to add a case you could not have known
about.

---

## Phase 2 — Run the cases

### 2a. Get a session

```bash
./qa start        # opens your real Chrome
./qa detect       # reads store, app handle, iframe host
```

`start` opens a browser for the **human** to log into. Ask them to log into the
Shopify admin and confirm before continuing — Shopify's SSO will not accept an
automated login, which is exactly why the flow is shaped this way.

### 2b. Pull the cases back from the sheet, then run

**The sheet is the source of truth, not your local file.** Between Phase 1 and
now, the human may have fixed a label, added a case, or disabled one. Running
your own copy silently discards their edits and reports on tests they never
approved.

So pull first, every time:

```
Google_Drive:search_files(query: "title contains 'QA Cases · TIN-1234'")     # if you need the id
Google_Drive:download_file_content(fileId: "<cases sheet id>", exportMimeType: "text/csv")
```

Decode it, write it over `Test Result/TIN-1234/cases.csv`, and re-validate — a
hand-edited sheet is exactly where a typo comes from:

```bash
./qa validate --task TIN-1234
```

If validation now fails, **fix the sheet, not just the local file**, or the next
pull loses the fix.

`qa validate` also prints a warning for every step that changes real store data
— creating a product, deleting one, placing an order. **Show those warnings to
the human and get a yes** before the first run against a store. After that they
are a reminder, not a gate. Then run:

```bash
./qa suite --task TIN-1234
```

Add `--id TC-003` to rerun one case, `--shots` to screenshot every step.

### 2c. When a case fails

**A failure is a hypothesis, not a finding.** Before writing it up:

1. Look at the screenshot and the ARIA tree the failure captured.
2. Reproduce it by hand: `./qa do 'click "Save"'`, `./qa snapshot --frame app`.
3. Rule out the tooling — wrong frame, wrong element of two, an assertion that
   ran before paint, a stale session daemon (`./qa stop && ./qa start`).
4. **Reload and check again** before claiming anything persisted or was removed.

If the case was wrong, fix `cases.csv`, re-upload the sheet, and rerun. If the
app is wrong, that is a finding — with a screenshot and exact steps.

---

## Phase 3 — Report sheet + issues sheet

```bash
./qa results --task TIN-1234
```

That writes `Test Result/TIN-1234/<stamp>/` containing:

| File | What it is |
|---|---|
| `results.csv` | one row per case — the **report sheet** |
| `issues.csv` | one row per failure or block, with repro steps — the **issues sheet** |
| `report.html` | the same thing for humans, with the screenshots **inline** |
| `screenshots/` | the picture behind every failure |

`issues.csv` is built by joining the verdicts back to the cases, so each issue
already carries numbered steps that stop at the step that broke, what was
expected, what actually happened, and the screenshot path. You do not write
these by hand.

### 3a. Upload the screenshots first

An issue without its picture is an argument. Upload each screenshot referenced
in `issues.csv`, then put its link in that row:

```
Google_Drive:create_file(
  title: "TIN-1234-01 · TC-003 · daily limit not saved.png",
  base64Content: <the png, base64 encoded>,
  contentMimeType: "image/png")
```

Name each file after **the issue it belongs to**, so the link is self-describing
once it is out of the folder.

> **Sheets cannot show a Drive image inline.** `=IMAGE()` needs a publicly
> reachable URL, and we only share by email — so the Screenshot column holds a
> **link**, not a thumbnail. If someone wants pictures on the page, send them
> `report.html`, where they are embedded. Say this plainly rather than shipping
> a sheet full of broken `=IMAGE()` cells.

### 3b. Upload the two sheets

Replace the local screenshot paths in `issues.csv` with the Drive links you just
got, then upload both:

```
Google_Drive:create_file(title: "QA Report · TIN-1234 · <stamp>",
  textContent: <results.csv>, contentMimeType: "text/csv")

Google_Drive:create_file(title: "QA Issues · TIN-1234 · <stamp>",
  textContent: <issues.csv with the screenshot links>, contentMimeType: "text/csv")
```

A CSV upload becomes a one-tab spreadsheet, which is why the report and the
issues are **two sheets, not two tabs**. Record both:

```bash
./qa task TIN-1234 --report-sheet "<report sheet url>"
```

### 3c. Say it in chat

- the counts — passed / failed / blocked / skipped
- **every** issue: its id, the case, the step that broke, expected vs actual,
  and the screenshot link
- links to the report sheet, the issues sheet, and the local report folder
- what you did **not** cover, and why (checkout completion is done by hand)

Optionally comment the summary back on the task with
`clickup_create_task_comment` — ask first, it is visible to the whole team.

---

## Rules that hold across all three phases

- **Never** put a password, an `id_token`, a `session` or an `hmac` in a sheet, a
  report, a comment or the terminal. The sheets are team-readable.
- **Never** commit anything under `Test Result/` — it is gitignored for a reason.
- Report BLOCKED as BLOCKED. An unrun case is not a passing case.
- If a finding stops reproducing, retract it plainly. Say what changed.
- **A case makes its own test data.** If it needs a product, it creates one and
  deletes it in teardown — never assume the store already has one, or the case
  fails the day someone tidies up and the failure looks like an app bug.
- **Destructive steps need the human's go-ahead the first time.** Creating
  products, deleting them, and placing orders all change the real store.
  `qa validate` prints a warning for each one; show those warnings and get a yes
  before the first run on a store you have not ordered on before.
- **Ordering only happens on a development store with test payments on.**
  `place a test order` checks the checkout for the test-mode text and refuses
  otherwise — but confirm it with the human rather than relying on the gate
  alone.
- **Every teardown gets checked.** Reload and confirm the product is gone. In
  this app, deletes have not always persisted.
- **The sheet wins.** Pull before every run; never report on a case list the
  human has not seen.
- **A sheet is one tab.** Cases, report and issues are three separate sheets.
  Do not promise tabs this flow cannot create.
- **Every issue needs steps and a picture.** If a failure produced no
  screenshot, rerun that case with `--shots` before writing it up.
- **Only failures and blocks become issues.** A passing case is not an issue,
  and a blocked one is filed as unverified — never as a defect you confirmed.
- **Do not invent a severity.** It comes from the case's tags, or it stays
  `Untriaged` for a human to set.
