import type {
  Action, Assertion, ParseIssue, Step, SurfaceName, Target, FrameHint,
} from '../types.js';

/**
 * Step grammar. Steps are plain English, one per line, as documented in
 * docs/TEST_CASE_SPEC.md. This module is pure: text in, structured steps out,
 * no browser and no network — which is what makes `qa validate` instant.
 */

const QUOTED = /^"([^"]*)"$|^'([^']*)'$/;
const EXPLICIT_SELECTOR = /^(\[|#|\.[a-zA-Z_-]|css=|xpath=|text=|\/\/)/;

export function isExplicitSelector(s: string): boolean {
  return EXPLICIT_SELECTOR.test(s.trim());
}

function unquote(s: string): string {
  const m = QUOTED.exec(s.trim());
  if (!m) return s.trim();
  return m[1] ?? m[2] ?? '';
}

function makeTarget(raw: string, frame: FrameHint): Target {
  const trimmed = raw.trim();
  const explicit = isExplicitSelector(trimmed);
  return { raw: explicit ? trimmed : unquote(trimmed), explicit, frame };
}

/** Pull a trailing ` in host` / ` in app` frame hint off the line. */
function extractFrameHint(line: string): { line: string; frame: FrameHint } {
  const m = /^(.*?)\s+in\s+(host|app)\s*$/i.exec(line);
  if (!m) return { line, frame: 'auto' };
  return { line: m[1]!.trim(), frame: m[2]!.toLowerCase() as FrameHint };
}

/** Every `{variable}` referenced in a line. */
export function referencedVariables(line: string): string[] {
  return [...line.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
}

const BUILTIN_VARIABLES = new Set([
  'store', 'storefrontUrl', 'adminUrl', 'runId', 'timestamp', 'random',
]);

const ASSERTION_PREFIX = /^(expect|assert|verify|should see|should)\s+/i;

// ---------------------------------------------------------------- assertions

function parseAssertion(body: string, frame: FrameHint): Assertion | null {
  const s = body.trim().replace(/\.$/, '');

  // expect the url to contain "…"
  let m = /^the\s+url\s+to\s+(contain|match|be)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'url', expected: unquote(m[2]!), negated: false };

  // expect toast "…" — the toast text is also how we find it, and it usually
  // lives in the host admin frame rather than the app frame
  m = /^(?:a\s+)?toast\s+(?:to\s+say\s+|saying\s+|with\s+)?(.+)$/i.exec(s);
  if (m) {
    const text = unquote(m[1]!);
    return { kind: 'toast', target: makeTarget(m[1]!, frame), expected: text, negated: false };
  }

  // expect the clipboard to contain "…"
  m = /^the\s+clipboard\s+to\s+(?:contain|be)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'clipboard', expected: unquote(m[1]!), negated: false };

  // expect the value of "X" to be "Y"
  m = /^the\s+value\s+of\s+(.+?)\s+to\s+(?:be|equal)\s+(.+)$/i.exec(s);
  if (m) {
    return { kind: 'value', target: makeTarget(m[1]!, frame), expected: unquote(m[2]!), negated: false };
  }

  // expect 3 products in the list
  m = /^(\d+)\s+(.+?)\s+(?:in\s+the\s+list|to\s+be\s+(?:visible|shown))$/i.exec(s);
  if (m) {
    return { kind: 'count', target: makeTarget(m[2]!, frame), count: Number(m[1]), negated: false };
  }

  // expect "X" to contain "Y"
  m = /^(.+?)\s+to\s+contain\s+(.+)$/i.exec(s);
  if (m) {
    return { kind: 'text', target: makeTarget(m[1]!, frame), expected: unquote(m[2]!), negated: false };
  }

  // expect "X" to be visible | hidden | not visible | to not be visible
  m = /^(.+?)\s+(?:to\s+|is\s+|are\s+)?((?:not\s+)?(?:be\s+)?(?:not\s+)?)(visible|hidden|shown|present|displayed|gone|missing)$/i.exec(s);
  if (m) {
    const word = m[3]!.toLowerCase();
    const positiveWord = !['hidden', 'gone', 'missing'].includes(word);
    const negatedByWords = /\bnot\b/i.test(m[2]!);
    // "not hidden" is a double negative and means visible
    const wantVisible = positiveWord !== negatedByWords;
    return {
      kind: wantVisible ? 'visible' : 'hidden',
      target: makeTarget(m[1]!, frame),
      negated: false,
    };
  }

  // bare `expect "Free shipping"` → must be visible
  if (s.length > 0) {
    return { kind: 'visible', target: makeTarget(s, frame), negated: false };
  }
  return null;
}

// ------------------------------------------------------------------- actions

function parseAction(line: string, frame: FrameHint): Action | null {
  const s = line.trim().replace(/\.$/, '');

  // switch to storefront / admin
  let m = /^switch\s+to\s+(?:the\s+)?(admin|storefront)(?:\s+context)?$/i.exec(s);
  if (m) return { kind: 'switch', surface: m[1]!.toLowerCase() as SurfaceName };

  // switch to the new tab
  if (/^switch\s+to\s+(?:the\s+)?new\s+tab$/i.test(s)) {
    return { kind: 'switch', value: 'new-tab' };
  }

  // open the app
  if (/^open\s+(?:the\s+)?app$/i.test(s)) return { kind: 'open' };

  // go to … / open …
  m = /^(?:go\s+to|open|navigate\s+to|visit)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'goto', value: unquote(m[1]!) };

  // set viewport to mobile | resize to 412x915
  m = /^(?:set\s+(?:the\s+)?viewport\s+to|resize\s+to|view\s+(?:on|at))\s+(.+)$/i.exec(s);
  if (m) return { kind: 'viewport', value: unquote(m[1]!).toLowerCase() };

  // reload
  if (/^reload(\s+the\s+page)?$/i.test(s)) return { kind: 'reload' };

  // save the value of "X" as name   |   save "literal" as name
  m = /^save\s+(?:the\s+value\s+of\s+)?(.+?)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i.exec(s);
  if (m) {
    const isLiteral = QUOTED.test(m[1]!.trim()) && /\{|\$/.test(m[1]!);
    return isLiteral
      ? { kind: 'save', value: unquote(m[1]!), variableName: m[2]! }
      : { kind: 'save', target: makeTarget(m[1]!, frame), variableName: m[2]! };
  }

  // fill "X" with "Y"  |  type "Y" into "X"  |  enter "Y" in "X"
  m = /^(?:fill|set)\s+(.+?)\s+with\s+(.+)$/i.exec(s);
  if (m) return { kind: 'fill', target: makeTarget(m[1]!, frame), value: unquote(m[2]!) };
  m = /^(?:type|enter)\s+(.+?)\s+(?:into|in)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'fill', target: makeTarget(m[2]!, frame), value: unquote(m[1]!) };

  // select "X" in "Y"
  m = /^(?:select|choose)\s+(.+?)\s+(?:in|from)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'select', target: makeTarget(m[2]!, frame), value: unquote(m[1]!) };

  // turn on / turn off / enable / disable
  m = /^(?:turn\s+(on|off)|(enable|disable))\s+(.+)$/i.exec(s);
  if (m) {
    const on = m[1] ? m[1].toLowerCase() === 'on' : m[2]!.toLowerCase() === 'enable';
    return { kind: 'toggle', target: makeTarget(m[3]!, frame), state: on };
  }

  // check / uncheck
  m = /^(un)?check\s+(.+)$/i.exec(s);
  if (m) return { kind: 'check', target: makeTarget(m[2]!, frame), state: !m[1] };

  // upload "file" to "field"
  m = /^upload\s+(.+?)\s+to\s+(.+)$/i.exec(s);
  if (m) return { kind: 'upload', target: makeTarget(m[2]!, frame), value: unquote(m[1]!) };

  // drag "A" to "B"
  m = /^drag\s+(.+?)\s+(?:to|onto)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'drag', target: makeTarget(m[1]!, frame), value: unquote(m[2]!) };

  // hover
  m = /^hover(?:\s+over)?\s+(.+)$/i.exec(s);
  if (m) return { kind: 'hover', target: makeTarget(m[1]!, frame) };

  // press "Enter"
  m = /^press\s+(.+)$/i.exec(s);
  if (m) return { kind: 'press', value: unquote(m[1]!) };

  // accept / dismiss the dialog
  m = /^(accept|dismiss)\s+(?:the\s+)?(?:dialog|alert|confirm)$/i.exec(s);
  if (m) return { kind: 'dialog', value: m[1]!.toLowerCase() };

  // wait for "X"
  m = /^wait\s+for\s+(.+)$/i.exec(s);
  if (m) return { kind: 'wait', target: makeTarget(m[1]!, frame) };

  // click "X"  (last: most permissive)
  m = /^(?:click|tap|press\s+on|select)\s+(?:on\s+)?(.+)$/i.exec(s);
  if (m) return { kind: 'click', target: makeTarget(m[1]!, frame) };

  return null;
}

