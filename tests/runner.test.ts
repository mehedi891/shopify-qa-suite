import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { Runner, type RunSummary } from '../src/runner/Runner.js';
import { Artifacts } from '../src/runner/artifacts.js';
import { LocatorCache } from '../src/engine/LocatorCache.js';
import { NullPlanner } from '../src/engine/Planner.js';
import { selectCases } from '../src/runner/select.js';
import { ConsoleReporter } from '../src/report/ConsoleReporter.js';
import { HtmlReporter } from '../src/report/HtmlReporter.js';
import { rowsToTestCases } from '../src/source/rows.js';
import type { TestCase } from '../src/types.js';
import { startFixtureServer } from './helpers/server.js';
import { FixtureSurfaces } from './helpers/fixtureSurfaces.js';

const ARTIFACT_ROOT = '.cache/test-artifacts';
let server: Awaited<ReturnType<typeof startFixtureServer>>;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  rmSync(ARTIFACT_ROOT, { recursive: true, force: true });
  rmSync('.cache/runner-locators.json', { force: true });
});

const HEADER = [
  'ID', 'Title', 'Suite', 'Tags', 'Surface', 'Precondition',
  'Steps', 'Expected Result', 'Teardown', 'Enabled',
];

function makeCase(over: Partial<Record<string, string>> & { ID: string }): TestCase {
  const row = HEADER.map((h) => over[h] ?? '');
  const { cases, issues } = rowsToTestCases(HEADER, [row]);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
  return cases[0]!;
}

async function runCases(cases: TestCase[], opts: { retries?: number } = {}): Promise<{
  summary: RunSummary; artifacts: Artifacts;
}> {
  const surfaces = new FixtureSurfaces(browser, server.url);
  const artifacts = new Artifacts(ARTIFACT_ROOT, `run-${Math.random().toString(36).slice(2, 8)}`);
  const runner = new Runner({
    surfaces,
    cache: new LocatorCache('.cache/runner-locators.json'),
    planner: new NullPlanner(),
    artifacts,
    config: {
      retries: opts.retries ?? 0,
      timeoutMs: 4_000,
      screenshots: 'on-failure',
      trace: 'off',
      builtins: { store: 'test-store.myshopify.com' },
    },
    reporters: [new ConsoleReporter(false), new HtmlReporter(artifacts)],
  });
  try {
    return { summary: await runner.run(cases), artifacts };
  } finally {
    await surfaces.close();
  }
}

describe('runner', () => {
  it('runs a cross-surface case end to end', async () => {
    const tc = makeCase({
      ID: 'TC-021',
      Title: 'Banner set in admin appears on the storefront',
      Suite: 'widget',
      Tags: 'smoke, cross-surface',
      Surface: 'admin',
      Steps: [
        'turn on "Enable discount banner"',
        'fill "Banner text" with "Free shipping {random}"',
        'click "Save"',
        'expect toast "Settings saved"',
        'save the value of "Banner text" as bannerText',
        'switch to storefront',
        'go to the product page for "Test Product"',
      ].join('\n'),
      'Expected Result': 'expect "{bannerText}" to be visible',
    });

    const { summary } = await runCases([tc]);
    const result = summary.results[0]!;
    if (result.status !== 'passed') {
      console.error(result.steps.filter((s) => s.status === 'failed').map((s) => `${s.step.raw} → ${s.error}`));
    }
    expect(result.status).toBe('passed');
    expect(summary.passed).toBe(1);
    expect(summary.plannerCalls).toBe(0); // heuristics alone resolved every step
  }, 90_000);

  it('runs teardown even when the case fails, and teardown failure does not mask it', async () => {
    const tc = makeCase({
      ID: 'TC-FAIL',
      Title: 'Fails mid-way but still cleans up',
      Surface: 'admin',
      Steps: [
        'turn on "Enable discount banner"',
        'fill "Banner text" with "Persisted value"',
        'click "Save"',
      ].join('\n'),
      'Expected Result': 'expect "This text is definitely not on the page" to be visible',
      Teardown: 'turn off "Enable discount banner"\nclick "Save"',
    });

    const { summary } = await runCases([tc]);
    const result = summary.results[0]!;
    expect(result.status).toBe('failed');
    // the teardown steps ran and passed despite the failure above them
    const teardown = result.steps.filter((s) => s.step.origin === 'teardown');
    expect(teardown).toHaveLength(2);
    expect(teardown.every((s) => s.status === 'passed')).toBe(true);
  }, 90_000);

  it('stops a case at the first failing step', async () => {
    const tc = makeCase({
      ID: 'TC-STOP',
      Title: 'Later steps are not attempted',
      Surface: 'admin',
      Steps: [
        'click "No Such Button"',
        'fill "Banner text" with "never reached"',
      ].join('\n'),
      'Expected Result': 'expect "Dashboard" to be visible',
    });

    const { summary } = await runCases([tc]);
    const result = summary.results[0]!;
    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.error).toMatch(/Could not find "No Such Button"/);
  }, 90_000);

  it('retries a failing case and reports the attempt count', async () => {
    const tc = makeCase({
      ID: 'TC-RETRY',
      Title: 'Always fails',
      Surface: 'admin',
      Steps: 'click "Nope"',
      'Expected Result': 'expect "Dashboard" to be visible',
    });
    const { summary } = await runCases([tc], { retries: 1 });
    expect(summary.results[0]!.attempts).toBe(2);
    expect(summary.failed).toBe(1);
  }, 90_000);

  it('keeps going after one case fails', async () => {
    const bad = makeCase({
      ID: 'TC-BAD', Title: 'Fails', Surface: 'admin',
      Steps: 'click "Nope"', 'Expected Result': 'expect "Dashboard" to be visible',
    });
    const good = makeCase({
      ID: 'TC-GOOD', Title: 'Passes', Surface: 'admin',
      Steps: 'click "Settings"', 'Expected Result': 'expect "Dashboard" to be visible',
    });
    const { summary } = await runCases([bad, good]);
    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(1);
  }, 90_000);

  it('skips disabled cases without launching a browser context', async () => {
    const tc = makeCase({
      ID: 'TC-OFF', Title: 'Disabled', Surface: 'admin',
      Steps: 'click "Settings"', 'Expected Result': 'expect "Dashboard" to be visible',
      Enabled: 'FALSE',
    });
    const { summary } = await runCases([tc]);
    expect(summary.skipped).toBe(1);
    expect(summary.results[0]!.steps).toHaveLength(0);
  }, 60_000);

  it('refuses to run a case that borrows a variable saved by another case', () => {
    // Cross-case variable leakage is caught statically, before a browser opens —
    // each case gets its own TestContext, so this could never resolve at runtime.
    const row = HEADER.map((h) => ({
      ID: 'TC-B', Title: 'Borrows a variable', Surface: 'admin',
      Steps: 'click "Settings"', 'Expected Result': 'expect "{leaked}" to be visible',
    } as Record<string, string>)[h] ?? '');
    const { issues } = rowsToTestCases(HEADER, [row]);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/Uses \{leaked\} but nothing saved it earlier/);
  });

  it('gives each case its own variable scope at runtime', async () => {
    const first = makeCase({
      ID: 'TC-A', Title: 'Saves a variable', Surface: 'admin',
      Steps: 'fill "Banner text" with "scoped-value"\nsave the value of "Banner text" as scoped',
      'Expected Result': 'expect the value of "Banner text" to be "{scoped}"',
    });
    const second = makeCase({
      ID: 'TC-B', Title: 'Saves its own', Surface: 'admin',
      Steps: 'fill "Banner text" with "different-value"\nsave the value of "Banner text" as scoped',
      'Expected Result': 'expect the value of "Banner text" to be "{scoped}"',
    });
    const { summary } = await runCases([first, second]);
    // both pass, each seeing only its own value for the same variable name
    expect(summary.passed).toBe(2);
  }, 90_000);
});

