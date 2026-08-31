import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

/**
 * Env is validated lazily and per-need: `qa validate --csv` must work with an
 * empty .env, while `qa run` needs the Shopify and Sheets values. Validating
 * everything up front would block the offline path for no reason.
 */
const schema = z.object({
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_APP_HANDLE: z.string().optional(),
  SHOPIFY_APP_HOST: z.string().optional(),
  SHOPIFY_STOREFRONT_PASSWORD: z.string().optional(),
  SHOPIFY_QA_EMAIL: z.string().optional(),
  QA_SHEET_ID: z.string().optional(),
  QA_SHEET_TAB: z.string().default('Test Cases'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
export const env: Env = schema.parse(process.env);

export class ConfigError extends Error {}

export function require_(key: keyof Env, why: string): string {
  const value = env[key];
  if (!value) {
    throw new ConfigError(`Missing ${key} in .env — needed to ${why}. See docs/SETUP.md.`);
  }
  return value;
}

export function sheetsCredentials(): string | undefined {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) return env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return undefined; // googleapis reads the file itself
  throw new ConfigError(
    'No Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON (the whole JSON key on one line) ' +
    'or GOOGLE_APPLICATION_CREDENTIALS (a path to it). See docs/SETUP.md §3.',
  );
}
