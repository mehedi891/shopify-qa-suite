import { expect } from 'playwright/test';
import type { Locator, Page } from 'playwright';
import type { Action } from '../types.js';
import type { TestContext } from '../runner/Context.js';

export class ActionError extends Error {}

export interface ActionDeps {
  page: Page;
  context: TestContext;
  timeoutMs: number;
}

/**
 * Perform one action on an already-resolved locator. Everything here relies on
 * Playwright's auto-waiting — there are no sleeps, because a fixed sleep is
 * either flake or wasted time.
 */
export async function performAction(
  action: Action,
  locator: Locator | undefined,
  deps: ActionDeps,
): Promise<void> {
  const { page, context, timeoutMs } = deps;
  const t = { timeout: timeoutMs };

  const need = (): Locator => {
    if (!locator) throw new ActionError(`Step "${action.kind}" needs a target element.`);
    return locator;
  };
  const value = () => (action.value === undefined ? '' : context.resolve(action.value));

  switch (action.kind) {
    case 'click':
      await need().click(t);
      return;

    case 'fill':
      await need().fill(value(), t);
      return;

    case 'select': {
      const el = need();
      const v = value();
      // a Polaris Select is a real <select>; a custom dropdown is not
      const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => '');
      if (tag === 'select') await el.selectOption({ label: v }, t);
      else {
        await el.click(t);
        await page.getByRole('option', { name: v, exact: false }).first().click(t);
      }
      return;
    }

    case 'toggle':
    case 'check': {
      const el = need();
      const want = action.state ?? true;
      // setChecked handles switches and checkboxes and is a no-op if already right
      try {
        await el.setChecked(want, t);
      } catch (err) {
        // Polaris — and most component kits — render a visually-hidden <input>
        // behind a styled span. The input is the accessible element but is not
        // clickable, so a normal check times out. Click its label instead,
        // which is exactly what a real user clicks.
        if (!isActionabilityTimeout(err)) throw err;
        const clicked = await clickAssociatedLabel(page, el, timeoutMs);
        if (!clicked) await el.setChecked(want, { ...t, force: true });
        // verify we ended up in the state the step asked for
        const now = await el.isChecked().catch(() => want);
        if (now !== want) await el.setChecked(want, { ...t, force: true });
      }
      return;
    }

    case 'hover':
      await need().hover(t);
      return;

    case 'upload':
      await need().setInputFiles(value(), t);
      return;

    case 'press':
      await page.keyboard.press(value());
      return;

    case 'wait':
      await expect(need()).toBeVisible(t);
      return;

    case 'reload':
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return;

    case 'goto':
      await page.goto(value(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return;

    case 'save': {
      if (!action.variableName) throw new ActionError('save step has no variable name.');
      const saved = action.target
        ? await readValue(need())
        : value();
      context.set(action.variableName, saved);
      return;
    }

    case 'drag': {
      const to = value();
      const targetLocator = page.getByText(to, { exact: false }).first();
      await need().dragTo(targetLocator, t);
      return;
    }

    case 'dialog':
      // handled by the dialog listener installed on the page; nothing to do here
      return;

    case 'viewport':
    case 'open':
    case 'switch':
      throw new ActionError(`"${action.kind}" is handled by the runner, not the action layer.`);

    default: {
      const exhaustive: never = action.kind;
      throw new ActionError(`Unsupported action: ${String(exhaustive)}`);
    }
  }
}

function isActionabilityTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Timeout .*exceeded|not visible|not stable|intercepts pointer events/i.test(msg);
}

/**
 * Click the <label> tied to a hidden input, the way a person would.
 * Returns false when there is no usable label to click.
 */
async function clickAssociatedLabel(page: Page, input: Locator, timeoutMs: number): Promise<boolean> {
  const id = await input.getAttribute('id').catch(() => null);
  if (id) {
    const escaped = id.replace(/["\\]/g, '\\$&');
    const label = page.locator(`label[for="${escaped}"]`).first();
    if (await label.count().catch(() => 0)) {
      try {
        await label.click({ timeout: Math.min(timeoutMs, 5_000) });
        return true;
      } catch { /* fall through to the wrapper attempt */ }
    }
  }
  // no matching label: click the nearest clickable ancestor instead
  try {
    const wrapper = input.locator('xpath=ancestor::label[1] | xpath=ancestor::*[@role="checkbox" or @role="switch"][1]').first();
    if (await wrapper.count().catch(() => 0)) {
      await wrapper.click({ timeout: Math.min(timeoutMs, 5_000) });
      return true;
    }
  } catch { /* nothing clickable found */ }
  return false;
}

/** Read an element's value the way a user would perceive it. */
export async function readValue(locator: Locator): Promise<string> {
  const tag = await locator.evaluate((n) => n.tagName.toLowerCase()).catch(() => '');
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return (await locator.inputValue()) ?? '';
  }
  const aria = await locator.getAttribute('aria-valuenow').catch(() => null);
  if (aria !== null) return aria;
  return ((await locator.textContent()) ?? '').trim();
}
