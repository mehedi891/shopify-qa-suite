import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ActionKind, AssertionKind } from '../types.js';
import type { LocatorSpec } from './locator.js';

export interface PlanRequest {
  /** The whole step as QA wrote it, for intent. */
  stepRaw: string;
  /** The target label extracted from the step. */
  label: string;
  actionKind?: ActionKind;
  assertionKind?: AssertionKind;
  /** Which frame this snapshot came from, so the model knows the context. */
  frameName: string;
  /** Playwright ARIA snapshot of the frame — a compact accessibility tree. */
  snapshot: string;
}

export interface Planner {
  readonly name: string;
  plan(req: PlanRequest): Promise<LocatorSpec | null>;
  /** Calls made so far, for budget reporting. */
  readonly calls: number;
}

/** Used offline, in unit tests, and whenever no API key is configured. */
export class NullPlanner implements Planner {
  readonly name = 'null';
  readonly calls = 0;
  async plan(): Promise<LocatorSpec | null> {
    return null;
  }
}

export class PlannerBudgetError extends Error {}

const SpecSchema = z.object({
  strategy: z.enum(['css', 'role', 'label', 'placeholder', 'text', 'testid', 'altText', 'title'])
    .describe('How to find the element. Prefer "role" — it is the most robust.'),
  role: z.string().nullable()
    .describe('ARIA role when strategy is "role", e.g. button, textbox, switch, link.'),
  name: z.string().nullable()
    .describe('Accessible name, label, placeholder or text to match. Null only for strategy "css".'),
  selector: z.string().nullable()
    .describe('CSS selector when strategy is "css". Use only as a last resort.'),
  exact: z.boolean().describe('Whether the name must match exactly.'),
  nth: z.number().int().nullable()
    .describe('Zero-based index when several elements legitimately match; null otherwise.'),
  confident: z.boolean()
    .describe('False if the snapshot contains no element plausibly matching the step.'),
});

const SYSTEM = `You locate a single UI element in a web page for a browser automation suite testing a Shopify app.

You receive:
- a test step written in plain English by a QA engineer
- the element label they referred to
- an ARIA accessibility snapshot of the frame currently in view

Return one locator that identifies exactly that element.

Rules:
- Prefer strategy "role" with the element's accessible name. It survives styling and markup changes.
- Use "label" or "placeholder" for form fields whose accessible name comes from a label.
- Use "text" only when nothing else identifies the element.
- Use "css" only as a last resort, and never with a generated or hashed class name.
- Set exact=true when the name in the snapshot matches the label exactly; false for a partial match.
- Set nth only when several elements genuinely match and position is the only way to choose.
- If nothing in the snapshot plausibly matches, set confident=false. Do not invent a locator.`;

export interface ClaudePlannerOptions {
  apiKey: string;
  model?: string;
  maxCalls?: number;
}

/**
 * Resolves a step to a locator by reading the page's accessibility tree.
 *
 * Only reached on a cache miss — see LocatorCache. Every successful plan is
 * cached, so a step costs at most one call for the life of its text.
 */
export class ClaudePlanner implements Planner {
  readonly name: string;
  private client: Anthropic;
  private model: string;
  private maxCalls: number;
  private _calls = 0;

  constructor(opts: ClaudePlannerOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? 'claude-opus-5';
    this.maxCalls = opts.maxCalls ?? 100;
    this.name = `claude:${this.model}`;
  }

  get calls(): number { return this._calls; }

  async plan(req: PlanRequest): Promise<LocatorSpec | null> {
    if (this._calls >= this.maxCalls) {
      throw new PlannerBudgetError(
        `Planner budget exhausted (${this.maxCalls} calls). This usually means many cached ` +
        `locators stopped matching — check whether the UI changed, then rerun to rebuild the cache. ` +
        `Raise planner.maxCallsPerRun in qa.config.ts if the budget is simply too low.`,
      );
    }
    this._calls++;

    const intent = req.actionKind
      ? `action: ${req.actionKind}`
      : `assertion: ${req.assertionKind ?? 'unknown'}`;

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4000,
        system: SYSTEM,
        output_config: {
          effort: 'low', // mechanical extraction; low effort is both enough and cheap
          format: zodOutputFormat(SpecSchema),
        },
        messages: [{
          role: 'user',
          content:
            `Step: ${req.stepRaw}\n` +
            `Target label: ${req.label}\n` +
            `Intent: ${intent}\n` +
            `Frame: ${req.frameName}\n\n` +
            `ARIA snapshot:\n${req.snapshot}`,
        }],
      });

      const parsed = response.parsed_output;
      if (!parsed || !parsed.confident) return null;

      const spec: LocatorSpec = { strategy: parsed.strategy, exact: parsed.exact };
      if (parsed.role) spec.role = parsed.role;
      if (parsed.name) spec.name = parsed.name;
      if (parsed.selector) spec.selector = parsed.selector;
      if (parsed.nth !== null) spec.nth = parsed.nth;

      // a spec that names nothing findable is worse than admitting defeat
      if (spec.strategy === 'css' ? !spec.selector : !spec.name) return null;
      return spec;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new Error('ANTHROPIC_API_KEY is invalid or expired. See docs/SETUP.md §4.');
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new Error('Anthropic rate limit hit while planning a locator. Retry the run shortly.');
      }
      if (err instanceof Anthropic.APIError) {
        throw new Error(`Planner request failed (${err.status}): ${err.message}`);
      }
      throw err;
    }
  }
}

/** Build the configured planner, falling back to offline mode without a key. */
export function createPlanner(apiKey: string | undefined, model: string, maxCalls: number): Planner {
  if (!apiKey) return new NullPlanner();
  return new ClaudePlanner({ apiKey, model, maxCalls });
}
