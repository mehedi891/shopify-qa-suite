import type { FrameLocator, Locator, Page } from 'playwright';
import type { ActionKind, AssertionKind } from '../types.js';

/**
 * Anything you can search inside: a Page, a Locator, or a FrameLocator. All
 * three expose the same query surface, so the engine never cares which it has.
 */
export type LocatorRoot = Pick<
  Page,
  'locator' | 'getByRole' | 'getByText' | 'getByLabel' | 'getByPlaceholder' | 'getByTestId' | 'getByAltText' | 'getByTitle'
>;

export type Strategy = 'css' | 'role' | 'label' | 'placeholder' | 'text' | 'testid' | 'altText' | 'title';

/**
 * A serialisable description of how to find an element. Stored in the locator
 * cache as JSON and rebuilt into a real Playwright locator — which is why the
 * cache can replay a resolution without any model involvement.
 */
export interface LocatorSpec {
  strategy: Strategy;
  /** ARIA role, for strategy 'role'. */
  role?: string;
  /** Accessible name / label / text to match. */
  name?: string;
  /** Raw selector, for strategy 'css'. */
  selector?: string;
  exact?: boolean;
  /** Disambiguates when several elements match. */
  nth?: number;
}

type RoleName = Parameters<Page['getByRole']>[0];

export function buildLocator(root: LocatorRoot, spec: LocatorSpec): Locator {
  let locator: Locator;
  switch (spec.strategy) {
    case 'css':
      locator = root.locator(spec.selector ?? '');
      break;
    case 'role':
      locator = root.getByRole(spec.role as RoleName, spec.name ? { name: spec.name, exact: spec.exact } : {});
      break;
    case 'label':
      locator = root.getByLabel(spec.name ?? '', { exact: spec.exact });
      break;
    case 'placeholder':
      locator = root.getByPlaceholder(spec.name ?? '', { exact: spec.exact });
      break;
    case 'text':
      locator = root.getByText(spec.name ?? '', { exact: spec.exact });
      break;
    case 'testid':
      locator = root.getByTestId(spec.name ?? '');
      break;
    case 'altText':
      locator = root.getByAltText(spec.name ?? '', { exact: spec.exact });
      break;
    case 'title':
      locator = root.getByTitle(spec.name ?? '', { exact: spec.exact });
      break;
  }
  return spec.nth === undefined ? locator : locator.nth(spec.nth);
}

/** Human-readable form for reports and cache inspection. */
export function describeSpec(spec: LocatorSpec): string {
  const nth = spec.nth === undefined ? '' : ` [${spec.nth}]`;
  switch (spec.strategy) {
    case 'css': return `css=${spec.selector}${nth}`;
    case 'role': return `role=${spec.role}[name="${spec.name ?? ''}"]${nth}`;
    default: return `${spec.strategy}="${spec.name ?? ''}"${nth}`;
  }
}

/**
 * Roles worth trying for a given step, most specific first.
 *
 * This is the cost-saving half of the engine: `click "Save"` is a
 * `getByRole('button', { name: 'Save' })` and needs no model at all. The
 * planner is only reached when these deterministic guesses all miss.
 */
const ROLES_BY_ACTION: Partial<Record<ActionKind, string[]>> = {
  click: ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio'],
  fill: ['textbox', 'searchbox', 'combobox', 'spinbutton'],
  select: ['combobox', 'listbox'],
  toggle: ['switch', 'checkbox'],
  check: ['checkbox', 'radio'],
  hover: ['button', 'link', 'img'],
  drag: ['listitem', 'button'],
  upload: ['button'],
  wait: [],
  save: ['textbox', 'combobox'],
};

const ROLES_BY_ASSERTION: Partial<Record<AssertionKind, string[]>> = {
  value: ['textbox', 'combobox', 'spinbutton', 'checkbox', 'switch'],
  visible: [],
  hidden: [],
  text: [],
  count: ['listitem', 'row'],
};

export interface CandidateOptions {
  actionKind?: ActionKind;
  assertionKind?: AssertionKind;
}

/**
 * Ordered deterministic guesses for a plain-English target. Tried in order;
 * the first that resolves uniquely wins and is cached.
 */
export function candidateSpecs(label: string, opts: CandidateOptions = {}): LocatorSpec[] {
  const name = label.trim();
  if (!name) return [];

  const roles = opts.actionKind
    ? ROLES_BY_ACTION[opts.actionKind] ?? []
    : opts.assertionKind
      ? ROLES_BY_ASSERTION[opts.assertionKind] ?? []
      : [];

  const specs: LocatorSpec[] = [];

  // exact role matches first — the most robust and least ambiguous
  for (const role of roles) specs.push({ strategy: 'role', role, name, exact: true });
  // labelled form fields
  specs.push({ strategy: 'label', name, exact: true });
  specs.push({ strategy: 'placeholder', name, exact: true });
  // relax to substring matching
  for (const role of roles) specs.push({ strategy: 'role', role, name, exact: false });
  specs.push({ strategy: 'label', name, exact: false });
  specs.push({ strategy: 'testid', name });
  specs.push({ strategy: 'title', name, exact: false });
  specs.push({ strategy: 'altText', name, exact: false });
  // plain text last: matches the most, disambiguates the least
  specs.push({ strategy: 'text', name, exact: false });

  return specs;
}
