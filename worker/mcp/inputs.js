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

export function yesNo(args, name) {
  if (args[name] === undefined) return undefined;
  if (typeof args[name] !== 'boolean') throw new InputError(`${name} must be true or false`);
  return args[name];
}

export function dayOf(args, name) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (typeof args[name] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args[name])) throw new InputError(`${name} must be a date written year-month-day, such as 2027-01-15`);
  return args[name];
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
