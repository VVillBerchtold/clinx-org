import { describe, expect, it } from 'vitest';
import { DRUG_CSV_HEADER, buildStateDrugViews, getDataset, stateDrugCsv } from '../src/lib/data';
import {
  byFilers,
  centsToDecimal,
  claimsShown,
  csvField,
  foldName,
  formatNdc,
  groupClaimsSortValue,
  groupDrugRows,
  ndcKey,
  pickGroupName,
  sumClaims,
  toCsv,
  type GroupableRow,
} from '../src/lib/drug-groups';
import { LEFT_OUT_SORT } from '../src/lib/drugs';
import { readCsv } from '../scripts/dataset-shape.mjs';

const row = (over: Partial<GroupableRow>): GroupableRow => ({
  filingId: 'f-a',
  line: '1',
  nameAsFiled: 'DRUG',
  ndcAsFiled: '00000000001',
  amountAsFiled: '10.00',
  amountCents: 1000,
  claims: 10,
  claimsStatus: 'count',
  ...over,
});

describe('ndcKey', () => {
  it('takes eleven digits and 5-4-2 with dashes, and nothing else', () => {
    expect(ndcKey('61958250101')).toBe('61958250101');
    expect(ndcKey(' 61958-2501-01 ')).toBe('61958250101');
    expect(ndcKey('169418113')).toBeNull(); // nine digits: not padded
    expect(ndcKey('0169418113')).toBeNull();
    expect(ndcKey('169418113, 169413013')).toBeNull(); // a list: not split
    expect(ndcKey('61958250101, 61958250102')).toBeNull();
    expect(ndcKey('6195-82501-01')).toBeNull();
    expect(ndcKey('see separate tab')).toBeNull();
    expect(ndcKey('')).toBeNull();
  });
  it('writes a key 5-4-2', () => {
    expect(formatNdc('61958250101')).toBe('61958-2501-01');
    expect(() => formatNdc('123')).toThrow();
  });
});

describe('pickGroupName', () => {
  it('takes the name filed most often, capitals and spacing ignored, as first written', () => {
    expect(pickGroupName(['Biktarvy  Tab', 'BIKTARVY 50MG', 'BIKTARVY TAB'])).toBe('Biktarvy Tab');
  });
  it('on a tie takes the shortest, then A to Z', () => {
    expect(pickGroupName(['tremelimumab-actl 300 mg in sodium chloride', 'IMJUDO 300 MG'])).toBe('IMJUDO 300 MG');
    expect(pickGroupName(['BBB', 'AAA'])).toBe('AAA');
  });
  it('passes over blank names', () => {
    expect(pickGroupName(['', ' ', 'X'])).toBe('X');
    expect(pickGroupName(['', ''])).toBe('');
  });
  it('folds names', () => {
    expect(foldName('  A  b ')).toBe('a b');
  });
});

describe('claims of a group', () => {
  it('adds the shown counts and counts the rows left out', () => {
    const c = sumClaims([row({ claims: 10 }), row({ claims: 0 }), row({ claims: null, claimsStatus: 'fewer_than_6' })]);
    expect(c).toEqual({ sum: 10, counted: 2, leftOut: 1 });
    expect(claimsShown(c)).toEqual({ kind: 'at_least', value: 10 });
    expect(groupClaimsSortValue(c)).toBe('10');
  });
  it('is a plain count when no row leaves its count out', () => {
    expect(claimsShown(sumClaims([row({ claims: 6 }), row({ claims: 7 })]))).toEqual({ kind: 'count', value: 13 });
    expect(claimsShown(sumClaims([row({ claims: 0 })]))).toEqual({ kind: 'count', value: 0 });
  });
  it('gives no figure when only left-out rows and zeros remain', () => {
    const c = sumClaims([row({ claims: null, claimsStatus: 'fewer_than_6' }), row({ claims: 0 })]);
    expect(claimsShown(c)).toEqual({ kind: 'left_out' });
    expect(groupClaimsSortValue(c)).toBe(LEFT_OUT_SORT);
  });
  it('refuses a shown count of 1 to 5 and a sum of 1 to 5', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(() => sumClaims([row({ claims: n })])).toThrow();
      expect(() => claimsShown({ sum: n, counted: 1, leftOut: 0 })).toThrow();
    }
    expect(() => sumClaims([row({ claims: null })])).toThrow();
  });
});

