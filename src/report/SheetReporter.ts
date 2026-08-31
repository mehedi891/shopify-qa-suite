import { writeFileSync } from 'node:fs';
import pc from 'picocolors';
import type { TestResult } from '../types.js';
import type { Reporter, RunSummary } from '../runner/Runner.js';
import type { ResultRow, WritableTestCaseSource } from '../source/TestCaseSource.js';
import type { Artifacts } from '../runner/artifacts.js';

/**
 * Writes results back to each case's own row, so QA sees outcomes where they
 * already work. Also persists the failed-ID list that `--only-failed` reads.
 */
export class SheetReporter implements Reporter {
  constructor(
    private readonly source: WritableTestCaseSource | undefined,
    private readonly artifacts: Artifacts,
    private readonly enabled: boolean,
  ) {}

  async onRunEnd(summary: RunSummary): Promise<void> {
    // written regardless of --no-write: it is local state, not a sheet edit
    writeFileSync(this.artifacts.statePath, JSON.stringify({
      runId: summary.runId,
      finishedAt: new Date().toISOString(),
      reportPath: this.artifacts.reportPath,
      failed: summary.results
        .filter((r) => r.status === 'failed' || r.status === 'error')
        .map((r) => r.testCase.id),
    }, null, 2));

    if (!this.enabled || !this.source) return;

    const rows = summary.results
      .filter((r) => r.status !== 'skipped')
      .map((r) => this.toRow(r, summary.runId));
    if (rows.length === 0) return;

    try {
      await this.source.writeResults(rows);
      console.log(pc.dim(`wrote ${rows.length} results back to the sheet`));
    } catch (err) {
      // never fail a run because the sheet write failed — the results still exist
      console.error(pc.yellow(
        `could not write results to the sheet: ${err instanceof Error ? err.message : String(err)}`,
      ));
    }
  }

  private toRow(result: TestResult, runId: string): ResultRow {
    const failing = result.steps.find((s) => s.status === 'failed');
    const reason = failing
      ? `step ${failing.step.index + 1} (${failing.step.raw}): ${(failing.error ?? '').split('\n')[0]}`
      : result.error ?? '';
    return {
      rowIndex: result.testCase.rowIndex,
      status: result.status.toUpperCase(),
      lastRun: new Date().toISOString(),
      durationSeconds: Number((result.durationMs / 1000).toFixed(1)),
      failureReason: reason.slice(0, 500),
      artifacts: result.status === 'passed' ? '' : `${runId}/${result.testCase.id}`,
    };
  }
}
