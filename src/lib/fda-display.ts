/**
 * How the FDA directory's text is drawn on a page.
 *
 * The directory is typed by many firms, each in its own way: one name in capitals, the next in
 * small letters, strengths written ".5 mg/1". On a page that reads as careless, so the text is
 * drawn one way throughout. Only the drawing changes. The reference file and the download keep
 * every field exactly as the directory lists it, and nothing here is used for a filer's own words
 * or for a filed number.
 *
 * Each rule is narrow on purpose. A name the firm wrote in mixed capitals ("NovoLOG", "KwikPen")
 * is the firm's choice and is left alone; a strength this file cannot read is shown as listed.
 */

/** Short words that stay in capitals inside a name: dose-form marks and kinds of company. */
const KEEP_CAPITALS = new Set(['HFA', 'XR', 'ER', 'XL', 'SR', 'DS', 'LA', 'ODT', 'PFS', 'LAR', 'HCT', 'ORS', 'USA', 'US', 'LLC', 'LP', 'LLP', 'PLC']);
const ROMAN = /^(?:II|III|IV|VI|VII|VIII|IX|XI|XII|XIII)$/;
const SMALL_WORDS = new Set(['and', 'in', 'of', 'with', 'for', 'the']);

const letters = (text: string): string => text.replace(/[^A-Za-z]/g, '');
const allCapitals = (text: string): boolean => letters(text) !== '' && letters(text) === letters(text).toUpperCase();
const allSmall = (text: string): boolean => letters(text) !== '' && letters(text) === letters(text).toLowerCase();
/** A capital after the first letter beside small letters ("KwikPen", "onabotulinumtoxinA"): the writer chose it. */
const chosenCapitals = (part: string): boolean => /[a-z]/.test(part) && /[A-Z]/.test(part.replace(/^[^A-Za-z]*[A-Za-z]/, ''));

/** Each run of letters and digits in a word, with the marks between them kept in place. */
const eachPart = (word: string, change: (part: string) => string): string => word.replace(/[A-Za-z0-9]+/g, change);

function titlePart(part: string, first: boolean): string {
  const upper = part.toUpperCase();
  if (/[0-9]/.test(part)) return part;
  if (part.length === 1) return upper;
  if (KEEP_CAPITALS.has(upper) || ROMAN.test(upper)) return upper;
  if (!first && SMALL_WORDS.has(part.toLowerCase())) return part.toLowerCase();
  return upper[0] + part.slice(1).toLowerCase();
}

/** "ABILIFY MAINTENA" and "abiraterone acetate" become "Abilify Maintena" and "Abiraterone Acetate". */
function titleCase(text: string): string {
  return text
    .split(' ')
    .map((word, i) => eachPart(word, (part) => titlePart(part, i === 0)))
    .join(' ');
}

const tidySpaces = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * A product name. One written all in capitals or all in small letters is set in title case. In any
 * other, a long word in capitals ("TOUJEO Max") is set like its neighbours, and the rest is as listed.
 */
export function tidyProductName(text: string): string {
  const name = tidySpaces(text);
  if (allCapitals(name) || allSmall(name)) return titleCase(name);
  return name
    .split(' ')
    .map((word) => (allCapitals(word) && letters(word).length >= 5 ? titleCase(word) : word))
    .join(' ');
}

function genericPart(part: string): string {
  if (part.length === 1) return part;
  if (ROMAN.test(part) || KEEP_CAPITALS.has(part)) return part;
  if (chosenCapitals(part)) return part;
  return part.toLowerCase();
}

/** An ingredient name in small letters, the way ingredients are written: "EMTRICITABINE AND TENOFOVIR" becomes "emtricitabine and tenofovir". A lone capital ("vitamin D", "factor IX") stays. */
export function tidyIngredient(text: string): string {
  return tidySpaces(text)
    .split(' ')
    .map((word) => {
      if (word.toUpperCase() === 'RHO(D)') return 'Rho(D)';
      // A word that mixes small letters with a run of capitals ("Fc-VWF-XTEN") is a name in its own right.
      const runs = word.match(/[A-Za-z0-9]+/g) ?? [];
      if (/[a-z]/.test(word) && runs.some((run) => /^[A-Z]{2,}$/.test(run) && !ROMAN.test(run) && !KEEP_CAPITALS.has(run))) return word;
      return eachPart(word, genericPart);
    })
    .join(' ');
}

/** "TABLET, FILM COATED" becomes "tablet, film coated". */
export function tidyForm(text: string): string {
  return tidySpaces(text).toLowerCase();
}

/** A firm's name: one in capitals throughout is set in title case, a stray mark where an apostrophe belongs is mended, a comma left at the end is dropped. */
export function tidyLabeler(text: string): string {
  const name = tidySpaces(text)
    .replace(/([A-Za-z])[¿’\u0092�](?=[A-Za-z])/g, "$1'")
    .replace(/[,\s]+$/, '');
  return allCapitals(name) ? titleCase(name) : name;
}

/** The directory's unit codes, as a reader writes them. A unit that is not here is shown as listed. */
const UNITS: Readonly<Record<string, string>> = {
  mg: 'mg',
  g: 'g',
  kg: 'kg',
  ug: 'mcg',
  ng: 'ng',
  mL: 'mL',
  L: 'L',
  mCi: 'mCi',
  meq: 'mEq',
  mmol: 'mmol',
  U: 'units',
  "[USP'U]": 'USP units',
  '[iU]': 'IU',
  "[arb'U]": 'units',
  '%': '%',
};
const PER: Readonly<Record<string, string>> = { ...UNITS, U: 'unit', "[USP'U]": 'USP unit', "[arb'U]": 'unit', h: 'hour', d: 'day', min: 'minute' };
const PER_MANY: Readonly<Record<string, string>> = { h: 'hours', d: 'days', min: 'minutes' };

/** ".5" becomes "0.5" and "10000" becomes "10,000". Anything that is not a plain number is returned as it is. */
function tidyNumber(text: string): string | null {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const [whole = '', rest] = text.split('.');
  const grouped = (whole === '' ? '0' : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest === undefined || rest === '' ? grouped : `${grouped}.${rest}`;
}

function tidyOneStrength(text: string): string {
  // "<amount> <unit>/<amount><unit>": the second amount and the second unit may each be missing.
  const m = /^(\S+) (\S+?)\/(\d*\.?\d*)(\S*)$/.exec(text);
  if (!m) return text;
  const amount = tidyNumber(m[1]!);
  const unit = UNITS[m[2]!];
  if (amount === null || unit === undefined) return text;
  const top = unit === '%' ? `${amount}%` : `${amount} ${unit}`;
  const [perAmount, perUnit] = [m[3]!, m[4]!];
  // "/1" is "in each tablet, capsule or vial": the amount stands by itself.
  if (perUnit === '') return perAmount === '1' ? top : text;
  const one = PER[perUnit];
  if (one === undefined) return text;
  if (perAmount === '' || perAmount === '1') return `${top}/${one}`;
  const count = tidyNumber(perAmount);
  if (count === null) return text;
  return `${top}/${count} ${PER_MANY[perUnit] ?? one}`;
}

/** "200 mg/1; 25 mg/1" becomes "200 mg; 25 mg"; ".75 mg/.5mL" becomes "0.75 mg/0.5 mL"; "100 ug/1" becomes "100 mcg". */
export function tidyStrength(text: string): string {
  const strength = tidySpaces(text);
  if (strength === '') return '';
  return strength
    .split(';')
    .map((part) => tidyOneStrength(part.trim()))
    .join('; ');
}