// -------------------------------------------------------------------- public

export interface ParseLineResult {
  step?: Step;
  error?: string;
}

export function parseStepLine(
  raw: string,
  index: number,
  surface: SurfaceName,
  origin: Step['origin'],
): ParseLineResult {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return {};

  const { line, frame } = extractFrameHint(trimmed);

  const assertionMatch = ASSERTION_PREFIX.exec(line);
  if (assertionMatch) {
    const assertion = parseAssertion(line.slice(assertionMatch[0].length), frame);
    if (!assertion) return { error: `Could not understand assertion: "${trimmed}"` };
    return { step: { index, raw: trimmed, kind: 'assertion', surface, assertion, origin } };
  }

  const action = parseAction(line, frame);
  if (!action) {
    return {
      error:
        `Could not understand step: "${trimmed}". ` +
        `Expected a verb (click, fill, select, turn on, go to, switch to, wait for, …) ` +
        `or an assertion starting with "expect".`,
    };
  }
  return { step: { index, raw: trimmed, kind: 'action', surface, action, origin } };
}

export interface ParseBlockResult {
  steps: Step[];
  errors: { line: number; message: string }[];
  /** Surface in effect after the block, so later columns continue correctly. */
  endSurface: SurfaceName;
}

/** Parse a multi-line cell, threading the current surface through `switch to`. */
export function parseStepBlock(
  cell: string,
  startSurface: SurfaceName,
  origin: Step['origin'],
  startIndex = 0,
): ParseBlockResult {
  const steps: Step[] = [];
  const errors: { line: number; message: string }[] = [];
  let surface = startSurface;
  let index = startIndex;

  const lines = (cell ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const { step, error } = parseStepLine(raw, index, surface, origin);
    if (error) {
      errors.push({ line: i + 1, message: error });
      continue;
    }
    if (!step) continue;
    if (step.action?.kind === 'switch' && step.action.surface) {
      surface = step.action.surface;
      step.surface = surface; // the switch itself belongs to the new surface
    }
    steps.push(step);
    index++;
  }
  return { steps, errors, endSurface: surface };
}

/**
 * Variable-flow check: every `{var}` must be a builtin or saved by an earlier
 * step. Catches the most common authoring mistake without running a browser.
 */
export function checkVariableFlow(steps: Step[]): { step: Step; missing: string }[] {
  const defined = new Set(BUILTIN_VARIABLES);
  const problems: { step: Step; missing: string }[] = [];
  for (const step of steps) {
    for (const name of referencedVariables(step.raw)) {
      if (!defined.has(name)) problems.push({ step, missing: name });
    }
    const saved = step.action?.variableName;
    if (saved) defined.add(saved);
  }
  return problems;
}
