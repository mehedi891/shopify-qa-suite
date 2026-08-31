# Shopify App QA Automation — Docs

Planning docs for a tool that reads QA test cases from a Google Sheet and runs
them in a real browser against our Shopify app — both the embedded admin app and
the storefront.

**Read in this order:**

1. **[PRD.md](PRD.md)** — problem, scope, requirements, risks, open questions.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — stack, layers, and the three
   Shopify-specific hard parts (admin auth, App Bridge iframe, storefront access).
3. **[TEST_CASE_SPEC.md](TEST_CASE_SPEC.md)** — the sheet columns and step
   grammar. **This is the doc to hand QA.**
4. **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** — six phases, build order,
   milestones.
5. **[COVERAGE.md](COVERAGE.md)** — what the tool can reach: App Bridge modals,
   dialogs, downloads, popups, forced error states, and the few categories that
   need extra infrastructure.
6. **[SETUP.md](SETUP.md)** — dev store, service account, env, CI. Some items need
   admin rights; start them early.

## Decisions locked in

- **Real browser** (Playwright + Chromium) — the embedded admin app cannot be
  tested any other way.
- **Google Sheets** as the test-case source, with results written back to the same rows.
- **All three surfaces**: embedded admin, storefront theme extension, and
  cross-surface flows in a single test case.
- **Plain-English steps** resolved by an AI planner on first run, then cached as
  concrete locators so repeat runs are fast and deterministic.

## Before implementation starts

Answers needed on [PRD §9](PRD.md#9-open-questions) — chiefly: which dev store,
whether we can get a staff account with 2FA disabled, and whether an existing QA
sheet should define the column layout.
