import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { ParsedSheet } from '../types.js';
import type { TestCaseSource } from './TestCaseSource.js';
import { rowsToTestCases } from './rows.js';

/**
 * Offline source. Same columns as the sheet, so a CSV export of the real sheet
 * works unchanged — useful for CI runs that shouldn't depend on Google, and for
 * developing the parser without credentials.
 */
export class CsvSource implements TestCaseSource {
  readonly name: string;
  constructor(private readonly path: string) {
    this.name = `csv:${path}`;
  }

  async load(): Promise<ParsedSheet> {
    const text = readFileSync(this.path, 'utf8');
    const rows = parse(text, { skipEmptyLines: false, relaxColumnCount: true }) as string[][];
    if (rows.length === 0) {
      return { cases: [], issues: [{ testCaseId: '-', rowIndex: 1, column: '-', severity: 'error', message: 'File is empty.' }] };
    }
    return rowsToTestCases(rows[0]!, rows.slice(1));
  }
}
