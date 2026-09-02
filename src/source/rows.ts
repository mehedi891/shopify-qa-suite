import type { ParseIssue, ParsedSheet, Step, SurfaceName, TestCase } from '../types.js';
import { checkVariableFlow, parseStepBlock } from './parser.js';

/** Canonical sheet columns. Header matching is case- and space-insensitive. */
export const COLUMNS = {
  id: 'ID',
  title: 'Title',
  suite: 'Suite',
  tags: 'Tags',
  surface: 'Surface',
  precondition: 'Precondition',
  steps: 'Steps',
  expected: 'Expected Result',
  teardown: 'Teardown',
  enabled: 'Enabled',
  // tool-owned, never read
  status: 'Status',
  lastRun: 'Last Run',
  duration: 'Duration',
  failureReason: 'Failure Reason',
  artifacts: 'Artifacts',
} as const;

const normalize = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');

/** Map header row → column index, tolerant of ordering and casing. */
export function mapHeaders(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => map.set(normalize(h), i));
  return map;
}

export type RawRow = string[];

/**
 * Turn raw sheet rows into TestCases, collecting every problem rather than
 * throwing on the first. QA gets one list of everything to fix.
 */
export function rowsToTestCases(header: string[], rows: RawRow[]): ParsedSheet {
  const issues: ParseIssue[] = [];
  const cases: TestCase[] = [];
  const headers = mapHeaders(header);

  const required = [COLUMNS.id, COLUMNS.title, COLUMNS.steps];
  for (const col of required) {
    if (!headers.has(normalize(col))) {
      issues.push({
        testCaseId: '-', rowIndex: 1, column: col, severity: 'error',
        message: `Missing required column "${col}" in the header row.`,
      });
    }
  }
  if (issues.length) return { cases, issues };

  const cell = (row: RawRow, col: string): string => {
    const i = headers.get(normalize(col));
    return i === undefined ? '' : (row[i] ?? '').toString();
  };

  const seenIds = new Map<string, number>();

  rows.forEach((row, i) => {
    const rowIndex = i + 2; // 1-based, +1 for the header
    const id = cell(row, COLUMNS.id).trim();
    if (!id && row.every((c) => !c?.trim())) return; // blank spacer row

    const add = (column: string, message: string, line?: number, severity: ParseIssue['severity'] = 'error') =>
      issues.push({ testCaseId: id || `row ${rowIndex}`, rowIndex, column, line, message, severity });

    if (!id) { add(COLUMNS.id, 'Missing ID.'); return; }
    const dupeOf = seenIds.get(id);
    if (dupeOf !== undefined) add(COLUMNS.id, `Duplicate ID — also used on row ${dupeOf}.`);
    seenIds.set(id, rowIndex);

    const title = cell(row, COLUMNS.title).trim();
    if (!title) add(COLUMNS.title, 'Missing Title.');

    const surfaceRaw = cell(row, COLUMNS.surface).trim().toLowerCase() || 'admin';
    if (surfaceRaw !== 'admin' && surfaceRaw !== 'storefront') {
      add(COLUMNS.surface, `Surface must be "admin" or "storefront", got "${surfaceRaw}".`);
    }
    const startSurface: SurfaceName = surfaceRaw === 'storefront' ? 'storefront' : 'admin';

    const enabledRaw = cell(row, COLUMNS.enabled).trim().toLowerCase();
    const enabled = !['false', 'no', '0', 'n'].includes(enabledRaw);

    let surface = startSurface;
    let index = 0;
    const collect = (col: string, origin: Step['origin']): Step[] => {
      const res = parseStepBlock(cell(row, col), surface, origin, index);
      // Precondition is documented as free text that MAY be written as steps,
      // so prose there is a note to the reader, not a broken test.
      const severity: ParseIssue['severity'] = origin === 'precondition' ? 'warning' : 'error';
      res.errors.forEach((e) => add(col, e.message, e.line, severity));
      // steps that create or destroy real store data say so on every run
      res.warnings.forEach((w) => add(col, w.message, w.line, 'warning'));
      surface = res.endSurface;
      index += res.steps.length;
      return res.steps;
    };

    const precondition = collect(COLUMNS.precondition, 'precondition');
    const steps = collect(COLUMNS.steps, 'steps');
    const expected = collect(COLUMNS.expected, 'expected');
    // teardown restarts from the case's declared surface, not wherever the
    // test happened to end up — otherwise a mid-test switch silently breaks it
    surface = startSurface;
    const teardown = collect(COLUMNS.teardown, 'teardown');

    if (steps.length === 0) add(COLUMNS.steps, 'No steps — the case would do nothing.');
    if (expected.length === 0) {
      add(COLUMNS.expected, 'No expected result — the case can never fail.', undefined, 'warning');
    }

    for (const p of checkVariableFlow([...precondition, ...steps, ...expected])) {
      add(p.step.origin === 'expected' ? COLUMNS.expected : COLUMNS.steps,
        `Uses {${p.missing}} but nothing saved it earlier. Add a "save … as ${p.missing}" step, or check the spelling.`);
    }

    cases.push({
      id, title,
      suite: cell(row, COLUMNS.suite).trim() || 'default',
      tags: cell(row, COLUMNS.tags).split(',').map((t) => t.trim()).filter(Boolean),
      surface: startSurface,
      precondition, steps, expected, teardown, enabled, rowIndex,
    });
  });

  return { cases, issues };
}
