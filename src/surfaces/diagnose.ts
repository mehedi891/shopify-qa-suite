import type { Frame, Page } from 'playwright';

/**
 * Distinguish "the app iframe is missing" from "the app's dev server is down".
 *
 * These look identical to a naive check — no app UI either way — but the fix is
 * completely different, and telling someone "the iframe never appeared" when
 * their tunnel is simply offline sends them hunting the wrong bug.
 */
/**
 * Shopify's embedded-app URLs carry `id_token`, `session` and `hmac` in the
 * query string. Those are live credentials — never print them into a terminal,
 * a log, or a CI transcript.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const sensitive = ['id_token', 'session', 'hmac', 'signature', 'token', 'access_token'];
    let redacted = false;
    for (const key of sensitive) {
      if (u.searchParams.has(key)) { u.searchParams.set(key, '…'); redacted = true; }
    }
    // host/shop are harmless and useful; everything else can go if long
    if (u.search.length > 200 && !redacted) return `${u.origin}${u.pathname}?…`;
    return `${u.origin}${u.pathname}${u.search ? `?${u.searchParams.toString()}` : ''}`;
  } catch {
    return url;
  }
}

export interface FrameDiagnosis {
  kind: 'ok' | 'dev-server-down' | 'not-installed' | 'unknown';
  message: string;
  frameUrl?: string;
}

const TUNNEL_ERRORS: { pattern: RegExp; label: string }[] = [
  { pattern: /ERR_NAME_NOT_RESOLVED/i, label: 'the tunnel hostname does not resolve (DNS)' },
  { pattern: /ERR_CONNECTION_REFUSED/i, label: 'the connection was refused' },
  { pattern: /ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i, label: 'the connection timed out' },
  { pattern: /ERR_TUNNEL_CONNECTION_FAILED/i, label: 'the tunnel connection failed' },
  { pattern: /ERR_NGROK|endpoint is offline|ngrok.*not found/i, label: 'the ngrok endpoint is offline' },
  { pattern: /error code:?\s*1033|Cloudflare Tunnel error|Argo Tunnel/i, label: 'the Cloudflare tunnel is not connected' },
  { pattern: /site can.?t be reached|This page isn.?t working/i, label: 'the page could not be reached' },
];

/**
 * Inspect whatever the app iframe actually rendered.
 *
 * Deliberately reads the live frame rather than probing the tunnel URL from
 * shopify.app.toml: `shopify app dev` mints a fresh tunnel per run, so the
 * value in the toml is often stale and probing it proves nothing.
 */
export async function diagnoseAppFrame(page: Page, appHost: string | undefined): Promise<FrameDiagnosis> {
  const frames = page.frames();
  const candidate: Frame | undefined = appHost
    ? frames.find((f) => f.url().includes(appHost))
    : frames.find((f) => f.url() && !/shopify\.com|about:blank/.test(f.url()));

  if (!candidate) {
    const adminText = await page.locator('body').innerText().catch(() => '');
    if (/didn.?t find that page|404|page not found/i.test(adminText)) {
      return {
        kind: 'not-installed',
        message:
          'The admin returned a 404 for this app. It may not be installed on this store, ' +
          'or the app handle is wrong. Check the install link in your dev server output.',
      };
    }
    return {
      kind: 'unknown',
      message:
        'No app iframe appeared. Frames present: ' +
        (frames.map((f) => f.url()).filter((u) => u && u !== 'about:blank').join(', ') || '(none)'),
    };
  }

  const url = candidate.url();
  if (url.startsWith('chrome-error://')) {
    return {
      kind: 'dev-server-down',
      message:
        'The app iframe failed to load — the browser could not reach your app server. ' +
        'Check that your dev server and tunnel are running.',
      frameUrl: redactUrl(url),
    };
  }

  const text = await candidate.locator('body').innerText().catch(() => '');
  for (const { pattern, label } of TUNNEL_ERRORS) {
    if (pattern.test(text)) {
      return {
        kind: 'dev-server-down',
        message:
          `The app iframe loaded an error page: ${label}. ` +
          'Your dev server or tunnel is not reachable — check that it is running. ' +
          '(The tunnel URL changes each time `shopify app dev` restarts.)',
        frameUrl: redactUrl(url),
      };
    }
  }

  return { kind: 'ok', message: 'app iframe rendered', frameUrl: redactUrl(url) };
}
