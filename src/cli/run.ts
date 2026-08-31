import pc from 'picocolors';
import config from '../../qa.config.js';
import { env } from '../config/env.js';
import { LocatorCache } from '../engine/LocatorCache.js';
import { createPlanner } from '../engine/Planner.js';
import { ConsoleReporter } from '../report/ConsoleReporter.js';
import { HtmlReporter } from '../report/HtmlReporter.js';
import { SheetReporter } from '../report/SheetReporter.js';
import { SlackReporter } from '../report/SlackReporter.js';
import { Artifacts, newRunId } from '../runner/artifacts.js';
import { Runner, type Reporter } from '../runner/Runner.js';
import { selectCases } from '../runner/select.js';
import { isWritable, type TestCaseSource } from '../source/TestCaseSource.js';
import { createSurfaces } from '../surfaces/index.js';
import { reportValidation } from './validate.js';

export interface RunOptions {
  id?: string[];
  tag?: string[];
  suite?: string;
  onlyFailed?: boolean;
  headed?: boolean;
  write?: boolean;
  verbose?: boolean;
}

/** Returns the process exit code. */
export async function runCommand(source: TestCaseSource, opts: RunOptions): Promise<number> {
  const parsed = await source.load();

  // refuse to start on a sheet that does not parse — two seconds beats
  // discovering it twenty minutes into a run
  const errors = parsed.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    reportValidation(source, parsed);
    return 1;
  }

  const cases = selectCases(parsed.cases, {
    id: opts.id,
    tag: opts.tag,
    suite: opts.suite,
    onlyFailed: opts.onlyFailed,
    statePath: `${config.artifacts.dir}/last-run.json`,
  });

  if (cases.length === 0) {
    console.log(pc.yellow('No test cases matched those filters.'));
    return 0;
  }

  const artifacts = new Artifacts(config.artifacts.dir, newRunId());
  const cache = new LocatorCache();
  const planner = createPlanner(env.ANTHROPIC_API_KEY, config.planner.model, config.planner.maxCallsPerRun);

  const reporters: Reporter[] = [
    new ConsoleReporter(opts.verbose),
    new HtmlReporter(artifacts),
    new SheetReporter(isWritable(source) ? source : undefined, artifacts, opts.write !== false),
    new SlackReporter(env.SLACK_WEBHOOK_URL, config.store.domain),
  ];

  const surfaces = await createSurfaces({
    storeDomain: config.store.domain,
    appHandle: config.store.appHandle,
    appHost: config.store.appHost,
    storefrontPassword: env.SHOPIFY_STOREFRONT_PASSWORD,
    authStatePath: '.auth/admin.json',
    headless: !opts.headed && config.run.headless,
    timeoutMs: config.run.timeoutMs,
  });

  try {
    const runner = new Runner({
      surfaces,
      cache,
      planner,
      artifacts,
      config: {
        retries: config.run.retries,
        timeoutMs: config.run.timeoutMs,
        screenshots: config.artifacts.screenshots,
        trace: config.artifacts.trace === 'on-failure' ? 'on-failure' : 'off',
        builtins: {
          store: config.store.domain,
          adminUrl: `https://admin.shopify.com/store/${storeHandle(config.store.domain)}`,
          storefrontUrl: `https://${config.store.domain}`,
          runId: artifacts.runId,
        },
      },
      reporters,
    });

    const summary = await runner.run(cases);
    console.log(pc.dim(`report: ${artifacts.reportPath}`));
    return summary.failed > 0 ? 1 : 0;
  } finally {
    await surfaces.close();
  }
}

const storeHandle = (domain: string) => domain.replace(/\.myshopify\.com$/, '');
