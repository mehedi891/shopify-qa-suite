import pc from 'picocolors';
import type { StepResult, TestCase, TestResult } from '../types.js';
import type { Reporter, RunSummary } from '../runner/Runner.js';

/** Live progress in the terminal. */
export class ConsoleReporter implements Reporter {
  constructor(private readonly verbose = false) {}

  onRunStart(cases: TestCase[]): void {
    const enabled = cases.filter((c) => c.enabled).length;
    console.log(`\nrunning ${pc.bold(String(enabled))} test cases` +
      (cases.length - enabled ? pc.dim(` (${cases.length - enabled} disabled)`) : '') + '\n');
  }

  onTestStart(testCase: TestCase): void {
    if (this.verbose) console.log(pc.dim(`─ ${testCase.id} ${testCase.title}`));
  }

  onStep(_testCase: TestCase, result: StepResult): void {
    if (!this.verbose) return;
    const mark = result.status === 'passed' ? pc.green('✓') : pc.red('✗');
    const via = result.locatorSource ? pc.dim(` (${result.locatorSource})`) : '';
    console.log(`  ${mark} ${result.step.raw}${via}`);
    if (result.error) console.log(pc.red(`      ${result.error.split('\n')[0]}`));
  }

  onTestEnd(result: TestResult): void {
    const { testCase } = result;
    const time = pc.dim(`${(result.durationMs / 1000).toFixed(1)}s`);
    const retry = result.attempts > 1 ? pc.yellow(` (retry ${result.attempts - 1})`) : '';

    if (result.status === 'passed') {
      console.log(`${pc.green('✓')} ${pc.bold(testCase.id)} ${testCase.title} ${time}${retry}`);
      return;
    }
    if (result.status === 'skipped') {
      console.log(`${pc.dim('○')} ${pc.dim(`${testCase.id} ${testCase.title} (disabled)`)}`);
      return;
    }
    console.log(`${pc.red('✗')} ${pc.bold(testCase.id)} ${testCase.title} ${time}${retry}`);
    const failing = result.steps.find((s) => s.status === 'failed');
    if (failing) {
      console.log(pc.red(`    step ${failing.step.index + 1}: ${failing.step.raw}`));
      for (const line of (failing.error ?? '').split('\n').slice(0, 4)) {
        console.log(pc.dim(`      ${line}`));
      }
    }
  }

  onRunEnd(summary: RunSummary): void {
    const parts = [
      summary.passed ? pc.green(`${summary.passed} passed`) : null,
      summary.failed ? pc.red(`${summary.failed} failed`) : null,
      summary.skipped ? pc.dim(`${summary.skipped} skipped`) : null,
    ].filter(Boolean);
    console.log(`\n${parts.join(pc.dim(' · '))}  ${pc.dim(`${(summary.durationMs / 1000).toFixed(1)}s`)}`);
    if (summary.plannerCalls > 0) {
      console.log(pc.dim(`${summary.plannerCalls} planner call${summary.plannerCalls === 1 ? '' : 's'} ` +
        `(0 on a warm cache)`));
    }
  }
}
