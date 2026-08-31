/** Which browser context a step executes in. */
export type SurfaceName = 'admin' | 'storefront';

/** Which frame within the admin a step targets. `auto` lets the resolver decide. */
export type FrameHint = 'auto' | 'app' | 'host';

export type ActionKind =
  | 'open'        // open the embedded app
  | 'goto'        // navigate to a url / named page
  | 'click'
  | 'fill'
  | 'select'
  | 'toggle'      // turn on / turn off
  | 'check'       // check / uncheck
  | 'upload'
  | 'hover'
  | 'press'
  | 'drag'
  | 'reload'
  | 'wait'        // wait for something visible
  | 'switch'      // switch surface
  | 'save'        // save a value into the variable bag
  | 'dialog';     // accept / dismiss a native dialog

export type AssertionKind =
  | 'visible'
  | 'hidden'
  | 'text'        // element/page contains text
  | 'value'       // input value equals
  | 'count'       // n items
  | 'url'         // url contains/matches
  | 'toast'
  | 'clipboard';

/**
 * A target is what a step acts on. `explicit` selectors bypass the planner
 * entirely; `describe` targets are resolved from the page at run time and cached.
 */
export interface Target {
  /** Raw text the author wrote, e.g. `"Banner text"` or `[data-test=save]`. */
  raw: string;
  /** true when the author wrote a CSS selector rather than a label. */
  explicit: boolean;
  frame: FrameHint;
}

export interface Action {
  kind: ActionKind;
  target?: Target;
  /** Literal or `{variable}` value: fill/select/press/upload/save-as. */
  value?: string;
  /** For `switch`. */
  surface?: SurfaceName;
  /** For `save … as <name>`. */
  variableName?: string;
  /** For `toggle`/`check`: the desired end state. */
  state?: boolean;
}

export interface Assertion {
  kind: AssertionKind;
  target?: Target;
  expected?: string;
  /** `expect ... to be hidden` and friends. */
  negated: boolean;
  count?: number;
}

export interface Step {
  index: number;
  /** Exactly what QA typed, preserved for reports and cache keys. */
  raw: string;
  kind: 'action' | 'assertion';
  surface: SurfaceName;
  action?: Action;
  assertion?: Assertion;
  /** Which sheet column this line came from, for error messages. */
  origin: 'steps' | 'expected' | 'teardown' | 'precondition';
}

export interface TestCase {
  id: string;
  title: string;
  suite: string;
  tags: string[];
  surface: SurfaceName;
  precondition: Step[];
  steps: Step[];
  expected: Step[];
  teardown: Step[];
  enabled: boolean;
  /** 1-based row in the sheet, used to write results back. */
  rowIndex: number;
}

export interface ParseIssue {
  testCaseId: string;
  rowIndex: number;
  column: string;
  line?: number;
  message: string;
  /** `error` blocks the run; `warning` does not. */
  severity: 'error' | 'warning';
}

export interface ParsedSheet {
  cases: TestCase[];
  issues: ParseIssue[];
}

export type StepStatus = 'passed' | 'failed' | 'skipped';
export type LocatorSource = 'explicit' | 'cache' | 'planned' | 'healed';

export interface StepResult {
  step: Step;
  status: StepStatus;
  durationMs: number;
  locatorSource?: LocatorSource;
  resolvedLocator?: string;
  screenshot?: string;
  error?: string;
}

export interface TestResult {
  testCase: TestCase;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number;
  steps: StepResult[];
  failedStepIndex?: number;
  error?: string;
  attempts: number;
}
