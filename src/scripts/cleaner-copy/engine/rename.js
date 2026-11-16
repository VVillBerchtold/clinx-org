// Gives sheets new names, and says whether a name can be used.
//
// In plain words: a sheet's name is written once in the workbook's list of sheets and again in
// every formula, list, chart and link that points at the sheet (Claims!A1, 'Old Name'!A1). When a
// person renames a sheet, each of those has to follow, or the formulas break and the old name
// stays in the file.

/** A sentence saying why a sheet cannot have this name, or null when it can. */
export function nameProblem(name, others = []) {
  if (typeof name !== 'string' || name.trim() === '') return 'A sheet needs a name.';
  if (name.length > 31) return 'A sheet name can be at most 31 characters.';
  if (/[[\]:*?/\\]/.test(name)) return 'A sheet name cannot contain any of these: [ ] : * ? / \\';
  if (/[\u0000-\u001f]/.test(name)) return 'A sheet name cannot contain a tab or a line break.';
  if (name.startsWith("'") || name.endsWith("'")) return 'A sheet name cannot start or end with an apostrophe.';
  if (name.toLowerCase() === 'history') return 'Excel keeps the name History for its own use. Choose another name.';
  if (others.some((other) => other.toLowerCase() === name.toLowerCase())) return 'Another sheet already has this name. Each sheet needs its own.';
  return null;
}

// In a formula: a piece of text in quotation marks, an error such as #REF!, a sheet named in
// apostrophes, or a sheet named plainly (alone, or as the end of First:Last). A name that follows
// a ] belongs to another workbook and is left alone.
const NAME = '[\\p{L}\\p{N}_.]+';
const IN_FORMULA = new RegExp(`"(?:[^"]|"")*"|#[A-Z0-9/]+[!?]?|'((?:[^']|'')+)'(?=!)|(?<![\\p{L}\\p{N}_.\\]'#])(?:(${NAME}):)?(${NAME})(?=!)`, 'gu');
// Inside a piece of text (as INDIRECT("Claims!A1") has it), only where a cell or a name follows the "!", or nothing does.
const AFTER = '(?=!(?:[$\\p{L}_]|$))';
const IN_TEXT = new RegExp(`'((?:[^']|'')+)'${AFTER}|(?<![\\p{L}\\p{N}_.\\]'#])(?:(${NAME}):)?(${NAME})${AFTER}`, 'gu');

const quote = (name) => `'${name.replace(/'/g, "''")}'`;

/**
 * Makes the functions that carry out a renaming. `sheets` is every sheet's present name;
 * `rename` maps a present name to its new one. Names are matched without regard to capitals,
 * as the spreadsheet program does.
 */
export function sheetRenamer(sheets, rename = {}) {
  const present = new Set(sheets.map((name) => name.toLowerCase()));
  const to = new Map();
  for (const [from, next] of Object.entries(rename)) if (present.has(from.toLowerCase()) && typeof next === 'string' && next !== from) to.set(from.toLowerCase(), next);
  const one = (name) => to.get(name.toLowerCase());

  const point = (all, quoted, first, last) => {
    if (quoted !== undefined) {
      const inner = quoted.replace(/''/g, "'");
      if (/[[\]]/.test(inner)) return all; // a sheet of another workbook
      const names = inner.split(':');
      if (names.length > 2 || !names.some((name) => one(name) !== undefined)) return all;
      return quote(names.map((name) => one(name) ?? name).join(':'));
    }
    if (last === undefined) return all;
    // First:Last!A1 names a run of sheets only when both are sheets; otherwise the colon joins two cells (A1:Data!B2).
    if (first !== undefined && present.has(first.toLowerCase()) && present.has(last.toLowerCase())) {
      return one(first) === undefined && one(last) === undefined ? all : quote(`${one(first) ?? first}:${one(last) ?? last}`);
    }
    const next = one(last);
    return next === undefined ? all : `${first === undefined ? '' : `${first}:`}${quote(next)}`;
  };

  return {
    /** How many sheets get a new name. */
    size: to.size,
    /** The new name of a sheet, or undefined when it keeps its name. */
    one,
    /** A formula with every mention of a renamed sheet changed. */
    inFormula(formula) {
      if (!to.size || !formula.includes('!')) return formula;
      return formula.replace(IN_FORMULA, (all, quoted, first, last) => {
        if (all[0] === '"') {
          if (!all.includes('!')) return all;
          return `"${all.slice(1, -1).replace(/""/g, '"').replace(IN_TEXT, point).replace(/"/g, '""')}"`;
        }
        return point(all, quoted, first, last);
      });
    },
  };
}
