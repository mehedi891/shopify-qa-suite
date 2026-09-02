import { describe, expect, it } from 'vitest';
import { expandMacro, type TestData } from '../src/source/macros.js';
import { parseStepBlock } from '../src/source/parser.js';

const data: TestData = {
  card: '4242424242424242',
  cardName: 'QA Tester',
  cardExpiry: '12/34',
  cardCvv: '111',
  testModeText: 'Test mode',
  checkout: {
    email: 'qa@example.com', firstName: 'QA', lastName: 'Tester',
    address: '1 Main St', city: 'Ottawa', country: 'Canada',
    province: 'Ontario', postalCode: 'K2P 2L8', phone: '6135550188',
  },
};

const expand = (line: string) => expandMacro(line, data);

describe('product macros', () => {
  it('creates a product with only the fields that were asked for', () => {
    expect(expand('create a product named "QA Widget"')!.lines).toEqual([
      'go to "/products/new"',
      'fill "Title" with "QA Widget"',
      'click "Save"',
      'expect "Unsaved changes" to be hidden',
    ]);
  });

  it('adds price and inventory when given', () => {
    const lines = expand('create a product named "QA Widget" with price "19.99" and inventory "5"')!.lines;
    expect(lines).toContain('fill "Price" with "19.99"');
    expect(lines).toContain('check "Track quantity"');
    expect(lines).toContain('fill "Available" with "5"');
  });

  it('warns that it changes real store data', () => {
    expect(expand('create a product named "QA Widget"')!.warning).toMatch(/real product/i);
    expect(expand('delete the product named "QA Widget"')!.warning).toMatch(/permanently/i);
  });

  it('leaves ordinary steps alone', () => {
    expect(expand('click "Save"')).toBeNull();
    expect(expand('expect "Free shipping" to be visible')).toBeNull();
  });
});

describe('order macros', () => {
  it('gates the order on the checkout being in test mode', () => {
    const lines = expand('place a test order')!.lines;
    // the gate must come before anything is submitted
    expect(lines[0]).toBe('expect "Test mode" to be visible');
    expect(lines.indexOf('click "Pay now"')).toBeGreaterThan(0);
  });

  it('uses the configured card, or the one the step names', () => {
    expect(expand('place a test order')!.lines).toContain('fill "Card number" with "4242424242424242"');
    // '1' is the Bogus Gateway's success card
    expect(expand('place a test order with card "1"')!.lines).toContain('fill "Card number" with "1"');
  });

  it('warns that it submits a real order', () => {
    expect(expand('place a test order')!.warning).toMatch(/submits a real order/i);
  });

  it('fills checkout details from config, not from hardcoded values', () => {
    const lines = expand('fill in the test checkout details')!.lines;
    expect(lines).toContain('fill "City" with "Ottawa"');
    expect(lines).toContain('select "Canada" in "Country/Region"');
  });
});

describe('macros inside a case', () => {
  it('expands into real steps that each keep their own text', () => {
    const res = parseStepBlock('create a product named "QA Widget"\nclick "Done"', 'admin', 'steps');
    expect(res.errors).toEqual([]);
    expect(res.steps.map((s) => s.raw)).toEqual([
      'go to "/products/new"',
      'fill "Title" with "QA Widget"',
      'click "Save"',
      'expect "Unsaved changes" to be hidden',
      'click "Done"',
    ]);
  });

  it('reports the warning against the sheet line the author wrote', () => {
    const res = parseStepBlock('click "Start"\nplace a test order', 'storefront', 'steps');
    expect(res.warnings).toEqual([{ line: 2, message: expect.stringMatching(/submits a real order/i) }]);
  });

  it('numbers the expanded steps continuously with the rest', () => {
    const res = parseStepBlock('click "A"\ncreate a product named "P"\nclick "B"', 'admin', 'steps');
    expect(res.steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('the {random} trap', () => {
  it('warns when a product name would differ between create and teardown', () => {
    const w = expand('create a product named "QA Widget {random}"')!.warning!;
    expect(w).toMatch(/new value every time/);
    expect(w).toMatch(/save "QA Widget \{random\}" as productName/);
  });

  it('says nothing when the name is pinned to a variable', () => {
    expect(expand('create a product named "{productName}"')!.warning).toMatch(/real product/i);
  });

  it('passes a variable through to the steps it expands into', () => {
    const lines = expand('delete the product named "{productName}"')!.lines;
    expect(lines).toContain('fill "Search products" with "{productName}"');
    expect(lines).toContain('click "{productName}"');
  });
});
