import { describe, expect, it } from 'vitest';
import { buildIssues, issuesToCsv } from '../src/report/issues.js';
import { rowsToTestCases } from '../src/source/rows.js';
import type { ResultRecord } from '../src/report/csv.js';

const HEADER = ['ID', 'Title', 'Suite', 'Tags', 'Surface', 'Precondition', 'Steps', 'Expected Result', 'Teardown', 'Enabled'];

const cases = rowsToTestCases(HEADER, [
  [
    'TC-001', 'Daily limit shows on the product page', 'limits', 'p0', 'admin',
    'open the app',
    'click "Individual Products"\nfill "Daily limit" with "5"\nclick "Save"',
    'expect toast "Saved"',
    '', 'TRUE',
  ],
  [
    'TC-002', 'Banner appears on the storefront', 'banner', 'p2', 'storefront',
    '', 'go to the product page for "Test Product"', 'expect "Free shipping" to be visible', '', 'TRUE',
  ],
]).cases;

const record = (over: Partial<ResultRecord>): ResultRecord =>
  ({ id: 'TC-001', title: 'Daily limit shows on the product page', status: 'FAIL', ...over }) as ResultRecord;

describe('buildIssues', () => {
  it('only reports failures and blocks', () => {
    const issues = buildIssues([
      record({ id: 'TC-001', status: 'PASS' }),
      record({ id: 'TC-002', status: 'SKIPPED' }),
      record({ id: 'TC-003', status: 'FAIL' }),
    ], cases);
    expect(issues.map((i) => i.caseId)).toEqual(['TC-003']);
  });

  it('stops the repro steps at the step that broke', () => {
    // steps after the failure never ran — listing them sends the reader
    // looking for a state the run never reached
    const [issue] = buildIssues([record({ failedStep: 'fill "Daily limit" with "5"' })], cases);
    expect(issue!.steps).toBe([
      '1. Open the admin.',
      '2. open the app',
      '3. click "Individual Products"',
      '4. fill "Daily limit" with "5"',
    ].join('\n'));
    expect(issue!.steps).not.toContain('Save');
  });

  it('falls back to the whole case when the failing step is an assertion', () => {
    const [issue] = buildIssues([record({ failedStep: 'expect toast "Saved"' })], cases);
    expect(issue!.steps).toContain('5. click "Save"');
    expect(issue!.expected).toBe('expect toast "Saved"');
  });

  it('uses the declared expectation when the failure was an action', () => {
    const [issue] = buildIssues([record({ failedStep: 'click "Save"' })], cases);
    expect(issue!.expected).toBe('expect toast "Saved"');
  });

  it('takes severity from the case tags and never invents one', () => {
    const [p0] = buildIssues([record({ id: 'TC-001' })], cases);
    const [p2] = buildIssues([record({ id: 'TC-002', title: 'Banner' })], cases);
    const [unknown] = buildIssues([record({ id: 'TC-999', title: 'Unknown case' })], cases);
    expect(p0!.severity).toBe('Critical');
    expect(p2!.severity).toBe('Medium');
    expect(unknown!.severity).toBe('Untriaged');
  });

  it('marks a blocked case as unverified rather than open', () => {
    const [issue] = buildIssues([record({ status: 'BLOCKED' })], cases);
    expect(issue!.status).toBe('Blocked — not verified');
    expect(issue!.actual).toBe('Case could not be run.');
  });

  it('numbers issues per task, failures before blocks', () => {
    const issues = buildIssues([
      record({ id: 'TC-002', status: 'BLOCKED' }),
      record({ id: 'TC-001', status: 'FAIL' }),
    ], cases, { taskId: 'TIN-1234' });
    expect(issues.map((i) => [i.issueId, i.caseId]))
      .toEqual([['TIN-1234-01', 'TC-001'], ['TIN-1234-02', 'TC-002']]);
  });

  it('still produces a usable issue with no case file to join against', () => {
    const [issue] = buildIssues([record({ failedStep: 'click "Save"', reason: 'timeout' })], []);
    expect(issue!.steps).toBe('1. click "Save"');
    expect(issue!.actual).toBe('timeout');
  });

  it('quotes multi-line steps so the CSV stays one row per issue', () => {
    const csv = issuesToCsv(buildIssues([record({ failedStep: 'click "Save"' })], cases));
    expect(csv.split('\n')[0]).toBe(
      'Issue,Case,Severity,Title,Surface,Steps to Reproduce,Expected,Actual,Screenshot,Status,Found At');
    // header + one quoted record + trailing newline
    expect(csv.match(/(?:^|\n)ISSUE-01,/)).not.toBeNull();
    expect(csv).toContain('"1. Open the admin.');
  });
});
