import { google, type sheets_v4 } from 'googleapis';
import type { ParsedSheet } from '../types.js';
import type { ResultRow, WritableTestCaseSource } from './TestCaseSource.js';
import { COLUMNS, mapHeaders, rowsToTestCases } from './rows.js';

export interface SheetsSourceOptions {
  spreadsheetId: string;
  tab: string;
  /** Whole service-account JSON, or undefined to use GOOGLE_APPLICATION_CREDENTIALS. */
  serviceAccountJson?: string;
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Column index → A1 letter (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export class SheetsSource implements WritableTestCaseSource {
  readonly name: string;
  private api?: sheets_v4.Sheets;
  private headerRow: string[] = [];

  constructor(private readonly opts: SheetsSourceOptions) {
    this.name = `sheet:${opts.spreadsheetId}/${opts.tab}`;
  }

  private async client(): Promise<sheets_v4.Sheets> {
    if (this.api) return this.api;
    const auth = this.opts.serviceAccountJson
      ? new google.auth.GoogleAuth({ credentials: JSON.parse(this.opts.serviceAccountJson), scopes: SCOPES })
      : new google.auth.GoogleAuth({ scopes: SCOPES });
    this.api = google.sheets({ version: 'v4', auth: await auth.getClient() as never });
    return this.api;
  }

  async load(): Promise<ParsedSheet> {
    const api = await this.client();
    let res;
    try {
      res = await api.spreadsheets.values.get({
        spreadsheetId: this.opts.spreadsheetId,
        range: `${this.opts.tab}!A:Z`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
    } catch (err) {
      throw new Error(explainSheetsError(err, this.opts));
    }
    const rows = (res.data.values ?? []) as string[][];
    if (rows.length === 0) {
      return { cases: [], issues: [{ testCaseId: '-', rowIndex: 1, column: '-', severity: 'error', message: `Tab "${this.opts.tab}" is empty.` }] };
    }
    this.headerRow = rows[0]!.map(String);
    return rowsToTestCases(this.headerRow, rows.slice(1));
  }

  /** Write the tool-owned result columns back to each case's own row. */
  async writeResults(results: ResultRow[]): Promise<void> {
    if (results.length === 0) return;
    const api = await this.client();
    const headers = mapHeaders(this.headerRow);
    const col = (name: string) => headers.get(name.trim().toLowerCase().replace(/\s+/g, ' '));

    type Candidate = { col: number | undefined; pick: (r: ResultRow) => string | number };
    const candidates: Candidate[] = [
      { col: col(COLUMNS.status), pick: (r) => r.status },
      { col: col(COLUMNS.lastRun), pick: (r) => r.lastRun },
      { col: col(COLUMNS.duration), pick: (r) => r.durationSeconds },
      { col: col(COLUMNS.failureReason), pick: (r) => r.failureReason },
      { col: col(COLUMNS.artifacts), pick: (r) => r.artifacts },
    ];
    // a sheet missing some result columns still gets the ones it has
    const targets = candidates.filter(
      (t): t is Candidate & { col: number } => t.col !== undefined,
    );

    if (targets.length === 0) {
      throw new Error(
        `The sheet has no result columns (${COLUMNS.status}, ${COLUMNS.lastRun}, …). ` +
        `Add them to the header row so results can be written back.`,
      );
    }

    const data = results.flatMap((r) =>
      targets.map((t) => ({
        range: `${this.opts.tab}!${columnLetter(t.col)}${r.rowIndex}`,
        values: [[t.pick(r)]],
      })),
    );

    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: this.opts.spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
}

/** Turn Google's opaque errors into the thing the user actually needs to do. */
function explainSheetsError(err: unknown, opts: SheetsSourceOptions): string {
  const e = err as { code?: number; message?: string };
  const base = `Could not read ${opts.spreadsheetId} (tab "${opts.tab}")`;
  if (e.code === 404) {
    return `${base}: not found. Check QA_SHEET_ID, and that the sheet is shared with the service account email as Editor.`;
  }
  if (e.code === 403) {
    return `${base}: permission denied. Share the sheet with your service account email (the client_email in the JSON key) as Editor.`;
  }
  if (e.message?.includes('Unable to parse range')) {
    return `${base}: no tab named "${opts.tab}". Check QA_SHEET_TAB matches the tab name exactly.`;
  }
  return `${base}: ${e.message ?? String(err)}`;
}