describe('groupDrugRows', () => {
  const rows = [
    row({ filingId: 'f-b', line: '2', nameAsFiled: 'Alpha tab', ndcAsFiled: '11111-1111-11', amountAsFiled: '5', amountCents: 500, claims: 6 }),
    row({ filingId: 'f-a', line: '9', nameAsFiled: 'ALPHA TAB', ndcAsFiled: '11111111111', amountAsFiled: '1.50', amountCents: 150, claims: null, claimsStatus: 'fewer_than_6' }),
    row({ filingId: 'f-a', line: '3', nameAsFiled: 'alpha', ndcAsFiled: '11111111111', amountAsFiled: '2.25', amountCents: 225, claims: 8 }),
    row({ filingId: 'f-a', line: '4', nameAsFiled: 'Beta', ndcAsFiled: '22222222222', amountAsFiled: '7', amountCents: 700, claims: 9 }),
    row({ filingId: 'f-b', line: '5', nameAsFiled: 'Gamma', ndcAsFiled: '333, 444', amountAsFiled: '8', amountCents: 800, claims: 12 }),
    row({ filingId: 'f-b', line: '6', nameAsFiled: 'Gamma', ndcAsFiled: '333, 444', amountAsFiled: '9', amountCents: 900, claims: 12 }),
  ];
  const groups = groupDrugRows(rows, ['f-a', 'f-b']);

  it('keeps every row exactly once', () => {
    expect(groups.flatMap((g) => g.rows)).toHaveLength(rows.length);
    expect(new Set(groups.flatMap((g) => g.rows)).size).toBe(rows.length);
  });
  it('groups a code filed with and without dashes, several rows of one filer included', () => {
    const g = groups.find((x) => x.key === '11111111111')!;
    expect(g.rows.map((r) => `${r.filingId}/${r.line}`)).toEqual(['f-a/9', 'f-a/3', 'f-b/2']);
    expect(g.filingIds).toEqual(['f-a', 'f-b']);
    expect(g.ndcText).toBe('11111-1111-11');
    expect(g.name).toBe('ALPHA TAB');
    expect(g.names).toEqual(['ALPHA TAB', 'alpha']);
    expect(g.amountCents).toBe(875);
    expect(g.scale).toBe(2);
    expect(g.claims).toEqual({ sum: 14, counted: 2, leftOut: 1 });
    expect(g.id).toBe('ndc-11111111111');
  });
  it('leaves a row whose cell is not one code on its own, even beside an identical cell', () => {
    const alone = groups.filter((g) => g.key === null);
    expect(alone).toHaveLength(2);
    expect(alone.map((g) => g.ndcText)).toEqual(['333, 444', '333, 444']);
    expect(new Set(alone.map((g) => g.id)).size).toBe(2);
  });
  it('orders by filers, then name', () => {
    expect(groups[0]!.key).toBe('11111111111');
    expect(groups.slice(1).map((g) => g.name)).toEqual(['Beta', 'Gamma', 'Gamma']);
    expect([...groups].sort(byFilers)).toEqual(groups);
  });
  it('stops on a row of a filing that is not in the order', () => {
    expect(() => groupDrugRows(rows, ['f-a'])).toThrow();
    expect(() => groupDrugRows(rows, ['f-a', 'f-a', 'f-b'])).toThrow();
  });
  it('keeps whole dollars when no row prints cents', () => {
    expect(groups.find((g) => g.key === '22222222222')!.scale).toBe(0);
  });
});

describe('csv', () => {
  it('quotes commas, quotes and line breaks only', () => {
    expect(csvField('a')).toBe('a');
    expect(csvField('1,234.50')).toBe('"1,234.50"');
    expect(csvField('say "x"')).toBe('"say ""x"""');
    expect(toCsv(['a', 'b'], [['1', 'x,y']])).toBe('a,b\n1,"x,y"\n');
    expect(() => toCsv(['a', 'b'], [['1']])).toThrow();
  });
  it('writes cents as a decimal', () => {
    expect(centsToDecimal(50809064)).toBe('508090.64');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(2223700)).toBe('22237.00');
  });
});

