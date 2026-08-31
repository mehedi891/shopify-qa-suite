/**
 * Control protocol between the CLI and the long-lived browser session.
 *
 * The session holds one headed browser that stays logged in across many
 * commands, so a human logs in once and an agent then drives it step by step.
 * No stored credentials, no API key — the window simply stays open.
 */
export interface SessionInfo {
  pid: number;
  port: number;
  startedAt: string;
  store?: string;
  appHandle?: string;
  appHost?: string;
  surface: 'admin' | 'storefront';
  url?: string;
  /** Which browser is driving, e.g. "Google Chrome · profile .qa-profile". */
  browser?: string;
}

export type Command =
  | { type: 'status' }
  | { type: 'detect' }
  | { type: 'doctor' }
  | { type: 'snapshot'; frame?: 'app' | 'host' | 'page' | 'auto'; maxChars?: number }
  | { type: 'frames' }
  | { type: 'do'; step: string; testCaseId?: string; index?: number }
  | { type: 'play'; steps: string[]; testCaseId?: string; stopOnFailure?: boolean; shotDir?: string; shotEvery?: boolean }
  | { type: 'goto'; surface: 'admin' | 'storefront'; target?: string }
  | { type: 'switch'; surface: 'admin' | 'storefront' }
  | { type: 'viewport'; width: number; height: number }
  | { type: 'screenshot'; path: string }
  | { type: 'vars' }
  | { type: 'reset' }
  | { type: 'stop' };

export interface CommandResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

export interface PlayedStep {
  step: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  locator?: string;
  durationMs: number;
  screenshot?: string;
}

export const SESSION_FILE = '.qa-session.json';
