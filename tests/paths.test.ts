import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESULT_ROOT, casesFile, reportDir, runStamp, taskDir, taskSlug } from '../src/report/paths.js';
import { addReportSheet, listReportStamps, readTaskMeta, upsertTaskMeta } from '../src/cli/task.js';

describe('taskSlug', () => {
  it('normalises a task id into a folder name', () => {
    expect(taskSlug('tin-1234')).toBe('TIN-1234');
    expect(taskSlug('  TIN 1234 ')).toBe('TIN-1234');
    expect(taskSlug('CU/86abc#1')).toBe('CU-86ABC-1');
  });

  it('refuses ids that would escape the results folder', () => {
    // a task id arrives from a chat message, so it is untrusted path input
    expect(taskSlug('../../etc/passwd')).toBe('ETC-PASSWD');
    expect(() => taskSlug('..')).toThrow(/not a usable task id/);
    expect(() => taskSlug('///')).toThrow(/not a usable task id/);
  });
});

describe('paths', () => {
  it('keeps a task\'s cases and reports together', () => {
    expect(taskDir('TIN-7')).toBe(join(RESULT_ROOT, 'TIN-7'));
    expect(casesFile('TIN-7')).toBe(join(RESULT_ROOT, 'TIN-7', 'cases.csv'));
    expect(reportDir('2026-09-02T10-00-00', 'TIN-7'))
      .toBe(join(RESULT_ROOT, 'TIN-7', '2026-09-02T10-00-00'));
  });

  it('falls back to a flat report folder with no task', () => {
    expect(reportDir('2026-09-02T10-00-00')).toBe(join(RESULT_ROOT, '2026-09-02T10-00-00'));
  });

  it('stamps runs in a form that sorts chronologically', () => {
    const stamp = runStamp(new Date('2026-09-02T10:00:00.000Z'));
    expect(stamp).toBe('2026-09-02T10-00-00');
    expect(stamp < runStamp(new Date('2026-09-02T11:00:00.000Z'))).toBe(true);
  });
});

describe('task metadata', () => {
  const cwd = process.cwd();
  let dir: string;

  afterEach(() => {
    process.chdir(cwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const inTempDir = () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-task-'));
    process.chdir(dir);
  };

  it('creates, then updates without losing earlier fields', () => {
    inTempDir();
    upsertTaskMeta('tin-1', { title: 'Daily limits', clickupUrl: 'https://app.clickup.com/t/abc' });
    upsertTaskMeta('TIN-1', { casesSheet: 'https://docs.google.com/spreadsheets/d/xyz' });

    const meta = readTaskMeta('TIN-1')!;
    expect(meta.taskId).toBe('TIN-1');
    expect(meta.title).toBe('Daily limits');
    expect(meta.clickupUrl).toBe('https://app.clickup.com/t/abc');
    expect(meta.casesSheet).toBe('https://docs.google.com/spreadsheets/d/xyz');
  });

  it('keeps one link per report and replaces a re-upload', () => {
    inTempDir();
    addReportSheet('TIN-2', '2026-09-01T10-00-00', 'https://sheet/one');
    addReportSheet('TIN-2', '2026-09-02T10-00-00', 'https://sheet/two');
    addReportSheet('TIN-2', '2026-09-01T10-00-00', 'https://sheet/one-again');

    const sheets = readTaskMeta('TIN-2')!.reportSheets!;
    expect(sheets).toHaveLength(2);
    expect(sheets.find((s) => s.stamp === '2026-09-01T10-00-00')!.url).toBe('https://sheet/one-again');
  });

  it('lists report folders oldest first, ignoring everything else', () => {
    inTempDir();
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(join(taskDir('TIN-3'), '2026-09-02T10-00-00'), { recursive: true });
    mkdirSync(join(taskDir('TIN-3'), '2026-09-01T10-00-00'), { recursive: true });
    mkdirSync(join(taskDir('TIN-3'), 'screenshots'), { recursive: true });
    writeFileSync(casesFile('TIN-3'), 'ID,Title,Steps\n');

    expect(listReportStamps('TIN-3')).toEqual(['2026-09-01T10-00-00', '2026-09-02T10-00-00']);
  });
});
