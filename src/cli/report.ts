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
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [state.reportPath], { detached: true, stdio: 'ignore' }).unref();
  console.log(state.reportPath);
  return 0;
}
