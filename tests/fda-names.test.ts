import { describe, expect, it } from 'vitest';
import { DRUG_CSV_HEADER, buildStateDrugViews, getDataset, stateDrugCsv } from '../src/lib/data';
import { foldName, ndcKey } from '../src/lib/drug-groups';
import { buildFdaNames, fdaGenericShown, fdaNameFor, fdaNameForCell, fdaTitle, getFdaNames, type FdaName } from '../src/lib/fda-names';
import { filedDrugShown } from '../src/lib/filed-drug-display';
import { readCsv } from '../scripts/dataset-shape.mjs';
import { NAMES_HEADER, buildNames, changeReport, filedKey, namesCsv, package10to11, parseTable, previousNames, product10to9, strengthText, unusualChange } from '../scripts/reference/build-fda-ndc.mjs';

const SOURCE = JSON.stringify({ name: 'National Drug Code Directory', publisher: 'U.S. Food and Drug Administration', url: 'https://example.invalid/ndc.zip', page: 'https://example.invalid/ndc', retrieved: '2026-11-11', zip_sha256: 'abc' });

const name = (over: Partial<FdaName>): FdaName => ({
  ndc11: '00169413013',
  match: 'package',
  productNdc: '0169-4130',
  proprietaryName: 'Ozempic',
  proprietaryNameSuffix: '',
  nonproprietaryName: 'semaglutide',
  dosageForm: 'INJECTION, SOLUTION',
  strength: '1.34 mg/mL',
  labeler: 'Novo Nordisk',
  listedOn: '2026-11-11',
  kept: false,
  ...over,
});

describe('writing a 10-digit code as 11 digits', () => {
  it('adds one zero to the short part, which the dashes name', () => {
    expect(package10to11('0169-4130-13')).toBe('00169413013'); // 4-4-2
    expect(package10to11('61958-250-01')).toBe('61958025001'); // 5-3-2
    expect(package10to11('61958-2501-1')).toBe('61958250101'); // 5-4-1
  });
  it('takes no other layout', () => {
    expect(package10to11('61958-2501-01')).toBeNull(); // already 11 digits
    expect(package10to11('6195825011')).toBeNull(); // no dashes: the short part is not known
    expect(package10to11('169-4130-13')).toBeNull();
    expect(package10to11('')).toBeNull();
  });
  it('writes a product code as the first nine digits', () => {
    expect(product10to9('0169-4130')).toBe('001694130');
    expect(product10to9('61958-250')).toBe('619580250');
    expect(product10to9('61958-2501')).toBe('619582501');
    expect(product10to9('619582501')).toBeNull();
    expect(product10to9('169-4130')).toBeNull();
  });
  it('reads a filed cell by the same rule as the drug page', () => {
    for (const cell of ['61958250101', ' 61958-2501-01 ', '169418113', '61958250101, 61958250102', 'see separate tab', '']) {
      expect(filedKey(cell)).toBe(ndcKey(cell));
    }
  });
});

describe('strengthText', () => {
  it('pairs each strength with its unit, as listed', () => {
    expect(strengthText('50; 200; 25', 'mg/1; mg/1; mg/1')).toBe('50 mg/1; 200 mg/1; 25 mg/1');
    expect(strengthText('.68', 'mg/mL')).toBe('.68 mg/mL');
    expect(strengthText('', '')).toBe('');
  });
  it('keeps both lists whole when they do not pair', () => {
    expect(strengthText('50; 200', 'mg/1')).toBe('50; 200 mg/1');
  });
});

