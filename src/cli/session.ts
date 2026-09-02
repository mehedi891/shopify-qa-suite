import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import pc from 'picocolors';
import { QaSession, type SessionOptions } from '../session/server.js';
import type { LaunchMode } from '../session/launch.js';
import { readSession, send } from '../session/client.js';
import { toMarkdownTable, type ResultRecord } from '../report/csv.js';
import { writeSessionReport } from '../report/SessionReport.js';
import { reportDir, runStamp } from '../report/paths.js';
import type { PlayedStep } from '../session/protocol.js';
import { SESSION_FILE } from '../session/protocol.js';

const RESULTS_PATH = '.cache/session-results.json';

const PROFILE_DIR = '.qa-profile';
const CDP_ENDPOINT = 'http://127.0.0.1:9222';

export function sessionOptions(opts: { chromium?: boolean; attach?: boolean | string }): SessionOptions {
  const mode: LaunchMode = opts.attach ? 'attach' : opts.chromium ? 'chromium' : 'chrome';
  return {
    mode,
    profileDir: PROFILE_DIR,
    cdpEndpoint: typeof opts.attach === 'string' ? opts.attach : CDP_ENDPOINT,
  };
}

/** Run the session server in this process (the daemon entrypoint). */
export async function serveSession(opts: SessionOptions): Promise<never> {
  const session = new QaSession();
  const info = await session.start(opts);
  console.log(pc.green(`browser session ready on port ${info.port} (pid ${info.pid})`));
  console.log(pc.dim(`browser: ${info.browser}`));
  return new Promise<never>(() => {}); // stay alive
}

/** `qa start` — spawn the session detached so the shell returns immediately. */
export async function startSession(opts: { chromium?: boolean; attach?: boolean | string } = {}): Promise<number> {
  if (existsSync(SESSION_FILE)) {
    try {
      const status = await send({ type: 'status' });
      if (status.ok) {
        console.log(pc.yellow('A session is already running. Use `qa stop` to end it.'));
        return 0;
      }
    } catch {
      // stale file; fall through and start fresh
    }
  }

  const mode = sessionOptions(opts);
  const args = [...process.execArgv, entrypoint(), 'serve', '--mode', mode.mode, '--cdp', mode.cdpEndpoint];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env: process.env });
  child.unref();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (existsSync(SESSION_FILE)) {
      const info = readSession();
      console.log(pc.green('✓ browser window open') + pc.dim(` (pid ${info.pid})`));
      if (info.browser) console.log(pc.dim(`  ${info.browser}`));
      console.log('\nNext:');
      console.log('  1. Log into your Shopify admin in that window (once — the profile persists)');
      console.log('  2. Open the app you want to test');
      console.log(`  3. Run ${pc.bold('qa detect')}\n`);
      return 0;
    }
  }
  console.error(pc.red('The browser session did not start in time.'));
  if (mode.mode === 'attach') {
    console.error(pc.dim(`Is Chrome running with --remote-debugging-port? See the README.`));
  }
  return 1;
}

function entrypoint(): string {
  // re-run this same CLI; tsx handles the .ts entry in dev
  return process.argv[1] ?? 'src/cli/index.ts';
}

export async function detect(): Promise<number> {
  const res = await send({ type: 'detect' });
  console.log(res.ok ? pc.green(`✓ ${res.message}`) : pc.yellow(res.message ?? ''));
  return res.ok ? 0 : 1;
}

/** `qa doctor` — why is the app iframe not showing what I expect? */
export async function doctor(): Promise<number> {
  const res = await send({ type: 'doctor' });
  console.log(res.ok ? pc.green(`✓ ${res.message}`) : pc.yellow(`⚠ ${res.message}`));
  return res.ok ? 0 : 1;
}

export async function status(): Promise<number> {
  const res = await send({ type: 'status' });
  console.log(JSON.stringify(res.data, null, 2));
  return 0;
}

