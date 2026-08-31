import type { SurfaceSet } from '../runner/Surface.js';
import { ConfigError } from '../config/env.js';

export interface SurfaceOptions {
  storeDomain: string;
  appHandle: string;
  appHost: string;
  storefrontPassword?: string;
  authStatePath: string;
  headless: boolean;
  timeoutMs: number;
}

/**
 * Builds the live Shopify surfaces.
 *
 * This is the seam Phase 1 fills: admin session reuse, App Bridge iframe entry,
 * and anonymous storefront access. Everything above it — engine, runner,
 * reporting — is complete and tested against the SurfaceSet contract, so the
 * only work left here is the Shopify-specific part.
 *
 * See docs/ARCHITECTURE.md §5 and the access checklist in docs/SETUP.md §0.
 */
export async function createSurfaces(_opts: SurfaceOptions): Promise<SurfaceSet> {
  throw new ConfigError(
    'Live Shopify surfaces are not implemented yet (Phase 1).\n' +
    '  The engine, runner and reporting are done and tested — this needs dev-store access:\n' +
    '    • SHOPIFY_STORE_DOMAIN, SHOPIFY_APP_HANDLE, SHOPIFY_APP_HOST in .env\n' +
    '    • a QA staff account, then `npm run auth` once\n' +
    '  Full checklist: docs/SETUP.md §0.',
  );
}
