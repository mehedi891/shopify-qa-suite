import type { Page } from 'playwright';
import type { Step, StepResult } from '../types.js';
import type { TestContext } from '../runner/Context.js';
import { performAction } from './actions.js';
import { checkAssertion } from './assertions.js';
import { describeSpec } from './locator.js';
import type { LocatorCache } from './LocatorCache.js';
import type { Planner } from './Planner.js';
import { resolveTarget, type FrameProvider } from './resolve.js';

export interface StepEngineDeps {
  page: Page;
  frames: FrameProvider;
  cache: LocatorCache;
  planner: Planner;
  context: TestContext;
  timeoutMs: number;
  /** Called after each step, for per-step screenshots. */
  onStep?: (result: StepResult) => Promise<void>;
}

/**
 * Executes a single step: resolve the target, do the thing, record the result.
 *
 * Deliberately knows nothing about test cases, sheets or suites — that is the
 * runner's job. This layer is one step, one page, one outcome.
 */
export class StepEngine {
  constructor(private readonly deps: StepEngineDeps) {}

  async execute(step: Step, testCaseId: string): Promise<StepResult> {
    const started = Date.now();
    const result: StepResult = { step, status: 'passed', durationMs: 0 };

    try {
      const target = step.kind === 'action' ? step.action?.target : step.assertion?.target;

      if (target) {
        // A label may itself contain a variable — `expect "{bannerText}" to be
        // visible` is the whole point of a cross-surface case. Resolve it before
        // searching, but do NOT cache the result: a locator built from a
        // run-specific value would miss on every later run.
        const hasVariable = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(target.raw);
        const searchTarget = hasVariable
          ? { ...target, raw: this.deps.context.resolve(target.raw) }
          : target;

        const resolution = await resolveTarget(step, searchTarget, testCaseId, {
          frames: this.deps.frames,
          cache: this.deps.cache,
          planner: this.deps.planner,
          timeoutMs: this.deps.timeoutMs,
          cacheable: !hasVariable,
        });
        result.locatorSource = resolution.source;
        result.resolvedLocator = `${resolution.frameName}:${describeSpec(resolution.spec)}`;

        await this.run(step, resolution.locator);
      } else {
        await this.run(step, undefined);
      }
    } catch (err) {
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
    }

    result.durationMs = Date.now() - started;
    await this.deps.onStep?.(result);
    return result;
  }

  private async run(step: Step, locator: Parameters<typeof performAction>[1]): Promise<void> {
    const shared = {
      page: this.deps.page,
      context: this.deps.context,
      timeoutMs: this.deps.timeoutMs,
    };
    if (step.kind === 'action' && step.action) {
      await performAction(step.action, locator, shared);
    } else if (step.kind === 'assertion' && step.assertion) {
      await checkAssertion(step.assertion, locator, shared);
    }
  }
}
