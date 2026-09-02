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
    workers: 1, // serial on purpose: one browser, one store, no cross-test interference
  },
  planner: {
    // Only reached on a cache miss that the free heuristics could not resolve,
    // so this is a low-volume call. Lower it if you want to trade accuracy for cost.
    model: 'claude-opus-5',
    maxCallsPerRun: 100,
  },
  /**
   * Data the setup and checkout macros need. Nothing here is secret, and
   * nothing here is guessable — the address must be one your store actually
   * ships to, and the card must be one your gateway accepts in test mode.
   *
   * `testModeText` is the safety gate: `place a test order` refuses to submit
   * unless this text is on the checkout page. It defaults to text that may not
   * match your checkout, and that is deliberate — the failure mode of a wrong
   * gate is a refused order, not a real one.
   */
  testData: {
    /** Shopify Payments test mode. Use '1' for the Bogus Gateway. */
    card: '4242424242424242',
    cardName: 'QA Tester',
    cardExpiry: '12/34',
    cardCvv: '111',
    testModeText: 'Test mode',
    checkout: {
      email: 'qa+{random}@example.com',
      firstName: 'QA',
      lastName: 'Tester',
      address: '151 O\'Connor Street',
      city: 'Ottawa',
      country: 'Canada',
      province: 'Ontario',
      postalCode: 'K2P 2L8',
      phone: '6135550188',
    },
  },

  artifacts: {
    screenshots: 'all' as const,
    video: 'on-failure' as const,
    trace: 'on-failure' as const,
    dir: 'Test Result',
  },
} as const;
