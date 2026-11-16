// Says what one cell's text reads as: plain words, a number, a date, an error code.
//
// In plain words: a spreadsheet program stores each cell as a number, a date, a yes/no, an error or
// a text. A text can still read as a number ("1,250.00") or as a date ("3/4/2026") to a person,
// and that gap is what trips up a script or a pivot table. This file looks at a text and says
// which of those it reads as. The answer is one whole number: a kind, plus marks for what else
// was seen (stray spaces, digits only, and so on).

/** The kinds. A cell has exactly one. */
export const PLAIN = 1; // words, or anything else that reads as text
export const NUM = 2; // stored as a number (in a CSV file: written as a plain number)
export const NUMTEXT = 3; // a text that reads as a number
export const ZEROTEXT = 4; // a text of digits with a zero in front: an ID, a ZIP code, a drug code
export const DATE = 5; // stored as a date
export const DATETEXT = 6; // a text that reads as a date
export const BOOL = 7; // yes/no
export const ERROR = 8; // #N/A, #REF! and the like
export const COMMANUM = 9; // CSV only: an amount written with a decimal comma
export const SPACES = 10; // a text that holds nothing but spaces
export const KIND = 15;
export const kindOfCell = (cls) => cls & KIND;

/** The marks. A cell can carry several. */
export const DIGITS = 16; // digits only
export const AMOUNT = 32; // written the way an amount is: a decimal point, a currency sign, thousands separators
export const EDGE = 64; // a space before or after the text
export const DOUBLE = 128; // two spaces in a row inside the text
export const NBSP = 256; // a non-breaking space
export const FORMAT = 512; // a text cell that carries a number format (an amount or a count)
export const TOKEN = 1024; // one unbroken run of characters, as an ID is
export const HASDIGIT = 2048; // holds at least one digit

/** The forms a date typed as text can take. Kept in the bits above the marks. */
const FORM_SHIFT = 12;
export const FORMS = ['', 'with slashes', 'with the year first', 'with dashes', 'with dots', 'with the month as a word'];
export const formOf = (cls) => cls >> FORM_SHIFT;

export const ERROR_CODES = new Set(['#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!']);

/** Spaces are only counted in short values. A long text is a sentence someone typed, and nobody matches on those. */
const SHORT = 60;

const CSV_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
/** 1,250.00 and $45 and (300) and 12.5% and +7: a number to a person, a text to a program. */
const NUMBER_TEXT = /^\(?[-+]?[$€£]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?\s?%?\)?$/;
/** 1.234,56 and 12,5: the comma is the decimal point. One or two digits after it, so 1,234 stays a thousand. */
const COMMA_NUMBER = /^-?(?:[$€£]\s?)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}(?:\s?[$€£%])?$/;

const TIME = '(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:\\s?[AaPp][Mm])?)?';
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const SLASH = new RegExp(`^(\\d{1,2})/(\\d{1,2})/(?:\\d{4}|\\d{2})${TIME}$`);
const DASH = new RegExp(`^(\\d{1,2})-(\\d{1,2})-(?:\\d{4}|\\d{2})${TIME}$`);
const DOT = /^(\d{1,2})\.(\d{1,2})\.(?:\d{4}|\d{2})$/;
const YEAR_FIRST = new RegExp(`^\\d{4}[-/](\\d{1,2})[-/](\\d{1,2})(?:[T ]\\d{1,2}:\\d{2}.*)?$`);
const WORDS = new RegExp(`^(?:\\d{1,2}(?:st|nd|rd|th)?[ -]${MONTH},?[ -]\\d{2,4}|${MONTH} \\d{1,2}(?:st|nd|rd|th)?,? \\d{4})$`, 'i');

/** A day and a month, in either order: both between 1 and 31, and one of them 12 or less. */
const dayAndMonth = (a, b) => a >= 1 && b >= 1 && a <= 31 && b <= 31 && (a <= 12 || b <= 12);

/** The form of a date typed as text, as a place in FORMS; 0 when the text does not read as a date. */
function dateForm(t) {
  const first = t.charCodeAt(0);
  if (first >= 48 && first <= 57) {
    let m = SLASH.exec(t);
    if (m) return dayAndMonth(Number(m[1]), Number(m[2])) ? 1 : 0;
    m = YEAR_FIRST.exec(t);
    if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? 2 : 0;
    m = DASH.exec(t);
    if (m) return dayAndMonth(Number(m[1]), Number(m[2])) ? 3 : 0;
    m = DOT.exec(t);
    if (m) return dayAndMonth(Number(m[1]), Number(m[2])) ? 4 : 0;
  }
  return t.length <= 24 && WORDS.test(t) ? 5 : 0;
}

/**
 * What a text reads as. `csv` is true for a cell of a CSV file, where nothing is stored as a
 * number or a date and the writing is all there is. Returns 0 for an empty text.
 */
export function classify(raw, csv) {
  const t = raw.trim();
  if (t === '') return raw === '' ? 0 : SPACES;
  let marks = 0;
  if (raw.length <= SHORT) {
    if (t.length !== raw.length) marks |= EDGE;
    if (raw.includes(' ')) marks |= NBSP;
    if (/[  ]{2}/.test(t)) marks |= DOUBLE;
  }
  const first = t.charCodeAt(0);
  if (first === 35 && ERROR_CODES.has(t.toUpperCase())) return ERROR;
  const digit = first >= 48 && first <= 57;
  // A number can start with a digit, a sign, a currency sign, a bracket or a point.
  if (digit || first === 45 || first === 43 || first === 36 || first === 40 || first === 46 || first === 0x20ac || first === 0xa3) {
    if (/^0\d+$/.test(t)) return ZEROTEXT | DIGITS | TOKEN | HASDIGIT | marks;
    const digits = /^\d+$/.test(t) ? DIGITS | TOKEN | HASDIGIT : 0;
    if (csv && CSV_NUMBER.test(t)) return NUM | digits | (marks & ~(EDGE | DOUBLE | NBSP));
    if (/\d/.test(t) && NUMBER_TEXT.test(t)) return NUMTEXT | digits | (/[.,$€£%()]/.test(t) ? AMOUNT : 0) | marks;
    if (csv && COMMA_NUMBER.test(t)) return COMMANUM | marks;
  }
  const form = dateForm(t);
  if (form) return DATETEXT | (form << FORM_SHIFT) | marks;
  return PLAIN | (/\s/.test(t) ? 0 : TOKEN) | (/\d/.test(t) ? HASDIGIT : 0) | marks;
}
