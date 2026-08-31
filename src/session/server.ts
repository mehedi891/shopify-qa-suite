import { createServer } from 'node:http';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { launchBrowser, type LaunchMode, type LaunchedBrowser } from './launch.js';
import type { SurfaceName, Step } from '../types.js';
import type { FrameProvider, NamedRoot } from '../engine/resolve.js';
import { ariaSnapshot } from '../engine/resolve.js';
import { StepEngine } from '../engine/StepEngine.js';
import { LocatorCache } from '../engine/LocatorCache.js';
import { AgentPlanner } from '../engine/Planner.js';
import { TestContext } from '../runner/Context.js';
import { DialogController } from '../runner/dialogs.js';
import { parseStepLine } from '../source/parser.js';
import { SESSION_FILE, type Command, type CommandResult, type SessionInfo } from './protocol.js';
import { slug } from '../surfaces/StorefrontSurface.js';

const SHOPIFY_HOSTS = /(^|\.)(shopify\.com|myshopify\.com|shopifycdn\.com|shopifycloud\.com)$/;

/** A browser that outlives a single command, so one human login covers a whole run. */
export interface SessionOptions {
  mode: LaunchMode;
  profileDir: string;
  cdpEndpoint: string;
}

export class QaSession {
  private launched!: LaunchedBrowser;
  private context!: BrowserContext;
  private adminPage!: Page;
  private storefrontPage?: Page;
  private current: SurfaceName = 'admin';
  private cache = new LocatorCache('.cache/session-locators.json');
  private testContext = new TestContext();
  private dialogs = new DialogController();
  private info!: SessionInfo;
  private stepIndex = 0;

