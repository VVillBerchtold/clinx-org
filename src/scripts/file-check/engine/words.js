// The small pieces every sentence of a finding is built from, and the findings as plain text.
//
// In plain words: a finding's sentences are put together here from counts, places and headings
// only. No function in this file is ever handed a cell's value, so none can end up in a sentence.

/** A count as a person writes it: 1,204. */
export const n = (count) => count.toLocaleString('en-US');

/** A count with its word, singular or plural: "1 cell", "2 cells". */
export const plural = (count, one, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
export const list = (items, last = 'and') => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`);

/** The places of a finding, for the end of its sentence: "F14, F20 and 12 more". */
export const places = (where, count) => (count > where.length ? `${where.join(', ')} and ${n(count - where.length)} more` : list(where));

/** A heading as it is shown in a sentence: cut short when it is longer than 40 characters, at the end of a word when there is one. */
export const short = (heading) => {
  if (heading.length <= 40) return heading;
  const cut = heading.slice(0, 39);
  const space = heading[39] === ' ' ? 39 : cut.lastIndexOf(' ');
  return `${(space >= 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

const WEIGHTS = [
  ['fix', 'To fix', 'to fix'],
  ['look', 'Worth a look', 'worth a look'],
  ['note', 'Good to know', 'good to know'],
];

/**
 * The findings as plain text for pasting into a chat. It holds counts, places, headings and sheet
 * names, and no value from a cell: it is built from each finding's `say` and `fix` alone.
 */
export function asText(report) {
  const what = report.kind === 'csv' ? 'a CSV file' : `a workbook with ${plural(report.sheets.length, 'sheet')}`;
  const lines = [];
  for (const sheet of report.sheets) {
    const headings = sheet.headingRow ? `headings in row ${n(sheet.headingRow)}` : 'no row of headings found';
    const size = sheet.rows === 0 && sheet.columns === 0 ? 'empty' : `${plural(sheet.rows, 'row')} of data, ${plural(sheet.columns, 'column')}, ${headings}`;
    lines.push(report.kind === 'csv' ? `The file: ${size}.` : `Sheet "${sheet.name}"${sheet.hidden ? ' (hidden)' : ''}: ${size}.`);
  }
  if (report.findings.length === 0) return [`File check of ${what}.`, ...lines, '', 'This check found nothing that would trip up a script or a pivot table.'].join('\n');
  const counts = WEIGHTS.map(([weight, , words]) => [report.findings.filter((finding) => finding.weight === weight).length, words]).filter(([count]) => count > 0);
  const out = [`File check of ${what}: ${list(counts.map(([count, words]) => `${n(count)} ${words}`))}.`, ...lines];
  const named = report.kind === 'workbook' && report.sheets.length > 1;
  for (const [weight, title] of WEIGHTS) {
    const group = report.findings.filter((finding) => finding.weight === weight);
    if (group.length === 0) continue;
    out.push('', `${title}:`);
    group.forEach((finding, at) => {
      out.push(`${at + 1}. ${named ? `${finding.sheet}: ` : ''}${finding.say}`, `   What to do: ${finding.fix}`);
    });
  }
  return out.join('\n');
}
