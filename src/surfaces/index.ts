import type { SurfaceSet } from '../runner/Surface.js';
import type { AppProfile } from '../config/apps.js';
import { ShopifySurfaces } from './ShopifySurfaces.js';

export interface SurfaceOptions {
  profile: AppProfile;
  headless: boolean;
  timeoutMs: number;
}

/** Build the live Shopify surfaces for a run. */
export async function createSurfaces(opts: SurfaceOptions): Promise<SurfaceSet> {
  return ShopifySurfaces.launch(opts);
}

export { AdminSurface } from './AdminSurface.js';
export { StorefrontSurface } from './StorefrontSurface.js';
export { ShopifySurfaces } from './ShopifySurfaces.js';
