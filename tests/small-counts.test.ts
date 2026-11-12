import { describe, expect, it } from 'vitest';
import { isSmallClaimCount, maskSmallClaimCounts, readCsv, valueProblems, writeCsv } from '../scripts/dataset-shape.mjs';

const HEADER = 'filing_id,schedule,line,row_kind,name_as_filed,amount_as_filed,unit,claims_as_filed,claims,claims_withheld';
const row = (line: string, name: string, claimsAsFiled: string, claims: string, withheld = '') => `made-up-clinic,G,${line},detail,${name},"1,234.00",usd,${claimsAsFiled},${claims},${withheld}`;

describe('the small-number rule on the way into the site', () => {
  it('knows a count of 1 to 5 and nothing else', () => {
    for (const small of ['1', '3', '5', '05']) expect(isSmallClaimCount(small)).toBe(true);
    for (const other of ['', '0', '6', '12', '1,204', 'N/A', '-', '3.5']) expect(isSmallClaimCount(other)).toBe(false);
  });

  it('leaves files alone, byte for byte, when no count is small', () => {
    const csv = [HEADER, row('1', 'DRUG ONE', '"1,204"', '1204'), row('2', 'DRUG TWO', '0', '0'), row('3', 'DRUG THREE', '', '', 'fewer_than_6')].join('\n') + '\n';
    const files = { 'line_items.csv': csv };
    const result = maskSmallClaimCounts(files);
    expect(result.changed).toEqual([]);
    expect(result.files['line_items.csv']).toBe(csv);
  });

  it('keeps a row with a small count, leaves the count out and says which row', () => {
    const csv = [HEADER, row('1', 'DRUG ONE', '"1,204"', '1204'), row('2', '"DRUG, TWO"', '3', '3'), row('3', 'DRUG THREE', '5', '5')].join('\n') + '\n';
    const json = JSON.stringify({ line_items: [{ filing_id: 'made-up-clinic', schedule: 'G', line: '2', name_as_filed: 'DRUG, TWO', claims_as_filed: '3', claims: '3', claims_withheld: '' }] }, null, 2) + '\n';
    const result = maskSmallClaimCounts({ 'line_items.csv': csv, '340b-state-filings.json': json });
    expect(result.changed).toEqual(['line_items.csv: made-up-clinic schedule G line 2', 'line_items.csv: made-up-clinic schedule G line 3', '340b-state-filings.json: made-up-clinic schedule G line 2']);

    const [header, ...rows] = readCsv(result.files['line_items.csv']!);
    const at = (name: string) => header!.indexOf(name);
    expect(rows).toHaveLength(3);
    expect(rows[0]![at('claims')]).toBe('1204');
    for (const changed of rows.slice(1)) {
      expect(changed[at('claims')]).toBe('');
      expect(changed[at('claims_as_filed')]).toBe('');
      expect(changed[at('claims_withheld')]).toBe('fewer_than_6');
      expect(changed[at('amount_as_filed')]).toBe('1,234.00');
    }
    expect(rows[1]![at('name_as_filed')]).toBe('DRUG, TWO');

    const document = JSON.parse(result.files['340b-state-filings.json']!);
    expect(document.line_items[0]).toMatchObject({ claims: '', claims_as_filed: '', claims_withheld: 'fewer_than_6', name_as_filed: 'DRUG, TWO' });
  });

  it('writes CSV that reads back the same', () => {
    const rows = [['a', 'b'], ['plain', 'has, comma'], ['has "quote"', 'two\nlines']];
    expect(readCsv(writeCsv(rows))).toEqual(rows);
  });

  it('speaks up about a finished copy that still carries a small count', () => {
    const base = {
      'filings.csv': 'filing_id,form,record_kind\n',
      'entities.csv': 'entity_id,entity_type\n',
      'discrepancies.csv': 'filing_id,unit\n',
    };
    const good = { ...base, 'line_items.csv': [HEADER, row('1', 'DRUG ONE', '', '', 'fewer_than_6')].join('\n') + '\n' };
    const bad = { ...base, 'line_items.csv': [HEADER, row('1', 'DRUG ONE', '4', '4')].join('\n') + '\n' };
    expect(valueProblems(good)).toEqual([]);
    expect(valueProblems(bad).join(' ')).toContain('carries a claim count of 1 to 5');
  });
});
