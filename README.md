# Shopify QA Suite

A tool that tests your Shopify app for you.

You write your tests in plain English. The tool opens a real browser, logs into
your store, clicks through your app, checks the storefront, and tells you what
broke.

```
Steps:            open the app
                  click "Settings"
                  turn on "Enable discount banner"
                  fill "Banner text" with "Free shipping"
                  click "Save"
                  switch to storefront
                  go to the product page for "Test Product"

Expected Result:  expect "Free shipping" to be visible
```

No CSS selectors. No code. Just words.

---

## What it can test

- Your app inside the Shopify admin (the part in the iframe)
- Your storefront blocks and widgets
- Both at once — change a setting in the admin, then check the storefront shows it
- How your app looks on a phone screen

---

## Before you start

You need three things:

1. **Node.js 20 or newer.** Check with `node -v`. If you don't have it, get it
   from [nodejs.org](https://nodejs.org). Works on macOS, Windows and Linux.
2. **Google Chrome** installed on your computer.
3. **A Shopify dev store** with your app installed on it.

That's all. You do **not** need any API key. You do **not** need a Google
service account. You do **not** need to put anything in a `.env` file.

---

## Setup — 4 steps

> ### 🪟 On Windows, write `qa` instead of `./qa`
>
> Everything else in this guide is exactly the same. So where you see
> `./qa start`, you type `qa start`.
>
> If that does not work, this longer form works on **every** computer:
> `npm run qa -- start`

### Step 1 — Get the code

```bash
git clone https://github.com/mehedi891/shopify-qa-suite.git
cd shopify-qa-suite
```

### Step 2 — Install it

```bash
npm install
npx playwright install chromium
```

This takes a minute or two the first time.

### Step 3 — Open the browser

```bash
./qa start
```

A Chrome window will open. (Windows: `qa start`)

### Step 4 — Log in

In that new Chrome window:

1. Log into your Shopify admin, like you normally would
2. Open the app you want to test

Then come back to your terminal and run:

```bash
./qa detect
```

You should see something like this:

```
✓ store fastdev891.myshopify.com · app "my-app" · iframe host my-tunnel.ngrok-free.app
```

The tool just learned your store name, your app name, and where your app runs.
You did not have to type any of it.

**You only log in once.** The tool remembers you. Next time you run `./qa start`,
you are already logged in.

---

## Write your first test

Make a file called `cases/my-tests.csv`. Copy this and change it to match your app:

```csv
ID,Title,Suite,Tags,Surface,Precondition,Steps,Expected Result,Teardown,Enabled
TC-001,App opens in the admin,basic,smoke,admin,,"open the app","expect ""Dashboard"" to be visible",,TRUE
TC-002,Product page loads,basic,smoke,storefront,,"go to the product page for ""Test Product""","expect ""Add to cart"" to be visible",,TRUE
```

Each row is one test. The important columns are:

| Column | What it means |
|---|---|
| `ID` | A short name, like `TC-001` |
| `Title` | What you are testing, in your own words |
| `Surface` | `admin` or `storefront` — where the test starts |
| `Steps` | What to do. One step per line. |
| `Expected Result` | What should be true at the end |
| `Teardown` | How to undo it (so the next test starts clean) |

Now check that the tool understands your file:

```bash
./qa validate --csv cases/my-tests.csv
```

If you made a typo, it tells you the exact row and line:

```
TC-003 (row 6, Steps line 1) Could not understand step: "frobnicate the widget".
```

This takes about 2 seconds. No browser opens. Fix your file and run it again.

---

## Run your tests

```bash
./qa suite --csv cases/my-tests.csv
```

You will see each step as it happens:

```
TC-001 App opens in the admin
  ✓ switch to admin 12ms
  ✓ open the app 840ms
  ✓ expect "Dashboard" to be visible 91ms
✓ PASS TC-001 App opens in the admin
```

---

## Get your report

```bash
./qa results
```

This makes a folder with everything in it:

```
reports/2026-08-31T12-01-02/
├── report.html       ← open this in your browser
├── results.csv       ← open this in Excel or Google Sheets
└── screenshots/      ← pictures of what broke
```

You can zip that folder and send it to your team. The pictures still work.

---

## When you are done

```bash
./qa stop
```

This closes the browser.

---

## Words you can use in your tests

### Doing things

```
open the app
go to the product page for "Test Product"
click "Save"
fill "Banner text" with "Summer sale"
select "Percentage" in "Discount type"
turn on "Enable widget"
turn off "Enable widget"
check "Show on collection pages"
uncheck "Show on collection pages"
upload "logo.png" to "Logo"
hover over "Info icon"
press "Enter"
wait for "Settings saved"
reload the page
switch to storefront
switch to admin
set viewport to mobile
save the value of "Banner text" as bannerText
```

### Checking things

```
expect "Free shipping" to be visible
expect "Old banner" to be hidden
expect the value of "Banner text" to be "Summer sale"
expect the url to contain "/settings"
expect toast "Settings saved"
expect 3 products in the list
```

### Using saved values

Save something in one place, check it in another:

```
save the value of "Banner text" as bannerText
switch to storefront
expect "{bannerText}" to be visible
```

`{random}` gives you a different value every time, so your tests don't clash:

```
fill "Banner text" with "Sale {random}"
```

### When words are not enough

If the tool can't find a button by its name, you can point straight at it:

```
click [data-testid="add-to-cart"]
fill #banner-text with "Hello"
```

---

## All the commands

On Windows, drop the `./` from every command below.

| Command | What it does |
|---|---|
| `./qa start` | Open the browser |
| `./qa detect` | Learn your store and app from the open browser |
| `./qa status` | Show what store and page you are on |
| `./qa validate --csv <file>` | Check your test file for mistakes |
| `./qa suite --csv <file>` | Run all the tests in a file |
| `./qa task TIN-1234` | Show one ClickUp task's cases, runs and sheet links |
| `./qa task` | List every task you have tested |
| `./qa play 'step one' 'step two'` | Run a few steps right now |
| `./qa do 'click "Save"'` | Run one step |
| `./qa snapshot` | Show what is on the page right now |
| `./qa shot picture.png` | Take a picture |
| `./qa viewport mobile` | Switch to a phone-sized screen |
| `./qa doctor` | Check if your app is loading properly |
| `./qa results` | Make the report |
| `./qa stop` | Close the browser |

Run only some tests:

```bash
./qa suite --csv cases/my-tests.csv --tag smoke
./qa suite --csv cases/my-tests.csv --id TC-001
```

`validate`, `run`, `suite` and `results` also take `--task TIN-1234` instead of
`--csv`. That is shorthand for the cases generated for that ClickUp task, and it
files the report under that task too:

```bash
./qa validate --task TIN-1234
./qa suite --task TIN-1234
./qa results --task TIN-1234
```

---

## Using this on Windows

It works the same way. Three small differences:

**1. Leave off the `./`**

| This guide says | You type |
|---|---|
| `./qa start` | `qa start` |
| `./qa detect` | `qa detect` |
| `./qa suite --csv cases/my-tests.csv` | `qa suite --csv cases/my-tests.csv` |

Command Prompt and PowerShell both work. You must be inside the project folder.

**2. If `qa` does not work, use this instead**

```
npm run qa -- start
npm run qa -- detect
npm run qa -- suite --csv cases/my-tests.csv
```

Note the `--` in the middle. It is needed, and this form works on every computer.

**3. File paths: use `/`, not `\`**

```
qa suite --csv cases/my-tests.csv
```

Forward slashes work on Windows too. Backslashes only work on Windows, so
sticking to `/` means the same command works for everyone on your team.

### Windows setup, start to finish

```
git clone https://github.com/mehedi891/shopify-qa-suite.git
cd shopify-qa-suite
npm install
npx playwright install chromium
qa start
```

Then log into Shopify in the Chrome window that opens, open your app, and run:

```
qa detect
```

## If something goes wrong

**Shopify won't let me log in.**
The tool uses your real Chrome, which usually works. If it still blocks you,
start Chrome yourself and let the tool join it.

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.qa-chrome-profile"
```

Windows:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\.qa-chrome-profile"
```

Log in there, then run:

```bash
./qa start --attach
```

**It says the profile is already in use.**
Another Chrome window from the tool is still open. Close it, or run `./qa stop`.

**My app doesn't show up.**

```bash
./qa doctor
```

This tells you if your app is fine, your dev server is down, or your app is not
installed on the store.

**It can't find a button.**

```bash
./qa snapshot
```

This shows you everything on the page. Check the button's real name, then fix
your test file.

**"Store unknown"**
Open your app in the browser window, then run `./qa detect` again.

**Windows: `./qa` is not recognised.**
Drop the `./` — on Windows the command is just `qa`. If that still fails, use
`npm run qa -- start` (and `npm run qa -- detect`, and so on). That form works
everywhere.

**Windows: `'qa' is not recognized as an internal or external command`.**
You are not in the project folder. `cd` into the folder you cloned, then try
again.

**Git Bash or WSL: `bad interpreter: /usr/bin/env bash^M`.**
Git converted the launcher to Windows line endings. Fix it with:

```bash
git config core.autocrlf input
git rm --cached -r . && git reset --hard
```

---

## Testing more than one app

If you test two apps, make a file called `qa.apps.json`:

```json
{
  "default": "app-one",
  "apps": {
    "app-one": {
      "store": "my-store.myshopify.com",
      "appHandle": "app-one",
      "appHost": "app-one.example.com"
    },
    "app-two": {
      "store": "my-store.myshopify.com",
      "appHandle": "app-two",
      "appHost": "app-two.example.com"
    }
  }
}
```

Then pick one:

```bash
./qa suite --csv cases/my-tests.csv --app app-two
```

Good to know: **one login covers every app on the same store.** Shopify logs you
into the store, not into each app.

---

## Where your results are saved

Everything a run produces goes in the **`Test Result`** folder, grouped by the
ClickUp task it belongs to:

```
Test Result/
├── screenshots/                  ← pictures taken while tests run
└── TIN-1234/                     ← one folder per ClickUp task
    ├── task.json                 ← the task title and its sheet links
    ├── cases.csv                 ← the tests for this task
    └── 2026-09-02T14-31-07/      ← one folder per run
        ├── report.html           ← open this in your browser
        ├── results.csv           ← open this in Excel or Google Sheets
        └── screenshots/          ← copies of the pictures for this run
```

Not working from a ClickUp task? Then reports land straight in
`Test Result/<timestamp>/` and everything else works the same.

You can zip a report folder and send it to your team. The pictures still work.

This folder is not saved to GitHub, because results belong to a run, not to the
code.

> The folder name has a space in it, so quote it if you ever type it:
> `./qa results --dir "Test Result/my-run"`.

---

## Starting from a ClickUp task

If you use ClickUp, you don't have to write the test file yourself. Give Claude
a task id and it does the whole loop:

1. **Reads** the ClickUp task and its TIN doc
2. **Writes** the test cases into `Test Result/TIN-1234/cases.csv` and uploads
   them as a Google Sheet for you to review
3. **Runs** them in your browser once you approve
4. **Reports** back — in the chat, as an HTML report, and as a second Google
   Sheet

Just say:

> QA TIN-1234

Claude reads the procedure from `.claude/skills/qa-from-clickup/`, which is part
of this repo — so it works the same for anyone who clones it.

**A note on the sheets.** A Google Sheet lives in Google Drive, not on your
computer. So each sheet has a twin CSV in `Test Result/`, and the link to the
sheet is saved in `task.json`. The CSV is what the tool runs; the sheet is what
your team reads. Both come from the same file, so they can never disagree.

```bash
./qa task TIN-1234     # where are this task's cases, runs and sheets?
./qa task              # every task you have tested
```

---

## A note on safety

- `.qa-profile/` holds your live Shopify login. It is never uploaded to GitHub.
- `qa.apps.json` has your real store names. It is never uploaded either.
- Never put passwords in your test file. Your whole team can read that file.
