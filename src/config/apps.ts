import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { ConfigError, env } from './env.js';

/**
 * One app under test. Several may share a store — a Shopify admin session is
 * per store, not per app, so auth state is keyed by store domain and one
 * `qa auth` covers every app installed on it.
 */
export const AppProfileSchema = z.object({
  /** Store the app is installed on, e.g. my-dev-store.myshopify.com */
  store: z.string().min(1),
  /** The /apps/<handle> segment in the admin URL. */
  appHandle: z.string().min(1),
  /** Host of the app iframe's src — how we find the embedded frame. */
  appHost: z.string().min(1),
  /** Storefront password, if the store is password-protected. */
  storefrontPassword: z.string().optional(),
  /** Google Sheet holding this app's test cases. */
  sheetId: z.string().optional(),
  sheetTab: z.string().default('Test Cases'),
});

export type AppProfile = z.infer<typeof AppProfileSchema> & { name: string };

const ProfilesFileSchema = z.object({
  default: z.string().optional(),
  apps: z.record(z.string(), AppProfileSchema),
});

const PROFILES_PATH = 'qa.apps.json';

/**
 * Profiles come from qa.apps.json when it exists, otherwise from .env as a
 * single unnamed app. Teams testing one app never need the file.
 */
export function loadProfiles(): { profiles: Record<string, AppProfile>; defaultName: string } {
  if (existsSync(PROFILES_PATH)) {
    const parsed = ProfilesFileSchema.safeParse(JSON.parse(readFileSync(PROFILES_PATH, 'utf8')));
    if (!parsed.success) {
      throw new ConfigError(
        `${PROFILES_PATH} is invalid:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
      );
    }
    const names = Object.keys(parsed.data.apps);
    if (names.length === 0) throw new ConfigError(`${PROFILES_PATH} defines no apps.`);

    const profiles: Record<string, AppProfile> = {};
    for (const [name, app] of Object.entries(parsed.data.apps)) profiles[name] = { ...app, name };

    const defaultName = parsed.data.default ?? names[0]!;
    if (!profiles[defaultName]) {
      throw new ConfigError(`${PROFILES_PATH} sets default "${defaultName}", which is not one of: ${names.join(', ')}`);
    }
    return { profiles, defaultName };
  }

  // single-app fallback: everything from .env
  if (!env.SHOPIFY_STORE_DOMAIN || !env.SHOPIFY_APP_HANDLE) {
    throw new ConfigError(
      'No app configured. Either set SHOPIFY_STORE_DOMAIN, SHOPIFY_APP_HANDLE and SHOPIFY_APP_HOST ' +
      `in .env, or create ${PROFILES_PATH} to test several apps. See docs/SETUP.md.`,
    );
  }
  const profile: AppProfile = {
    name: env.SHOPIFY_APP_HANDLE,
    store: env.SHOPIFY_STORE_DOMAIN,
    appHandle: env.SHOPIFY_APP_HANDLE,
    // falls back to the store host, which is right for apps served from the store domain
    appHost: env.SHOPIFY_APP_HOST || env.SHOPIFY_STORE_DOMAIN,
    storefrontPassword: env.SHOPIFY_STOREFRONT_PASSWORD,
    sheetId: env.QA_SHEET_ID,
    sheetTab: env.QA_SHEET_TAB,
  };
  return { profiles: { [profile.name]: profile }, defaultName: profile.name };
}

export function resolveProfile(name?: string): AppProfile {
  const { profiles, defaultName } = loadProfiles();
  const wanted = name ?? defaultName;
  const profile = profiles[wanted];
  if (!profile) {
    throw new ConfigError(
      `No app profile "${wanted}". Available: ${Object.keys(profiles).join(', ')}.`,
    );
  }
  return profile;
}

/** Store handle from a myshopify domain: my-store.myshopify.com → my-store */
export const storeHandle = (domain: string) => domain.replace(/\.myshopify\.com$/, '');

/** Admin session state is per store, so several apps share one login. */
export const authStatePath = (store: string) => `.auth/${storeHandle(store)}.json`;

export const adminUrl = (store: string) => `https://admin.shopify.com/store/${storeHandle(store)}`;
export const storefrontUrl = (store: string) => `https://${store}`;
