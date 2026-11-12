import { describe, expect, it } from 'vitest';
import { getDataset } from '../src/lib/data';
import { brandWords, filedDrugShown, tidyFiledDrugName } from '../src/lib/filed-drug-display';

const brand = brandWords(['Abilify Maintena', 'NovoLOG FlexPen', 'Basaglar KwikPen', 'Breo Ellipta', 'Adalimumab-aacf', 'Ventolin HFA', 'Jivi']);
const tidy = (name: string): string => tidyFiledDrugName(name, brand);

describe('a name typed all in capitals', () => {
  it('sets name words like a name and leaves shorthand as typed', () => {
    expect(tidy('ABILIFY MAINT 400 MG KIT')).toBe('Abilify Maint 400 mg kit');
    expect(tidy('HEMLIBRA 300 MG SDV 2 ML')).toBe('Hemlibra 300 mg SDV 2 mL');
    expect(tidy('MPB IDHIFA 100MG TAB 30')).toBe('MPB Idhifa 100 mg tab 30');
    expect(tidy('REVLIMID DS 10 MG CAP 28')).toBe('Revlimid DS 10 mg cap 28');
  });
  it('uses the capitals of a known product word', () => {
    expect(tidy('NOVOLOG FLEXPEN 100 UN/ML')).toBe('NovoLOG FlexPen 100 units/mL');
    expect(tidy('BREO ELLIPTA 100-25 MCG INH')).toBe('Breo Ellipta 100-25 mcg inh');
    expect(tidy('ADALIMUMAB-AACF 40 MG-0.8 ML PFP KIT 2')).toBe('Adalimumab-aacf 40 mg-0.8 mL PFP kit 2');
    expect(tidy('VENTOLIN HFA 90 MCG INH 18 GM')).toBe('Ventolin HFA 90 mcg inh 18 g');
  });
  it('sets plain words small and cut-short name parts like a name', () => {
    expect(tidy('OZEMPIC 2MG PER DOSE (8MG/3ML) PFP')).toBe('Ozempic 2 mg per dose (8 mg/3 mL) PFP');
    expect(tidy('DEXRAZOXANE-SOD LAC 250 MG SDV KIT')).toBe('Dexrazoxane-Sod Lac 250 mg SDV kit');
    expect(tidy('TETRACYCLINE HCL 500MG CAPS')).toBe('Tetracycline HCl 500 mg caps');
    expect(tidy('JIVI FACTOR FVIII 1999 IU VL')).toBe('Jivi Factor FVIII 1,999 IU VL');
    expect(tidy('INSULIN GLARGINE-YFGN 100UN/ML PFP 5X3ML')).toBe('Insulin Glargine-yfgn 100 units/mL PFP 5x3 mL');
  });
});

describe('a name typed in mixed capitals', () => {
  it('keeps the words as typed', () => {
    expect(tidy('EPINEPHrine 1 MG/10ML SOSY')).toBe('EPINEPHrine 1 mg/10 mL SOSY');
    expect(tidy('RisperDAL Consta 25 MG SRER 1x1 EA')).toBe('RisperDAL Consta 25 mg SRER 1x1 EA');
    expect(tidy('everolimus, antineoplastic, 5 mg Tab')).toBe('everolimus, antineoplastic, 5 mg Tab');
    expect(tidy('Ozempic .25 OR .5MG')).toBe('Ozempic 0.25 OR 0.5 mg');
  });
  it('sets a long word in capitals like its neighbours', () => {
    expect(tidy('norethindrone (MICRONOR) 0.35 mg tablet')).toBe('norethindrone (Micronor) 0.35 mg tablet');
  });
});

