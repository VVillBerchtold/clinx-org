// The Cleaner Copy engine, as the page uses it.
//
// In plain words: a person gives a workbook or a CSV file. `inspect` only reports what is in it.
// `makeCopy` writes a copy with randomized stand-in values in every column the person did not ask to
// leave alone, then searches that copy for every text it replaced. Both kinds of file go through
// the same two functions and give the same kind of report. Everything happens on the person's own
// machine: nothing in this folder can make a connection, and nothing is kept once the page closes.
// No list of which stand-in replaced which original is kept or given back. There is one exception: for a
// column the person asked to have coded, the legend (which code is which original) is given back for the
// person to save for their own use. It is never written into the copy.

import { checkCopy } from './check.js';
import { legendWorkbook } from './code.js';
import { standInCsv } from './csv.js';
import { nameProblem } from './rename.js';
import { FIXTURE } from './sample.js';
import { standInWorkbook } from './workbook.js';
import { kindOf } from './kind.js';

/** Looks only. Changes nothing, and gives back only the report. */
export async function inspect(bytes, kind) {
  const { report } = await (kind === 'csv' ? standInCsv : standInWorkbook)(bytes, { only: 'report' });
  return report;
}

/**
 * Makes the copy, then searches it for every text that was replaced.
 * Gives back the copy, the report, the check with each match labelled, what the copy looks like, and
 * the legend of any columns the person asked to have coded (an empty list when there are none).
 */
export async function makeCopy(bytes, kind, choices = {}) {
  const { keep = {}, code = {}, rename = {}, swapText = [], dropExtras = true } = choices ?? {};
  const result = kind === 'csv' ? await standInCsv(bytes, { keep, code }) : await standInWorkbook(bytes, { keep, code, rename, swapText, dropExtras });
  const check = await checkCopy(result, kind, bytes.length);
  return { bytes: result.bytes, report: result.report, check, described: result.described, legend: result.legend };
}

export { kindOf, legendWorkbook, nameProblem };

/** The sample clinic report that the page offers for a first try. */
export const SAMPLE_NAME = 'sample-clinic-report.xlsx';
export function sampleBytes() {
  return Uint8Array.from(atob(FIXTURE), (c) => c.charCodeAt(0));
}
