import { describe, expect, it } from 'vitest';
import { slug } from '../src/surfaces/StorefrontSurface.js';
import { adminUrl, authStatePath, storefrontUrl, storeHandle } from '../src/config/apps.js';

describe('store URL helpers', () => {
  it('derives the admin and storefront URLs from a myshopify domain', () => {
    expect(storeHandle('my-dev-store.myshopify.com')).toBe('my-dev-store');
    expect(adminUrl('my-dev-store.myshopify.com')).toBe('https://admin.shopify.com/store/my-dev-store');
    expect(storefrontUrl('my-dev-store.myshopify.com')).toBe('https://my-dev-store.myshopify.com');
  });

  it('keys session state by store, so apps on one store share a login', () => {
    expect(authStatePath('my-dev-store.myshopify.com')).toBe('.auth/my-dev-store.json');
    // two apps, same store → same session file
    expect(authStatePath('shop.myshopify.com')).toBe(authStatePath('shop.myshopify.com'));
  });
});

describe('storefront handle slugs', () => {
  it('matches Shopify handle rules', () => {
    expect(slug('Test Product')).toBe('test-product');
    expect(slug('  Blue Shirt — Large ')).toBe('blue-shirt-large');
    expect(slug('50% Off!')).toBe('50-off');
  });
});
