import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import pc from 'picocolors';
import type { AppProfile } from '../config/apps.js';
import { adminUrl, authStatePath, storeHandle } from '../config/apps.js';

const LOGIN_HOSTS = /accounts\.shopify\.com|\/login|\/auth\/login/;

/**
 * One-time interactive login.
 *
 * Shopify admin login is interactive and often 2FA-gated, so logging in per
 * test is not viable. Instead a human logs in once in a real window and the
 * session cookies are saved; every later run reuses them. Sessions last weeks.
 *
 * State is keyed by store, so several apps on the same store share one login.
 */
export async function authenticate(profile: AppProfile, timeoutMs = 5 * 60_000): Promise<string> {
  const statePath = authStatePath(profile.store);
  mkdirSync(dirname(statePath), { recursive: true });

  console.log(`\nOpening a browser window for ${pc.bold(profile.store)}.`);
  console.log(pc.dim('Log in as your QA staff account, complete 2FA if prompted, and wait'));
  console.log(pc.dim('for the admin dashboard to load. The session is saved automatically.\n'));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(adminUrl(profile.store), { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + timeoutMs;
    let lastUrl = '';
    while (Date.now() < deadline) {
      const url = page.url();
      if (url !== lastUrl) {
        lastUrl = url;
        if (!LOGIN_HOSTS.test(url)) console.log(pc.dim(`  → ${url}`));
      }
      if (await isAuthenticated(page.url(), profile.store)) {
        // let post-login redirects and cookie writes settle
        await page.waitForTimeout(2_000);
        await context.storageState({ path: statePath });
        console.log(pc.green(`\n✓ Session saved to ${statePath}`));
        console.log(pc.dim('  Reused by every run until it expires. Re-run `npm run auth` when it does.'));
        return statePath;
      }
      await page.waitForTimeout(1_000);
    }
    throw new Error(`Timed out after ${Math.round(timeoutMs / 60_000)} minutes waiting for login.`);
  } finally {
    await browser.close();
  }
}

async function isAuthenticated(url: string, store: string): Promise<boolean> {
  if (LOGIN_HOSTS.test(url)) return false;
  return url.includes(`admin.shopify.com/store/${storeHandle(store)}`);
}

export interface SessionStatus {
  path: string;
  exists: boolean;
  ageDays?: number;
}

export function sessionStatus(store: string): SessionStatus {
  const path = authStatePath(store);
  if (!existsSync(path)) return { path, exists: false };
  const ageDays = (Date.now() - statSync(path).mtimeMs) / 86_400_000;
  return { path, exists: true, ageDays };
}

/**
 * Confirm a saved session still works before running anything.
 *
 * Without this, an expired session shows up as forty mysterious step timeouts
 * instead of one clear message.
 */
export async function assertSessionValid(context: BrowserContext, profile: AppProfile): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(adminUrl(profile.store), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1_500);
    if (LOGIN_HOSTS.test(page.url())) {
      throw new SessionExpiredError(
        `Shopify session expired for ${profile.store}.\n` +
        `  Run \`npm run auth\`${profile.name ? ` -- --app ${profile.name}` : ''} and log in again.`,
      );
    }
  } finally {
    await page.close();
  }
}

export class SessionExpiredError extends Error {}
