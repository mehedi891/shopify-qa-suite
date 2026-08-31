import type { Step, StepResult, SurfaceName, TestCase, TestResult } from '../types.js';
import { LocatorCache } from '../engine/LocatorCache.js';
import { StepEngine } from '../engine/StepEngine.js';
import type { Planner } from '../engine/Planner.js';
import { TestContext } from './Context.js';
import type { ActiveSurface, SurfaceSet } from './Surface.js';
import { DialogController } from './dialogs.js';
import type { Artifacts } from './artifacts.js';

export interface RunnerConfig {
  retries: number;
  timeoutMs: number;
  screenshots: 'all' | 'on-failure' | 'off';
  trace: 'on' | 'on-failure' | 'off';
  builtins: Record<string, string>;
}

export interface Reporter {
  onRunStart?(cases: TestCase[]): void | Promise<void>;
  onTestStart?(testCase: TestCase): void | Promise<void>;
  onStep?(testCase: TestCase, result: StepResult): void | Promise<void>;
  onTestEnd?(result: TestResult): void | Promise<void>;
  onRunEnd?(summary: RunSummary): void | Promise<void>;
}

export interface RunSummary {
  runId: string;
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  plannerCalls: number;
}

export interface RunnerDeps {
  surfaces: SurfaceSet;
  cache: LocatorCache;
  planner: Planner;
  artifacts: Artifacts;
  config: RunnerConfig;
  reporters: Reporter[];
}

/**
 * Runs test cases one at a time.
 *
 * Serial on purpose: two cases toggling the same app setting on one dev store
 * corrupt each other (see ARCHITECTURE.md §11). Isolation comes from discarding
 * browser contexts between cases, not from parallelism.
 */
export class Runner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(cases: TestCase[]): Promise<RunSummary> {
    const started = Date.now();
    await this.emit((r) => r.onRunStart?.(cases));

    const results: TestResult[] = [];
    for (const testCase of cases) {
      if (!testCase.enabled) {
        const skipped: TestResult = {
          testCase, status: 'skipped', durationMs: 0, steps: [], attempts: 0,
        };
        results.push(skipped);
        await this.emit((r) => r.onTestEnd?.(skipped));
        continue;
      }
      const result = await this.runWithRetries(testCase);
      results.push(result);
      await this.emit((r) => r.onTestEnd?.(result));
    }

    this.deps.cache.save();

