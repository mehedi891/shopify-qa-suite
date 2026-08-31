import { existsSync, readFileSync } from 'node:fs';
import { SESSION_FILE, type Command, type CommandResult, type SessionInfo } from './protocol.js';

export class NoSessionError extends Error {}

export function readSession(): SessionInfo {
  if (!existsSync(SESSION_FILE)) {
    throw new NoSessionError('No browser session running. Start one with `qa start`.');
  }
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionInfo;
}

export async function send(cmd: Command): Promise<CommandResult> {
  const info = readSession();
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return (await res.json()) as CommandResult;
  } catch {
    throw new NoSessionError(
      'The browser session is not responding — it may have been closed. Run `qa start` again.',
    );
  }
}
