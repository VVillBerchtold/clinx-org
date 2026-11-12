/**
 * How a filer's own drug name is drawn on a page.
 *
 * Filers type drug names in many ways: most in capitals, with pharmacy shorthand, the unit run
 * into the number ("ABILIFY MAINT 400MG KIT", "Ozempic .25 OR .5MG"). The pages draw them one way.
 * Only the drawing changes: capitals, spaces, the spelling of units, a zero before a bare decimal
 * point and commas in long numbers. No word is replaced, spelled out or dropped, and no digit
 * changes. The dataset, the download and the filing PDF keep each name as typed.
 *
 * The rules are narrow on purpose. A short word this file does not know stays as typed, because
 * it may be shorthand ("SDV", "PFP") and a guess would put words in the filer's mouth.
 */

import { fdaTitle, getFdaNames } from './fda-names';

/** Units that mean one thing wherever they stand. */
const UNITS_ANYWHERE: Readonly<Record<string, string>> = { MG: 'mg', MCG: 'mcg', ML: 'mL', MEQ: 'mEq' };
/** Units read as units only straight after a number, or after a unit and a slash or dash ("250 U/GM"). */
const UNITS_AFTER_NUMBER: Readonly<Record<string, string>> = { G: 'g', GM: 'g', U: 'units', UN: 'units', UNT: 'units', UNIT: 'units', UNITS: 'units', IU: 'IU', HR: 'hr' };

/** Plain words and well-known short forms, set in small letters in a name typed all in capitals. */
const SMALL = new Set(
  (
    'TAB TABS TABLET TABLETS CAP CAPS CAPSULE CAPSULES INJ INJECTION KIT INH INHALER AUTO AER AERO AEROSOL ORAL PEN PENS SUS SUSP SUSPENSION ' +
    'PWD POWDER SOL SOLN SOLUTION BAG DOSE DOSES VIAL VIALS SYR SYRINGE SPR SPRAY PACK PAK CRM CREAM FILM GEL PAT PATCH PER GRAM GRAN LIQ LIQUID ' +
    'FOAM GUM PAD TUBE OR ON ONCE WKLY WEEKLY DAY MONTH CART CARTRIDGE AMP TEST PUSH NEW FOR AND WITH IN OF NASAL TOPICAL RECTAL BUCCAL PUFFS ' +
    'FILLED FREE BODY NON RETURN OINTMENT IMPLANT SUPPLIED STANDARD PRE PREF MO INJECTOR AUTOINJECTOR ' +
    // The four-letter endings of biosimilar names, which are written small ("adalimumab-adaz").
    'YFGN ADAZ AACF ADBM'
  ).split(' '),
);
/** Cut-short parts of a drug's name, set like a name. */
const NAME_PARTS = new Set('ACET SOD SULF SUL PROP DEXT LAC CIT CHL BROM CYP VAL POT CON SOLO KWIK FLEX PRO MINI HYPO UNO ACCU CHEK RHO'.split(' '));
const SPELLED: Readonly<Record<string, string>> = { HCL: 'HCl', NACL: 'NaCl', FVIII: 'FVIII' };

type Kind = 'word' | 'number' | 'space' | 'mark' | 'unit';
interface Piece {
  kind: Kind;
  text: string;
}

const PIECES = /[A-Za-z]+|\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+|\s+|[^A-Za-z\d\s]/g;

function split(name: string): Piece[] {
  return (name.match(PIECES) ?? []).map((text) => ({
    text,
    kind: /^[A-Za-z]/.test(text) ? 'word' : /^[\d.]/.test(text) && /\d/.test(text) ? 'number' : /^\s/.test(text) ? 'space' : 'mark',
  }));
}

/** True when the filer typed the name all in capitals (an "x" between two numbers aside). */
function typedInCapitals(name: string): boolean {
  const letters = name.replace(/(?<=\d)x(?=\d)/g, '').replace(/[^A-Za-z]/g, '');
  return letters !== '' && letters === letters.toUpperCase();
}

const title = (word: string): string => word[0]!.toUpperCase() + word.slice(1).toLowerCase();

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Draws one name. `brand` gives the capitals of a known product word by its capital spelling
 * ("NOVOLOG" to "NovoLOG"); a word not in it is set by the rules above.
 */
