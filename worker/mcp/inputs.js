// Small helpers every tool uses: checking what was asked for, and shaping a short row.
//
// In plain words: a tool is given inputs by an assistant, and an assistant can get them wrong (a
// date in the wrong form, a limit of a thousand). Each helper here reads one input and, when it is
// not usable, says so in a sentence the assistant can act on. The 340B tools (src/tools.js) and the
// health center tools (src/health-center-tools.js) share them, so the two groups behave alike.
//
// This file uses nothing that only one kind of computer has.

export const SITE = 'https://clinx.org';
export const LIMIT = { type: 'integer', minimum: 1, maximum: 100, description: 'How many to return (default 20).' };

/** A problem with what was asked for, said back to the asker as the tool's answer. */
export class InputError extends Error {}

export const text = (value) => String(value ?? '').toLowerCase();

export function clip(rows, limit) {
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 100)) throw new InputError('limit must be a whole number from 1 to 100');
  return rows.slice(0, limit ?? 20);
}

// ---- How much one answer may hold ---------------------------------------------------------------
//
// An assistant can take in only so much text at once, and the directories that list servers like
// this one turn away an answer that is too long. So every tool that gives a list keeps whole rows
// only while its answer stays within one size, the same size for every tool. A row is never cut in
// the middle and a value is never shortened: a row is in the answer whole, or it is left out and
// the answer says so, with how many rows it shows of how many there are and how to get the rest.
//
// The size is counted as the answer travels. An answer is written out as JSON and carried as one
// piece of text inside the reply, where every quotation mark and backslash takes a second
// character. That is the size counted here, so the whole reply is this and a few hundred more.

/** The most characters one answer may take up inside its reply. */
export const ANSWER_MOST = 60000;

/** The characters an answer takes up inside its reply. */
export const sizeOf = (answer) => JSON.stringify(JSON.stringify(answer)).length - 2;

/**
 * The answer with as many whole rows as fit. `rows` are the rows the tool would give, in their
 * order. `write` writes the whole answer from the rows that are kept, so that its counts and its
 * note are true to what is returned. Rows are left out from the end, never from the middle.
 * The first row is always kept: a list with rows to give never comes back empty, and where a tool
 * gives a long list in parts, the next part can always be asked for.
 */
export function fitRows(rows, write) {
  const whole = write(rows);
  if (rows.length < 2 || sizeOf(whole) <= ANSWER_MOST) return whole;
  // Too long with every row. Look for the largest number of rows that fits, halving the stretch
  // still in question each time, so a list of 200 rows is settled in about eight tries.
  let fits = 1;
  let low = 2;
  let high = rows.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (sizeOf(write(rows.slice(0, middle))) <= ANSWER_MOST) {
      fits = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return write(rows.slice(0, fits));
}

/**
 * The sentence a list carries when rows were left out for size, or nothing when none were.
 * `kept` are the rows returned, `asked` the rows the tool would have given, `matched` how many
 * fit the question in all, and `filters` names the inputs that narrow the list.
 */
export const leftOutForSize = (kept, asked, matched, filters) => (kept.length < asked.length
  ? `Showing ${kept.length} of ${matched}, as many whole rows as fit in one answer: narrow it with ${filters} to see the rest.`
  : '');

export function yesNo(args, name) {
  if (args[name] === undefined) return undefined;
  if (typeof args[name] !== 'boolean') throw new InputError(`${name} must be true or false`);
  return args[name];
}

// A value the asker typed is said back in a refusal so the asker can see what was wrong with it.
// A very long one is cut, so the refusal stays a sentence and not a page.
const ECHO_MOST = 80;
/** What the asker typed, for a refusal: as it is up to 80 characters, else its first 80 and an ellipsis. */
export function echo(value) {
  const letters = Array.from(String(value));
  return letters.length > ECHO_MOST ? `${letters.slice(0, ECHO_MOST).join('')}…` : letters.join('');
}

/** True when year-month-day names a day that exists: 2026-02-30 and 2026-13-45 do not. */
function onTheCalendar(day) {
  const [year, month, date] = day.split('-').map(Number);
  const made = new Date(0);
  made.setUTCFullYear(year, month - 1, date);
  return made.getUTCFullYear() === year && made.getUTCMonth() === month - 1 && made.getUTCDate() === date;
}

export function dayOf(args, name) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (typeof args[name] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args[name])) throw new InputError(`${name} must be a date written year-month-day, such as 2027-01-15`);
  if (!onTheCalendar(args[name])) throw new InputError(`${name} must be a day that exists: there is no ${args[name]} on the calendar. Write a date year-month-day, such as 2027-01-15`);
  return args[name];
}

/** An id the asker may give to narrow a list: text, or nothing. Anything that is not text is refused. */
export function idOf(args, name, example) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (typeof args[name] !== 'string') throw new InputError(`${name} must be text, such as ${example}`);
  return args[name].trim().toLowerCase() || undefined;
}

export function oneOf(args, name, allowed) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (!allowed.includes(args[name])) throw new InputError(`${name} must be one of: ${allowed.join(', ')}`);
  return args[name];
}

export function words(args) {
  if (args.text !== undefined && typeof args.text !== 'string') throw new InputError('text must be words to look for');
  return text(args.text).split(/\s+/).filter(Boolean);
}
export const holds = (haystack, needles) => needles.every((needle) => haystack.includes(needle));

// Short rows for lists. Empty fields are left out, so an answer carries only what there is to say.
export const said = (row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value !== undefined && value !== null));

export function freeText(args, name) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (typeof args[name] !== 'string') throw new InputError(`${name} must be text`);
  return args[name].trim().toLowerCase();
}

export function yearOf(args) {
  if (args.year === undefined || args.year === '') return undefined;
  const year = typeof args.year === 'string' && /^\d{4}$/.test(args.year.trim()) ? Number(args.year) : args.year;
  if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new InputError('year must be a four-digit year, such as 2025');
  return String(year);
}

/** A whole number input between two bounds, or the fallback when none was given. */
export function wholeNumber(args, name, low, high, fallback) {
  if (args[name] === undefined) return fallback;
  if (!Number.isInteger(args[name]) || args[name] < low || args[name] > high) throw new InputError(`${name} must be a whole number from ${low} to ${high}`);
  return args[name];
}

export const tally = (rows, key) => rows.reduce((all, row) => { const k = key(row); if (k !== undefined && k !== '') all[k] = (all[k] ?? 0) + 1; return all; }, {});
