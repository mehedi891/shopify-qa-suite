import type { ParsedSheet } from '../types.js';

/**
 * Where test cases come from. Google Sheets is the real source; CSV exists so
 * the parser and runner can be developed and CI-tested without credentials.
 */
export interface TestCaseSource {
  readonly name: string;
  load(): Promise<ParsedSheet>;
}

/** Optional: sources that can write results back to their rows. */
export interface WritableTestCaseSource extends TestCaseSource {
  writeResults(results: ResultRow[]): Promise<void>;
}

export interface ResultRow {
  rowIndex: number;
  status: string;
  lastRun: string;
  durationSeconds: number;
  failureReason: string;
  artifacts: string;
}

export function isWritable(s: TestCaseSource): s is WritableTestCaseSource {
  return typeof (s as WritableTestCaseSource).writeResults === 'function';
}