describe('units and numbers', () => {
  it('puts one space between a number and its unit', () => {
    expect(tidy('BIKTARVY 50MG/200MG/25MG TAB 30')).toBe('Biktarvy 50 mg/200 mg/25 mg tab 30');
    expect(tidy('nivolumab 110 mg in sodium chloride 0.9 % 50 mL IVPB')).toBe('nivolumab 110 mg in sodium chloride 0.9% 50 mL IVPB');
  });
  it('reads G, U, UN and UNIT as units only after a number', () => {
    expect(tidy('SANTYL 250 U/GM ONT 30 GM')).toBe('Santyl 250 units/g ONT 30 g');
    expect(tidy('HUMULIN R U-500 KWIKPEN')).toBe('Humulin R U-500 KwikPen');
    expect(tidy('DEXCOM G7 SENSOR MISC')).toBe('Dexcom G7 Sensor MISC');
    expect(tidy('BUPRENORPHINE 10 MCG-HR PAT 4')).toBe('Buprenorphine 10 mcg-hr pat 4');
  });
  it('writes a zero before a bare decimal point', () => {
    expect(tidy('WEGOVY PEN .5MG/.5ML NOV4')).toBe('Wegovy pen 0.5 mg/0.5 mL NOV4');
    expect(tidy('X 1.2.3')).toBe('X 1.2.3');
  });
  it('puts commas in a long number that stands alone or carries a unit', () => {
    expect(tidy('RETACRIT 40000 UN/ML VL 4X1ML')).toBe('Retacrit 40,000 units/mL VL 4x1 mL');
    expect(tidy('CREON 12000 DR CAP 100')).toBe('Creon 12,000 DR cap 100');
    expect(tidy('ADVATE BAXJECT III 5ML 1801-2400 IU')).toBe('Advate Baxject III 5 mL 1,801-2,400 IU');
    expect(tidy('efgartigimod 1008 mg-11200 units / 5.6 mL INJ')).toBe('efgartigimod 1,008 mg-11,200 units / 5.6 mL INJ');
  });
  it('leaves a number that may be a code as typed', () => {
    expect(tidy('LUPRON DEPOT 22.5MG KT 3346-03')).toBe('Lupron Depot 22.5 mg KT 3346-03');
    expect(tidy('Adzynma 0500U 1 EA')).toBe('Adzynma 0500 units 1 EA');
  });
  it('writes "x" between two numbers', () => {
    expect(tidy('CIMZIA START 2X200 MG/ML KIT 3')).toBe('Cimzia Start 2x200 mg/mL kit 3');
    expect(tidy('XPOVIO 100 MG ONCE WKLY TAB (50MGX8) BP')).toBe('Xpovio 100 mg once wkly tab (50 mg x 8) BP');
  });
  it('gives an empty name back empty', () => {
    expect(tidy('  ')).toBe('');
  });
});

/**
 * The promise the pages make: only the drawing changes. For every drug name in the dataset, the
 * words are the same words in the same order and every number has the same value.
 */
describe('every filed drug name in the dataset', () => {
  const names = [...new Set(getDataset().drugRows.map((r) => r.nameAsFiled))].filter((n) => n !== '');
  const UNIT_WORDS = new Set(['MG', 'MCG', 'ML', 'MEQ', 'G', 'GM', 'U', 'UN', 'UNT', 'UNIT', 'UNITS', 'IU', 'HR', 'X', 'MGX', 'MLX', 'MCGX']);
  const words = (text: string): string[] => (text.match(/[A-Za-z]+/g) ?? []).map((w) => w.toUpperCase()).filter((w) => !UNIT_WORDS.has(w));
  const numbers = (text: string): number[] => (text.match(/\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+/g) ?? []).map((n) => Number(n.replace(/,/g, '')));
  const unitCount = (text: string): number => (text.match(/[A-Za-z]+/g) ?? []).filter((w) => UNIT_WORDS.has(w.toUpperCase()) && !/^X$/i.test(w)).length;

  it('has names to check', () => {
    expect(names.length).toBeGreaterThan(2000);
  });
  it('keeps every word, in order', () => {
    for (const name of names) expect(words(filedDrugShown(name)), name).toEqual(words(name));
  });
  it('keeps the value of every number, in order', () => {
    for (const name of names) expect(numbers(filedDrugShown(name)), name).toEqual(numbers(name));
  });
  it('keeps as many units as were typed', () => {
    for (const name of names) expect(unitCount(filedDrugShown(name)), name).toBe(unitCount(name));
  });
  it('changes nothing but letters case, spaces, commas, a leading zero and unit spellings', () => {
    const SAME: Readonly<Record<string, string>> = { UNITS: 'U', UNIT: 'U', UNT: 'U', UN: 'U', GM: 'G' };
    const fold = (text: string): string =>
      text
        .toUpperCase()
        .replace(/[A-Z]+/g, (word) => SAME[word] ?? word)
        .replace(/(?<![\d.])0\./g, '.')
        .replace(/[\s,]/g, '');
    for (const name of names) {
      const typed = fold(name);
      const shown = fold(filedDrugShown(name));
      // "GM" and the spellings of "units" fold the same way on both sides; everything else must match letter for letter.
      expect(shown, name).toBe(typed);
    }
  });
  it('draws a name the same way twice', () => {
    for (const name of names.slice(0, 300)) expect(filedDrugShown(filedDrugShown(name)), name).toBe(filedDrugShown(name));
  });
});
