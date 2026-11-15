import { describe, expect, it } from 'vitest';
import { KIND_PAGES, LAW_KINDS, kindOpening, kindPath, lawName, lawsMapSvg, lawsOf, lawsOfKind, lawsPath, ownerOf, parseLaws, savedTextUrl, statesByLaws } from '../src/lib/laws';
import { KNOWN_LAW_KINDS } from '../scripts/dataset-shape.mjs';
import { STATES, STATE_REGISTRY } from '../src/lib/states';

/** The laws table of the copy of the dataset in this site. */
function load() {
  const modules = import.meta.glob('../src/data/dataset/340b-state-laws.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return parseLaws(Object.values(modules)[0]!);
}

describe('state laws', () => {
  const data = load();

  it('knows the same kinds as the check that guards the copy of the dataset', () => {
    expect([...LAW_KINDS]).toEqual(KNOWN_LAW_KINDS);
    expect(data.kinds.map((k) => k.kind)).toEqual([...LAW_KINDS]);
  });

  it('gives every law a name, a kind, a quote that names the program and an https link', () => {
    expect(data.laws.length).toBeGreaterThan(0);
    for (const law of data.laws) {
      expect(lawName(law)).not.toBe('');
      expect(law.kinds.length).toBeGreaterThan(0);
      expect(law.quote).toMatch(/340\s?\(?b\)?|256b/i); // Pennsylvania's law prints it as 340(b)
      expect(law.sourceUrl).toMatch(/^https:\/\//);
      expect(law.lawId.slice(0, 2).toUpperCase()).toBe(law.state);
    }
    expect(new Set(data.laws.map((l) => l.lawId)).size).toBe(data.laws.length);
  });

  it('can name the office behind every link it shows', () => {
    for (const law of data.laws) {
      expect(ownerOf(data, law.state, law.sourceUrl)).not.toBe('');
      if (law.moreUrl) expect(ownerOf(data, law.state, law.moreUrl)).not.toBe('');
    }
    expect(() => ownerOf(data, 'RI', 'https://example.com/a')).toThrow();
  });

  it('puts every state in one of two lists, and every law under its state and its kinds', () => {
    const { withLaws, without } = statesByLaws(data);
    expect(withLaws.length + without.length).toBe(STATES.length);
    expect(withLaws.reduce((n, s) => n + lawsOf(data, s.code).length, 0)).toBe(data.laws.length);
    for (const s of without) expect(lawsOf(data, s.code)).toEqual([]);
    const underKinds = LAW_KINDS.reduce((n, k) => n + lawsOfKind(data, k).length, 0);
    expect(underKinds).toBe(data.laws.reduce((n, l) => n + l.kinds.length, 0));
  });

  it('draws a map where a state with a law opens its page and a state with none is a plain tile', () => {
    const { withLaws, without } = statesByLaws(data);
    const svg = lawsMapSvg(data, 't', { current: 'RI' });
    expect(svg.split('<a ').length - 1).toBe(withLaws.length);
    expect(svg.split('class="tile-g has').length - 1).toBe(withLaws.length);
    expect(svg.split('class="tile-g none').length - 1).toBe(without.length);
    expect(withLaws.length + without.length).toBe(STATES.length);
    expect(svg).toContain(`href="${lawsPath('RI')}"`);
    for (const s of without) expect(svg).not.toContain(`href="${lawsPath(s.code)}"`);
    expect(svg.split('aria-current="page"').length - 1).toBe(1);
    expect(svg).not.toMatch(/\sstyle=/);
  });

  it('fills only the states with a law of one kind on that kind\'s map', () => {
    const reporting = new Set(lawsOfKind(data, 'reporting').map((l) => l.state));
    const svg = lawsMapSvg(data, 't', { kind: 'reporting' });
    expect(svg.split('<a ').length - 1).toBe(reporting.size);
    for (const code of reporting) expect(svg).toContain(`href="${lawsPath(code)}"`);
  });

  it('gives every kind a page of its own, with a heading and an opening line that stands alone', () => {
    for (const info of data.kinds) {
      expect(kindPath(info.kind)).toBe(`/laws/${info.kind}/`);
      expect(KIND_PAGES[info.kind].heading).not.toBe('');
      expect(kindOpening(info)).toMatch(/^[A-Z].*\.$/);
      expect(kindOpening(info)).not.toMatch(/kinds above/);
    }
    expect(lawsPath('RI')).toBe('/laws/ri/');
  });

  it('points a saved text at the dataset repository, at the version of the data', () => {
    const law = data.laws[0]!;
    expect(savedTextUrl(data, law.sourceText)).toBe(`https://github.com/VVillBerchtold/clinx-340b/blob/v${data.version}/${law.sourceText}`);
  });

  it('has a reporting law in the table for every state the scorecard says has one', () => {
    const reporting = new Set(lawsOfKind(data, 'reporting').map((l) => l.state));
    for (const [code, entry] of Object.entries(STATE_REGISTRY)) {
      if (entry.status === 'law') expect(reporting.has(code), code).toBe(true);
    }
  });

  it('refuses a file with a kind it has no label for', () => {
    const bad = JSON.stringify({ dataset_version: '0', kinds: [{ kind: 'made-up', label: 'x', description: 'y' }], laws: [], not_listed: [], sites: [] });
    expect(() => parseLaws(bad)).toThrow(/unknown kind/);
  });
});
