import { describe, expect, it } from 'vitest';
import { BANDS, R, STATE_COLUMNS, bandShares, hubCards, hubMapSvg, pct, reachPlaces, stackSvg, statesCsv, toMapSvg } from '../src/lib/reach';

const sum = (b: Record<string, number>): number => BANDS.reduce((s, k) => s + (b[k] ?? 0), 0);

describe('contract pharmacy reach', () => {
  const places = reachPlaces();

  it('splits every arrangement into exactly one band, in each place and in the whole country', () => {
    for (const c of places) expect(sum(R.states[c]!.bands)).toBe(R.states[c]!.arrangements);
    expect(sum(R.national.bands)).toBe(R.national.arrangements);
    expect(places.reduce((s, c) => s + R.states[c]!.arrangements, 0)).toBe(R.national.arrangements);
    expect(places.reduce((s, c) => s + R.states[c]!.holders, 0)).toBe(R.national.holders);
  });

  it('counts the same arrangements leaving the states as arriving in them', () => {
    const leaving = places.reduce((s, c) => s + R.states[c]!.bands.neighbor + R.states[c]!.bands.farther, 0);
    const arriving = Object.values(R.states).reduce((s, p) => s + p.in_arrangements, 0);
    expect(arriving).toBe(leaving);
  });

  it('adds up the pharmacy groups and the kinds of entity to the national total', () => {
    expect(Object.values(R.chains).reduce((s, b) => s + sum(b), 0)).toBe(R.national.arrangements);
    expect(Object.values(R.types).reduce((s, b) => s + sum(b), 0)).toBe(R.national.arrangements);
  });

  it('uses a border table that runs both ways, and puts neighbours only in the neighbour band', () => {
    const n = R.rules.neighbors;
    for (const [a, list] of Object.entries(n)) for (const b of list) expect(n[b]).toContain(a);
    expect(n['AZ']).not.toContain('CO');
    expect(n['RI']).toEqual(['CT', 'MA']);
  });

  it('lists where a place reaches without itself, largest first', () => {
    for (const c of places) {
      const to = R.states[c]!.to;
      expect(to.some(([s]) => s === c)).toBe(false);
      for (let i = 1; i < to.length; i++) expect(to[i - 1]![1]).toBeGreaterThanOrEqual(to[i]![1]);
      expect(to.reduce((s, [, k]) => s + k, 0)).toBeLessThanOrEqual(R.states[c]!.bands.neighbor + R.states[c]!.bands.farther);
    }
  });

  it('draws the maps and the bars, and gives a card for every place', () => {
    expect(hubMapSvg('t').match(/<a /g)?.length).toBe(places.length);
    expect(toMapSvg('RI', 'u')).toContain('tile-g has here t-ri');
    expect(hubCards().length).toBe(places.length);
    expect(stackSvg(R.national.bands).match(/<rect/g)?.length).toBe(3);
    expect(bandShares(R.national.bands).reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 9);
  });

  it('writes the download with its header and one row per place', () => {
    const lines = statesCsv().trimEnd().split('\n');
    expect(lines[0]).toBe(STATE_COLUMNS.join(','));
    expect(lines.length - 1).toBe(places.length);
  });

  it('prints a share, and a tiny one as under 1%', () => {
    expect(pct(1, 4)).toBe('25%');
    expect(pct(1, 1000)).toBe('under 1%');
    expect(pct(0, 0)).toBe('–');
  });
});
