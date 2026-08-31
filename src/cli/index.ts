#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { ConfigError, env, sheetsCredentials } from '../config/env.js';
import { CsvSource } from '../source/CsvSource.js';
import { SheetsSource } from '../source/SheetsSource.js';
import type { TestCaseSource } from '../source/TestCaseSource.js';
import { reportValidation } from './validate.js';

const program = new Command();

program
  .name('qa')
  .description('Automated QA for our Shopify app — embedded admin + storefront')
  .version('0.1.0');

/** Pick the test-case source: an explicit CSV, otherwise the configured sheet. */
function resolveSource(csv?: string): TestCaseSource {
  if (csv) return new CsvSource(csv);
  if (!env.QA_SHEET_ID) {
    throw new ConfigError(
      'No test-case source. Set QA_SHEET_ID in .env, or pass --csv <file> to read a local CSV. See docs/SETUP.md.',
    );
  }
  return new SheetsSource({
    spreadsheetId: env.QA_SHEET_ID,
    tab: env.QA_SHEET_TAB,
    serviceAccountJson: sheetsCredentials(),
  });
}

program
  .command('validate')
  .description('Parse-check the test cases without opening a browser')
  .option('--csv <file>', 'read from a local CSV instead of Google Sheets')
  .option('-v, --verbose', 'print every parsed step')
  .action(async (opts: { csv?: string; verbose?: boolean }) => {
    const source = resolveSource(opts.csv);
    const parsed = await source.load();
    const ok = reportValidation(source, parsed, { verbose: opts.verbose });
    process.exit(ok ? 0 : 1);
  });

program
  .command('run')
  .description('Run test cases in a real browser')
  .option('--csv <file>', 'read from a local CSV instead of Google Sheets')
  .option('--id <ids...>', 'run only these test case IDs')
  .option('--tag <tags...>', 'run only cases with these tags')
  .option('--suite <suite>', 'run only this suite')
  .option('--only-failed', 'rerun the cases that failed last time')
  .option('--headed', 'show the browser')
  .option('--no-write', 'do not write results back to the sheet')
  .action(async () => {
    console.log(pc.yellow('`qa run` arrives in Phase 3/4 (see docs/IMPLEMENTATION_PLAN.md).'));
    console.log(pc.dim('Phase 1 (Shopify session + iframe) is blocked on dev-store credentials.'));
    process.exit(2);
  });

program
  .command('auth')
  .description('Log into Shopify admin once and save the session for later runs')
  .action(async () => {
    console.log(pc.yellow('`qa auth` arrives in Phase 1 — blocked on dev-store credentials.'));
    console.log(pc.dim('See the access checklist in docs/SETUP.md §0.'));
    process.exit(2);
  });

program
  .command('report')
  .description('Open the most recent HTML report')
  .action(async () => {
    console.log(pc.yellow('`qa report` arrives in Phase 4.'));
    process.exit(2);
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
