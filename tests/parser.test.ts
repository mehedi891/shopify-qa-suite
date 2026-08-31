import { describe, expect, it } from 'vitest';
import { checkVariableFlow, parseStepBlock, parseStepLine, referencedVariables } from '../src/source/parser.js';
import type { Step } from '../src/types.js';

const parse = (line: string) => parseStepLine(line, 0, 'admin', 'steps');
const stepOf = (line: string): Step => {
  const { step, error } = parse(line);
  if (!step) throw new Error(error ?? 'no step');
  return step;
};

describe('actions', () => {
  it('parses click with a quoted label', () => {
    const a = stepOf('click "Save"').action!;
    expect(a.kind).toBe('click');
    expect(a.target).toMatchObject({ raw: 'Save', explicit: false, frame: 'auto' });
  });

  it('recognises explicit selectors and skips the planner path', () => {
    expect(stepOf('click [data-test="save"]').action!.target).toMatchObject({
      raw: '[data-test="save"]', explicit: true,
    });
    expect(stepOf('fill #banner-text with "Hi"').action!.target!.explicit).toBe(true);
  });

  it('parses fill both ways round', () => {
    expect(stepOf('fill "Banner text" with "Summer"').action).toMatchObject({
      kind: 'fill', value: 'Summer', target: { raw: 'Banner text' },
    });
    expect(stepOf('type "Summer" into "Banner text"').action).toMatchObject({
      kind: 'fill', value: 'Summer', target: { raw: 'Banner text' },
    });
  });

  it('parses select, targeting the field not the option', () => {
    expect(stepOf('select "Percentage" in "Discount type"').action).toMatchObject({
      kind: 'select', value: 'Percentage', target: { raw: 'Discount type' },
    });
  });

  it('parses toggles and checkboxes with their end state', () => {
    expect(stepOf('turn on "Enable widget"').action).toMatchObject({ kind: 'toggle', state: true });
    expect(stepOf('turn off "Enable widget"').action).toMatchObject({ kind: 'toggle', state: false });
    expect(stepOf('disable "Enable widget"').action).toMatchObject({ kind: 'toggle', state: false });
    expect(stepOf('check "Show on collections"').action).toMatchObject({ kind: 'check', state: true });
    expect(stepOf('uncheck "Show on collections"').action).toMatchObject({ kind: 'check', state: false });
  });

  it('parses navigation, waits and reloads', () => {
    expect(stepOf('open the app').action!.kind).toBe('open');
    expect(stepOf('go to the product page for "Test Product"').action!.kind).toBe('goto');
    expect(stepOf('reload the page').action!.kind).toBe('reload');
    expect(stepOf('wait for "Settings saved"').action).toMatchObject({ kind: 'wait', target: { raw: 'Settings saved' } });
  });

  it('parses upload, drag, hover, press and dialogs', () => {
    expect(stepOf('upload "fixtures/logo.png" to "Logo"').action).toMatchObject({
      kind: 'upload', value: 'fixtures/logo.png', target: { raw: 'Logo' },
    });
    expect(stepOf('drag "Block A" to "Block B"').action).toMatchObject({ kind: 'drag', value: 'Block B' });
    expect(stepOf('hover over "Info icon"').action!.kind).toBe('hover');
    expect(stepOf('press "Enter"').action).toMatchObject({ kind: 'press', value: 'Enter' });
    expect(stepOf('accept the dialog').action).toMatchObject({ kind: 'dialog', value: 'accept' });
  });

  it('parses save-as for both element values and literals', () => {
    expect(stepOf('save the value of "Banner text" as bannerText').action).toMatchObject({
      kind: 'save', variableName: 'bannerText', target: { raw: 'Banner text' },
    });
    expect(stepOf('save "order-{random}" as orderName').action).toMatchObject({
      kind: 'save', variableName: 'orderName', value: 'order-{random}',
    });
  });

  it('ignores blanks and comments', () => {
    expect(parse('').step).toBeUndefined();
    expect(parse('# a note').step).toBeUndefined();
  });

  it('reports an actionable error for gibberish', () => {
    const { step, error } = parse('frobnicate the widget');
    expect(step).toBeUndefined();
    expect(error).toMatch(/Could not understand step/);
    expect(error).toMatch(/click, fill, select/);
  });
});