describe('buildNames', () => {
  const product = (id: string, ndc: string, proprietary: string) => ({
    PRODUCTID: id,
    PRODUCTNDC: ndc,
    PROPRIETARYNAME: proprietary,
    PROPRIETARYNAMESUFFIX: '',
    NONPROPRIETARYNAME: 'generic',
    DOSAGEFORMNAME: 'TABLET',
    ACTIVE_NUMERATOR_STRENGTH: '10',
    ACTIVE_INGRED_UNIT: 'mg/1',
    LABELERNAME: 'Labeler, Inc.',
  });
  const products = [product('p1', '0169-4130', 'One'), product('p2', '61958-250', 'Two'), product('p3', '11111-1111', 'Three'), product('p4', '11111-1111', 'Three again')];
  const packages = [
    { PRODUCTID: 'p1', NDCPACKAGECODE: '0169-4130-13' },
    { PRODUCTID: 'p2', NDCPACKAGECODE: '61958-250-01' },
    { PRODUCTID: 'p3', NDCPACKAGECODE: '11111-1111-1' },
    { PRODUCTID: 'p4', NDCPACKAGECODE: '11111-1111-1' },
  ];
  const filed = ['61958025001', '00169413013', '00169413099', '99999999999', '11111111101', '00169413013'];
  const built = buildNames(products, packages, filed, { retrieved: '2026-11-11' });

  it('gives one line per code, in code order, a code filed twice once', () => {
    expect(built.lines.map((l: string[]) => l[0])).toEqual(['00169413013', '00169413099', '11111111101', '61958025001', '99999999999']);
  });
  it('matches by package, then by product, and takes no name when the directory disagrees with itself', () => {
    const byCode = new Map<string, string[]>(built.lines.map((l: string[]) => [l[0]!, l]));
    expect(byCode.get('00169413013')!.slice(1, 4)).toEqual(['package', '0169-4130', 'One']);
    expect(byCode.get('00169413013')![9]).toBe('2026-11-11');
    expect(byCode.get('00169413099')!.slice(1, 4)).toEqual(['product', '0169-4130', 'One']);
    expect(byCode.get('61958025001')!.slice(1, 4)).toEqual(['package', '61958-250', 'Two']);
    expect(byCode.get('99999999999')!.slice(1)).toEqual(['none', '', '', '', '', '', '', '', '']);
    expect(byCode.get('11111111101')!.slice(1)).toEqual(['unclear', '', '', '', '', '', '', '', '']);
    expect(built.counts).toEqual({ package: 2, product: 1, none: 1, unclear: 1, kept: 0 });
  });
  it('writes a file the site reads back', () => {
    const names = buildFdaNames(namesCsv(built.lines), SOURCE);
    expect(names.byCode.size).toBe(5);
    expect(names.byCode.get('99999999999')).toBeNull();
    expect(names.byCode.get('11111111101')).toBeNull();
    expect(names.byCode.get('00169413099')).toMatchObject({ match: 'product', proprietaryName: 'One', labeler: 'Labeler, Inc.', strength: '10 mg/1' });
  });
  it('stops on a code that is not 11 digits', () => {
    expect(() => buildNames(products, packages, ['123'])).toThrow();
  });

  describe('a month later', () => {
    const before = previousNames(namesCsv(built.lines), '2026-11-11');
    const next = (nextProducts: typeof products, nextPackages: typeof packages) =>
      buildNames(nextProducts, nextPackages, filed, { retrieved: '2026-12-03', previous: before, previousRetrieved: '2026-11-11' });

    it('reads back only the lines that carry a name', () => {
      expect([...before.keys()].sort()).toEqual(['00169413013', '00169413099', '61958025001']);
    });
    it('reports nothing when the directory says the same, and moves each day forward', () => {
      const same = next(products, packages);
      expect(same.changes).toEqual({ added: [], changed: [], kept: [], removed: [] });
      expect(same.lines.find((l: string[]) => l[0] === '00169413013')![9]).toBe('2026-12-03');
    });
    it('keeps a name the directory has dropped, with the day it was last listed', () => {
      const dropped = next(products.filter((p) => p.PRODUCTID !== 'p2'), packages.filter((k) => k.PRODUCTID !== 'p2'));
      const line = dropped.lines.find((l: string[]) => l[0] === '61958025001')!;
      expect(line.slice(1, 4)).toEqual(['package', '61958-250', 'Two']);
      expect(line[9]).toBe('2026-11-11');
      expect(dropped.counts).toMatchObject({ package: 2, product: 1, kept: 1 });
      expect(dropped.changes.kept.map((c: { code: string }) => c.code)).toEqual(['61958025001']);
      // The month after that it is still kept, and is not reported a second time.
      const later = buildNames(products.filter((p) => p.PRODUCTID !== 'p2'), packages.filter((k) => k.PRODUCTID !== 'p2'), filed, {
        retrieved: '2027-01-03',
        previous: previousNames(namesCsv(dropped.lines), '2026-12-03'),
        previousRetrieved: '2026-12-03',
      });
      expect(later.lines.find((l: string[]) => l[0] === '61958025001')![9]).toBe('2026-11-11');
      expect(later.changes.kept).toEqual([]);
      const names = buildFdaNames(namesCsv(later.lines), JSON.stringify({ ...JSON.parse(SOURCE), retrieved: '2027-01-03' }));
      expect(names.byCode.get('61958025001')).toMatchObject({ kept: true, listedOn: '2026-11-11', proprietaryName: 'Two' });
      expect(names.byCode.get('00169413013')).toMatchObject({ kept: false, listedOn: '2027-01-03' });
    });
    it('reports a changed listing and a newly named code', () => {
      const renamed = next([...products.map((p) => (p.PRODUCTID === 'p1' ? { ...p, LABELERNAME: 'New Labeler' } : p)), product('p9', '99999-9999', 'Nine')], [...packages, { PRODUCTID: 'p9', NDCPACKAGECODE: '99999-9999-99'.slice(0, 12) }]);
      expect(renamed.changes.changed.map((c: { code: string }) => c.code)).toEqual(['00169413013', '00169413099']);
      expect(renamed.changes.kept).toEqual([]);
      const report = changeReport(renamed, '2026-12-03', []);
      expect(report).toContain('## Listing changed: 2');
      expect(report).toContain('Labeler, Inc. → One / generic / 10 mg/1 / TABLET / New Labeler');
    });
    it('writes the directory\'s text plainly into the report', () => {
      const odd = next(products.map((p) => (p.PRODUCTID === 'p1' ? { ...p, PROPRIETARYNAME: 'One [x](y) <b>*bold*</b>' } : p)), packages);
      const report = changeReport(odd, '2026-12-03', []);
      expect(/[<>\[\]*`]/.test(report.split('\n').filter((l) => l.startsWith('- ')).join('\n'))).toBe(false);
    });
  });

  describe('when a person must look', () => {
    const source = { products_listed: 4, packages_listed: 4 };
    it('passes a first run and an ordinary month', () => {
      expect(unusualChange(built, null)).toEqual([]);
      expect(unusualChange(built, source)).toEqual([]);
    });
    it('stops when the directory has shrunk by more than a tenth', () => {
      const reasons = unusualChange(built, { products_listed: 5, packages_listed: 4 });
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain('cut short');
    });
    it('stops when many codes change or drop out at once', () => {
      const codes = Array.from({ length: 300 }, (_, i) => `5${String(i).padStart(4, '0')}000101`);
      const many = codes.map((code, i) => product(`m${i}`, `${code.slice(0, 5)}-${code.slice(5, 9)}`, `Name ${i}`));
      const packs = codes.map((code, i) => ({ PRODUCTID: `m${i}`, NDCPACKAGECODE: `${code.slice(0, 5)}-${code.slice(5, 9)}-1` }));
      const first = buildNames(many, packs, codes, { retrieved: '2026-11-11' });
      expect(first.counts.package).toBe(300);
      const previous = previousNames(namesCsv(first.lines), '2026-11-11');
      const opts = { retrieved: '2026-12-03', previous, previousRetrieved: '2026-11-11' };
      const fifteen = buildNames(many.map((p, i) => (i < 15 ? { ...p, LABELERNAME: 'Other' } : p)), packs, codes, opts);
      expect(unusualChange(fifteen, { products_listed: 300, packages_listed: 300 })).toEqual([]);
      const sixteen = buildNames(many.map((p, i) => (i < 16 ? { ...p, LABELERNAME: 'Other' } : p)), packs, codes, opts);
      expect(unusualChange(sixteen, { products_listed: 300, packages_listed: 300 })[0]).toContain('16 of 300 codes changed');
      const gone = buildNames(many.slice(20), packs.slice(20), codes, opts);
      expect(gone.counts.kept).toBe(20);
      expect(unusualChange(gone, { products_listed: 300, packages_listed: 300 })[0]).toContain('20 of 300 codes are no longer listed');
    });
  });
});

describe('reading the directory\'s tables', () => {
  it('stops when a column the script reads is gone, or a line has the wrong number of fields', () => {
    expect(parseTable('A\tB\n1\t2\n', 'x.txt', ['A', 'B'])).toEqual([{ A: '1', B: '2' }]);
    expect(() => parseTable('A\tB\n1\t2\n', 'x.txt', ['A', 'C'])).toThrow(/no column C/);
    expect(() => parseTable('A\tB\n1\n', 'x.txt')).toThrow(/fields/);
  });
});

describe('reading the names file', () => {
  const header = NAMES_HEADER.join(',');
  it('stops on a code listed twice, an unknown match, or a match with no name', () => {
    expect(() => buildFdaNames(`${header}\n00169413013,none,,,,,,,,\n00169413013,none,,,,,,,,\n`, SOURCE)).toThrow(/twice/);
    expect(() => buildFdaNames(`${header}\n00169413013,maybe,,,,,,,,\n`, SOURCE)).toThrow(/unknown match/);
    expect(() => buildFdaNames(`${header}\n00169413013,package,0169-4130,,,,,,,2026-11-11\n`, SOURCE)).toThrow(/no name/);
    expect(() => buildFdaNames(`${header}\n169413013,none,,,,,,,,\n`, SOURCE)).toThrow(/11-digit/);
  });
  it('stops on a name with no day it was listed, or a day after the copy it came from', () => {
    expect(() => buildFdaNames(`${header}\n00169413013,package,0169-4130,Ozempic,,,,,,\n`, SOURCE)).toThrow(/listed_on/);
    expect(() => buildFdaNames(`${header}\n00169413013,package,0169-4130,Ozempic,,,,,,2026-12-01\n`, SOURCE)).toThrow(/listed_on/);
  });
  it('stops when the source record has no date', () => {
    expect(() => buildFdaNames(`${header}\n`, JSON.stringify({ ...JSON.parse(SOURCE), retrieved: 'last week' }))).toThrow(/date/);
  });
  it('stops on a code that was never looked up, and does not call it "not listed"', () => {
    const names = buildFdaNames(`${header}\n00169413013,none,,,,,,,,\n`, SOURCE);
    expect(fdaNameFor(names, '00169413013')).toBeNull();
    expect(() => fdaNameFor(names, '00169413014')).toThrow(/build-fda-ndc/);
  });
});

describe('the name for one row as filed', () => {
  const header = NAMES_HEADER.join(',');
  const names = buildFdaNames(`${header}\n00169413013,package,0169-4130,Ozempic,,semaglutide,\"INJECTION, SOLUTION\",1.34 mg/mL,Novo Nordisk,2026-11-11\n00169413099,none,,,,,,,,\n`, SOURCE);
  it('reads a cell filed as eleven digits or 5-4-2', () => {
    expect(fdaNameForCell(names, '00169413013')?.proprietaryName).toBe('Ozempic');
    expect(fdaNameForCell(names, ' 00169-4130-13 ')?.proprietaryName).toBe('Ozempic');
    expect(fdaNameForCell(names, '00169413099')).toBeNull();
  });
  it('looks nothing up for a cell that is not one 11-digit code', () => {
    expect(fdaNameForCell(names, '169413013')).toBeNull();
    expect(fdaNameForCell(names, '00169413013, 00169413099')).toBeNull();
    expect(fdaNameForCell(names, 'see separate tab')).toBeNull();
    expect(fdaNameForCell(names, '')).toBeNull();
  });
  it('stops on an 11-digit code that was never looked up', () => {
    expect(() => fdaNameForCell(names, '00169413014')).toThrow(/build-fda-ndc/);
  });
});

describe('the name shown', () => {
  it('is the listed name with its suffix', () => {
    expect(fdaTitle(name({}))).toBe('Ozempic');
    expect(fdaTitle(name({ proprietaryName: 'Humalog', proprietaryNameSuffix: 'KwikPen' }))).toBe('Humalog KwikPen');
  });
  it('leaves the second name out when it only repeats the first', () => {
    expect(fdaGenericShown(name({}))).toBe('semaglutide');
    expect(fdaGenericShown(name({ proprietaryName: 'Lisinopril', nonproprietaryName: 'LISINOPRIL' }))).toBe('');
    expect(fdaGenericShown(name({ proprietaryName: 'Insulin', proprietaryNameSuffix: 'Pen', nonproprietaryName: 'insulin  pen' }))).toBe('');
  });
});

describe('the names file in this repository', () => {
  const data = getDataset();
  const names = getFdaNames();
  const ri = buildStateDrugViews(data).find((v) => v.state === 'RI')!;
  const coded = ri.groups.filter((g) => g.key !== null);

  it('has a line for every drug code filed as one 11-digit code, and no other', () => {
    const filed = new Set(data.drugRows.map((r) => ndcKey(r.ndcAsFiled)).filter((k): k is string => k !== null));
    expect([...names.byCode.keys()].sort()).toEqual([...filed].sort());
  });
  it('counts on the page what the file holds', () => {
    const listed = [...names.byCode.values()].filter((n): n is FdaName => n !== null);
    expect(ri.fda.named).toBe(coded.filter((g) => g.fda !== null).length);
    expect(ri.fda.named + ri.fda.notListed).toBe(ri.codeCount);
    expect(ri.fda.byProduct).toBe(listed.filter((n) => coded.some((g) => g.key === n.ndc11) && n.match === 'product').length);
    expect(ri.fda.source.url.startsWith('https://www.accessdata.fda.gov/')).toBe(true);
    expect(ri.fda.source.page.startsWith('https://www.fda.gov/')).toBe(true);
  });
  it('shows the listed name where there is one, and the name as filed where there is none', () => {
    for (const g of ri.groups) {
      if (g.key === null) expect(g.fda).toBeNull();
      if (g.fda) {
        expect(g.fda.ndc11).toBe(g.key);
        expect(g.shownName).toBe(fdaTitle(g.fda));
      } else expect(g.shownName).toBe(filedDrugShown(g.name));
    }
  });
  it('keeps the name as filed beside every listed name', () => {
    // The name filed most often stays the group's own name, whatever the directory lists.
    for (const g of coded) {
      if (g.name !== '') expect(g.rows.some((r) => foldName(r.nameAsFiled) === foldName(g.name))).toBe(true);
    }
  });
  it('carries no line break, tab or markup in a listed name', () => {
    for (const n of names.byCode.values()) {
      if (!n) continue;
      for (const text of [n.proprietaryName, n.proprietaryNameSuffix, n.nonproprietaryName, n.dosageForm, n.strength, n.labeler, n.productNdc]) {
        expect(/[\r\n\t<>]/.test(text)).toBe(false);
      }
      expect(/^[0-9]{4,5}-[0-9]{3,4}$/.test(n.productNdc)).toBe(true);
      expect(n.ndc11.startsWith((product10to9(n.productNdc) ?? 'x'))).toBe(true);
    }
  });

  describe('in the download', () => {
    const [header, ...lines] = readCsv(stateDrugCsv(ri)) as string[][];
    const col = (field: (typeof DRUG_CSV_HEADER)[number]) => header!.indexOf(field);

    it('adds the directory fields after the site fields and changes no filed cell', () => {
      const fda = DRUG_CSV_HEADER.filter((h) => h.startsWith('fda_'));
      expect(fda).toEqual(['fda_proprietary_name', 'fda_proprietary_name_suffix', 'fda_nonproprietary_name', 'fda_dosage_form', 'fda_strength', 'fda_labeler', 'fda_match', 'fda_listed_on']);
      expect(col('fda_proprietary_name')).toBe(col('group_name') + 1);
    });
    it('fills them from the directory for the code of each row, and leaves them blank where it lists none', () => {
      for (const line of lines) {
        const key = line[col('ndc_11')]!;
        const listed = key === '' ? null : fdaNameFor(names, key);
        expect(line[col('fda_proprietary_name')]).toBe(listed?.proprietaryName ?? '');
        expect(line[col('fda_nonproprietary_name')]).toBe(listed?.nonproprietaryName ?? '');
        expect(line[col('fda_labeler')]).toBe(listed?.labeler ?? '');
        expect(line[col('fda_match')]).toBe(listed?.match ?? '');
        expect(line[col('fda_listed_on')]).toBe(listed?.listedOn ?? '');
      }
    });
    it('keeps group_name the name as filed, not the directory name', () => {
      const byKey = new Map(coded.map((g) => [g.key!, g.name]));
      for (const line of lines) {
        const key = line[col('ndc_11')]!;
        if (key !== '') expect(line[col('group_name')]).toBe(byKey.get(key));
      }
    });
  });
});
