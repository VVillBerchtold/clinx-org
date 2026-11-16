// Cutting the filed reports file into an index and one small file for each report.
//
// In plain words: the file of filed reports holds every line of every report and is now far too
// big for a small web host to read whole (24 MB). The same facts are cut in two. The index lists
// each report with its filer, its dates, its file and the numbers about it, but none of its
// lines. Each report then has a small file of its own, holding that report's lines and its
// discrepancies. The server reads the index once an hour and a report's file only when someone
// asks for that report. clinx.org writes these files from the same dataset when it is built,
// by calling the function below, so the server and the site cannot disagree about the cut.
//
// Nothing here changes a figure. A claim count of 1 to 5 never passes this file, whatever the
// file it reads says: it is removed and the row is marked as withheld.
//
// This file uses nothing that only one kind of computer has.

/** A cell with nothing in it is left out. Nothing else about a cell is changed. */
const filled = (row, leave = []) => {
  const kept = {};
  for (const [key, value] of Object.entries(row)) {
    if (leave.includes(key) || value === '' || value === undefined || value === null) continue;
    kept[key] = value;
  }
  return kept;
};

/** The claim counts that the published files leave out are 1 to 5. A whole number in that range is never held. */
const isSmallCount = (value) => /^\s*[1-5]\s*$/.test(String(value ?? '').replace(/,/g, ''));

/**
 * One line of a report, as it is kept and given out. A claim count of 1 to 5 never gets past
 * this point, whatever the file says. Where a row is marked withheld and carries its figure in
 * the amount (a count, or a percentage, on a form that has no claims column), the amount goes
 * too: a row marked withheld has no figure to give.
 */
function keepLine(row) {
  const line = filled(row, ['filing_id']);
  const small = line.claims !== undefined && isSmallCount(line.claims);
  if (line.claims_withheld !== undefined || small) {
    delete line.claims;
    delete line.claims_as_filed;
    line.claims_withheld ??= 'fewer_than_6';
    if (line.unit === 'count' || line.unit === 'percent') {
      delete line.amount;
      delete line.amount_as_filed;
    }
  } else if (line.claims_as_filed !== undefined && isSmallCount(line.claims_as_filed)) {
    delete line.claims;
    delete line.claims_as_filed;
    line.claims_withheld = 'fewer_than_6';
  }
  return line;
}

const groupBy = (rows, keep) => {
  const groups = new Map();
  for (const row of rows) {
    const id = row.filing_id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(keep(row));
  }
  return groups;
};

/**
 * Cut the parsed filed reports file in two. Returns `{ index, reports }`.
 *
 * `index` has the dataset version and licence and, for each report in the file's order, the
 * record itself, its entity, the number of its lines, the number of its discrepancies, its
 * calculated measures and its attached documents. It has none of the lines.
 *
 * `reports` maps a filing_id to `{ filing_id, dataset_version, lines, discrepancies }`: that
 * report's lines in the file's order, and its discrepancies.
 *
 * Throws when the file is not the filed reports file at all.
 */
export function split(file) {
  if (file === null || typeof file !== 'object' || !Array.isArray(file.filings) || !Array.isArray(file.entities) || !Array.isArray(file.line_items)) {
    throw new Error('the filed reports file is not in the shape expected');
  }
  const version = file.dataset_version ?? '';
  const entities = new Map(file.entities.map((entity) => [entity.entity_id, filled(entity)]));
  const lines = groupBy(file.line_items, keepLine);
  const discrepancies = groupBy(file.discrepancies ?? [], (row) => filled(row, ['filing_id']));
  const measures = groupBy(file.measures ?? [], (row) => filled(row, ['filing_id']));
  const attachments = groupBy(file.attachments ?? [], (row) => filled(row, ['filing_id']));

  const reports = {};
  const filings = file.filings.map((row) => {
    const own = lines.get(row.filing_id) ?? [];
    const differences = discrepancies.get(row.filing_id) ?? [];
    reports[row.filing_id] = { filing_id: row.filing_id, dataset_version: version, lines: own, discrepancies: differences };
    return {
      ...filled(row),
      entity: entities.get(row.entity_id) ?? { entity_id: row.entity_id, state: row.state },
      line_count: own.length,
      discrepancy_count: differences.length,
      measures: measures.get(row.filing_id) ?? [],
      attachments: attachments.get(row.filing_id) ?? [],
    };
  });
  return {
    index: { dataset_version: version, license: file.license ?? 'CC-BY-4.0', filings },
    reports,
  };
}

/**
 * A report's file, as read from anywhere, made safe to give out: every line goes through the
 * same rule as in `split`. Returns `{ lines, discrepancies }`. Throws when the file is not a
 * report's file.
 */
export function readReport(file) {
  if (file === null || typeof file !== 'object' || !Array.isArray(file.lines) || !Array.isArray(file.discrepancies ?? [])) {
    throw new Error('a report\'s file is not in the shape expected');
  }
  return { lines: file.lines.map(keepLine), discrepancies: file.discrepancies ?? [] };
}
