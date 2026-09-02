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

/**
 * A task id turned into something safe to use as a folder name.
 *
 * Task ids come from a chat message, so they are untrusted input that we are
 * about to turn into a filesystem path. Only letters, digits, dash and
 * underscore survive — dots included, so no id can spell `..` — and an id left
 * with nothing usable is rejected rather than silently becoming a stray folder.
 */
export function taskSlug(taskId: string): string {
  const slug = taskId.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new Error(`"${taskId}" is not a usable task id — use something like TIN-1234.`);
  }
  return slug.toUpperCase();
}

/** Everything belonging to one ClickUp task: its cases, its reports, its metadata. */
export function taskDir(taskId: string): string {
  return join(RESULT_ROOT, taskSlug(taskId));
}

/** The generated test cases — the local twin of the cases Google Sheet. */
export function casesFile(taskId: string): string {
  return join(taskDir(taskId), 'cases.csv');
}

/** Task metadata: title, ClickUp link, and the sheets we uploaded for it. */
export function taskMetaFile(taskId: string): string {
  return join(taskDir(taskId), 'task.json');
}

/**
 * One folder per report, holding the html, the csv and its own screenshots.
 * Reports for a task nest under it, so a task folder is a complete record of
 * that feature: the cases, and every run of them.
 */
export function reportDir(stamp: string, taskId?: string): string {
  return taskId ? join(taskDir(taskId), stamp) : join(RESULT_ROOT, stamp);
}

/**
 * A path as it should appear in a report, a CSV or a sheet — always with
 * forward slashes.
 *
 * `join()` gives backslashes on Windows, which is right for the filesystem and
 * wrong for everything a human or a browser reads: `src="screenshots\\x.png"`
 * is not a portable relative URL, and `screenshots\\x.png` in a Google Sheet
 * cell is just noise. Filesystem paths keep `join`; anything that leaves for a
 * report goes through here.
 */
export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/** A filesystem- and sheet-friendly stamp for "now": 2026-09-02T14-31-07. */
export function runStamp(at: Date = new Date()): string {
  return at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
