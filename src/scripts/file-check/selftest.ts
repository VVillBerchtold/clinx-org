// The tool's test of itself. Before it reads a person's file, the page asks the worker to check
// the sample report that is built into the tool, and compares what comes back with the answer
// written here. A copy of the tool that has been changed or damaged gives another answer, and the
// page then stops before it reads anything.
import type { CheckReport } from './engine/index.js';

/** One line for a report: the sheets and rows it read, and how many times it found each thing. */
export function answerOf(report: CheckReport): string {
  const found = new Map<string, number>();
  for (const finding of report.findings) found.set(finding.rule, (found.get(finding.rule) ?? 0) + 1);
  const rows = report.sheets.reduce((sum, sheet) => sum + sheet.rows, 0);
  const things = [...found].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rule, count]) => `${rule} ${count}`);
  return [`sheets ${report.sheets.length}`, `rows ${rows}`, ...things].join(', ');
}

/** What the built-in sample report must give. A test holds this line to what the check really finds. */
export const SAMPLE_ANSWER =
  'sheets 2, rows 49, blank-rows 1, empty-heading 1, error-cells 1, leading-zeros 1, merged-cells 1, mixed-dates 2, mixed-kinds 1, near-duplicates 1, number-as-text 1, repeated-heading 1, repeated-id 1, stray-spaces 1, total-row 1';
