import { expect } from 'playwright/test';
import type { Locator, Page } from 'playwright';
import type { Assertion } from '../types.js';
import type { TestContext } from '../runner/Context.js';
import { readValue } from './actions.js';

export class AssertionFailure extends Error {}

export interface AssertionDeps {
  page: Page;
  context: TestContext;
  timeoutMs: number;
}

/**
 * Check one assertion. Every check goes through Playwright's `expect`, which
 * retries until the timeout — so an async toast or a re-render resolves on its
 * own rather than needing a wait step.
 */
export async function checkAssertion(
  assertion: Assertion,
  locator: Locator | undefined,
  deps: AssertionDeps,
): Promise<void> {
  const { page, context, timeoutMs } = deps;
  const t = { timeout: timeoutMs };
  const expected = assertion.expected === undefined ? undefined : context.resolve(assertion.expected);

  const need = (): Locator => {
    if (!locator) throw new AssertionFailure(`Assertion "${assertion.kind}" needs a target element.`);
    return locator;
  };

  try {
    switch (assertion.kind) {
      case 'visible':
        await expect(need().first()).toBeVisible(t);
        return;

      case 'hidden': {
        // "hidden" must also pass when the element is absent entirely
        const el = need();
        await expect(el.first()).toBeHidden(t).catch(async () => {
          await expect(el).toHaveCount(0, t);
        });
        return;
      }

      case 'text':
        await expect(need().first()).toContainText(expected ?? '', t);
        return;

      case 'value': {
        const el = need().first();
        await expect
          .poll(async () => readValue(el), { timeout: timeoutMs })
          .toBe(expected ?? '');
        return;
      }

      case 'count':
        await expect(need()).toHaveCount(assertion.count ?? 0, t);
        return;

      case 'url':
        await expect(page).toHaveURL(new RegExp(escapeRegExp(expected ?? '')), t);
        return;

      case 'toast':
        // toasts may render in the app frame or the host admin frame; the
        // resolver already searched both, so by here we just verify it showed
        await expect(need().first()).toBeVisible(t);
        return;

      case 'clipboard': {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        if (!text.includes(expected ?? '')) {
          throw new AssertionFailure(`Clipboard is "${text}", expected it to contain "${expected}".`);
        }
        return;
      }

      default: {
        const exhaustive: never = assertion.kind;
        throw new AssertionFailure(`Unsupported assertion: ${String(exhaustive)}`);
      }
    }
  } catch (err) {
    if (err instanceof AssertionFailure) throw err;
    throw new AssertionFailure(summarise(assertion, expected, err));
  }
}

function summarise(assertion: Assertion, expected: string | undefined, err: unknown): string {
  const what = assertion.target?.raw ? `"${assertion.target.raw}"` : 'the page';
  const detail = err instanceof Error ? (err.message.split('\n')[0] ?? err.message) : String(err);
  switch (assertion.kind) {
    case 'visible': return `Expected ${what} to be visible, but it was not. ${detail}`;
    case 'hidden': return `Expected ${what} to be hidden, but it was visible. ${detail}`;
    case 'text': return `Expected ${what} to contain "${expected}". ${detail}`;
    case 'value': return `Expected the value of ${what} to be "${expected}". ${detail}`;
    case 'count': return `Expected ${assertion.count} of ${what}. ${detail}`;
    case 'url': return `Expected the url to contain "${expected}". ${detail}`;
    case 'toast': return `Expected a toast saying "${expected}". ${detail}`;
    default: return detail;
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
