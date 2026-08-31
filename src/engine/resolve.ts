import type { Locator } from 'playwright';
import type { FrameHint, LocatorSource, Step, Target } from '../types.js';
import { buildLocator, candidateSpecs, describeSpec, type LocatorRoot, type LocatorSpec } from './locator.js';
import { LocatorCache } from './LocatorCache.js';
import type { Planner } from './Planner.js';

/** Supplies the frames a step may search, in priority order. */
export interface FrameProvider {
  roots(hint: FrameHint): Promise<NamedRoot[]>;
}

export interface NamedRoot {
  /** 'app', 'host', 'page' — recorded in the cache so we skip searching next time. */
  name: string;
  root: LocatorRoot;
}

export interface Resolution {
  locator: Locator;
  spec: LocatorSpec;
  frameName: string;
  source: LocatorSource;
}

export interface ResolveDeps {
  frames: FrameProvider;
  cache: LocatorCache;
  planner: Planner;
  timeoutMs: number;
  /** False when the target label contains a variable, so the resolution is
   *  run-specific and must not be persisted. Defaults to true. */
  cacheable?: boolean;
}

export class ResolutionError extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Count matches without throwing — a detached frame mid-navigation is normal. */
async function safeCount(locator: Locator): Promise<number> {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function findRootByName(frames: FrameProvider, hint: FrameHint, name: string): Promise<NamedRoot | undefined> {
  const roots = await frames.roots(hint);
  return roots.find((r) => r.name === name) ?? roots[0];
}

/**
 * Find the element a step refers to.
 *
 * Order matters, and it is the whole cost story:
 *   1. explicit selector  — free, deterministic, author-controlled
 *   2. cached locator     — free, and what makes repeat runs reproducible
 *   3. role/label/text heuristics — free, and resolves the large majority of steps
 *   4. the planner        — costs a model call, so it is the last resort
 *
 * Steps 1–3 are retried until the deadline so async rendering resolves itself
 * without anyone writing a sleep.
 */
export async function resolveTarget(
  step: Step,
  target: Target,
  testCaseId: string,
  deps: ResolveDeps,
): Promise<Resolution> {
  const { frames, cache, planner, timeoutMs } = deps;
  const cacheable = deps.cacheable !== false;
  const hint = target.frame;

  // 1. explicit selector — the author told us exactly what they meant
  if (target.explicit) {
    const spec: LocatorSpec = { strategy: 'css', selector: target.raw };
    const roots = await frames.roots(hint);
    const deadline = Date.now() + timeoutMs;
    do {
      for (const { name, root } of roots) {
        const locator = buildLocator(root, spec);
        if (await safeCount(locator) > 0) {
          return { locator, spec, frameName: name, source: 'explicit' };
        }
      }
      await sleep(150);
    } while (Date.now() < deadline);
    throw new ResolutionError(`No element matched the selector ${target.raw}.`);
  }

  const cacheKey = LocatorCache.key(testCaseId, step.index, step.raw);

  // 2. cached locator — replay a past resolution, no model involved
  const cached = cacheable ? cache.get(cacheKey) : undefined;
  if (cached) {
    const named = await findRootByName(frames, hint, cached.frame);
    if (named) {
      const locator = buildLocator(named.root, cached.spec);
      const deadline = Date.now() + Math.min(timeoutMs, 5_000);
      do {
        if (await safeCount(locator) > 0) {
          return { locator, spec: cached.spec, frameName: named.name, source: 'cache' };
        }
        await sleep(150);
      } while (Date.now() < deadline);
    }
    // stale — drop it and re-resolve, which is the self-healing path
    cache.delete(cacheKey);
  }

  // 3. deterministic heuristics
  const opts = step.kind === 'action'
    ? { actionKind: step.action?.kind }
    : { assertionKind: step.assertion?.kind };
  const candidates = candidateSpecs(target.raw, opts);
  const roots = await frames.roots(hint);
  const heuristicDeadline = Date.now() + timeoutMs;

  do {
    let ambiguous: { spec: LocatorSpec; name: string } | undefined;
    for (const { name, root } of roots) {
      for (const spec of candidates) {
        const count = await safeCount(buildLocator(root, spec));
        if (count === 1) {
          const locator = buildLocator(root, spec);
          const source: LocatorSource = cached ? 'healed' : 'planned';
          if (cacheable) cache.set(cacheKey, { spec, frame: name, via: 'heuristic', savedAt: new Date().toISOString() });
          return { locator, spec, frameName: name, source };
        }
        // remember the first multi-match in case nothing resolves uniquely
        if (count > 1 && !ambiguous) ambiguous = { spec, name };
      }
    }
    if (ambiguous && Date.now() + 300 >= heuristicDeadline) {
      // several match and time is up: take the first, and record the choice
      const spec: LocatorSpec = { ...ambiguous.spec, nth: 0 };
      const named = roots.find((r) => r.name === ambiguous!.name)!;
      if (cacheable) cache.set(cacheKey, { spec, frame: named.name, via: 'heuristic', savedAt: new Date().toISOString() });
      return {
        locator: buildLocator(named.root, spec),
        spec,
        frameName: named.name,
        source: cached ? 'healed' : 'planned',
      };
    }
    await sleep(200);
  } while (Date.now() < heuristicDeadline);

  // 4. planner — the only step that costs anything
  const primary = roots[0];
  if (!primary) throw new ResolutionError('No frame available to search.');

  const snapshot = await ariaSnapshot(primary.root);
  const spec = await planner.plan({
    stepRaw: step.raw,
    label: target.raw,
    actionKind: step.action?.kind,
    assertionKind: step.assertion?.kind,
    frameName: primary.name,
    snapshot,
  });

  if (spec) {
    const locator = buildLocator(primary.root, spec);
    if (await safeCount(locator) > 0) {
      if (cacheable) cache.set(cacheKey, { spec, frame: primary.name, via: 'planner', savedAt: new Date().toISOString() });
      return { locator, spec, frameName: primary.name, source: cached ? 'healed' : 'planned' };
    }
  }

  throw new ResolutionError(
    `Could not find "${target.raw}" for step: ${step.raw}\n` +
    `  Searched: ${roots.map((r) => r.name).join(', ')}\n` +
    `  Tried: ${candidates.slice(0, 4).map(describeSpec).join(', ')}…` +
    plannerAdvice(planner.name),
  );
}

function plannerAdvice(plannerName: string): string {
  if (plannerName === 'agent') {
    return '\n  Run `qa snapshot` to see what is actually on the page, then either fix the\n' +
           '  label in the sheet or use an explicit selector, e.g. qa do \'click [data-test=save]\'.';
  }
  if (plannerName === 'null') {
    return '\n  No planner configured. Either drive this interactively (`qa start`, then\n' +
           '  `qa snapshot`), or set ANTHROPIC_API_KEY for unattended runs.';
  }
  return '\n  The planner could not identify it either.';
}

/** Compact accessibility tree of a frame, used as planner input. */
export async function ariaSnapshot(root: LocatorRoot, maxChars = 20_000): Promise<string> {
  try {
    const body = root.locator('body');
    const snapshot = await body.ariaSnapshot({ timeout: 5_000 });
    return snapshot.length > maxChars ? `${snapshot.slice(0, maxChars)}\n… (truncated)` : snapshot;
  } catch {
    return '(accessibility snapshot unavailable)';
  }
}