  async start(opts: SessionOptions, port = 0): Promise<SessionInfo> {
    this.launched = await launchBrowser(opts);
    // one context: a person testing their own store is logged in on both the
    // admin and the storefront, and that is what we are simulating
    this.context = this.launched.context;
    this.context.setDefaultTimeout(15_000);

    // reuse an already-open tab when attaching, so we land in the user's session
    const existing = this.context.pages();
    this.adminPage = existing[0] ?? await this.context.newPage();
    this.dialogs.attach(this.adminPage);

    // do not hijack a tab the user is already using
    if (opts.mode !== 'attach' || this.adminPage.url() === 'about:blank') {
      await this.adminPage.goto('https://admin.shopify.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let result: CommandResult;
      try {
        result = await this.handle(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Command);
      } catch (err) {
        result = { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    });

    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('session server failed to bind');

    this.info = {
      pid: process.pid, port: addr.port, startedAt: new Date().toISOString(),
      surface: 'admin', browser: this.launched.description,
    };
    this.persist();

    const cleanup = () => rmSync(SESSION_FILE, { force: true });
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    this.launched.browser?.on('disconnected', () => { cleanup(); process.exit(0); });
    this.context.on('close', () => { cleanup(); process.exit(0); });

    return this.info;
  }

  private persist(): void {
    writeFileSync(SESSION_FILE, JSON.stringify(this.info, null, 2));
  }

  private get page(): Page {
    return this.current === 'admin' ? this.adminPage : this.storefrontPage ?? this.adminPage;
  }

  /** Frames a step may search: the app iframe first, then the host admin page. */
  private frames(): FrameProvider {
    const page = this.page;
    const appHost = this.info.appHost;
    const isAdmin = this.current === 'admin';
    return {
      async roots(hint): Promise<NamedRoot[]> {
        if (!isAdmin) return [{ name: 'page', root: page }];
        const selector = appHost ? `iframe[src*="${appHost}"]` : 'iframe';
        const app: NamedRoot = { name: 'app', root: page.frameLocator(selector) };
        const host: NamedRoot = { name: 'host', root: page };
        if (hint === 'app') return [app];
        if (hint === 'host') return [host];
        return [app, host];
      },
    };
  }

  private async handle(cmd: Command): Promise<CommandResult> {
    switch (cmd.type) {
      case 'status': return { ok: true, data: { ...this.info, url: this.page.url(), surface: this.current } };
      case 'detect': return this.detect();
      case 'frames': return { ok: true, data: this.page.frames().map((f) => ({ url: f.url(), name: f.name() })) };
      case 'snapshot': return this.snapshot(cmd.frame ?? 'auto', cmd.maxChars ?? 18_000);
      case 'do': return this.doStep(cmd.step, cmd.testCaseId, cmd.index);
      case 'goto': return this.goto(cmd.surface, cmd.target);
      case 'switch': return this.switchTo(cmd.surface);
      case 'screenshot': return this.screenshot(cmd.path);
      case 'vars': return { ok: true, data: this.testContext.snapshot() };
      case 'reset':
        this.testContext = new TestContext();
        this.stepIndex = 0;
        return { ok: true, message: 'variables cleared' };
      case 'stop':
        setTimeout(() => { rmSync(SESSION_FILE, { force: true }); process.exit(0); }, 50);
        return { ok: true, message: 'stopping' };
    }
  }

  /**
   * Learn the store, app handle and app-iframe host from whatever is open.
   * This is why none of it needs configuring: the browser already knows.
   */
  private async detect(): Promise<CommandResult> {
    const url = this.adminPage.url();
    const storeMatch = /admin\.shopify\.com\/store\/([^/?#]+)/.exec(url);
    if (storeMatch) {
      this.info.store = `${storeMatch[1]}.myshopify.com`;
      const appMatch = /\/apps\/([^/?#]+)/.exec(url);
      if (appMatch) this.info.appHandle = appMatch[1];
    }

    // the app iframe is simply the one that is not Shopify's own
    const foreign = this.adminPage.frames()
      .map((f) => f.url())
      .filter((u) => u && u !== 'about:blank')
      .map((u) => { try { return new URL(u); } catch { return null; } })
      .filter((u): u is URL => u !== null)
      .filter((u) => !SHOPIFY_HOSTS.test(u.hostname));
    if (foreign.length > 0) this.info.appHost = foreign[0]!.host;

    this.persist();
    return {
      ok: Boolean(this.info.store),
      message: this.info.store
        ? `store ${this.info.store}` +
          (this.info.appHandle ? ` · app "${this.info.appHandle}"` : ' · no app open') +
          (this.info.appHost ? ` · iframe host ${this.info.appHost}` : ' · no app iframe detected')
        : 'Not on an admin page yet — log in and open your app, then run `qa detect` again.',
      data: this.info,
    };
  }

  private async snapshot(which: 'app' | 'host' | 'page' | 'auto', maxChars: number): Promise<CommandResult> {
    const hint = which === 'page' ? 'auto' : which;
    const roots = await this.frames().roots(hint as never);
    const out: Record<string, string> = {};
    for (const { name, root } of roots) {
      out[name] = await ariaSnapshot(root, Math.floor(maxChars / roots.length));
    }
    return { ok: true, data: { url: this.page.url(), surface: this.current, frames: out } };
  }

  /** Execute one plain-English step against the live browser. */
  private async doStep(raw: string, testCaseId = 'SESSION', index?: number): Promise<CommandResult> {
    const idx = index ?? this.stepIndex++;
    const { step, error } = parseStepLine(raw, idx, this.current, 'steps');
    if (error) return { ok: false, message: error };
    if (!step) return { ok: true, message: 'blank step, nothing to do' };

    // navigation-style steps belong to the session, not the element engine
    const kind = step.action?.kind;
    if (kind === 'switch' && step.action?.surface) return this.switchTo(step.action.surface);
    if (kind === 'open') return this.openApp();
    if (kind === 'goto') return this.goto(this.current, this.testContext.resolve(step.action?.value ?? ''));
    if (kind === 'dialog') {
      if (step.action?.value === 'dismiss') this.dialogs.expectDismiss(); else this.dialogs.expectAccept();
      return { ok: true, message: `next dialog will be ${step.action?.value ?? 'accepted'}` };
    }

    const engine = new StepEngine({
      page: this.page,
      frames: this.frames(),
      cache: this.cache,
      // the agent driving this session is the planner; when heuristics miss,
      // it reads a snapshot and supplies an explicit selector itself
      planner: new AgentPlanner(),
      context: this.testContext,
      timeoutMs: 15_000,
    });

    const result = await engine.execute(step as Step, testCaseId);
    this.cache.save();
    return {
      ok: result.status === 'passed',
      message: result.status === 'passed'
        ? `${raw}  (${result.locatorSource ?? 'ok'}${result.resolvedLocator ? ` · ${result.resolvedLocator}` : ''}, ${result.durationMs}ms)`
        : result.error,
      data: { status: result.status, locator: result.resolvedLocator, durationMs: result.durationMs },
    };
  }

  private async openApp(): Promise<CommandResult> {
    if (!this.info.store || !this.info.appHandle) {
      return { ok: false, message: 'Store or app unknown. Open your app in the browser, then run `qa detect`.' };
    }
    const handle = this.info.store.replace('.myshopify.com', '');
    const url = `https://admin.shopify.com/store/${handle}/apps/${this.info.appHandle}`;
    await this.adminPage.goto(url, { waitUntil: 'domcontentloaded' });
    await this.adminPage.waitForTimeout(1500);
    await this.detect();
    return { ok: true, message: `opened ${url}` };
  }

  private async goto(surface: SurfaceName, target?: string): Promise<CommandResult> {
    await this.switchTo(surface);
    if (!target) return { ok: true, message: `on ${surface}` };
    const url = this.resolveUrl(surface, target);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    return { ok: true, message: `→ ${url}` };
  }

  private resolveUrl(surface: SurfaceName, target: string): string {
    if (/^https?:\/\//.test(target)) return target;
    const store = this.info.store ?? '';
    if (surface === 'admin') {
      const base = `https://admin.shopify.com/store/${store.replace('.myshopify.com', '')}`;
      return target.startsWith('/') ? `${base}${target}` : `${base}/${slug(target)}`;
    }
    const base = `https://${store}`;
    if (target.startsWith('/')) return `${base}${target}`;
    const product = /product page for\s+"?([^"]+)"?|product\s+"?([^"]+)"?/i.exec(target);
    if (product) return `${base}/products/${slug(product[1] ?? product[2] ?? '')}`;
    const collection = /collection(?:\s+page)?\s+(?:for\s+)?"?([^"]+)"?/i.exec(target);
    if (collection) return `${base}/collections/${slug(collection[1] ?? '')}`;
    if (/^(the\s+)?(home|homepage|storefront)$/i.test(target.trim())) return base;
    if (/\bcart\b/i.test(target)) return `${base}/cart`;
    return `${base}/${slug(target)}`;
  }

  private async switchTo(surface: SurfaceName): Promise<CommandResult> {
    if (surface === 'storefront' && !this.storefrontPage) {
      this.storefrontPage = await this.context.newPage();
      this.dialogs.attach(this.storefrontPage);
      if (this.info.store) {
        await this.storefrontPage.goto(`https://${this.info.store}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
    this.current = surface;
    this.info.surface = surface;
    this.persist();
    await this.page.bringToFront().catch(() => {});
    return { ok: true, message: `switched to ${surface} (${this.page.url()})` };
  }

  private async screenshot(path: string): Promise<CommandResult> {
    mkdirSync(dirname(path), { recursive: true });
    await this.page.screenshot({ path });
    return { ok: true, message: path };
  }
}
