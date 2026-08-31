#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { ConfigError, env, sheetsCredentials } from '../config/env.js';
import { CsvSource } from '../source/CsvSource.js';
import { SheetsSource } from '../source/SheetsSource.js';
import type { TestCaseSource } from '../source/TestCaseSource.js';
import { resolveProfile } from '../config/apps.js';
import { reportValidation } from './validate.js';
import * as session from './session.js';
import { runCommand } from './run.js';

const program = new Command();

program
  .name('qa')
  .description('Automated QA for our Shopify app — embedded admin + storefront')
  .version('0.1.0');

/** Pick the test-case source: an explicit CSV, otherwise the configured sheet. */
function resolveSource(csv?: string, app?: string): TestCaseSource {
  if (csv) return new CsvSource(csv);

  // each app profile may point at its own sheet; .env is the single-app default
  let sheetId = env.QA_SHEET_ID;
  let sheetTab = env.QA_SHEET_TAB;
  try {
    const profile = resolveProfile(app);
    sheetId = profile.sheetId ?? sheetId;
    sheetTab = profile.sheetTab ?? sheetTab;
  } catch {
    // no profiles configured yet — fall back to .env alone
  }

  if (!sheetId) {
    throw new ConfigError(
      'No test-case source. Set QA_SHEET_ID in .env (or sheetId in qa.apps.json), ' +
      'or pass --csv <file> to read a local CSV. See docs/SETUP.md.',
    );
  }
  return new SheetsSource({ spreadsheetId: sheetId, tab: sheetTab, serviceAccountJson: sheetsCredentials() });
}

program
  .command('validate')
  .description('Parse-check the test cases without opening a browser')
  .option('--csv <file>', 'read from a local CSV instead of Google Sheets')
  .option('--app <name>', 'which app profile to validate')
  .option('-v, --verbose', 'print every parsed step')
  .action(async (opts: { csv?: string; app?: string; verbose?: boolean }) => {
    const source = resolveSource(opts.csv, opts.app);
    const parsed = await source.load();
    const ok = reportValidation(source, parsed, { verbose: opts.verbose });
    process.exit(ok ? 0 : 1);
  });

program
  .command('run')
  .description('Run test cases in a real browser')
  .option('--csv <file>', 'read from a local CSV instead of Google Sheets')
  .option('--app <name>', 'which app profile to test (see qa.apps.json)')
  .option('--id <ids...>', 'run only these test case IDs')
  .option('--tag <tags...>', 'run only cases with these tags')
  .option('--suite <suite>', 'run only this suite')
  .option('--only-failed', 'rerun the cases that failed last time')
  .option('--headed', 'show the browser')
  .option('--no-write', 'do not write results back to the sheet')
  .option('-v, --verbose', 'print every step as it runs')
  .action(async (opts) => {
    const code = await runCommand(resolveSource(opts.csv, opts.app), opts);
    process.exit(code);
  });

program
  .command('auth')
  .description('Log into Shopify admin once and save the session for later runs')
  .option('--app <name>', 'which app profile to authenticate for')
  .action(async (opts: { app?: string }) => {
    const { resolveProfile } = await import('../config/apps.js');
    const { authenticate } = await import('../surfaces/auth.js');
    await authenticate(resolveProfile(opts.app));
    process.exit(0);
  });

program
  .command('apps')
  .description('List the configured app profiles and their session status')
  .action(async () => {
    const { loadProfiles } = await import('../config/apps.js');
    const { sessionStatus } = await import('../surfaces/auth.js');
    const { profiles, defaultName } = loadProfiles();
    for (const [name, p] of Object.entries(profiles)) {
      const session = sessionStatus(p.store);
      const state = session.exists
        ? pc.green(`session ${session.ageDays!.toFixed(0)}d old`)
        : pc.yellow('no session — run `qa auth`');
      const marker = name === defaultName ? pc.dim(' (default)') : '';
      console.log(`${pc.bold(name)}${marker}  ${pc.dim(p.store)}  ${state}`);
      console.log(pc.dim(`   app handle: ${p.appHandle} · iframe host: ${p.appHost}`));
    }
    process.exit(0);
  });

program
  .command('report')
  .description('Open the most recent HTML report')
  .action(async () => {
    const { openLastReport } = await import('./report.js');
    process.exit(await openLastReport());
  });


// ─────────────────────────────────────────────────────────────────────────────
// Interactive mode: a browser session a human logs into, driven step by step
// by an agent. No API key, no service account, no stored credentials.
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Open a browser session for you to log into')
  .option('--chromium', "use Playwright's bundled Chromium instead of your Chrome")
  .option('--attach [endpoint]', 'attach to a Chrome you started yourself (default http://127.0.0.1:9222)')
  .action(async (opts: { chromium?: boolean; attach?: boolean | string }) =>
    process.exit(await session.startSession(opts)));

program
  .command('serve', { hidden: true })
  .description('Run the session server in the foreground (used by `qa start`)')
  .option('--mode <mode>', 'chrome | chromium | attach', 'chrome')
  .option('--cdp <endpoint>', 'CDP endpoint for attach mode', 'http://127.0.0.1:9222')
  .action(async (opts: { mode: string; cdp: string }) => {
    await session.serveSession({
      mode: opts.mode as 'chrome' | 'chromium' | 'attach',
      profileDir: '.qa-profile',
      cdpEndpoint: opts.cdp,
    });
  });

