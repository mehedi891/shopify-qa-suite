/**
 * One plain-English line that expands into several steps.
 *
 * Creating a product or placing an order is a fixed sequence of ordinary
 * clicks and fills. Writing them out in every case that needs test data is
 * noise, and it means fixing the same sequence in twenty rows when Shopify
 * renames a field.
 *
 * Macros expand at parse time, so each sub-step still gets the full resolver,
 * its own screenshot on failure, and its own line in the repro steps — a
 * failure points at "click Save", not at an opaque "create a product".
 *
 * These sequences follow the Shopify admin and checkout as they are today. When
 * a label changes, this file is the one place to fix it, and `qa do 'click "…"'`
 * is how you find the new one.
 */

export interface TestData {
  card: string;
  cardName: string;
  cardExpiry: string;
  cardCvv: string;
  /** Text that must be on the checkout before an order may be submitted. */
  testModeText: string;
  checkout: {
    email: string;
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    country: string;
    province: string;
    postalCode: string;
    phone: string;
  };
}

export interface MacroExpansion {
  lines: string[];
  /**
   * Surfaced by `qa validate` on every run. A step that creates real records
   * should never be quiet about it.
   */
  warning?: string;
}

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * `{random}` is regenerated on every use, so a product created as
 * "Widget {random}" and deleted as "Widget {random}" are two different names —
 * the teardown quietly deletes nothing and the store fills with junk.
 *
 * The fix is to pin it once: `save "Widget {random}" as productName`, then use
 * `{productName}` in both places.
 */
function volatileNameWarning(name: string): string | undefined {
  if (!/\{(random|timestamp)\}/.test(name)) return undefined;
  const which = /\{random\}/.test(name) ? 'random' : 'timestamp';
  return `"${name}" uses {${which}}, which is a new value every time it is read — ` +
    `a teardown naming it would target a different product. ` +
    `Do: save "${name}" as productName, then use "{productName}" in both steps.`;
}

/** `with price "10" and inventory "5"` → the parts that were given. */
function productOptions(tail: string): { price?: string; inventory?: string } {
  const price = /\b(?:with\s+)?price\s+"([^"]*)"/i.exec(tail)?.[1];
  const inventory = /\b(?:with\s+|and\s+)?(?:inventory|stock|quantity)\s+"([^"]*)"/i.exec(tail)?.[1];
  return { price, inventory };
}

export function expandMacro(line: string, data: TestData): MacroExpansion | null {
  const s = line.trim().replace(/\.$/, '');

  // create a product named "X" [with price "10"] [and inventory "5"]
  let m = /^create\s+(?:a\s+)?product\s+(?:named|called)\s+"([^"]*)"(.*)$/i.exec(s);
  if (m) {
    const name = m[1]!;
    const { price, inventory } = productOptions(m[2] ?? '');
    const lines = ['go to "/products/new"', `fill "Title" with ${q(name)}`];
    if (price !== undefined) lines.push(`fill "Price" with ${q(price)}`);
    if (inventory !== undefined) {
      lines.push('check "Track quantity"', `fill "Available" with ${q(inventory)}`);
    }
    lines.push('click "Save"');
    // the save bar stays put when a save is rejected, so its absence is the
    // same signal a human uses — and "hidden" is also true when it never showed
    lines.push('expect "Unsaved changes" to be hidden');
    return {
      lines,
      warning: volatileNameWarning(name)
        ?? `Creates a real product (${name}) in the store. Add a teardown that deletes it.`,
    };
  }

  // delete the product named "X"
  m = /^(?:delete|remove)\s+(?:the\s+)?product\s+(?:named|called)\s+"([^"]*)"$/i.exec(s);
  if (m) {
    const name = m[1]!;
    return {
      lines: [
        'go to "/products"',
        `fill "Search products" with ${q(name)}`,
        `click ${q(name)}`,
        'click "Delete product"',
        'click "Delete" in host',
        'expect "Unsaved changes" to be hidden',
      ],
      warning: volatileNameWarning(name) ?? `Deletes the product ${q(name)} permanently.`,
    };
  }

  // fill in the test checkout details
  if (/^fill\s+in\s+(?:the\s+)?test\s+checkout\s+details$/i.test(s)) {
    const c = data.checkout;
    return {
      lines: [
        `fill "Email" with ${q(c.email)}`,
        `fill "First name" with ${q(c.firstName)}`,
        `fill "Last name" with ${q(c.lastName)}`,
        `fill "Address" with ${q(c.address)}`,
        `fill "City" with ${q(c.city)}`,
        `select ${q(c.country)} in "Country/Region"`,
        `select ${q(c.province)} in "Province"`,
        `fill "Postal code" with ${q(c.postalCode)}`,
        `fill "Phone" with ${q(c.phone)}`,
      ],
    };
  }

  // place a test order [with card "1"]
  m = /^place\s+(?:a\s+)?test\s+order(?:\s+with\s+card\s+"([^"]*)")?$/i.exec(s);
  if (m) {
    const card = m[1] ?? data.card;
    return {
      lines: [
        // the gate. If the checkout is not in test mode this fails and nothing
        // is submitted — a refused order is the safe direction to be wrong in
        `expect ${q(data.testModeText)} to be visible`,
        `fill "Card number" with ${q(card)}`,
        `fill "Name on card" with ${q(data.cardName)}`,
        `fill "Expiration date" with ${q(data.cardExpiry)}`,
        `fill "Security code" with ${q(data.cardCvv)}`,
        'click "Pay now"',
        'expect "Thank you" to be visible',
      ],
      warning:
        'Submits a real order. Only run this on a development store with test ' +
        `payments on — it refuses unless ${q(data.testModeText)} is on the checkout.`,
    };
  }

  return null;
}

/** Every macro verb, for the error message when a near-miss does not parse. */
export const MACRO_VERBS = [
  'create a product named "…"',
  'delete the product named "…"',
  'fill in the test checkout details',
  'place a test order',
] as const;
