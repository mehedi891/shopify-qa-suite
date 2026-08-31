import { env } from './src/config/env.js';

/** Everything non-secret. Secrets live in .env; this file is reviewable. */
export default {
  store: {
    domain: env.SHOPIFY_STORE_DOMAIN ?? '',
    appHandle: env.SHOPIFY_APP_HANDLE ?? '',
    appHost: env.SHOPIFY_APP_HOST ?? '',
  },
  sheet: {
    spreadsheetId: env.QA_SHEET_ID ?? '',
    tab: env.QA_SHEET_TAB,
  },
  run: {
    headless: true,
    retries: 1,
    timeoutMs: 30_000,
    workers: 1, // see ARCHITECTURE.md §11 — serial on purpose
  },
  planner: {
    // Only reached on a cache miss that the free heuristics could not resolve,
    // so this is a low-volume call. Lower it if you want to trade accuracy for cost.
    model: 'claude-opus-5',
    maxCallsPerRun: 100,
  },
  artifacts: {
    screenshots: 'all' as const,
    video: 'on-failure' as const,
    trace: 'on-failure' as const,
    dir: 'artifacts',
  },
} as const;
