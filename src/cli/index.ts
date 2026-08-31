#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { ConfigError, env, sheetsCredentials } from '../config/env.js';
import { CsvSource } from '../source/CsvSource.js';
import { SheetsSource } from '../source/SheetsSource.js';
import type { TestCaseSource } from '../source/TestCaseSource.js';
import { resolveProfile } from '../config/apps.js';
import { reportValidation } from './validate.js';
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
