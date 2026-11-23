import { describe, expect, it } from 'vitest';
import { H, FULL_RECORD_FROM, at, flowMap, lastMonth, lawStates, lineChart, niceTicks } from '../src/lib/registry';

describe('registry history data', () => {
  it('has one value per month for every national series, with no gaps in the months', () => {
    const n = H.months.length;
    expect(H.months[0]).toBe('2010-01');
    for (let i = 1; i < n; i++) {
      const [y, m] = H.months[i - 1]!.split('-').map(Number) as [number, number];
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      expect(H.months[i]).toBe(next);
    }
    for (const v of Object.values(H.national)) expect(v).toHaveLength(n);
  });

  it('adds up: chain groups and entity kinds sum to the national arrangements', () => {
    const m = lastMonth();
    const chains = H.chains.groups.reduce((a, g) => a + at(H.chains.arrangements[g]!, m), 0);
    const kinds = H.types.groups.reduce((a, g) => a + at(H.types.arrangements[g]!, m), 0);
    expect(chains).toBe(at(H.national.arrangements, m));
    expect(kinds).toBe(at(H.national.arrangements, m));
    expect(at(H.national.out_of_state, m)).toBeLessThan(at(H.national.arrangements, m));
  });

  it('dates every contract pharmacy law it charts, one chart per state', () => {
    const laws = lawStates();
    expect(new Set(laws.map((l) => l.state)).size).toBe(laws.length);
    for (const l of laws) expect(l.effective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('starts the full record of endings in 2017', () => {
    expect(H.months).toContain(FULL_RECORD_FROM);
  });
});

describe('registry charts', () => {
  it('makes round axis steps that reach the largest value', () => {
    expect(niceTicks(232731, 5)).toEqual([0, 50000, 100000, 150000, 200000, 250000]);
    expect(niceTicks(7.5, 4)).toEqual([0, 2, 4, 6, 8]);
  });

  it('draws both sizes, writes no style attribute, and carries the numbers for the hover layer', () => {
    const c = lineChart({ id: 't', frame: 'hero', title: 'T', desc: 'D', series: [{ key: 'a', label: 'a', values: H.national.arrangements, slot: 1 }] });
    expect(c.wide).toContain('rx-wide');
    expect(c.narrow).toContain('rx-narrow');
    expect(c.wide + c.narrow).not.toMatch(/style=/);
    expect(JSON.parse(c.data).series[0].values).toHaveLength(H.months.length);
  });

  it('keeps the flow map to the 40 largest pairs of states', () => {
    const f = flowMap(lastMonth());
    expect((f.svg.match(/class="fm-arc"/g) ?? []).length).toBe(40);
    expect(f.shown).toBeLessThanOrEqual(f.total);
  });
});
