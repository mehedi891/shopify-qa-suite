import type { Reporter, RunSummary } from '../runner/Runner.js';

/** One-line run summary to Slack. Silent no-op without a webhook. */
export class SlackReporter implements Reporter {
  constructor(private readonly webhookUrl: string | undefined, private readonly store: string) {}

  async onRunEnd(summary: RunSummary): Promise<void> {
    if (!this.webhookUrl) return;

    const ok = summary.failed === 0;
    const failed = summary.results.filter((r) => r.status === 'failed' || r.status === 'error');
    const lines = [
      `${ok ? '✅' : '❌'} *QA run ${summary.runId}* — ${this.store}`,
      `${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped ` +
      `(${(summary.durationMs / 1000).toFixed(0)}s)`,
      ...failed.slice(0, 10).map((r) => `• \`${r.testCase.id}\` ${r.testCase.title}`),
      failed.length > 10 ? `…and ${failed.length - 10} more` : '',
    ].filter(Boolean);

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
      });
    } catch (err) {
      console.error(`Slack notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
