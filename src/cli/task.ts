import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { RESULT_ROOT, casesFile, taskDir, taskMetaFile, taskSlug } from '../report/paths.js';

/**
 * One ClickUp task's QA record.
 *
 * The Google Sheets themselves live in Drive, so what we keep on disk is the
 * local twin — the CSV the run actually reads — plus the links, so a task
 * folder answers "where is the sheet for this feature?" without a Drive search.
 */
export interface TaskMeta {
  taskId: string;
  title?: string;
  clickupUrl?: string;
  /** The generated test cases, uploaded to Drive. */
  casesSheet?: string;
  /** One entry per run whose results were uploaded. */
  reportSheets?: { stamp: string; url: string }[];
  createdAt: string;
  updatedAt: string;
}

export function readTaskMeta(taskId: string): TaskMeta | undefined {
  const path = taskMetaFile(taskId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TaskMeta;
  } catch {
    return undefined; // a hand-edited file should not break the run
  }
}

export function writeTaskMeta(meta: TaskMeta): void {
  mkdirSync(taskDir(meta.taskId), { recursive: true });
  writeFileSync(taskMetaFile(meta.taskId), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

/** Create or update a task's record, leaving fields alone when not supplied. */
export function upsertTaskMeta(taskId: string, patch: Partial<TaskMeta>): TaskMeta {
  const id = taskSlug(taskId);
  const now = new Date().toISOString();
  const existing = readTaskMeta(id);
  const meta: TaskMeta = {
    ...existing,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    taskId: id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeTaskMeta(meta);
  return meta;
}

/** Record a report sheet against a task without dropping earlier ones. */
export function addReportSheet(taskId: string, stamp: string, url: string): TaskMeta {
  const existing = readTaskMeta(taskSlug(taskId));
  const sheets = (existing?.reportSheets ?? []).filter((s) => s.stamp !== stamp);
  sheets.push({ stamp, url });
  return upsertTaskMeta(taskId, { reportSheets: sheets });
}

export interface TaskOptions {
  title?: string;
  url?: string;
  casesSheet?: string;
  reportSheet?: string;
  stamp?: string;
}

/** `qa task <id>` — show one task; `qa task` — list them all. */
export async function taskCommand(taskId: string | undefined, opts: TaskOptions): Promise<number> {
  if (!taskId) return listTasks();

  const id = taskSlug(taskId);
  const patch: Partial<TaskMeta> = {
    title: opts.title,
    clickupUrl: opts.url,
    casesSheet: opts.casesSheet,
  };
  const touched = Object.values(patch).some((v) => v !== undefined) || opts.reportSheet;

  if (opts.reportSheet) {
    const stamp = opts.stamp ?? latestReportStamp(id);
    if (!stamp) {
      console.error(pc.red(`No report folder found under ${taskDir(id)} — pass --stamp <folder>.`));
      return 1;
    }
    addReportSheet(id, stamp, opts.reportSheet);
  }
  const meta = touched ? upsertTaskMeta(id, patch) : (readTaskMeta(id) ?? upsertTaskMeta(id, {}));

  const cases = casesFile(id);
  console.log(`\n${pc.bold(meta.taskId)}${meta.title ? `  ${meta.title}` : ''}`);
  console.log(pc.dim(`  folder      ${taskDir(id)}`));
  console.log(`  cases       ${existsSync(cases) ? pc.green(cases) : pc.yellow(`${cases} ${pc.dim('(not generated yet)')}`)}`);
  if (meta.clickupUrl) console.log(pc.dim(`  clickup     ${meta.clickupUrl}`));
  console.log(`  cases sheet ${meta.casesSheet ? pc.dim(meta.casesSheet) : pc.yellow('not uploaded')}`);
  const reports = listReportStamps(id);
  if (reports.length === 0) {
    console.log(pc.yellow('  reports     none yet'));
  } else {
    for (const stamp of reports) {
      const sheet = meta.reportSheets?.find((s) => s.stamp === stamp);
      console.log(`  report      ${stamp}${sheet ? pc.dim(`  ${sheet.url}`) : pc.yellow('  not uploaded')}`);
    }
  }
  console.log();
  return 0;
}

/** Report folders inside a task folder, oldest first — stamps sort lexically. */
export function listReportStamps(taskId: string): string[] {
  const dir = taskDir(taskId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name) && statSync(join(dir, name)).isDirectory())
    .sort();
}

function latestReportStamp(taskId: string): string | undefined {
  return listReportStamps(taskId).at(-1);
}

function listTasks(): number {
  if (!existsSync(RESULT_ROOT)) {
    console.log(pc.yellow(`No "${RESULT_ROOT}" folder yet — nothing has been generated or run.`));
    return 0;
  }
  const dirs = readdirSync(RESULT_ROOT)
    .filter((name) => name !== 'screenshots' && statSync(join(RESULT_ROOT, name)).isDirectory())
    .filter((name) => existsSync(join(RESULT_ROOT, name, 'task.json')) || existsSync(join(RESULT_ROOT, name, 'cases.csv')))
    .sort();

  if (dirs.length === 0) {
    console.log(pc.yellow('No tasks yet. Give the agent a ClickUp task id to generate cases for one.'));
    return 0;
  }
  for (const id of dirs) {
    const meta = readTaskMeta(id);
    const runs = listReportStamps(id).length;
    console.log(`${pc.bold(id.padEnd(12))} ${(meta?.title ?? '').slice(0, 60).padEnd(60)} ${pc.dim(`${runs} run(s)`)}`);
  }
  return 0;
}
