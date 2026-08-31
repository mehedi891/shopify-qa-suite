import type { Browser, BrowserContext, Page } from 'playwright';
import type { SurfaceName } from '../../src/types.js';
import type { ActiveSurface, SurfaceSet } from '../../src/runner/Surface.js';
import type { FrameProvider, NamedRoot } from '../../src/engine/resolve.js';

/**
 * A SurfaceSet over the local fixture pages. Mirrors the real arrangement —
 * admin with an app iframe plus a host frame, storefront as a separate
 * anonymous context — so the runner is exercised through the same contract
 * Phase 1's Shopify implementation will satisfy.
 */
export class FixtureSurfaces implements SurfaceSet {
  private contexts = new Map<SurfaceName, BrowserContext>();
  private surfaces = new Map<SurfaceName, ActiveSurface>();
  private tracingContexts: BrowserContext[] = [];

  constructor(private readonly browser: Browser, private readonly baseUrl: string) {}

  async get(name: SurfaceName): Promise<ActiveSurface> {
    const existing = this.surfaces.get(name);
    if (existing) return existing;

    const context = await this.browser.newContext();
    const page = await context.newPage();
    this.contexts.set(name, context);

    const surface = name === 'admin'
      ? this.adminSurface(context, page)
      : this.storefrontSurface(context, page);

    await page.goto(name === 'admin' ? `${this.baseUrl}/admin.html` : `${this.baseUrl}/storefront.html`);
    this.surfaces.set(name, surface);
    return surface;
  }

  private adminSurface(context: BrowserContext, page: Page): ActiveSurface {
    const frames: FrameProvider = {
      async roots(hint): Promise<NamedRoot[]> {
        const app: NamedRoot = { name: 'app', root: page.frameLocator('iframe[name="app-iframe"]') };
        const host: NamedRoot = { name: 'host', root: page };
        if (hint === 'app') return [app];
        if (hint === 'host') return [host];
        return [app, host];
      },
    };
    const baseUrl = this.baseUrl;
    return {
      name: 'admin', page, context, frames,
      async openApp() { await page.goto(`${baseUrl}/admin.html`); },
      async navigate(target) { await page.goto(resolveUrl(baseUrl, target)); },
    };
  }

  private storefrontSurface(context: BrowserContext, page: Page): ActiveSurface {
    const frames: FrameProvider = { async roots() { return [{ name: 'page', root: page }]; } };
    const baseUrl = this.baseUrl;
    return {
      name: 'storefront', page, context, frames,
      async openApp() { throw new Error('The storefront has no embedded app.'); },
      async navigate(target) { await page.goto(resolveUrl(baseUrl, target)); },
    };
  }

  active(): ActiveSurface[] { return [...this.surfaces.values()]; }

  async startTracing(title: string): Promise<void> {
    this.tracingContexts = [...this.contexts.values()];
    for (const c of this.tracingContexts) {
      await c.tracing.start({ title, screenshots: true, snapshots: true });
    }
  }

  async stopTracing(path: string | undefined): Promise<void> {
    for (const c of this.tracingContexts) {
      await c.tracing.stop(path ? { path } : {});
    }
    this.tracingContexts = [];
  }

  async reset(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    for (const c of this.contexts.values()) await c.close().catch(() => {});
    this.contexts.clear();
    this.surfaces.clear();
    this.tracingContexts = [];
  }
}

/** Turn a plain-English navigation phrase into a fixture URL. */
function resolveUrl(baseUrl: string, target: string): string {
  if (/^https?:\/\//.test(target)) return target;
  if (/product page/i.test(target)) return `${baseUrl}/storefront.html`;
  if (/^\//.test(target)) return `${baseUrl}${target}`;
  return `${baseUrl}/${target}`;
}