program
  .command('detect')
  .description('Read the store, app handle and app iframe host from the open browser')
  .action(async () => process.exit(await session.detect()));

program
  .command('doctor')
  .description('Diagnose the app iframe: rendering, dev server down, or not installed')
  .action(async () => process.exit(await session.doctor()));

program
  .command('status')
  .description('Show the current session: store, app, surface, URL')
  .action(async () => process.exit(await session.status()));

program
  .command('frames')
  .description('List the frames on the current page (debugging the app iframe)')
  .action(async () => process.exit(await session.frames()));

program
  .command('snapshot')
  .description('Print the accessibility tree of the current page, per frame')
  .option('--frame <which>', 'app | host | page (default: every relevant frame)')
  .option('--max <chars>', 'truncate the tree', (v) => Number(v))
  .action(async (opts: { frame?: string; max?: number }) =>
    process.exit(await session.snapshot(opts.frame, opts.max)));

program
  .command('do <step>')
  .description('Run one plain-English step, e.g. qa do \'click "Save"\'')
  .option('--case <id>', 'test case id, for the locator cache')
  .action(async (step: string, opts: { case?: string }) =>
    process.exit(await session.doStep(step, opts)));

program
  .command('play [steps...]')
  .description('Run a whole test case in one call (steps as args, or --file)')
  .option('--file <path>', 'read steps from a file, one per line')
  .option('--case <id>', 'test case id')
  .option('--title <title>', 'test case title')
  .option('--suite <suite>', 'suite')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--record', 'record the verdict automatically')
  .option('--shots', 'screenshot every step, not just failures')
  .option('--keep-going', 'do not stop at the first failure')
  .action(async (steps: string[], opts) => {
    const { readFileSync } = await import('node:fs');
    const fromFile = opts.file
      ? readFileSync(opts.file, 'utf8').split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
      : [];
    const all = [...fromFile, ...steps];
    if (all.length === 0) {
      console.error(pc.red('No steps given. Pass them as arguments or use --file.'));
      process.exit(1);
    }
    process.exit(await session.play({ ...opts, steps: all }));
  });

program
  .command('admin [target]')
  .description('Switch to the admin, optionally navigating somewhere')
  .action(async (target?: string) => process.exit(await session.goSurface('admin', target)));

program
  .command('storefront [target]')
  .description('Switch to the storefront, optionally navigating somewhere')
  .action(async (target?: string) => process.exit(await session.goSurface('storefront', target)));

program
  .command('suite')
  .description('Run every case in a CSV through the live browser session')
  .requiredOption('--csv <file>', 'case file in the sheet column format')
  .option('--id <ids...>', 'only these case IDs')
  .option('--tag <tags...>', 'only cases with these tags')
  .option('--suite <suite>', 'only this suite')
  .option('--shots', 'screenshot every step, not just failures')
  .action(async (opts) => {
    const { runSuite } = await import('./suite.js');
    process.exit(await runSuite(opts));
  });

program
  .command('viewport <preset>')
  .description('Resize for responsive checks: mobile | tablet | desktop | wide | 412x915')
  .action(async (preset: string) => process.exit(await session.viewport(preset)));

program
  .command('shot <path>')
  .description('Screenshot the current surface')
  .action(async (path: string) => process.exit(await session.shot(path)));

program
  .command('vars-reset')
  .description('Clear saved variables between test cases')
  .action(async () => process.exit(await session.resetVars()));

program
  .command('record <id> <status>')
  .description('Record a verdict for one test case: PASS | FAIL | BLOCKED | SKIPPED')
  .option('--title <title>', 'case title')
  .option('--suite <suite>', 'suite')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--step <step>', 'the step that failed')
  .option('--reason <reason>', 'why it failed')
  .option('--seconds <n>', 'duration', (v) => Number(v))
  .option('--screenshot <path>', 'screenshot path')
  .option('--notes <notes>', 'anything worth knowing')
  .action(async (id: string, statusArg: string, opts) => {
    const status = statusArg.toUpperCase();
    if (!['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(status)) {
      console.error(pc.red(`status must be PASS, FAIL, BLOCKED or SKIPPED — got "${statusArg}"`));
      process.exit(1);
    }
    process.exit(await session.record({
      id,
      title: opts.title ?? '',
      suite: opts.suite,
      tags: opts.tags,
      status: status as 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED',
      failedStep: opts.step,
      reason: opts.reason,
      durationSeconds: opts.seconds,
      screenshot: opts.screenshot,
      notes: opts.notes,
    }));
  });

program
  .command('results')
  .description('Print the run as a table and write a CSV + HTML report folder')
  .option('--csv <path>', 'where to write the CSV (default: inside the report folder)')
  .option('--dir <path>', 'report folder (default: reports/<timestamp>)')
  .action(async (opts: { csv?: string; dir?: string }) =>
    process.exit(await session.results(opts.csv, opts.dir)));

program
  .command('results-clear')
  .description('Start a fresh set of results')
  .action(async () => process.exit(await session.clearResults()));

program
  .command('stop')
  .description('Close the browser session')
  .action(async () => process.exit(await session.stopSession()));

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(pc.red('config: ') + err.message);
      process.exit(1);
    }
    console.error(pc.red('error: ') + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

void main();