describe('artifacts and reporting', () => {
  it('writes an HTML report and a screenshot for the failing step', async () => {
    const tc = makeCase({
      ID: 'TC-SHOT', Title: 'Fails to produce a screenshot', Surface: 'admin',
      Steps: 'click "Settings"',
      'Expected Result': 'expect "Nothing like this exists" to be visible',
    });
    const { summary, artifacts } = await runCases([tc]);
    expect(existsSync(artifacts.reportPath)).toBe(true);

    const html = readFileSync(artifacts.reportPath, 'utf8');
    expect(html).toContain('TC-SHOT');
    expect(html).toContain('1 failed');
    // the failing step's locator source and error make it into the report
    expect(html).toContain('Could not find');

    const failing = summary.results[0]!.steps.find((s) => s.status === 'failed')!;
    expect(failing.screenshot).toBeDefined();
    expect(existsSync(failing.screenshot!)).toBe(true);
  }, 90_000);

  it('escapes test content so a quote in a title cannot break the report', async () => {
    const tc = makeCase({
      ID: 'TC-XSS', Title: 'Title with <script>alert("x")</script> inside', Surface: 'admin',
      Steps: 'click "Settings"', 'Expected Result': 'expect "Dashboard" to be visible',
    });
    const { artifacts } = await runCases([tc]);
    const html = readFileSync(artifacts.reportPath, 'utf8');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  }, 90_000);
});

describe('case selection', () => {
  const cases = [
    makeCase({ ID: 'TC-1', Title: 'a', Suite: 'settings', Tags: 'smoke, p0', Steps: 'click "x"', 'Expected Result': 'expect "y"' }),
    makeCase({ ID: 'TC-2', Title: 'b', Suite: 'widget', Tags: 'p1', Steps: 'click "x"', 'Expected Result': 'expect "y"' }),
    makeCase({ ID: 'TC-3', Title: 'c', Suite: 'widget', Tags: 'smoke', Steps: 'click "x"', 'Expected Result': 'expect "y"', Enabled: 'FALSE' }),
  ];

  it('filters by id, tag and suite', () => {
    expect(selectCases(cases, { id: ['TC-2'] }).map((c) => c.id)).toEqual(['TC-2']);
    expect(selectCases(cases, { tag: ['smoke'] }).map((c) => c.id)).toEqual(['TC-1', 'TC-3']);
    expect(selectCases(cases, { suite: 'widget' }).map((c) => c.id)).toEqual(['TC-2', 'TC-3']);
  });

  it('is case-insensitive', () => {
    expect(selectCases(cases, { id: ['tc-2'] }).map((c) => c.id)).toEqual(['TC-2']);
    expect(selectCases(cases, { tag: ['SMOKE'] })).toHaveLength(2);
  });

  it('errors on an unknown id rather than silently running nothing', () => {
    expect(() => selectCases(cases, { id: ['TC-99'] })).toThrow(/No test case with ID TC-99/);
  });

  it('runs a disabled case when it is named explicitly', () => {
    const [only] = selectCases(cases, { id: ['TC-3'] });
    expect(only!.enabled).toBe(true);
  });

  it('explains itself when --only-failed has no previous run', () => {
    expect(() => selectCases(cases, { onlyFailed: true, statePath: '/nope/none.json' }))
      .toThrow(/No previous run found/);
  });
});
