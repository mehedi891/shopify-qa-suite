import { describe, expect, it } from 'vitest';
import { CsvSource } from '../src/source/CsvSource.js';
import { columnLetter } from '../src/source/SheetsSource.js';

describe('sample sheet', () => {
  it('parses cleanly', async () => {
    const parsed = await new CsvSource('fixtures/sample-test-cases.csv').load();
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(parsed.cases).toHaveLength(5);
  });

  it('models the cross-surface case correctly', async () => {
    const parsed = await new CsvSource('fixtures/sample-test-cases.csv').load();
    const tc = parsed.cases.find((c) => c.id === 'TC-021')!;
    expect(tc.tags).toEqual(['smoke', 'cross-surface', 'p0']);
    expect(tc.surface).toBe('admin');
    // the storefront steps must have flipped surface
    expect(tc.steps.at(-1)!.surface).toBe('storefront');
    expect(tc.expected[0]!.surface).toBe('storefront');
    // teardown restarts from the declared surface, not where the test ended
    expect(tc.teardown[0]!.surface).toBe('admin');
  });
});

describe('broken sheet', () => {
  it('reports every problem rather than stopping at the first', async () => {
    const { issues } = await new CsvSource('fixtures/broken-test-cases.csv').load();
    const messages = issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/Duplicate ID/);
    expect(messages).toMatch(/Missing ID/);
    expect(messages).toMatch(/Surface must be/);
    expect(messages).toMatch(/Could not understand step/);
    expect(messages).toMatch(/nothing saved it earlier/);
    expect(messages).toMatch(/No steps/);
  });
});

describe('columnLetter', () => {
  it('maps indices to A1 letters', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});
