import { writeFileSync } from 'node:fs';
import type { TestCase } from '../types.js';
import { oneLine, readableTimestamp, toCsv, type ResultRecord } from './csv.js';

/**
 * One defect, in the shape a developer needs to act on it.
 *
 * A results row says "FAIL". That is not a bug report — nobody can fix a row.
 * An issue carries the steps that reproduce it, what was expected, what
 * actually happened, and the picture. Building it means joining the run's
 * verdicts back to the cases they came from, which is why this is not just a
 * filter over the results.
 */
export interface Issue {
  issueId: string;
  caseId: string;
  severity: string;
  title: string;
  surface: string;
  steps: string;
  expected: string;
  actual: string;
  screenshot: string;
  status: string;
  foundAt: string;
}

export const ISSUE_HEADER = [
  'Issue', 'Case', 'Severity', 'Title', 'Surface',
  'Steps to Reproduce', 'Expected', 'Actual', 'Screenshot', 'Status', 'Found At',
];

/**
 * Severity comes from the case's own tags, or stays "Untriaged".
 *
 * We deliberately do not invent one. A tool that stamps "High" on everything
 * teaches people to ignore the column; an honest blank asks a human to decide.
 */
function severityFrom(tags: string[]): string {
  const has = (t: string) => tags.some((x) => x.trim().toLowerCase() === t);
  if (has('p0') || has('critical') || has('blocker')) return 'Critical';
  if (has('p1') || has('major')) return 'High';
  if (has('p2') || has('minor')) return 'Medium';
  if (has('p3') || has('trivial')) return 'Low';
  return 'Untriaged';
}

/** Numbered steps, so a cell can be pasted straight into a bug report. */
function numbered(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

/**
 * The steps that get you to the failure — the setup, then everything up to and
 * including the step that broke. Steps after it never ran, and listing them
 * would send whoever reads this looking for a state the run never reached.
 */
function reproSteps(testCase: TestCase | undefined, record: ResultRecord): string {
  if (!testCase) {
    return record.failedStep ? numbered([record.failedStep]) : '';
  }
  const setup = testCase.precondition.map((s) => s.raw);
  const body = testCase.steps.map((s) => s.raw);
  const cut = record.failedStep ? body.indexOf(record.failedStep) : -1;
  const upTo = cut >= 0 ? body.slice(0, cut + 1) : body;
  return numbered([`Open the ${testCase.surface}.`, ...setup, ...upTo]);
}

/**
 * What should have happened. When the failing step is itself an assertion it is
 * the most precise answer available, because it is the exact check that broke.
 */
function expectedFrom(testCase: TestCase | undefined, record: ResultRecord): string {
  const isAssertion = record.failedStep?.trim().match(/^(expect|assert|verify|should)\b/i);
  if (isAssertion) return record.failedStep!.trim();
  const declared = testCase?.expected.map((s) => s.raw) ?? [];
  return declared.join('\n');
}

export interface BuildIssuesOptions {
  /** Prefixes the issue ids, so they are unique across tasks. */
  taskId?: string;
  runAt?: Date;
}

/** Turn a run's failures and blocks into issues. Passes are not issues. */
export function buildIssues(
  records: ResultRecord[],
  cases: TestCase[] = [],
  opts: BuildIssuesOptions = {},
): Issue[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const foundAt = readableTimestamp(opts.runAt ?? new Date());
  const prefix = opts.taskId ? `${opts.taskId}-` : 'ISSUE-';

  return records
    .filter((r) => r.status === 'FAIL' || r.status === 'BLOCKED')
    // failures first, then stable by case id, so issue numbers stay meaningful
    .sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id, undefined, { numeric: true })
      : a.status === 'FAIL' ? -1 : 1))
    .map((r, i) => {
      const testCase = byId.get(r.id);
      const tags = testCase?.tags ?? (r.tags ? r.tags.split(',') : []);
      return {
        issueId: `${prefix}${String(i + 1).padStart(2, '0')}`,
        caseId: r.id,
        severity: r.status === 'BLOCKED' ? 'Untriaged' : severityFrom(tags),
        title: r.title,
        surface: testCase?.surface ?? '',
        steps: reproSteps(testCase, r),
        expected: expectedFrom(testCase, r),
        actual: oneLine(r.reason ?? (r.status === 'BLOCKED' ? 'Case could not be run.' : 'No reason recorded.'), 500),
        screenshot: r.screenshot ?? '',
        status: r.status === 'BLOCKED' ? 'Blocked — not verified' : 'Open',
        foundAt,
      };
    });
}

export function issuesToCsv(issues: Issue[]): string {
  return toCsv(ISSUE_HEADER, issues.map((i) => [
    i.issueId, i.caseId, i.severity, i.title, i.surface,
    i.steps, i.expected, i.actual, i.screenshot, i.status, i.foundAt,
  ]));
}

export function writeIssuesCsv(path: string, issues: Issue[]): string {
  // BOM + CRLF so Excel opens it as UTF-8 without mangling the arrows and dots
  writeFileSync(path, `﻿${issuesToCsv(issues).replace(/\n/g, '\r\n')}`, 'utf8');
  return path;
}
