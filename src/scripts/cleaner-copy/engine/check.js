// Searches a finished copy for every text that was replaced, and says what each match is.
//
// In plain words: after the copy is made, the tool reads the copy through from end to end, looking
// for each original text it gave a stand-in. Most copies hold none. Where one is found, it is
// labelled: a randomized value that happens to equal a real one, a word that is also a sheet's name,
// a text already on the list for the person to look at, or, the kind that matters, a text the
// tool cannot account for.

import { PLACEHOLDERS } from './connections.js';
import { leftovers, partMeaning } from './workbook.js';
import { leftoversCsv } from './csv.js';

/** The check reads the whole copy into memory several times over, so it is not run on a file larger than this. */
export const CHECK_LIMIT = 20_000_000;

/** What a value looks like, said without saying the value. */
export function shape(value) {
  const long = value.length < 5 ? 'under 5 long' : value.length < 7 ? '5 or 6 long' : value.length < 11 ? '7 to 10 long' : value.length < 21 ? '11 to 20 long' : 'over 20 long';
  const kind = !/[\p{L}\p{N}]/u.test(value) ? 'punctuation or symbols only' : /^\d+$/.test(value) ? 'digits only' : /^[\d\s.,:/-]+$/.test(value) ? 'digits and punctuation' : /^[A-Za-z]+$/.test(value) ? 'one word, letters only' : /^[A-Za-z]+(\s+[A-Za-z]+)+$/.test(value) ? 'several plain words' : /\d/.test(value) ? 'letters and digits' : 'words with punctuation';
  return `${kind}, ${long}`;
}

/** The pattern of a short value: A for a capital, a for a small letter, 9 for a digit, other marks as they are. Never the value. */
export function pattern(value) {
  if (value.length > 12) return 'longer than 12';
  return [...value].map((ch) => (/\p{Lu}/u.test(ch) ? 'A' : /\p{L}/u.test(ch) ? 'a' : /\p{N}/u.test(ch) ? '9' : ch === ' ' ? '_' : ch)).join('');
}

/**
 * Says what each value found again in the copy turns out to be.
 *
 * `names` are the names the copy's sheets have; `oldNames` the names renamed sheets used to have.
 * An old name is never explained away as "a name the copy keeps": it was meant to go.
 */
export function sortOut(left, report, { names = report.sheets.map((sheet) => sheet.name), oldNames = [] } = {}) {
  const flagged = report.forALook.map((f) => f.text);
  const gone = new Set(oldNames);
  return left.map((l) => {
    const old = gone.has(l.value);
    let kind = 'unexplained';
    if (!/[\p{L}\p{N}]/u.test(l.value)) kind = 'symbols';
    else if (/^(customXml\/|docProps\/custom\.xml$|xl\/printerSettings\/)/.test(l.part)) kind = 'untouched';
    else if (names.some((name) => name.includes(l.value))) kind = 'name';
    else if (!old && / codeName on </.test(l.sits ?? '')) kind = 'name';
    // In a saved connection: the text of its query is listed for the person to read, and a placeholder
    // ("server", "database") that happens to be a cell's value too is a match by chance.
    else if (l.part === 'xl/connections.xml' && /^the setting (?:command|serverCommand) on </.test(l.sits ?? '')) kind = 'listed';
    else if (l.part === 'xl/connections.xml' && PLACEHOLDERS.some((placeholder) => placeholder.includes(l.value))) kind = 'chance';
    else if (/^xl\/(?:worksheets|charts|drawings|tables)\//.test(l.part) && flagged.some((text) => text.includes(l.value))) kind = 'listed';
    else if (!old && /^(xl\/theme\/|xl\/styles\.xml$|xl\/workbook\.xml$|docProps\/app\.xml$)/.test(l.part)) kind = 'name';
    else if (l.how === 'whole' && l.madeUp) kind = 'chance';
    else if (l.how === 'inside' && /^[\d\s.,:/-]+$/.test(l.value)) kind = 'digits';
    return { ...l, kind };
  });
}

/**
 * Runs the check on a finished copy. `result` is what the copy's maker gave back; `kind` is
 * "workbook" or "csv"; `size` is the size of the file the person gave.
 */
export async function checkCopy(result, kind, size) {
  if (size > CHECK_LIMIT) return { ran: false, searched: 0, items: [] };
  const csv = kind === 'csv';
  const headings = new Set(result.kept);
  // Not searched for: headings (kept on purpose), words that are part of a heading, the values of
  // columns the person left alone, and dates written as text (a randomized date can equal a real one).
  const stays = (value) => headings.has(value) || result.keptByChoice.has(value) || result.kept.some((heading) => heading.includes(value)) || /^\d{4}-\d{2}-\d{2}/.test(value);
  const oldNames = result.oldNames.filter((name) => !stays(name));
  const wanted = [...new Set([...result.originals, ...oldNames])].filter((value) => !stays(value));
  const options = { madeUp: result.madeUp, kept: result.keptByChoice };
  const found = await (csv ? leftoversCsv : leftovers)(result.bytes, wanted, options);
  let searched = wanted.filter((value) => value.trim().length >= 5).length;

  // A short old sheet name is looked for too: as the whole of something, and where a formula would point at it.
  const short = oldNames.filter((name) => name.trim().length < 5);
  if (short.length && !csv) {
    const pointers = new Map(short.flatMap((name) => [[`${name}!`, name], [`${name.replace(/'/g, "''")}'!`, name]]));
    const more = await leftovers(result.bytes, [...pointers.keys()], { ...options, shortest: Math.min(...[...pointers.keys()].map((pointer) => pointer.length)), exact: short });
    const seen = new Set();
    for (const item of more) {
      const value = pointers.get(item.value) ?? item.value;
      const how = pointers.has(item.value) ? 'inside' : item.how;
      const key = `${value}|${item.part}|${item.sits}|${how}`;
      if (!seen.has(key)) found.push({ ...item, value, how, madeUp: false });
      seen.add(key);
    }
    searched += short.length;
  }

  const sorted = sortOut(found, result.report, { names: csv ? [] : result.names, oldNames: result.oldNames });
  return {
    ran: true,
    searched,
    items: sorted.map((l) => ({ value: l.value, part: l.part, where: partMeaning(l.part), sits: l.sits ?? '', how: l.how, kind: l.kind, shape: shape(l.value), pattern: pattern(l.value) })),
  };
}
