import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import pc from 'picocolors';
import config from '../../qa.config.js';

/** Open the most recent HTML report in the default browser. */
export async function openLastReport(): Promise<number> {
  const statePath = `${config.artifacts.dir}/last-run.json`;
  if (!existsSync(statePath)) {
    console.log(pc.yellow('No runs yet — run `qa run` first.'));
    return 1;
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as { reportPath?: string };
  if (!state.reportPath || !existsSync(state.reportPath)) {
    console.log(pc.yellow(`Report missing: ${state.reportPath ?? '(none recorded)'}`));
    return 1;
  }
  // `start` is a cmd.exe builtin rather than an executable, so spawning it
  // directly fails with ENOENT on Windows. The empty "" is the window title
  // argument, which start requires before a quoted path.
  const [command, args] =
    process.platform === 'darwin' ? ['open', [state.reportPath]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', state.reportPath]]
    : ['xdg-open', [state.reportPath]];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log(state.reportPath);
  return 0;
}
