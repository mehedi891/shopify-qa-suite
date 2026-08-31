import type { BrowserContext, Page } from 'playwright';
import type { FrameProvider } from '../engine/resolve.js';
import type { ActiveSurface } from '../runner/Surface.js';
import type { AppProfile } from '../config/apps.js';
import { storefrontUrl } from '../config/apps.js';

/**
 * The storefront, as an anonymous shopper.
 *
 * Always a clean context: a leaked admin cookie would make theme-extension
 * tests lie about what a real customer sees.
 */
export class StorefrontSurface implements ActiveSurface {
  readonly name = 'storefront' as const;
  private passwordDone = false;

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    private readonly profile: AppProfile,
    private readonly timeoutMs: number,
  ) {}

  get frames(): FrameProvider {
    const page = this.page;
    return { async roots() { return [{ name: 'page', root: page }]; } };
  }

  async openApp(): Promise<never> {
    throw new Error(
      'There is no embedded app on the storefront. Use `switch to admin` before `open the app`.',
    );
  }

  async navigate(target: string): Promise<void> {
    await this.unlock();
    await this.page.goto(this.resolve(target), { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
  }

  /**
   * Dev stores sit behind a password page. Entered once per context; the
   * resulting cookie carries the rest of the run.
   */
  async unlock(): Promise<void> {
    if (this.passwordDone) return;
    this.passwordDone = true;

    const password = this.profile.storefrontPassword;
    if (!password) return;

    const base = storefrontUrl(this.profile.store);
    await this.page.goto(`${base}/password`, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });

    // an unlocked store redirects away from /password, so there is nothing to do
    if (!/\/password/.test(this.page.url())) return;

    const field = this.page.locator('input[type="password"]').first();
    try {
      await field.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      return; // no password form; the store is open
    }
    await field.fill(password);
    await field.press('Enter');
    await this.page.waitForURL((url) => !/\/password/.test(url.toString()), { timeout: this.timeoutMs })
      .catch(() => {
        throw new Error(
          `The storefront password was rejected for ${this.profile.store}. ` +
          `Check SHOPIFY_STOREFRONT_PASSWORD (Online Store → Preferences).`,
        );
      });
  }

  /** `go to the product page for "X"`, a path, or a full URL. */
  private resolve(target: string): string {
    const base = storefrontUrl(this.profile.store);
    if (/^https?:\/\//.test(target)) return target;
    if (target.startsWith('/')) return `${base}${target}`;

    const product = /product page for\s+"?([^"]+)"?|product\s+"?([^"]+)"?/i.exec(target);
    if (product) return `${base}/products/${slug(product[1] ?? product[2] ?? '')}`;

    const collection = /collection(?:\s+page)?\s+(?:for\s+)?"?([^"]+)"?/i.exec(target);
    if (collection) return `${base}/collections/${slug(collection[1] ?? '')}`;

    if (/^(the\s+)?(home|homepage|storefront)$/i.test(target.trim())) return base;
    if (/\bcart\b/i.test(target)) return `${base}/cart`;
    if (/\bsearch\b/i.test(target)) return `${base}/search`;

    return `${base}/${slug(target)}`;
  }
}

/** Shopify handle form: lowercase, non-alphanumerics collapsed to hyphens. */
export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
