import { randomBytes } from 'node:crypto';

/**
 * Per-test variable bag. Holds values saved by `save … as x` plus builtins, and
 * interpolates `{name}` in step values. Scoped to one test case so nothing
 * leaks between them.
 */
export class TestContext {
  private readonly vars = new Map<string, string>();

  constructor(builtins: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(builtins)) this.vars.set(k, v);
  }

  set(name: string, value: string): void {
    this.vars.set(name, value);
  }

  get(name: string): string | undefined {
    // regenerated per use so two {random} in one case differ
    if (name === 'random') return randomBytes(4).toString('hex');
    if (name === 'timestamp') return new Date().toISOString();
    return this.vars.get(name);
  }

  /** Replace every `{name}`. Unknown names are left untouched and reported. */
  interpolate(text: string): { value: string; missing: string[] } {
    const missing: string[] = [];
    const value = text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, name: string) => {
      const v = this.get(name);
      if (v === undefined) { missing.push(name); return whole; }
      return v;
    });
    return { value, missing };
  }

  /** Interpolate, throwing if anything is unresolved — used for step values. */
  resolve(text: string): string {
    const { value, missing } = this.interpolate(text);
    if (missing.length) {
      throw new Error(
        `Unknown variable ${missing.map((m) => `{${m}}`).join(', ')}. ` +
        `Save it earlier with "save … as ${missing[0]}", or check the spelling.`,
      );
    }
    return value;
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.vars);
  }
}
