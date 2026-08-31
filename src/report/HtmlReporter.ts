import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { StepResult, TestResult } from '../types.js';
import type { Reporter, RunSummary } from '../runner/Runner.js';
import type { Artifacts } from '../runner/artifacts.js';

/**
 * Self-contained HTML report. Written for someone who did not run the suite:
 * what failed, on which step, what the screen looked like at that moment, and
 * how each element was found.
 */
export class HtmlReporter implements Reporter {
  constructor(private readonly artifacts: Artifacts) {}

  onRunEnd(summary: RunSummary): void {
    writeFileSync(this.artifacts.reportPath, this.render(summary));
  }

  private render(summary: RunSummary): string {
    const status = summary.failed > 0 ? 'failed' : 'passed';
    return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA run ${escape(summary.runId)}</title>
<style>${CSS}</style>
<header class="${status}">
  <h1>QA run <span class="mono">${escape(summary.runId)}</span></h1>
  <div class="totals">
    <span class="pill pass">${summary.passed} passed</span>
    ${summary.failed ? `<span class="pill fail">${summary.failed} failed</span>` : ''}
    ${summary.skipped ? `<span class="pill skip">${summary.skipped} skipped</span>` : ''}
    <span class="pill dim">${(summary.durationMs / 1000).toFixed(1)}s</span>
    <span class="pill dim">${summary.plannerCalls} planner calls</span>
  </div>
</header>
<main>${summary.results.map((r) => this.renderCase(r)).join('\n')}</main>
<script>
document.querySelectorAll('details.case').forEach(d => {
  if (d.dataset.status === 'failed' || d.dataset.status === 'error') d.open = true;
});
</script>`;
  }

  private renderCase(result: TestResult): string {
    const { testCase } = result;
    const tags = testCase.tags.map((t) => `<span class="tag">${escape(t)}</span>`).join('');
    return `<details class="case" data-status="${result.status}">
  <summary>
    <span class="status ${result.status}">${symbol(result.status)}</span>
    <span class="id mono">${escape(testCase.id)}</span>
    <span class="title">${escape(testCase.title)}</span>
    ${tags}
    <span class="time">${(result.durationMs / 1000).toFixed(1)}s</span>
    ${result.attempts > 1 ? `<span class="tag warn">retried</span>` : ''}
  </summary>
  ${result.error ? `<pre class="error">${escape(result.error)}</pre>` : ''}
  <ol class="steps">${result.steps.map((s) => this.renderStep(s)).join('')}</ol>
</details>`;
  }

  private renderStep(step: StepResult): string {
    const shot = step.screenshot
      ? `<a class="shot" href="${escape(relative(this.artifacts.runDir, step.screenshot))}" target="_blank">
           <img loading="lazy" src="${escape(relative(this.artifacts.runDir, step.screenshot))}" alt="">
         </a>`
      : '';
    const via = step.locatorSource
      ? `<span class="tag ${step.locatorSource === 'healed' ? 'warn' : 'via'}">${step.locatorSource}</span>`
      : '';
    const loc = step.resolvedLocator ? `<code class="loc">${escape(step.resolvedLocator)}</code>` : '';
    return `<li class="step ${step.status}">
      <div class="row">
        <span class="status ${step.status}">${symbol(step.status)}</span>
        <span class="raw">${escape(step.step.raw)}</span>
        <span class="tag surface">${escape(step.step.surface)}</span>
        ${via}${loc}
        <span class="time">${step.durationMs}ms</span>
      </div>
      ${step.error ? `<pre class="error">${escape(step.error)}</pre>` : ''}
      ${shot}
    </li>`;
  }
}

const symbol = (s: string) => (s === 'passed' ? '✓' : s === 'skipped' ? '○' : '✗');

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--dim:#6b7280;--line:#e5e7eb;--pass:#15803d;--fail:#b91c1c;--warn:#b45309;--card:#fafafa}
@media(prefers-color-scheme:dark){:root{--bg:#111;--fg:#e5e7eb;--dim:#9ca3af;--line:#2a2a2a;--pass:#4ade80;--fail:#f87171;--warn:#fbbf24;--card:#171717}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:20px 24px;border-bottom:3px solid var(--pass)}
header.failed{border-bottom-color:var(--fail)}
h1{margin:0 0 10px;font-size:18px;font-weight:600}
.totals{display:flex;gap:8px;flex-wrap:wrap}
.pill{padding:3px 10px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.pill.pass{color:var(--pass)}.pill.fail{color:var(--fail)}.pill.dim,.pill.skip{color:var(--dim)}
main{padding:16px 24px;max-width:1100px}
details.case{border:1px solid var(--line);border-radius:8px;margin-bottom:10px;background:var(--card)}
summary{padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
summary::-webkit-details-marker{display:none}
.status{font-weight:700;width:14px}
.status.passed{color:var(--pass)}.status.failed,.status.error{color:var(--fail)}.status.skipped{color:var(--dim)}
.id{font-weight:600}
.title{flex:1;min-width:200px}
.time{color:var(--dim);font-size:12px}
.tag{font-size:11px;padding:2px 7px;border-radius:4px;background:var(--line);color:var(--dim)}
.tag.warn{color:var(--warn)}.tag.surface{text-transform:uppercase;letter-spacing:.04em}
.steps{margin:0;padding:0 14px 14px 34px}
.step{padding:6px 0;border-top:1px solid var(--line)}
.step .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.raw{flex:1;min-width:180px}
.loc{font-size:11px;color:var(--dim);font-family:ui-monospace,monospace}
.error{background:rgba(185,28,28,.08);color:var(--fail);padding:8px 10px;border-radius:6px;
       white-space:pre-wrap;font-size:12px;margin:6px 0;overflow-x:auto}
.shot{display:block;margin:6px 0}
.shot img{max-width:min(100%,420px);border:1px solid var(--line);border-radius:6px}
`;
