import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Per-run artifact directory: artifacts/<runId>/<caseId>/… */
export class Artifacts {
  readonly runDir: string;

  constructor(readonly root: string, readonly runId: string) {
    this.runDir = join(root, runId);
    mkdirSync(this.runDir, { recursive: true });
  }

  caseDir(testCaseId: string): string {
    const dir = join(this.runDir, safe(testCaseId));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  stepScreenshot(testCaseId: string, stepIndex: number, status: string): string {
    return join(this.caseDir(testCaseId), `step-${String(stepIndex).padStart(2, '0')}-${status}.png`);
  }

  trace(testCaseId: string, attempt: number): string {
    return join(this.caseDir(testCaseId), `trace-attempt-${attempt}.zip`);
  }

  get reportPath(): string { return join(this.runDir, 'report.html'); }
  get statePath(): string { return join(this.root, 'last-run.json'); }
}

export function newRunId(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
