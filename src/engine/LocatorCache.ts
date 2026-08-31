import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LocatorSpec } from './locator.js';

export interface CachedLocator {
  /** Serialisable locator description, rebuilt without a model. */
  spec: LocatorSpec;
  /** Name of the frame it resolved in ('app' | 'host' | 'page'), so we go
   *  straight there next time instead of searching every frame again. */
  frame: string;
  /** How it was originally found, surfaced in the report. */
  via: 'heuristic' | 'planner';
  savedAt: string;
}

/**
 * Persisted map of step → resolved locator. This is what makes repeat runs
 * deterministic and free: a warm cache means zero model calls.
 *
 * Keyed on the step text as well as its position, so editing a step in the
 * sheet correctly invalidates its entry rather than replaying a stale locator.
 */
export class LocatorCache {
  private data: Record<string, CachedLocator> = {};
  private dirty = false;

  constructor(private readonly path = '.cache/locators.json') {
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, CachedLocator>;
      } catch {
        this.data = {}; // a corrupt cache is a rebuild, not a failure
      }
    }
  }

  static key(testCaseId: string, stepIndex: number, stepRaw: string): string {
    return `${testCaseId}#${stepIndex}:${stepRaw.trim()}`;
  }

  get(key: string): CachedLocator | undefined {
    return this.data[key];
  }

  set(key: string, value: CachedLocator): void {
    this.data[key] = value;
    this.dirty = true;
  }

  delete(key: string): void {
    if (key in this.data) { delete this.data[key]; this.dirty = true; }
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    this.dirty = false;
  }

  get size(): number { return Object.keys(this.data).length; }
}
