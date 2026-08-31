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
  'ID', 'Title', 'Suite', 'Tags', 'Status', 'Failed Step',
  'Reason', 'Duration (s)', 'Screenshot', 'Notes', 'Run At',
];

export function writeResultsCsv(path: string, records: ResultRecord[], runAt = new Date()): string {
  const stamp = runAt.toISOString();
  const rows = records.map((r) => [
    r.id, r.title, r.suite ?? '', r.tags ?? '', r.status,
    r.failedStep ?? '', r.reason ?? '', r.durationSeconds ?? '', r.screenshot ?? '', r.notes ?? '', stamp,
  ]);
  const csv = toCsv(RESULT_HEADER, rows);
  writeFileSync(path, csv);
  return csv;
}

/** Compact table for printing results back into a chat. */
export function toMarkdownTable(records: ResultRecord[]): string {
  const head = '| ID | Title | Status | Failed step | Reason |\n|---|---|---|---|---|';
  const rows = records.map((r) => {
    const mark = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : `⚠️ ${r.status}`;
    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| ${esc(r.id)} | ${esc(r.title)} | ${mark} | ${esc(r.failedStep ?? '—')} | ${esc((r.reason ?? '—').slice(0, 140))} |`;
  });
  return [head, ...rows].join('\n');
}
