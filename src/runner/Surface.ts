import type { BrowserContext, Page } from 'playwright';
import type { SurfaceName } from '../types.js';
import type { FrameProvider } from '../engine/resolve.js';

/**
 * One live browser surface — the admin (with its app iframe) or the storefront.
 *
 * The runner talks only to this interface, so Phase 1's real Shopify
 * implementation drops in without the runner changing. The fixture
 * implementation used in tests satisfies the same contract.
 */
export interface ActiveSurface {
  readonly name: SurfaceName;
  readonly page: Page;
  readonly context: BrowserContext;
  /** Frames a step may search, in priority order (app before host, etc.). */
  readonly frames: FrameProvider;
  /** Handle `open the app`. */
  openApp(): Promise<void>;
  /** Handle `go to …` — a URL, or a phrase like "the product page for X". */
  navigate(target: string): Promise<void>;
}

/**
 * Lazily creates surfaces. A pure-admin test never launches a storefront
 * context, and the storefront context is always anonymous — a leaked admin
 * cookie would make theme-extension tests lie.
 */
export interface SurfaceSet {
  get(name: SurfaceName): Promise<ActiveSurface>;
  /** Surfaces already created, for artifact capture. */
  active(): ActiveSurface[];
  startTracing(title: string): Promise<void>;
  stopTracing(path: string | undefined): Promise<void>;
  /** Discard all contexts so the next test starts clean. */
  reset(): Promise<void>;
  close(): Promise<void>;
}
