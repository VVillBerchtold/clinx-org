// The File Check engine, as the page uses it.
//
// In plain words: a person gives a workbook or a CSV file, and `checkFile` says what in it will
// trip up a script or a pivot table, and where. It only looks. Nothing in the file is changed,
// no copy is made, and nothing in this folder can make a connection: the work happens on the
// person's own machine and nothing is kept once the page closes.
//
// The file is opened with the Cleaner Copy engine's own reader (its zip reader, its patterns for
// a workbook's parts, and `kindOf`, which tells a workbook from a CSV file and refuses the rest).
// Only those small files are loaded. The rest of that engine, and its sample report, are not.

import { kindOf } from '../../cleaner-copy/engine/kind.js';
import { readCsv } from './read-csv.js';
import { readWorkbook } from './read-workbook.js';
import { checkGrid, ruleRank } from './rules.js';
import { asText } from './words.js';

const WEIGHT_RANK = { fix: 0, look: 1, note: 2 };

/**
 * Looks through a file and gives back what was found. `kind` is what `kindOf` said the file is.
 * A file that is not a workbook or a CSV file is refused with the sentence `kindOf` gives for it.
 */
export async function checkFile(bytes, kind) {
  const told = kindOf('', bytes);
  if ('problem' in told) throw new Error(told.problem);
  const grids = kind === 'csv' ? readCsv(bytes) : await readWorkbook(bytes);
  const sheets = [];
  const found = [];
  grids.forEach((grid, at) => {
    const { info, findings } = checkGrid(grid);
    sheets.push(info);
    for (const finding of findings) found.push({ finding, at });
  });
  // To fix first, then worth a look, then good to know; within each, in the order of the sheets, then of the columns.
  found.sort((a, b) => WEIGHT_RANK[a.finding.weight] - WEIGHT_RANK[b.finding.weight] || a.at - b.at || a.finding.order - b.finding.order || ruleRank(a.finding.rule) - ruleRank(b.finding.rule));
  const findings = found.map(({ finding }) => {
    const { order, ...rest } = finding;
    return rest;
  });
  return { kind, sheets, findings };
}

export { asText, kindOf };