    const summary: RunSummary = {
      runId: this.deps.artifacts.runId,
      results,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed' || r.status === 'error').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      durationMs: Date.now() - started,
      plannerCalls: this.deps.planner.calls,
    };
    await this.emit((r) => r.onRunEnd?.(summary));
    return summary;
  }

  private async runWithRetries(testCase: TestCase): Promise<TestResult> {
    const maxAttempts = this.deps.config.retries + 1;
    let last: TestResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      last = await this.runOnce(testCase, attempt);
      if (last.status === 'passed') return last;
    }
    return last!;
  }

  private async runOnce(testCase: TestCase, attempt: number): Promise<TestResult> {
    const started = Date.now();
    await this.emit((r) => r.onTestStart?.(testCase));

    const { surfaces, config, artifacts } = this.deps;
    const context = new TestContext(config.builtins);
    const dialogs = new DialogController();
    const steps: StepResult[] = [];

    let status: TestResult['status'] = 'passed';
    let failedStepIndex: number | undefined;
    let error: string | undefined;

    // a fresh set of contexts per attempt — no cookie or storage bleed
    await surfaces.reset();
    const tracing = config.trace !== 'off';
    if (tracing) await surfaces.startTracing(`${testCase.id} attempt ${attempt}`);

    try {
      const body: Step[] = [...testCase.precondition, ...testCase.steps, ...testCase.expected];
      const outcome = await this.executeSteps(body, testCase, context, dialogs, steps);
      if (!outcome.ok) {
        status = 'failed';
        failedStepIndex = outcome.failedIndex;
        error = outcome.error;
      }
    } catch (err) {
      // a crash, not an assertion failure — recorded, and the suite continues
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    } finally {
      // teardown always runs, and its failures never fail the test itself
      if (testCase.teardown.length) {
        const teardownResults: StepResult[] = [];
        try {
          await this.executeSteps(testCase.teardown, testCase, context, dialogs, teardownResults);
        } catch {
          // swallow: a broken teardown is reported through its step results
        }
        steps.push(...teardownResults);
      }

      const failed = status !== 'passed';
      if (tracing) {
        const keep = config.trace === 'on' || failed;
        await surfaces.stopTracing(keep ? artifacts.trace(testCase.id, attempt) : undefined);
      }
    }

    return {
      testCase,
      status,
      durationMs: Date.now() - started,
      steps,
      failedStepIndex,
      error,
      attempts: attempt,
    };
  }

  private async executeSteps(
    steps: Step[],
    testCase: TestCase,
    context: TestContext,
    dialogs: DialogController,
    out: StepResult[],
  ): Promise<{ ok: true } | { ok: false; failedIndex: number; error: string }> {
    let current: ActiveSurface | undefined;

    for (const step of steps) {
      // a step's surface may differ from the last one — `switch to storefront`
      if (!current || current.name !== step.surface) {
        current = await this.surfaceFor(step.surface, dialogs);
      }

      const handled = await this.runNavigationStep(step, testCase, current, context, dialogs, out);
      if (handled) {
        const lastResult = out[out.length - 1]!;
        if (lastResult.status === 'failed') {
          return { ok: false, failedIndex: step.index, error: lastResult.error ?? 'step failed' };
        }
        continue;
      }

      const engine = new StepEngine({
        page: current.page,
        frames: current.frames,
        cache: this.deps.cache,
        planner: this.deps.planner,
        context,
        timeoutMs: this.deps.config.timeoutMs,
        onStep: async (result) => {
          await this.capture(testCase, result, current!);
          await this.emit((r) => r.onStep?.(testCase, result));
        },
      });

      const result = await engine.execute(step, testCase.id);
      out.push(result);
      if (result.status === 'failed') {
        return { ok: false, failedIndex: step.index, error: result.error ?? 'step failed' };
      }
    }
    return { ok: true };
  }

  /** Steps the surfaces own rather than the element engine. */
  private async runNavigationStep(
    step: Step,
    testCase: TestCase,
    surface: ActiveSurface,
    context: TestContext,
    dialogs: DialogController,
    out: StepResult[],
  ): Promise<boolean> {
    const kind = step.action?.kind;
    if (kind !== 'open' && kind !== 'goto' && kind !== 'switch' && kind !== 'dialog') return false;

    const started = Date.now();
    const result: StepResult = { step, status: 'passed', durationMs: 0 };
    try {
      if (kind === 'open') {
        await surface.openApp();
      } else if (kind === 'goto') {
        await surface.navigate(context.resolve(step.action?.value ?? ''));
      } else if (kind === 'dialog') {
        if (step.action?.value === 'dismiss') dialogs.expectDismiss();
        else {
          const seen = dialogs.takeSeen();
          if (seen.length === 0) dialogs.expectAccept();
        }
      }
      // 'switch' needs nothing here: the surface was already swapped above
    } catch (err) {
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
    }
    result.durationMs = Date.now() - started;
    out.push(result);
    await this.capture(testCase, result, surface);
    await this.emit((r) => r.onStep?.(testCase, result));
    return true;
  }

  private async surfaceFor(name: SurfaceName, dialogs: DialogController): Promise<ActiveSurface> {
    const surface = await this.deps.surfaces.get(name);
    dialogs.attach(surface.page);
    return surface;
  }

  private async capture(testCase: TestCase, result: StepResult, surface: ActiveSurface): Promise<void> {
    const mode = this.deps.config.screenshots;
    if (mode === 'off') return;
    if (mode === 'on-failure' && result.status !== 'failed') return;
    const path = this.deps.artifacts.stepScreenshot(testCase.id, result.step.index, result.status);
    try {
      await surface.page.screenshot({ path, timeout: 5_000 });
      result.screenshot = path;
    } catch {
      // a closed or navigating page is not worth failing a test over
    }
  }

  private async emit(fn: (r: Reporter) => void | Promise<void>): Promise<void> {
    for (const reporter of this.deps.reporters) {
      try {
        await fn(reporter);
      } catch (err) {
        console.error(`reporter error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
