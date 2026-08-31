import pc from 'picocolors';
import type { ParseIssue, ParsedSheet, TestCase } from '../types.js';
import type { TestCaseSource } from '../source/TestCaseSource.js';

export interface ValidateOptions { verbose?: boolean }

/** Human-readable validation report. Returns true when the sheet is runnable. */
export function reportValidation(
  source: TestCaseSource,
  parsed: ParsedSheet,
  opts: ValidateOptions = {},
): boolean {
  const errors = parsed.issues.filter((i) => i.severity === 'error');
  const warnings = parsed.issues.filter((i) => i.severity === 'warning');

  console.log(pc.dim(`source: ${source.name}`));
  console.log(
    `parsed ${pc.bold(String(parsed.cases.length))} test cases ` +
    `(${parsed.cases.filter((c) => c.enabled).length} enabled), ` +
    `${countSteps(parsed.cases)} steps\n`,
  );

  if (errors.length) {
    console.log(pc.red(pc.bold(`${errors.length} error${errors.length === 1 ? '' : 's'}:`)));
    for (const i of errors) console.log('  ' + formatIssue(i, pc.red));
    console.log();
  }
  if (warnings.length) {
    console.log(pc.yellow(pc.bold(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`)));
    for (const i of warnings) console.log('  ' + formatIssue(i, pc.yellow));
    console.log();
  }

  if (opts.verbose) {
    for (const c of parsed.cases) {
      const flags = [c.enabled ? null : pc.dim('disabled'), ...c.tags.map((t) => pc.dim(t))].filter(Boolean);
      console.log(`${pc.bold(c.id)} ${c.title} ${flags.join(' ')}`);
      const all = [...c.precondition, ...c.steps, ...c.expected];
      for (const s of all) {
        const marker = s.kind === 'assertion' ? pc.magenta('?') : pc.cyan('>');
        console.log(`   ${marker} ${pc.dim(`[${s.surface}]`)} ${s.raw}`);
      }
      for (const s of c.teardown) console.log(`   ${pc.dim('~')} ${pc.dim(`[${s.surface}] ${s.raw}`)}`);
      console.log();
    }
  }

  if (errors.length === 0) {
    console.log(pc.green(warnings.length ? '✓ runnable (with warnings)' : '✓ all test cases parse cleanly'));
    return true;
  }
  console.log(pc.red('✗ fix the errors above before running'));
  return false;
}

function formatIssue(i: ParseIssue, color: (s: string) => string): string {
  const where = i.line !== undefined ? `${i.column} line ${i.line}` : i.column;
  return `${color(i.testCaseId)} ${pc.dim(`(row ${i.rowIndex}, ${where})`)} ${i.message}`;
}

function countSteps(cases: TestCase[]): number {
  return cases.reduce(
    (n, c) => n + c.precondition.length + c.steps.length + c.expected.length + c.teardown.length,
    0,
  );
}
