// The shapes of the two pieces that cut the filed reports file in two (see split.js).

export interface FilingsIndex {
  dataset_version: string;
  license: string;
  filings: Array<Record<string, unknown> & { filing_id: string; entity: Record<string, string>; line_count: number; discrepancy_count: number; measures: Array<Record<string, string>>; attachments: Array<Record<string, string>> }>;
}

export interface ReportFile {
  filing_id: string;
  dataset_version: string;
  lines: Array<Record<string, string>>;
  discrepancies: Array<Record<string, string>>;
}

/** Cut the parsed filed reports file into an index and one small document for each report. */
export declare function split(file: unknown): { index: FilingsIndex; reports: Record<string, ReportFile> };

/** A report's file made safe to give out: every line goes through the small-count rule. */
export declare function readReport(file: unknown): { lines: Array<Record<string, string>>; discrepancies: Array<Record<string, string>> };
