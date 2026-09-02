import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { TestCase } from '../types.js';
import type { ResultRecord } from './csv.js';
import { sortForReport, writeResultsCsv } from './csv.js';
import { buildIssues, writeIssuesCsv } from './issues.js';

export interface WrittenReport {
  dir: string;
  csvPath: string;
  htmlPath: string;
  issuesPath: string;
  issueCount: number;
  screenshots: number;
}

/**
 * Write a self-contained report folder: the CSV, an HTML page, and copies of
 * every screenshot referenced by a failure.
 *
 * Copies rather than links because screenshots are taken into a scratch
 * directory during the run — a report pointing at files that later get cleaned
 * up is worse than no report.
 */
export function writeSessionReport(
  records: ResultRecord[],
  opts: { dir: string; store?: string; app?: string; csvPath?: string; cases?: TestCase[]; taskId?: string },
): WrittenReport {
  const shotsDir = join(opts.dir, 'screenshots');
  mkdirSync(opts.dir, { recursive: true });

  let screenshots = 0;
  const localised = records.map((r) => {
    if (!r.screenshot || !existsSync(r.screenshot)) return r;
    mkdirSync(shotsDir, { recursive: true });
    const name = basename(r.screenshot);
    copyFileSync(r.screenshot, join(shotsDir, name));
    screenshots++;
    return { ...r, screenshot: join('screenshots', name) };
  });

  const csvPath = opts.csvPath ?? join(opts.dir, 'results.csv');
  writeResultsCsv(csvPath, localised);

  const htmlPath = join(opts.dir, 'report.html');
  writeFileSync(htmlPath, renderHtml(localised, opts));

  // issues are built from the localised records, so a screenshot path in the
  // issues sheet points at the copy that ships with the report
  const issues = buildIssues(localised, opts.cases, { taskId: opts.taskId });
  const issuesPath = writeIssuesCsv(join(opts.dir, 'issues.csv'), issues);

  return { dir: opts.dir, csvPath, htmlPath, issuesPath, issueCount: issues.length, screenshots };
}

function renderHtml(records: ResultRecord[], opts: { store?: string; app?: string }): string {
  const passed = records.filter((r) => r.status === 'PASS').length;
  const failed = records.filter((r) => r.status === 'FAIL').length;
  const other = records.length - passed - failed;

  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA report — ${escape(opts.app ?? 'Shopify app')}</title>
<style>${CSS}</style>
<header class="${failed ? 'failed' : 'passed'}">
  <h1>QA report</h1>
  <p class="meta">${escape(opts.app ?? '')}${opts.store ? ` · ${escape(opts.store)}` : ''} · ${new Date().toLocaleString()}</p>
  <div class="pills">
    <span class="pill pass">${passed} passed</span>
    ${failed ? `<span class="pill fail">${failed} failed</span>` : ''}
    ${other ? `<span class="pill dim">${other} other</span>` : ''}
  </div>
</header>
<main>
${sortForReport(records).map(renderCase).join('\n')}
</main>`;
}

function renderCase(r: ResultRecord): string {
  const cls = r.status === 'PASS' ? 'passed' : r.status === 'FAIL' ? 'failed' : 'other';
  const mark = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '○';
  return `<section class="case ${cls}">
  <h2><span class="mark">${mark}</span> <code>${escape(r.id)}</code> ${escape(r.title)}</h2>
  <p class="tags">${[r.suite, r.tags, r.durationSeconds ? `${r.durationSeconds}s` : '']
    .filter(Boolean).map((t) => `<span class="tag">${escape(String(t))}</span>`).join('')}</p>
  ${r.failedStep ? `<p class="step">failed at: <code>${escape(r.failedStep)}</code></p>` : ''}
  ${r.reason ? `<pre class="reason">${escape(r.reason)}</pre>` : ''}
  ${r.notes ? `<p class="notes">${escape(r.notes)}</p>` : ''}
  ${r.screenshot ? `<a href="${escape(r.screenshot)}" target="_blank"><img loading="lazy" src="${escape(r.screenshot)}" alt="screenshot at failure"></a>` : ''}
</section>`;
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const CSS = `
:root{--bg:#fff;--fg:#18181b;--dim:#71717a;--line:#e4e4e7;--pass:#15803d;--fail:#b91c1c;--card:#fafafa}
@media(prefers-color-scheme:dark){:root{--bg:#0c0c0d;--fg:#e4e4e7;--dim:#a1a1aa;--line:#27272a;--pass:#4ade80;--fail:#f87171;--card:#161618}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,sans-serif}
header{padding:24px;border-bottom:3px solid var(--pass)}
header.failed{border-bottom-color:var(--fail)}
h1{margin:0;font-size:20px}
.meta{margin:4px 0 12px;color:var(--dim);font-size:13px}
.pills{display:flex;gap:8px;flex-wrap:wrap}
.pill{border:1px solid var(--line);border-radius:99px;padding:3px 12px;font-size:12px}
.pill.pass{color:var(--pass)}.pill.fail{color:var(--fail)}.pill.dim{color:var(--dim)}
main{padding:16px 24px;max-width:900px}
.case{border:1px solid var(--line);border-left-width:4px;border-radius:8px;background:var(--card);padding:14px 16px;margin-bottom:12px}
.case.passed{border-left-color:var(--pass)}.case.failed{border-left-color:var(--fail)}.case.other{border-left-color:var(--dim)}
h2{margin:0;font-size:15px;font-weight:600;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.mark{font-weight:700}
.case.passed .mark{color:var(--pass)}.case.failed .mark{color:var(--fail)}.case.other .mark{color:var(--dim)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.tags{margin:6px 0 0}
.tag{display:inline-block;background:var(--line);color:var(--dim);border-radius:4px;padding:1px 7px;font-size:11px;margin-right:6px}
.step{margin:10px 0 4px;font-size:13px;color:var(--dim)}
.reason{background:rgba(185,28,28,.08);color:var(--fail);padding:10px 12px;border-radius:6px;
  white-space:pre-wrap;font-size:12.5px;overflow-x:auto;margin:6px 0}
.notes{font-size:13px;color:var(--dim);margin:6px 0}
img{max-width:100%;border:1px solid var(--line);border-radius:6px;margin-top:10px}
`;