export async function frames(): Promise<number> {
  const res = await send({ type: 'frames' });
  for (const f of (res.data as { url: string; name: string }[])) {
    console.log(`${f.name || pc.dim('(unnamed)')}  ${f.url}`);
  }
  return 0;
}

export async function snapshot(frame?: string, maxChars?: number): Promise<number> {
  const res = await send({
    type: 'snapshot',
    frame: (frame as 'app' | 'host' | 'page' | undefined) ?? 'auto',
    maxChars,
  });
  const data = res.data as { url: string; surface: string; frames: Record<string, string> };
  console.log(pc.dim(`# ${data.surface} · ${data.url}\n`));
  for (const [name, tree] of Object.entries(data.frames)) {
    console.log(pc.bold(`## frame: ${name}`));
    console.log(tree);
    console.log();
  }
  return 0;
}

export async function doStep(step: string, opts: { case?: string } = {}): Promise<number> {
  const res = await send({ type: 'do', step, testCaseId: opts.case });
  console.log(res.ok ? `${pc.green('✓')} ${res.message}` : `${pc.red('✗')} ${res.message}`);
  return res.ok ? 0 : 1;
}

/**
 * `qa play` — run a whole test case in one call, and optionally record its
 * verdict. This is the command to reach for: one round trip instead of one per
 * step, with a screenshot captured at the moment of failure.
 */
export async function play(opts: {
  steps: string[];
  case?: string;
  title?: string;
  suite?: string;
  tags?: string;
  record?: boolean;
  shots?: boolean;
  keepGoing?: boolean;
}): Promise<number> {
  const started = Date.now();
  const res = await send({
    type: 'play',
    steps: opts.steps,
    testCaseId: opts.case,
    stopOnFailure: !opts.keepGoing,
    shotEvery: opts.shots,
  });
  const data = res.data as { steps: PlayedStep[]; url: string; surface: string };

  for (const s of data.steps) {
    if (s.skipped) { console.log(`${pc.dim('○')} ${pc.dim(s.step)} ${pc.dim('(skipped)')}`); continue; }
    if (s.ok) {
      const via = s.locator ? pc.dim(` · ${s.locator}`) : '';
      console.log(`${pc.green('✓')} ${s.step}${via} ${pc.dim(`${s.durationMs}ms`)}`);
    } else {
      console.log(`${pc.red('✗')} ${s.step}`);
      for (const line of (s.detail ?? '').split('\n').slice(0, 6)) console.log(pc.dim(`    ${line}`));
      if (s.screenshot) console.log(pc.yellow(`    screenshot: ${s.screenshot}`));
      if (s.snapshot) {
        console.log(pc.dim('    ── page at the moment of failure ──'));
        for (const line of s.snapshot.split('\n')) console.log(pc.dim(`    ${line}`));
        if (s.snapshotPath) console.log(pc.dim(`    (full tree: ${s.snapshotPath})`));
      }
    }
  }
  console.log(pc.dim(`\n${data.surface} · ${data.url}`));

  if (opts.record && opts.case) {
    const failing = data.steps.find((s) => !s.ok && !s.skipped);
    await record({
      id: opts.case,
      title: opts.title ?? '',
      suite: opts.suite,
      tags: opts.tags,
      status: res.ok ? 'PASS' : 'FAIL',
      failedStep: failing?.step,
      reason: failing?.detail?.split('\n')[0],
      durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      screenshot: failing?.screenshot,
    });
  }
  return res.ok ? 0 : 1;
}

export async function goSurface(surface: 'admin' | 'storefront', target?: string): Promise<number> {
  const res = await send({ type: 'goto', surface, target });
  console.log(res.ok ? pc.green(`✓ ${res.message}`) : pc.red(`✗ ${res.message}`));
  return res.ok ? 0 : 1;
}

const VIEWPORTS: Record<string, [number, number]> = {
  mobile: [390, 844],      // iPhone 14
  'mobile-small': [360, 640],
  tablet: [820, 1180],     // iPad Air
  desktop: [1440, 900],
  wide: [1920, 1080],
};

