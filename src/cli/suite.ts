import pc from 'picocolors';
import { CsvSource } from '../source/CsvSource.js';
import { selectCases } from '../runner/select.js';
import { reportValidation } from './validate.js';
import { send } from '../session/client.js';
import { record } from './session.js';
import type { PlayedStep } from '../session/protocol.js';
import type { Step, TestCase } from '../types.js';

export interface SuiteOptions {
  csv: string;
  id?: string[];
  tag?: string[];
  suite?: string;
  shots?: boolean;
}

/**
 * Run a whole case file through the live browser session.
 *
 * This is the loop that closes the circle: a spec (a ClickUp doc, a sheet, a
 * description) becomes a CSV of cases, `qa validate` proves it parses, and this
 * runs every case and records a verdict for each.
 */
export async function runSuite(opts: SuiteOptions): Promise<number> {
  const source = new CsvSource(opts.csv);
  const parsed = await source.load();
  if (parsed.issues.some((i) => i.severity === 'error')) {
    reportValidation(source, parsed);
    return 1;
  }

  const cases = selectCases(parsed.cases, { id: opts.id, tag: opts.tag, suite: opts.suite });
  if (cases.length === 0) {
    console.log(pc.yellow('No cases matched those filters.'));
    return 0;
  }

  console.log(`\nrunning ${pc.bold(String(cases.length))} cases from ${opts.csv}\n`);
  let failed = 0;

  for (const testCase of cases) {
    if (!testCase.enabled) {
      console.log(`${pc.dim('○')} ${pc.dim(`${testCase.id} ${testCase.title} (disabled)`)}`);
      await record({ id: testCase.id, title: testCase.title, suite: testCase.suite,
        tags: testCase.tags.join(','), status: 'SKIPPED' });
      continue;
    }

    console.log(`${pc.bold(testCase.id)} ${testCase.title}`);
    const started = Date.now();

    // each case starts from a clean variable scope, on its declared surface
    await send({ type: 'reset' });
    const body = [`switch to ${testCase.surface}`, ...stepText([
      ...testCase.precondition, ...testCase.steps, ...testCase.expected,
    ])];

    const res = await send({
      type: 'play', steps: body, testCaseId: testCase.id, stopOnFailure: true, shotEvery: opts.shots,
    });
    const data = res.data as { steps: PlayedStep[] };
    printSteps(data.steps);

    // teardown always runs, and never turns a pass into a fail
    if (testCase.teardown.length) {
      const td = await send({
        type: 'play',
        steps: [`switch to ${testCase.surface}`, ...stepText(testCase.teardown)],
        testCaseId: `${testCase.id}-teardown`,
        stopOnFailure: false,
      });
      const tdData = td.data as { steps: PlayedStep[] };
      const broken = tdData.steps.filter((s) => !s.ok && !s.skipped);
      if (broken.length) {
        console.log(pc.yellow(`  teardown: ${broken.length} step(s) failed — state may be dirty`));
      }
    }

    const failing = data.steps.find((s) => !s.ok && !s.skipped);
    if (!res.ok) failed++;
    await record({
      id: testCase.id,
      title: testCase.title,
      suite: testCase.suite,
      tags: testCase.tags.join(','),
      status: res.ok ? 'PASS' : 'FAIL',
      failedStep: failing?.step,
      reason: failing?.detail?.split('\n')[0],
      durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      screenshot: failing?.screenshot,
    });
    console.log();
  }

  console.log(failed ? pc.red(`${failed} of ${cases.length} cases failed`) : pc.green('all cases passed'));
  console.log(pc.dim('run `qa results --csv <path>` for the report'));
  return failed > 0 ? 1 : 0;
}

const stepText = (steps: Step[]): string[] => steps.map((s) => s.raw);

function printSteps(steps: PlayedStep[]): void {
  for (const s of steps) {
    if (s.skipped) { console.log(`  ${pc.dim('○')} ${pc.dim(s.step)}`); continue; }
    if (s.ok) {
      console.log(`  ${pc.green('✓')} ${s.step} ${pc.dim(`${s.durationMs}ms`)}`);
    } else {
      console.log(`  ${pc.red('✗')} ${s.step}`);
      for (const line of (s.detail ?? '').split('\n').slice(0, 4)) console.log(pc.dim(`      ${line}`));
      if (s.screenshot) console.log(pc.yellow(`      ${s.screenshot}`));
    }
  }
}

export type { TestCase };
