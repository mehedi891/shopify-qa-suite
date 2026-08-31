import type { BrowserContext, Page } from 'playwright';
import type { FrameProvider, NamedRoot } from '../engine/resolve.js';
import type { ActiveSurface } from '../runner/Surface.js';
import type { AppProfile } from '../config/apps.js';
import { adminUrl } from '../config/apps.js';

/**
 * The Shopify admin, with our app in its App Bridge iframe.
 *
 * This is the only place in the codebase that knows the iframe exists. If
 * Shopify changes its shape, `roots()` and `openApp()` are the fix — nothing
 * above this file references a frame.
 */
export class AdminSurface implements ActiveSurface {
  readonly name = 'admin' as const;

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    private readonly profile: AppProfile,
    private readonly timeoutMs: number,
  ) {}

  /**
   * Frames a step may search.
   *
   * The app frame comes first because most steps act on our own UI. The host
   * admin frame is searched second because App Bridge draws some things
   * outside our iframe — `ui-modal` chrome, `ui-save-bar`, `ui-nav-menu` and
   * `shopify.toast.show()`. The resolver caches whichever frame won, so this
   * search happens once per step, not every run.
   */
  get frames(): FrameProvider {
    const page = this.page;
    const appHost = this.profile.appHost;
    return {
      async roots(hint): Promise<NamedRoot[]> {
        // matched on OUR host rather than a Shopify-owned attribute like
        // name="app-iframe", because the app domain is ours and will not change
        const app: NamedRoot = { name: 'app', root: page.frameLocator(`iframe[src*="${appHost}"]`) };
        const host: NamedRoot = { name: 'host', root: page };
        if (hint === 'app') return [app];
        if (hint === 'host') return [host];
        return [app, host];
      },
    };
  }

  async openApp(): Promise<void> {
    const url = `${adminUrl(this.profile.store)}/apps/${this.profile.appHandle}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
    await this.waitForAppFrame();
  }

  /** Wait for the app itself to be ready, not merely for the iframe element. */
  private async waitForAppFrame(): Promise<void> {
    const frame = this.page.frameLocator(`iframe[src*="${this.profile.appHost}"]`);
    try {
      await frame.locator('body').waitFor({ state: 'attached', timeout: this.timeoutMs });
    } catch {
      const frames = this.page.frames().map((f) => f.url()).filter((u) => u && u !== 'about:blank');
      throw new Error(
        `The embedded app iframe never appeared.\n` +
        `  Looked for: iframe[src*="${this.profile.appHost}"]\n` +
        `  Frames present: ${frames.length ? frames.join(', ') : '(none)'}\n` +
        `  Check SHOPIFY_APP_HOST matches the app's real URL, and that the app is installed on ${this.profile.store}.`,
      );
    }
  }

  /**
   * `go to …` inside the admin. Accepts a full URL, an admin-relative path, or
   * a plain-English phrase naming an admin section.
   */
  async navigate(target: string): Promise<void> {
    await this.page.goto(this.resolve(target), { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
  }

  private resolve(target: string): string {
    const base = adminUrl(this.profile.store);
    if (/^https?:\/\//.test(target)) return target;
    if (target.startsWith('/')) return `${base}${target}`;
    if (/\bapp\b/i.test(target)) return `${base}/apps/${this.profile.appHandle}`;

    const section = target.toLowerCase().replace(/^(the|my)\s+/, '').replace(/\s+(page|section)$/, '').trim();
    const known: Record<string, string> = {
      products: '/products', orders: '/orders', customers: '/customers',
      settings: '/settings', discounts: '/discounts', apps: '/apps',
      'theme editor': '/themes/current/editor', themes: '/themes',
    };
    return `${base}${known[section] ?? `/${section.replace(/\s+/g, '-')}`}`;
  }
}