describe('the Rhode Island page of all drug rows', () => {
  const data = getDataset();
  const views = buildStateDrugViews(data);
  const ri = views.find((v) => v.state === 'RI')!;
  const detail = data.drugRows.filter((r) => r.rowKind === 'detail' && r.filingId.startsWith('ri-'));

  it('is the only state with drug rows in this dataset version', () => {
    expect(views.map((v) => v.state)).toEqual(['RI']);
    expect(ri.path).toBe('/scorecard/ri/drugs/');
    expect(ri.csvPath).toBe(`/data/drug-rows-ri-${ri.reportingYear}.csv`);
  });
  it('holds every detail row of every filing once', () => {
    expect(ri.rowCount).toBe(detail.length);
    const seen = ri.groups.flatMap((g) => g.rows.map((r) => `${r.filingId}|${r.line}`));
    expect(seen).toHaveLength(detail.length);
    expect(new Set(seen).size).toBe(detail.length);
    expect(ri.groups).toHaveLength(ri.codeCount + ri.aloneCount);
  });
  it('adds amounts exactly: the groups add up to the rows', () => {
    const fromGroups = ri.groups.reduce((sum, g) => sum + BigInt(g.amountCents), 0n);
    const fromRows = detail.reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
    expect(fromGroups).toBe(fromRows);
  });
  it('groups only identical codes', () => {
    for (const g of ri.groups) {
      if (g.key === null) {
        expect(g.rows).toHaveLength(1);
        expect(ndcKey(g.rows[0]!.ndcAsFiled)).toBeNull();
      } else {
        for (const r of g.rows) expect(ndcKey(r.ndcAsFiled)).toBe(g.key);
      }
    }
  });
  it('takes each group name from the names filed with its code', () => {
    for (const g of ri.groups) {
      if (g.name === '') expect(g.rows.every((r) => r.nameAsFiled.trim() === '')).toBe(true);
      else expect(g.rows.some((r) => foldName(r.nameAsFiled) === foldName(g.name))).toBe(true);
    }
  });
  it('never yields a claims figure of 1 to 5', () => {
    for (const g of ri.groups) {
      const shown = claimsShown(g.claims);
      if (shown.kind !== 'left_out') expect(shown.value === 0 || shown.value >= 6).toBe(true);
      expect(g.claims.counted + g.claims.leftOut).toBe(g.rows.length);
    }
  });

  describe('the download', () => {
    const text = stateDrugCsv(ri);
    const [header, ...lines] = readCsv(text) as string[][];
    const col = (name: (typeof DRUG_CSV_HEADER)[number]) => header!.indexOf(name);

    it('has one line per row, under the stated header', () => {
      expect(header).toEqual([...DRUG_CSV_HEADER]);
      expect(lines).toHaveLength(detail.length);
    });
    it('carries no claim count of 1 to 5 and names every count left out', () => {
      let leftOut = 0;
      for (const line of lines) {
        const claims = line[col('claims')]!;
        const withheld = line[col('claims_withheld')]!;
        if (withheld === '') {
          expect(/^(0|[6-9]|[1-9][0-9]+)$/.test(claims)).toBe(true);
        } else {
          leftOut++;
          expect(claims).toBe('');
          expect(line[col('claims_as_filed')]).toBe('');
          expect(['fewer_than_6', 'beside_small']).toContain(withheld);
        }
      }
      expect(leftOut).toBe(ri.fewerThan6 + ri.notShown);
    });
    it('keeps each filed cell as filed', () => {
      const byId = new Map(detail.map((r) => [`${r.filingId}|${r.line}`, r]));
      for (const line of lines) {
        const r = byId.get(`${line[col('filing_id')]}|${line[col('line')]}`)!;
        expect(line[col('name_as_filed')]).toBe(r.nameAsFiled);
        expect(line[col('ndc_as_filed')]).toBe(r.ndcAsFiled);
        expect(line[col('amount_as_filed')]).toBe(r.amountAsFiled);
        expect(line[col('ndc_11')]).toBe(ndcKey(r.ndcAsFiled) ?? '');
        expect(line[col('source_url')]!.endsWith(`#page=${r.page}`)).toBe(true);
      }
    });
  });
});