describe('frame hints', () => {
  it('strips a trailing "in host" / "in app"', () => {
    expect(stepOf('click "Save" in host').action!.target!.frame).toBe('host');
    expect(stepOf('click "Save" in app').action!.target!.frame).toBe('app');
    expect(stepOf('click "Save"').action!.target!.frame).toBe('auto');
  });

  it('does not mistake select-in-field for a frame hint', () => {
    const a = stepOf('select "Percentage" in "Discount type"').action!;
    expect(a.target!.raw).toBe('Discount type');
    expect(a.target!.frame).toBe('auto');
  });
});

describe('assertions', () => {
  const assertOf = (line: string) => stepOf(line).assertion!;

  it('treats expect/assert/should as assertions', () => {
    for (const p of ['expect', 'assert', 'verify', 'should']) {
      expect(stepOf(`${p} "Banner" to be visible`).kind).toBe('assertion');
    }
  });

  it('parses visibility, including double negatives', () => {
    expect(assertOf('expect "Banner" to be visible').kind).toBe('visible');
    expect(assertOf('expect "Banner" to be hidden').kind).toBe('hidden');
    expect(assertOf('expect "Banner" to not be visible').kind).toBe('hidden');
    expect(assertOf('expect "Banner" to be not hidden').kind).toBe('visible');
    expect(assertOf('expect "Banner"').kind).toBe('visible');
  });

  it('parses value, text, count, url, toast and clipboard', () => {
    expect(assertOf('expect the value of "Banner text" to be "Summer"')).toMatchObject({
      kind: 'value', expected: 'Summer', target: { raw: 'Banner text' },
    });
    expect(assertOf('expect "Card" to contain "Total"')).toMatchObject({ kind: 'text', expected: 'Total' });
    expect(assertOf('expect 3 products in the list')).toMatchObject({ kind: 'count', count: 3 });
    expect(assertOf('expect the url to contain "/settings"')).toMatchObject({ kind: 'url', expected: '/settings' });
    expect(assertOf('expect toast "Settings saved"')).toMatchObject({ kind: 'toast', expected: 'Settings saved' });
    expect(assertOf('expect the clipboard to contain "abc"')).toMatchObject({ kind: 'clipboard', expected: 'abc' });
  });
});

describe('surface switching', () => {
  it('carries the new surface to later steps', () => {
    const { steps, endSurface } = parseStepBlock(
      ['click "Save"', 'switch to storefront', 'go to "/products/test"'].join('\n'),
      'admin', 'steps',
    );
    expect(steps.map((s) => s.surface)).toEqual(['admin', 'storefront', 'storefront']);
    expect(endSurface).toBe('storefront');
  });

  it('numbers steps continuously and skips blank lines', () => {
    const { steps } = parseStepBlock('click "A"\n\n\nclick "B"', 'admin', 'steps');
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it('collects a line error without losing the other steps', () => {
    const { steps, errors } = parseStepBlock('click "A"\nfrobnicate\nclick "B"', 'admin', 'steps');
    expect(steps).toHaveLength(2);
    expect(errors).toEqual([{ line: 2, message: expect.stringMatching(/Could not understand/) }]);
  });
});

describe('variables', () => {
  it('finds referenced variables', () => {
    expect(referencedVariables('expect "{bannerText} today" to be visible')).toEqual(['bannerText']);
  });

  it('accepts builtins and anything saved earlier', () => {
    const { steps } = parseStepBlock(
      'save the value of "Banner text" as bannerText\nexpect "{bannerText}" to be visible\nfill "X" with "{random}"',
      'admin', 'steps',
    );
    expect(checkVariableFlow(steps)).toEqual([]);
  });

  it('flags a variable used before it is saved', () => {
    const { steps } = parseStepBlock(
      'expect "{bannerText}" to be visible\nsave the value of "Banner text" as bannerText',
      'admin', 'steps',
    );
    expect(checkVariableFlow(steps)).toHaveLength(1);
    expect(checkVariableFlow(steps)[0]!.missing).toBe('bannerText');
  });
});
