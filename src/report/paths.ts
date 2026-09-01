import { join } from 'node:path';

/**
 * Where a run's output lives.
 *
 * Defined once so the session server, the reporters and the CLI cannot drift
 * apart — a screenshot written to one place and looked for in another is a
 * broken report that still claims success.
 */
export const RESULT_ROOT = 'Test Result';

/** Screenshots taken while steps run, before any report exists. */
export const WORKING_SHOTS = join(RESULT_ROOT, 'screenshots');

/** One folder per report, holding the html, the csv and its own screenshots. */
export function reportDir(stamp: string): string {
  return join(RESULT_ROOT, stamp);
}