/** `qa viewport mobile` — design breaks are almost always narrow-viewport bugs. */
export async function viewport(preset: string): Promise<number> {
  const named = VIEWPORTS[preset.toLowerCase()];
  const custom = /^(\d+)x(\d+)$/i.exec(preset);
  if (!named && !custom) {
    console.error(pc.red(
      `Unknown viewport "${preset}". Use ${Object.keys(VIEWPORTS).join(', ')}, or WxH like 412x915.`,
    ));
    return 1;
  }
  const [width, height] = named ?? [Number(custom![1]), Number(custom![2])];
  const res = await send({ type: 'viewport', width, height });
  console.log(res.ok ? pc.green(`✓ ${res.message}`) : pc.red(`✗ ${res.message}`));
  return res.ok ? 0 : 1;
}

export async function shot(path: string): Promise<number> {
  const res = await send({ type: 'screenshot', path });
  console.log(res.ok ? pc.green(`✓ ${res.message}`) : pc.red(`✗ ${res.message}`));
  return res.ok ? 0 : 1;
}

export async function resetVars(): Promise<number> {
  await send({ type: 'reset' });
  console.log(pc.green('✓ variables cleared'));
  return 0;
}

export async function stopSession(): Promise<number> {
  try {
    await send({ type: 'stop' });
    console.log(pc.green('✓ session stopped'));
  } catch {
    console.log(pc.yellow('No running session.'));
  }
  return 0;
}

// ---------------------------------------------------------------- results

function loadRecords(): ResultRecord[] {
  if (!existsSync(RESULTS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) as ResultRecord[];
  } catch {
    return [];
  }
}

function saveRecords(records: ResultRecord[]): void {
  mkdirSync('.cache', { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(records, null, 2));
}

/** `qa record` — log one case's verdict as it is decided. */
export async function record(input: ResultRecord): Promise<number> {
  const records = loadRecords().filter((r) => r.id !== input.id);
  records.push(input);
  saveRecords(records);
  const mark = input.status === 'PASS' ? pc.green('✓ PASS') : input.status === 'FAIL' ? pc.red('✗ FAIL') : pc.yellow(input.status);
  console.log(`${mark} ${pc.bold(input.id)} ${input.title}`);
  return 0;
}

/**
 * `qa results` — the run in three places at once: a table in the terminal (and
 * therefore in the chat), a CSV, and a self-contained HTML report folder.
 */
export async function results(csvPath?: string, dir?: string, taskId?: string): Promise<number> {
  const records = loadRecords();
  if (records.length === 0) {
    console.log(pc.yellow('No results recorded yet.'));
    return 0;
  }
  console.log(toMarkdownTable(records));

  const passed = records.filter((r) => r.status === 'PASS').length;
  const failed = records.filter((r) => r.status === 'FAIL').length;
  const other = records.length - passed - failed;
  console.log(`\n${passed} passed · ${failed} failed${other ? ` · ${other} other` : ''}`);

  // a durable folder, not a scratch directory that later gets cleaned up
  const stamp = runStamp();
  const outDir = dir ?? reportDir(stamp, taskId);
  let store: string | undefined;
  let app: string | undefined;
  try {
    const info = readSession();
    store = info.store;
    app = info.appHandle;
  } catch { /* no live session: the report is still worth writing */ }

  const written = writeSessionReport(records, { dir: outDir, store, app, csvPath });
  console.log(pc.dim(`\nreport: ${written.htmlPath}`));
  console.log(pc.dim(`csv:    ${written.csvPath}`));
  if (written.screenshots) console.log(pc.dim(`        ${written.screenshots} screenshot(s) copied alongside`));
  return failed > 0 ? 1 : 0;
}

export async function clearResults(): Promise<number> {
  saveRecords([]);
  console.log(pc.green('✓ results cleared'));
  return 0;
}
