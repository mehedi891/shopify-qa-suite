import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, toMarkdownTable, type ResultRecord } from '../src/report/csv.js';

describe('CSV output', () => {
  it('quotes only what needs quoting, and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('has "quotes"')).toBe('"has ""quotes"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('survives a failure reason containing commas, quotes and newlines', () => {
    const csv = toCsv(['ID', 'Reason'], [['TC-1', 'Expected "Save", got:\nnothing']]);
    expect(csv).toBe('ID,Reason\nTC-1,"Expected ""Save"", got:\nnothing"\n');
  });
});

describe('chat table', () => {
  const records: ResultRecord[] = [
    { id: 'TC-001', title: 'App loads', status: 'PASS' },
    { id: 'TC-021', title: 'Banner | with pipe', status: 'FAIL', failedStep: 'click "Save"', reason: 'not found' },
  ];

  it('renders pass and fail rows', () => {
    const table = toMarkdownTable(records);
    expect(table).toContain('✅ PASS');
    expect(table).toContain('❌ FAIL');
    expect(table).toContain('click "Save"');
  });

  it('escapes pipes so one title cannot break the table', () => {
    expect(toMarkdownTable(records)).toContain('Banner \\| with pipe');
  });
});

describe('launch mode selection', () => {
  it('defaults to real Chrome, since bundled Chromium is refused by Shopify login', async () => {
    const { sessionOptions } = await import('../src/cli/session.js');
    expect(sessionOptions({}).mode).toBe('chrome');
    expect(sessionOptions({ chromium: true }).mode).toBe('chromium');
    expect(sessionOptions({ attach: true }).mode).toBe('attach');
  });

  it('uses a persistent profile so a login survives between sessions', async () => {
    const { sessionOptions } = await import('../src/cli/session.js');
    expect(sessionOptions({}).profileDir).toBe('.qa-profile');
  });

  it('accepts a custom CDP endpoint for attach mode', async () => {
    const { sessionOptions } = await import('../src/cli/session.js');
    expect(sessionOptions({ attach: 'http://127.0.0.1:9333' }).cdpEndpoint).toBe('http://127.0.0.1:9333');
    expect(sessionOptions({ attach: true }).cdpEndpoint).toBe('http://127.0.0.1:9222');
  });
});
