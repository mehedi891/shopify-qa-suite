import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { SurfaceName } from '../types.js';
import type { ActiveSurface, SurfaceSet } from '../runner/Surface.js';
import type { AppProfile } from '../config/apps.js';
import { authStatePath } from '../config/apps.js';
import { AdminSurface } from './AdminSurface.js';
import { StorefrontSurface } from './StorefrontSurface.js';
import { assertSessionValid } from './auth.js';

export interface ShopifySurfacesOptions {
  profile: AppProfile;
  headless: boolean;
  timeoutMs: number;
}

/**
 * Live Shopify surfaces.
 *
 * The admin context loads the saved session; the storefront context is always
 * anonymous. Both are created lazily — a pure-admin test never launches a
 * storefront browser, and vice versa.
 */
export class ShopifySurfaces implements SurfaceSet {
  private surfaces = new Map<SurfaceName, ActiveSurface>();
  private contexts = new Map<SurfaceName, BrowserContext>();
  private tracing: BrowserContext[] = [];
  private sessionChecked = false;

  private constructor(
    private readonly browser: Browser,
    private readonly opts: ShopifySurfacesOptions,
  ) {}

  static async launch(opts: ShopifySurfacesOptions): Promise<ShopifySurfaces> {
    const statePath = authStatePath(opts.profile.store);
    if (!existsSync(statePath)) {
      throw new Error(
        `No saved Shopify session for ${opts.profile.store}.\n` +
        `  Run \`npm run auth\` and log in once — the session is reused for weeks.\n` +
        `  (Expected it at ${statePath}.)`,
      );
    }
    const browser = await chromium.launch({ headless: opts.headless });
    return new ShopifySurfaces(browser, opts);
  }

  async get(name: SurfaceName): Promise<ActiveSurface> {
    const existing = this.surfaces.get(name);
    if (existing) return existing;

    const { profile, timeoutMs } = this.opts;
    const context = name === 'admin'
      ? await this.browser.newContext({ storageState: authStatePath(profile.store) })
      : await this.browser.newContext(); // anonymous: a shopper is not a merchant

    context.setDefaultTimeout(timeoutMs);
    this.contexts.set(name, context);

    // check the session once per run, not once per test
    if (name === 'admin' && !this.sessionChecked) {
      this.sessionChecked = true;
      await assertSessionValid(context, profile);
    }

    const page = await context.newPage();
    const surface: ActiveSurface = name === 'admin'
      ? new AdminSurface(page, context, profile, timeoutMs)
      : new StorefrontSurface(page, context, profile, timeoutMs);

    if (name === 'storefront') await (surface as StorefrontSurface).unlock();
    this.surfaces.set(name, surface);
    return surface;
  }

  active(): ActiveSurface[] { return [...this.surfaces.values()]; }

  async startTracing(title: string): Promise<void> {
    // contexts are created lazily, so tracing starts on whatever exists and
    // newly created ones are picked up on the next attempt
    this.tracing = [...this.contexts.values()];
    for (const c of this.tracing) {
      await c.tracing.start({ title, screenshots: true, snapshots: true }).catch(() => {});
    }
  }

  async stopTracing(path: string | undefined): Promise<void> {
    for (const c of this.tracing) {
      await c.tracing.stop(path ? { path } : {}).catch(() => {});
    }
    this.tracing = [];
  }

  /** Discard contexts between test cases so nothing bleeds across. */
  async reset(): Promise<void> {
    for (const c of this.contexts.values()) await c.close().catch(() => {});
    this.contexts.clear();
    this.surfaces.clear();
    this.tracing = [];
  }

  async close(): Promise<void> {
    await this.reset();
    await this.browser.close().catch(() => {});
  }
}
