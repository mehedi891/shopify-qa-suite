import type { Dialog, Page } from 'playwright';

/**
 * Native browser dialogs (`confirm`, `alert`, `prompt`) block the page until
 * answered, so a handler must be installed before the action that triggers one.
 *
 * Default policy is accept, so flows proceed. `dismiss the dialog` sets the
 * policy for the *next* dialog and must therefore be written before the step
 * that triggers it; `accept the dialog` after the fact asserts one was seen.
 */
export class DialogController {
  private nextPolicy: 'accept' | 'dismiss' | null = null;
  private seen: string[] = [];

  attach(page: Page): void {
    page.on('dialog', async (dialog: Dialog) => {
      this.seen.push(dialog.message());
      const policy = this.nextPolicy ?? 'accept';
      this.nextPolicy = null;
      try {
        if (policy === 'accept') await dialog.accept();
        else await dialog.dismiss();
      } catch {
        // already handled or the page navigated away — nothing to do
      }
    });
  }

  /** `dismiss the dialog` — applies to the next dialog that appears. */
  expectDismiss(): void { this.nextPolicy = 'dismiss'; }
  expectAccept(): void { this.nextPolicy = 'accept'; }

  /** Consume the record of dialogs seen since the last check. */
  takeSeen(): string[] {
    const seen = this.seen;
    this.seen = [];
    return seen;
  }

  reset(): void { this.nextPolicy = null; this.seen = []; }
}
