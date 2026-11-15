import { describe, expect, it } from 'vitest';
import { COLUMNS, DATASET, MOST_DAYS, questions, report, table } from '../scripts/usage/mcp-usage.mjs';
import { COUNT_COLUMNS } from '../worker/assistants';
import config from '../wrangler.jsonc?raw';

// The counts are written by worker/assistants.ts and read back by scripts/usage/mcp-usage.mjs.
// The two must agree on the order of the columns and on the name of the set of counts.
describe('the reader of the counts', () => {
  it('reads the columns in the order the door writes them, from the set of counts the host is given', () => {
    expect(COLUMNS).toEqual([...COUNT_COLUMNS]);
    expect(config).toContain(`"dataset": "${DATASET}"`);
  });

  it('asks only for counts by kind, over the days given', () => {
    const asked = questions(7);
    expect(asked.length).toBeGreaterThan(4);
    for (const { sql, columns } of asked) {
      expect(sql).toContain(`FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '7' DAY`);
      expect(sql).toContain('SUM(_sample_interval) AS requests');
      expect(sql).toContain('GROUP BY');
      expect(columns.at(-1)).toBe('requests');
      for (const column of columns.slice(0, -1)) expect(sql).toContain(`AS ${column}`);
    }
    const places = asked.find((question) => question.title.includes('places'))!;
    expect(places.sql).toContain('blob4 AS place');
    expect(places.sql).toContain("blob1 = 'tools/call'");
  });

  it('refuses a number of days the host does not keep', () => {
    for (const days of [0, -1, 1.5, MOST_DAYS + 1, Number.NaN]) expect(() => questions(days)).toThrow();
    expect(() => questions(MOST_DAYS)).not.toThrow();
  });

  it('prints tables a person can read', () => {
    expect(table(['tool', 'outcome', 'requests'], [{ tool: 'find_bills', outcome: 'answered', requests: '1204' }, { tool: 'get_law', outcome: 'mistake', requests: 3 }])).toBe(
      ['  tool        outcome   requests', '  ----------  --------  --------', '  find_bills  answered     1,204', '  get_law     mistake          3'].join('\n'),
    );
    expect(table(['place', 'requests'], [])).toBe('  (none in this period)');
    const asked = questions(30);
    const text = report(30, asked, [[{ day: '2027-01-12 00:00:00', requests: 40 }, { day: '2027-01-13 00:00:00', requests: '2' }]]);
    expect(text).toContain('How clinx.org/mcp was used in the last 30 days');
    expect(text).toContain('42 requests in all');
    expect(text).toContain('  2027-01-12        40');
    for (const { title } of asked) expect(text).toContain(title);
  });
});