export function tidyFiledDrugName(text: string, brand: ReadonlyMap<string, string> = new Map()): string {
  const name = text.trim().replace(/\s+/g, ' ');
  if (name === '') return '';
  const capitals = typedInCapitals(name);
  const pieces = split(name);

  // "50MGX8": a unit, then "x", then how many.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const m = p.kind === 'word' ? /^(MG|MCG|ML)X$/i.exec(p.text) : null;
    if (m && pieces[i + 1]?.kind === 'number') pieces.splice(i, 1, { kind: 'unit', text: UNITS_ANYWHERE[m[1]!.toUpperCase()]! }, { kind: 'mark', text: ' x ' });
  }

  const before = (i: number): number => {
    let j = i - 1;
    while (j >= 0 && pieces[j]!.kind === 'space') j--;
    return j;
  };

  // Units.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    if (p.kind !== 'word') continue;
    const upper = p.text.toUpperCase();
    const anywhere = UNITS_ANYWHERE[upper];
    if (anywhere) {
      pieces[i] = { kind: 'unit', text: anywhere };
      continue;
    }
    const after = UNITS_AFTER_NUMBER[upper];
    if (!after) continue;
    const j = before(i);
    const prev = j >= 0 ? pieces[j]! : null;
    const afterNumber = prev?.kind === 'number';
    const afterUnitAndMark = prev?.kind === 'mark' && (prev.text === '/' || prev.text === '-') && j === i - 1 && pieces[j - 1]?.kind === 'unit';
    if (afterNumber || afterUnitAndMark) pieces[i] = { kind: 'unit', text: after };
  }

  // Numbers: a zero before a bare decimal point, commas in long numbers, "x" between two numbers.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    if (p.kind === 'number') {
      if (p.text.startsWith('.')) {
        if (pieces[i - 1]?.kind !== 'number') p.text = `0${p.text}`;
        continue;
      }
      if (!/^[1-9]\d{3,}$/.test(p.text)) continue;
      const prev = pieces[i - 1];
      const next = pieces[i + 1];
      const nextSeen = next?.kind === 'space' ? pieces[i + 2] : next;
      // A number stands alone when a space, a bracket or the end is on each side: "KT 3346-03" is left as typed.
      const afterUnitMark = prev?.kind === 'mark' && (prev.text === '-' || prev.text === '/') && pieces[i - 2]?.kind === 'unit';
      const opens = !prev || prev.kind === 'space' || (prev.kind === 'mark' && prev.text === '(') || afterUnitMark;
      const beforeUnit = nextSeen?.kind === 'unit';
      const rangeStart = next?.kind === 'mark' && next.text === '-' && pieces[i + 2]?.kind === 'space';
      const closes = !next || next.kind === 'space' || (next.kind === 'mark' && /^[),;]$/.test(next.text)) || rangeStart;
      // Both ends of a range that carries a unit: "1801-2400 IU".
      const afterDash = prev?.kind === 'mark' && prev.text === '-' && pieces[i - 2]?.kind === 'number';
      const dashThenNumber = next?.kind === 'mark' && next.text === '-' && pieces[i + 2]?.kind === 'number';
      const unitAfterNext = (pieces[i + 3]?.kind === 'space' ? pieces[i + 4] : pieces[i + 3])?.kind === 'unit';
      if ((opens && (beforeUnit || closes)) || (afterDash && beforeUnit) || (opens && dashThenNumber && unitAfterNext)) p.text = groupThousands(p.text);
    } else if (p.kind === 'word' && p.text === 'X' && pieces[i - 1]?.kind === 'number' && pieces[i + 1]?.kind === 'number') {
      p.text = 'x';
    }
  }

  // Capitals.
  for (const p of pieces) {
    if (p.kind !== 'word' || p.text.length === 1) continue;
    const upper = p.text.toUpperCase();
    const typedCapitals = p.text === upper;
    if (!capitals && !(typedCapitals && p.text.length >= 5)) continue;
    if (!typedCapitals) continue;
    if (SMALL.has(upper)) p.text = upper.toLowerCase();
    else if (SPELLED[upper]) p.text = SPELLED[upper]!;
    else if (NAME_PARTS.has(upper)) p.text = title(upper);
    else if (brand.has(upper)) p.text = brand.get(upper)!;
    else if (upper.length >= 5) p.text = title(upper);
  }

  // Spaces: one between a number and its unit, none before a percent sign.
  let out = '';
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const prev = pieces[i - 1];
    if (p.kind === 'unit' && prev?.kind === 'number') out += ' ';
    if (p.kind === 'space' && prev?.kind === 'number' && pieces[i + 1]?.kind === 'mark' && pieces[i + 1]!.text === '%') continue;
    out += p.text;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Every product word of the FDA directory's names, by its capital spelling, as the pages draw it. */
export function brandWords(titles: Iterable<string>): Map<string, string> {
  const seen = new Map<string, Map<string, number>>();
  for (const t of titles) {
    for (const word of t.match(/[A-Za-z]+/g) ?? []) {
      if (word.length < 2) continue;
      const upper = word.toUpperCase();
      const forms = seen.get(upper) ?? new Map<string, number>();
      forms.set(word, (forms.get(word) ?? 0) + 1);
      seen.set(upper, forms);
    }
  }
  const out = new Map<string, string>();
  for (const [upper, forms] of seen) {
    // The form written most often; when two are written equally often, the one earlier in the alphabet, so a build never flips.
    const [best] = [...forms].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    out.set(upper, best![0]);
  }
  return out;
}

let cached: Map<string, string> | null = null;

/** A filer's drug name as a page draws it. */
export function filedDrugShown(nameAsFiled: string): string {
  if (!cached) {
    const titles: string[] = [];
    for (const name of getFdaNames().byCode.values()) if (name) titles.push(fdaTitle(name));
    cached = brandWords(titles);
  }
  return tidyFiledDrugName(nameAsFiled, cached);
}
