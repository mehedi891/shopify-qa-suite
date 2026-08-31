import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { rmSync } from 'node:fs';
import { StepEngine } from '../src/engine/StepEngine.js';
import { LocatorCache } from '../src/engine/LocatorCache.js';
import { NullPlanner } from '../src/engine/Planner.js';
import type { FrameProvider, NamedRoot } from '../src/engine/resolve.js';
import { TestContext } from '../src/runner/Context.js';
import { parseStepBlock } from '../src/source/parser.js';
import type { Step, StepResult } from '../src/types.js';
import { startFixtureServer } from './helpers/server.js';

const CACHE_PATH = '.cache/test-locators.json';

let server: Awaited<ReturnType<typeof startFixtureServer>>;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  rmSync(CACHE_PATH, { force: true });
});

/**
 * Mirrors AdminSurface: the app iframe first, then the host admin frame.
 * This is the arrangement the real Shopify admin has — our app inside an
 * iframe, with toasts and the save bar drawn by the host outside it.
 */
function adminFrames(page: Page): FrameProvider {
  return {
    async roots(hint): Promise<NamedRoot[]> {
      const app: NamedRoot = { name: 'app', root: page.frameLocator('iframe[name="app-iframe"]') };
      const host: NamedRoot = { name: 'host', root: page };
      if (hint === 'app') return [app];
      if (hint === 'host') return [host];
      return [app, host];
    },
  };
}

function pageFrames(page: Page): FrameProvider {
  return { async roots() { return [{ name: 'page', root: page }]; } };
}

interface RunResult { results: StepResult[]; context: TestContext; cache: LocatorCache }

async function runSteps(
  text: string,
  opts: { page: Page; frames: FrameProvider; testCaseId?: string; cache?: LocatorCache; context?: TestContext },
): Promise<RunResult> {
  const { steps } = parseStepBlock(text, 'admin', 'steps');
  const cache = opts.cache ?? new LocatorCache(CACHE_PATH);
  const context = opts.context ?? new TestContext();
  const engine = new StepEngine({
    page: opts.page,
    frames: opts.frames,
    cache,
    planner: new NullPlanner(),
    context,
    timeoutMs: 5_000,
  });
  const results: StepResult[] = [];
  for (const step of steps) {
    results.push(await engine.execute(step, opts.testCaseId ?? 'TC-TEST'));
  }
  return { results, context, cache };
}

const failures = (rs: StepResult[]) =>
  rs.filter((r) => r.status === 'failed').map((r) => `${r.step.raw} → ${r.error}`);

describe('step engine against a simulated Shopify admin', () => {
  it('acts inside the embedded app iframe', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);

    const { results } = await runSteps(
      [
        'turn on "Enable discount banner"',
        'fill "Banner text" with "Free shipping over $50"',
        'select "Below add to cart" in "Placement"',
        'expect the value of "Banner text" to be "Free shipping over $50"',
      ].join('\n'),
      { page, frames: adminFrames(page) },
    );

    expect(failures(results)).toEqual([]);
    // every one of those resolved inside the app frame
    expect(results.map((r) => r.resolvedLocator?.split(':')[0])).toEqual(['app', 'app', 'app', 'app']);
    await page.close();
  }, 60_000);

  it('finds a toast that the host frame renders, not the app frame', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);

    const { results } = await runSteps(
      [
        'turn on "Enable discount banner"',
        'fill "Banner text" with "Summer sale"',
        'click "Save"',
        'expect toast "Settings saved"',
      ].join('\n'),
      { page, frames: adminFrames(page) },
    );

    expect(failures(results)).toEqual([]);
    // the click was in the app; the toast was found in the host — automatically
    expect(results[2]!.resolvedLocator).toMatch(/^app:/);
    expect(results[3]!.resolvedLocator).toMatch(/^host:/);
    await page.close();
  }, 60_000);

  it('honours an explicit "in host" frame hint', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);
    const { results } = await runSteps('expect "Test Store · Admin" to be visible in host', {
      page, frames: adminFrames(page),
    });
    expect(failures(results)).toEqual([]);
    expect(results[0]!.resolvedLocator).toMatch(/^host:/);
    await page.close();
  }, 60_000);

  it('resolves explicit CSS selectors without touching the cache', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);
    const { results, cache } = await runSteps('click [data-block-handle], #save', {
      page, frames: adminFrames(page),
    });
    expect(results[0]!.locatorSource).toBe('explicit');
    expect(cache.get(LocatorCache.key('TC-TEST', 0, 'click [data-block-handle], #save'))).toBeUndefined();
    await page.close();
  }, 60_000);
});

