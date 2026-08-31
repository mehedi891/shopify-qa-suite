import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import pc from 'picocolors';
import { QaSession } from '../session/server.js';
import { readSession, send } from '../session/client.js';
import { RESULT_HEADER, toMarkdownTable, writeResultsCsv, type ResultRecord } from '../report/csv.js';
import { SESSION_FILE } from '../session/protocol.js';

const RESULTS_PATH = '.cache/session-results.json';

/** Run the session server in this process (the daemon entrypoint). */
export async function serveSession(): Promise<never> {
  const session = new QaSession();
  const info = await session.start();
  console.log(pc.green(`browser session ready on port ${info.port} (pid ${info.pid})`));
  console.log(pc.dim('Log into Shopify in the window that opened, then run `qa detect`.'));
  return new Promise<never>(() => {}); // stay alive
}

/** `qa start` — spawn the session detached so the shell returns immediately. */
export async function startSession(): Promise<number> {
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

  const child = spawn(process.execPath, [...process.execArgv, entrypoint(), 'serve'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (existsSync(SESSION_FILE)) {
      const info = readSession();
      console.log(pc.green('✓ browser window open') + pc.dim(` (pid ${info.pid})`));
      console.log('\nNext:');
      console.log('  1. Log into your Shopify admin in that window');
      console.log('  2. Open the app you want to test');
      console.log(`  3. Run ${pc.bold('qa detect')}\n`);
      return 0;
    }
  }
  console.error(pc.red('The browser session did not start in time.'));
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

export async function goSurface(surface: 'admin' | 'storefront', target?: string): Promise<number> {
  const res = await send({ type: 'goto', surface, target });
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

/** `qa results` — the whole run, as a markdown table and a CSV file. */
export async function results(csvPath?: string): Promise<number> {
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

  const path = csvPath ?? `qa-results-${new Date().toISOString().slice(0, 10)}.csv`;
  writeResultsCsv(path, records);
  console.log(pc.dim(`\ncsv: ${path} (${RESULT_HEADER.length} columns, ${records.length} rows)`));
  return failed > 0 ? 1 : 0;
}

export async function clearResults(): Promise<number> {
  saveRecords([]);
  console.log(pc.green('✓ results cleared'));
  return 0;
}
