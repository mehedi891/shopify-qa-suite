import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export type LaunchMode = 'chrome' | 'chromium' | 'attach';

export interface LaunchOptions {
  mode: LaunchMode;
  /** Persistent profile directory, so a login survives between sessions. */
  profileDir: string;
  /** CDP endpoint for `attach` mode. */
  cdpEndpoint: string;
}

export interface LaunchedBrowser {
  context: BrowserContext;
  browser?: Browser;
  mode: LaunchMode;
  description: string;
  close(): Promise<void>;
}

/**
 * Flags that stop the browser announcing itself as automated.
 *
 * Shopify — and Google SSO especially — reject Playwright's bundled Chromium:
 * it sets `navigator.webdriver`, carries an "automation controlled" flag, and
 * lacks real Chrome's branding and proprietary codecs. Google's login refuses
 * it outright with "this browser or app may not be secure".
 */
const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-default-browser-check',
  '--no-first-run',
  '--start-maximized',
];

const IGNORED_DEFAULTS = ['--enable-automation', '--disable-extensions'];

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  if (opts.mode === 'attach') return attach(opts.cdpEndpoint);

  // A persistent profile is the important part: you log in ONCE, ever. The
  // cookies live in profileDir and every later session is already signed in.
  const useChrome = opts.mode === 'chrome';
  try {
    const context = await chromium.launchPersistentContext(opts.profileDir, {
      channel: useChrome ? 'chrome' : undefined,
      headless: false,
      viewport: null,
      args: STEALTH_ARGS,
      ignoreDefaultArgs: IGNORED_DEFAULTS,
    });
    return {
      context,
      mode: opts.mode,
      description: `${useChrome ? 'Google Chrome' : 'Chromium'} · profile ${opts.profileDir}`,
      close: () => context.close(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already in use|Opening in existing browser session|ProcessSingleton/i.test(message)) {
      throw new Error(
        `The browser profile at ${opts.profileDir} is already open in another Chrome window.\n\n` +
        `  • If a previous session's window is still open, close it, or run \`qa stop\`.\n` +
        `  • If it is orphaned, quit that Chrome window manually.\n\n` +
        `Only one session can use a profile at a time — that is Chrome's rule, not ours.`,
      );
    }
    if (useChrome) {
      // Chrome not installed — fall back rather than dead-end, but say so
      console.error(
        `Could not launch Google Chrome (${err instanceof Error ? err.message : String(err)}).\n` +
        `Falling back to bundled Chromium. Shopify/Google login may refuse it — ` +
        `see the README, "Shopify won't let me log in".`,
      );
      return launchBrowser({ ...opts, mode: 'chromium' });
    }
    throw err;
  }
}

/**
 * Attach to a Chrome the user started themselves. The most reliable option
 * when login is blocked, because nothing about the browser is automated —
 * Playwright only connects to it after the fact.
 */
async function attach(endpoint: string): Promise<LaunchedBrowser> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch {
    throw new Error(
      `Could not attach to Chrome at ${endpoint}.\n\n` +
      `Start Chrome with remote debugging first:\n\n${attachCommand()}\n\n` +
      `Note the --user-data-dir: since Chrome 136, remote debugging is refused on\n` +
      `the default profile directory. Use a dedicated one and log in there once —\n` +
      `it persists, so this is a one-time step.`,
    );
  }

  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error('Attached to Chrome, but it has no open window. Open a tab and try again.');
  }
  return {
    context,
    browser,
    mode: 'attach',
    description: `attached to your Chrome at ${endpoint}`,
    // only detach — never close a browser we did not open
    close: async () => { await browser.close().catch(() => {}); },
  };
}

/** The exact command to paste, in the shell the user is actually running. */
function attachCommand(): string {
  if (process.platform === 'win32') {
    return [
      '  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ^',
      '    --remote-debugging-port=9222 ^',
      '    --user-data-dir="%USERPROFILE%\\.qa-chrome-profile"',
    ].join('\n');
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const binary = existsSync(mac) ? `"${mac}"` : 'google-chrome';
  return [
    `  ${binary} \\`,
    '    --remote-debugging-port=9222 \\',
    '    --user-data-dir="$HOME/.qa-chrome-profile"',
  ].join('\n');
}