describe('cross-surface flow', () => {
  it('carries a value from the admin app to the storefront', async () => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await admin.goto(`${server.url}/admin.html`);

    const context = new TestContext();
    const setup = await runSteps(
      [
        'turn on "Enable discount banner"',
        'fill "Banner text" with "Free shipping over $50 {random}"',
        'click "Save"',
        'expect toast "Settings saved"',
        'save the value of "Banner text" as bannerText',
      ].join('\n'),
      { page: admin, frames: adminFrames(admin), context, testCaseId: 'TC-021' },
    );
    expect(failures(setup.results)).toEqual([]);

    const bannerText = context.get('bannerText');
    expect(bannerText).toMatch(/^Free shipping over \$50 /);

    // same origin, fresh page — the storefront as a shopper sees it
    const storefront = await ctx.newPage();
    await storefront.goto(`${server.url}/storefront.html`);

    const check = await runSteps('expect "{bannerText}" to be visible', {
      page: storefront, frames: pageFrames(storefront), context, testCaseId: 'TC-021',
    });
    expect(failures(check.results)).toEqual([]);

    await storefront.close();
    await admin.close();
    await ctx.close();
  }, 60_000);

  it('fails clearly when the storefront does not reflect the admin change', async () => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await admin.goto(`${server.url}/admin.html`);
    await runSteps('turn off "Enable discount banner"\nclick "Save"', {
      page: admin, frames: adminFrames(admin),
    });

    const storefront = await ctx.newPage();
    await storefront.goto(`${server.url}/storefront.html`);
    const { results } = await runSteps('expect "Free shipping" to be visible', {
      page: storefront, frames: pageFrames(storefront),
    });

    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.error).toMatch(/Could not find "Free shipping"/);
    await storefront.close();
    await admin.close();
    await ctx.close();
  }, 60_000);
});

describe('validation behaviour', () => {
  it('reports the app-side validation error as a normal failed assertion', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);
    const { results } = await runSteps(
      [
        'turn on "Enable discount banner"',
        'fill "Banner text" with ""',
        'click "Save"',
        'expect "Banner text is required" to be visible',
      ].join('\n'),
      { page, frames: adminFrames(page) },
    );
    expect(failures(results)).toEqual([]);
    await page.close();
  }, 60_000);
});

describe('locator cache', () => {
  it('resolves via heuristics first, then replays from cache with no planner', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);
    const cache = new LocatorCache(CACHE_PATH);
    const step = 'click "Save"';

    const first = await runSteps(step, { page, frames: adminFrames(page), cache, testCaseId: 'TC-CACHE' });
    expect(first.results[0]!.locatorSource).toBe('planned');

    const second = await runSteps(step, { page, frames: adminFrames(page), cache, testCaseId: 'TC-CACHE' });
    expect(second.results[0]!.locatorSource).toBe('cache');
    // and it remembered which frame, so it never searched the host again
    expect(second.results[0]!.resolvedLocator).toMatch(/^app:/);
    await page.close();
  }, 60_000);

  it('re-resolves and marks the step healed when a cached locator goes stale', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/admin.html`);
    const cache = new LocatorCache(CACHE_PATH);
    const step = 'click "Save"';
    const key = LocatorCache.key('TC-HEAL', 0, step);

    // poison the cache the way a UI change would
    cache.set(key, {
      spec: { strategy: 'css', selector: '#button-that-no-longer-exists' },
      frame: 'app', via: 'heuristic', savedAt: new Date().toISOString(),
    });

    const { results } = await runSteps(step, { page, frames: adminFrames(page), cache, testCaseId: 'TC-HEAL' });
    expect(results[0]!.status).toBe('passed');
    expect(results[0]!.locatorSource).toBe('healed');
    expect(cache.get(key)!.spec.strategy).toBe('role');
    await page.close();
  }, 60_000);

  it('does not cache a locator built from a variable, since it is run-specific', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${server.url}/admin.html`);

    const cache = new LocatorCache(CACHE_PATH);
    const context = new TestContext();
    context.set('label', 'Save');
    const step = 'click "{label}"';

    const { results } = await runSteps(step, {
      page, frames: adminFrames(page), cache, context, testCaseId: 'TC-VAR',
    });
    expect(results[0]!.status).toBe('passed');
    // caching "Save" under a step that says "{label}" would be wrong the moment
    // the variable resolves to anything else
    expect(cache.get(LocatorCache.key('TC-VAR', 0, step))).toBeUndefined();

    await page.close();
    await ctx.close();
  }, 60_000);
});

