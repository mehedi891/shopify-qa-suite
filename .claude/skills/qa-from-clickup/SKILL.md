---
name: qa-from-clickup
description: Run the QA flow for a Shopify app feature end to end, starting from a ClickUp task id (e.g. TIN-1234). Reads the task and its TIN doc, generates test cases into a Google Sheet, runs them against the live store in a real browser, and produces a report sheet. Use whenever someone gives a ClickUp task id, a TIN doc link, or asks to QA / test / verify a feature or a bug.
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

### 2b. Run

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

## Phase 3 — Report

```bash
./qa results --task TIN-1234
```

This writes `Test Result/TIN-1234/<stamp>/` with `results.csv`, `report.html`
and the screenshots, and prints the table for the chat.

Upload the results as the report sheet:

```
Google_Drive:create_file(
  title: "QA Report · TIN-1234 · <stamp>",
  textContent: <the exact contents of results.csv>,
  contentMimeType: "text/csv")
```

```bash
./qa task TIN-1234 --report-sheet "<the sheet url>"
```

Then report in chat:

- the counts — passed / failed / blocked / skipped
- **every** failure: case id, the step that failed, what was expected, what
  happened, and the screenshot path
- the report sheet link and the local report folder
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
- Destructive steps (deleting data, placing real orders) need the human's
  go-ahead first, and a teardown that puts the store back.
