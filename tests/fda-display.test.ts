import { describe, expect, it } from 'vitest';
import { tidyForm, tidyIngredient, tidyLabeler, tidyProductName, tidyStrength } from '../src/lib/fda-display';
import { fdaShown, getFdaNames } from '../src/lib/fda-names';

describe('a product name', () => {
  it('sets a name in capitals or in small letters in title case', () => {
    expect(tidyProductName('ABILIFY MAINTENA')).toBe('Abilify Maintena');
    expect(tidyProductName('abiraterone acetate')).toBe('Abiraterone Acetate');
    expect(tidyProductName('buprenorphine and naloxone')).toBe('Buprenorphine and Naloxone');
    expect(tidyProductName('SOLU-MEDROL')).toBe('Solu-Medrol');
    expect(tidyProductName('  DESCOVY ')).toBe('Descovy');
  });
  it('keeps short marks, numerals and anything with a digit', () => {
    expect(tidyProductName('ADDERALL XR')).toBe('Adderall XR');
    expect(tidyProductName('FACTOR IX COMPLEX')).toBe('Factor IX Complex');
    expect(tidyProductName('VITAMIN D')).toBe('Vitamin D');
    expect(tidyProductName('IMDELLTRA (AMG757)')).toBe('Imdelltra (AMG757)');
  });
  it("leaves a name the firm wrote in mixed capitals alone", () => {
    for (const name of ['NovoLOG', 'Actemra ACTPen', 'Biktarvy', 'Humalog KwikPen', 'TOBI Podhaler', 'Adrenalin (epinephrine in sodium chloride)']) expect(tidyProductName(name)).toBe(name);
  });
  it('sets a long word in capitals like its neighbours', () => {
    expect(tidyProductName('TOUJEO Max')).toBe('Toujeo Max');
    expect(tidyProductName('GAMMAGARD Liquid')).toBe('Gammagard Liquid');
  });
});

describe('an ingredient name', () => {
  it('is written in small letters', () => {
    expect(tidyIngredient('EMTRICITABINE AND TENOFOVIR ALAFENAMIDE')).toBe('emtricitabine and tenofovir alafenamide');
    expect(tidyIngredient('Abiraterone Acetate')).toBe('abiraterone acetate');
    expect(tidyIngredient('ADO-TRASTUZUMAB EMTANSINE')).toBe('ado-trastuzumab emtansine');
    expect(tidyIngredient('Tocilizumab-aazg')).toBe('tocilizumab-aazg');
    expect(tidyIngredient('ALBUMIN (HUMAN)')).toBe('albumin (human)');
    expect(tidyIngredient('INTERFERON ALFA-2B')).toBe('interferon alfa-2b');
  });
  it('keeps a lone capital, a numeral and capitals the writer chose', () => {
    expect(tidyIngredient('Coagulation Factor IX (Recombinant)')).toBe('coagulation factor IX (recombinant)');
    expect(tidyIngredient('PENICILLIN G BENZATHINE')).toBe('penicillin G benzathine');
    expect(tidyIngredient('onabotulinumtoxinA')).toBe('onabotulinumtoxinA');
    expect(tidyIngredient('Fc-VWF-XTEN Fusion Protein-ehtl')).toBe('Fc-VWF-XTEN fusion protein-ehtl');
    expect(tidyIngredient('RHO(D) IMMUNE GLOBULIN')).toBe('Rho(D) immune globulin');
    expect(tidyIngredient('Albuterol Sulfate HFA')).toBe('albuterol sulfate HFA');
  });
});

describe('a strength', () => {
  it('drops "in each one", adds the zero and names the unit', () => {
    expect(tidyStrength('200 mg/1; 25 mg/1')).toBe('200 mg; 25 mg');
    expect(tidyStrength('.75 mg/.5mL')).toBe('0.75 mg/0.5 mL');
    expect(tidyStrength('.25 mg/mL')).toBe('0.25 mg/mL');
    expect(tidyStrength('100 ug/1')).toBe('100 mcg');
    expect(tidyStrength("10000 [USP'U]/mL")).toBe('10,000 USP units/mL');
    expect(tidyStrength('100 [iU]/mL')).toBe('100 IU/mL');
    expect(tidyStrength('100 U/mL')).toBe('100 units/mL');
    expect(tidyStrength('25 ug/h')).toBe('25 mcg/hour');
    expect(tidyStrength('4.6 mg/24h')).toBe('4.6 mg/24 hours');
    expect(tidyStrength('1 g/10mL')).toBe('1 g/10 mL');
    expect(tidyStrength('40 mg/1mL')).toBe('40 mg/mL');
    expect(tidyStrength('')).toBe('');
  });
  it('shows what it cannot read as listed', () => {
    for (const text of ['5 furlongs/1', 'about 5 mg/1', '5 mg', '5 mg/2', '5 mg/1 extra']) expect(tidyStrength(text)).toBe(text);
  });
});

describe('a form and a firm', () => {
  it('writes the form in small letters', () => {
    expect(tidyForm('TABLET, FILM COATED')).toBe('tablet, film coated');
  });
  it('sets a firm in capitals in title case and mends its marks', () => {
    expect(tidyLabeler('FOSUN PHARMA USA INC')).toBe('Fosun Pharma USA Inc');
    expect(tidyLabeler('GRIFOLS USA, LLC')).toBe('Grifols USA, LLC');
    expect(tidyLabeler('SMITH & NEPHEW, INC')).toBe('Smith & Nephew, Inc');
    expect(tidyLabeler('Dr. Reddy¿s Laboratories Inc.,')).toBe("Dr. Reddy's Laboratories Inc.");
    expect(tidyLabeler('AbbVie Inc.')).toBe('AbbVie Inc.');
  });
});

describe('the names file as drawn', () => {
  const names = getFdaNames();
  const listed = [...names.byCode.values()].filter((n) => n !== null);
  it('leaves no strength unread and no name in capitals throughout', () => {
    const unread: string[] = [];
    for (const name of listed) {
      const shown = fdaShown(name);
      expect(shown.title).not.toBe('');
      if (/(^|[ ;/])\.\d|\/1(;|$)|\bug\b|\[/.test(shown.strength)) unread.push(`${name.ndc11}: ${shown.strength}`);
      expect(/[^\x20-\x7e]/.test(`${shown.title}${shown.generic}${shown.strength}${shown.form}${shown.labeler}`), name.ndc11).toBe(false);
      const words = shown.title.split(' ').filter((w) => /^[A-Z]{5,}$/.test(w));
      expect(words, `${name.ndc11}: ${shown.title}`).toEqual([]);
    }
    expect(unread).toEqual([]);
  });
  it('changes only the drawing: the listed fields stay as they are in the file', () => {
    const reddy = names.byCode.get('43598069750')!;
    expect(reddy.labeler).toContain('¿');
    expect(fdaShown(reddy).labeler).toBe("Dr. Reddy's Laboratories Inc.");
  });
});
