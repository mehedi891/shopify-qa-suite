import { writeFileSync } from 'node:fs';

/** RFC 4180 quoting: wrap when needed, double any embedded quote. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export interface ResultRecord {
  id: string;
  title: string;
  suite?: string;
  tags?: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';
  failedStep?: string;
  reason?: string;
  durationSeconds?: number;
  screenshot?: string;
  notes?: string;
}

export const RESULT_HEADER = [
  'ID', 'Status', 'Title', 'Suite', 'Tags', 'Duration (s)',
  'Failed Step', 'Reason', 'Screenshot', 'Notes', 'Run At',
];

/** Status order for sorting: what needs attention comes first. */
const STATUS_RANK: Record<ResultRecord['status'], number> = {
  FAIL: 0, BLOCKED: 1, SKIPPED: 2, PASS: 3,
};

/**
 * Squash a message onto one line.
 *
 * A failure reason often spans many lines — a Playwright call log, a stack.
 * Left alone, one such cell makes a spreadsheet row tall enough to hide every
 * other result. The full text stays in the HTML report and the .txt beside the
 * screenshot; this is the readable summary.
 */
export function oneLine(text: string, max = 300): string {
  const flat = text.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** `2026-09-01 13:04` — readable in a cell, still sorts correctly as text. */
export function readableTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sortForReport(records: ResultRecord[]): ResultRecord[] {
  return [...records].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    return byStatus !== 0 ? byStatus : a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export function writeResultsCsv(path: string, records: ResultRecord[], runAt = new Date()): string {
  const stamp = readableTimestamp(runAt);
  const rows = sortForReport(records).map((r) => [
    r.id,
    r.status,
    r.title,
    r.suite ?? '',
    r.tags ?? '',
    r.durationSeconds === undefined ? '' : r.durationSeconds.toFixed(1),
    r.failedStep ? oneLine(r.failedStep, 120) : '',
    r.reason ? oneLine(r.reason) : '',
    r.screenshot ?? '',
    r.notes ? oneLine(r.notes) : '',
    stamp,
  ]);

  // CRLF per RFC 4180, and a BOM so Excel reads it as UTF-8 — without it,
  // currency symbols and accented text arrive mangled.
  const csv = '\uFEFF' + toCsv(RESULT_HEADER, rows).replace(/\n/g, '\r\n');
  writeFileSync(path, csv);
  return csv;
}

/** Compact table for printing results back into a chat. */
export function toMarkdownTable(records: ResultRecord[]): string {
  const head = '| ID | Title | Status | Failed step | Reason |\n|---|---|---|---|---|';
  const rows = sortForReport(records).map((r) => {
    const mark = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : `⚠️ ${r.status}`;
    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| ${esc(r.id)} | ${esc(r.title)} | ${mark} | ${esc(r.failedStep ?? '—')} | ${esc(r.reason ? oneLine(r.reason, 140) : '—')} |`;
  });
  return [head, ...rows].join('\n');
}
