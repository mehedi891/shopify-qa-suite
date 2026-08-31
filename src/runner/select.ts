import { existsSync, readFileSync } from 'node:fs';
import type { TestCase } from '../types.js';

export interface SelectFilters {
  id?: string[];
  tag?: string[];
  suite?: string;
  onlyFailed?: boolean;
  /** Path to last-run.json, for --only-failed. */
  statePath?: string;
}

export class SelectionError extends Error {}

/** Narrow the loaded cases down to what this run should execute. */
export function selectCases(cases: TestCase[], filters: SelectFilters): TestCase[] {
  let selected = cases;

  if (filters.id?.length) {
    const wanted = new Set(filters.id.map((i) => i.toLowerCase()));
    selected = selected.filter((c) => wanted.has(c.id.toLowerCase()));
    const found = new Set(selected.map((c) => c.id.toLowerCase()));
    const missing = filters.id.filter((i) => !found.has(i.toLowerCase()));
    if (missing.length) {
      throw new SelectionError(`No test case with ID ${missing.join(', ')}. Check the sheet's ID column.`);
    }
  }

  if (filters.tag?.length) {
    const wanted = filters.tag.map((t) => t.toLowerCase());
    selected = selected.filter((c) => {
      const tags = c.tags.map((t) => t.toLowerCase());
      return wanted.some((t) => tags.includes(t));
    });
  }

  if (filters.suite) {
    const suite = filters.suite.toLowerCase();
    selected = selected.filter((c) => c.suite.toLowerCase() === suite);
  }

  if (filters.onlyFailed) {
    const failed = readFailedIds(filters.statePath);
    if (failed === undefined) {
      throw new SelectionError('No previous run found, so --only-failed has nothing to rerun.');
    }
    const wanted = new Set(failed);
    selected = selected.filter((c) => wanted.has(c.id));
  }

  // an explicit --id runs a case even if the sheet has it disabled
  if (filters.id?.length) {
    return selected.map((c) => (c.enabled ? c : { ...c, enabled: true }));
  }
  return selected;
}

function readFailedIds(statePath: string | undefined): string[] | undefined {
  if (!statePath || !existsSync(statePath)) return undefined;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { failed?: string[] };
    return state.failed ?? [];
  } catch {
    return undefined;
  }
}
