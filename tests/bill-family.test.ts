import { describe, expect, it } from 'vitest';
import { LINK_COLUMNS, chainOf, travellingPassage, getFamily, linksCsv, parentLink, parseFamily } from '../src/lib/bill-family';
import { familyMap, familyTreeSvg, markPassage, monthsBetween } from '../src/lib/bill-family-pictures';
import { layFamily } from '../src/lib/family-layout';

const raw = (): string => {
  const modules = import.meta.glob('../src/data/bill-family/340b-bill-family.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return Object.values(modules)[0]!;
};

describe('bill family tree', () => {
  const data = getFamily();

  it('stops on a file it does not understand', () => {
    const d = JSON.parse(raw());
    d.links[0].kind = 'cousin';
    expect(() => parseFamily(JSON.stringify(d))).toThrow(/unknown link kind/);
    const e = JSON.parse(raw());
    e.members[0].parent = 'nobody';
    expect(() => parseFamily(JSON.stringify(e))).toThrow(/not a member/);
  });

  it('draws only links the rules allow: enough shared words and one long run, or the same bill listed twice', () => {
    expect(data.links.length).toBeGreaterThan(0);
    for (const l of data.links) {
      if (l.sameNumber) continue;
      expect(l.sharedWords).toBeGreaterThanOrEqual(data.rules.minShared);
      expect(l.longestWords).toBeGreaterThanOrEqual(data.rules.minLongest);
      expect(l.longestPassage.length).toBeGreaterThan(0);
    }
  });

  it('gives every text a parent that came earlier, with a link that shows the words', () => {
    for (const m of data.members.values()) {
      if (!m.parent) continue;
      const p = data.members.get(m.parent)!;
      expect(p.order <= m.order).toBe(true);
      expect(parentLink(data, m.id)).toBeDefined();
    }
  });

  it('puts each compared text in one family or alone, and each family has one root', () => {
    const seen = new Set<string>();
    for (const f of data.families) {
      expect(data.members.get(f.root)!.parent).toBe('');
      for (const id of f.members) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(chainOf(data, id).at(-1)).toBe(f.root);
      }
    }
    for (const id of data.alone) expect(seen.has(id)).toBe(false);
  });

  it('draws every text in both trees, with one line to each from its parent', () => {
    const f = data.families[0]!;
    for (const layout of ['tidy', 'indent'] as const) {
      const svg = familyTreeSvg(data, f, { id: 't', title: 'T', desc: 'D', layout, fold: true });
      expect(svg.match(/<a class="ft-n/g)?.length).toBe(f.members.length);
      expect(svg.match(/class="ft-e /g)?.length).toBe(f.members.length - 1);
      expect(svg).not.toMatch(/style=/);
    }
  });

  it('lays a folded branch out without the texts under it', () => {
    const f = data.families[0]!;
    const rows = f.members.map((id) => ({ id, parent: data.members.get(id)!.parent, order: data.members.get(id)!.order }));
    const all = layFamily(rows, 'tidy');
    const folded = layFamily(rows, 'tidy', new Set([f.root]));
    expect(all.nodes.length).toBe(f.members.length);
    expect(folded.nodes.map((n) => n.id)).toEqual([f.root]);
    // The tidy tree never puts two texts on the same spot.
    const spots = new Set(all.nodes.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(all.nodes.length);
  });

  it('puts the family on the map: a tile for each state, an arc for each link across a state line', () => {
    const f = data.families[0]!;
    const m = familyMap(data, f, { id: 'm', title: 'T', desc: 'D' });
    expect(Object.keys(m.cards).sort()).toEqual([...f.states].sort());
    const across = f.members.filter((id) => {
      const t = data.members.get(id)!;
      return t.parent && data.members.get(t.parent)!.state !== t.state;
    });
    expect(m.arcs).toBe(across.length);
    expect(m.svg.match(/class="fm-arc"/g)?.length).toBe(across.length);
    expect(m.months[0]! <= m.months.at(-1)!).toBe(true);
    expect(monthsBetween('2024-11', '2025-02')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('marks the shared words inside a passage, and nothing when they are not there', () => {
    expect(markPassage('a covered entity may not be required to', 'Covered entity')).toEqual(['a', 'covered entity', 'may not be required to']);
    expect(markPassage('nothing here', 'covered entity')).toEqual(['nothing here', '', '']);
  });

  it('finds the passage the most links share, and every link it names holds it', () => {
    const p = travellingPassage(data, data.families[0]!);
    expect(p.words.split(' ').length).toBeGreaterThanOrEqual(12);
    expect(p.links.length).toBeGreaterThan(2);
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
    for (const l of p.links) expect(norm(l.longestPassage)).toContain(norm(p.words));
  });

  it('writes the links download with its header and one row per link', () => {
    const csv = linksCsv(raw());
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(LINK_COLUMNS.join(','));
    expect(lines.length - 1).toBeGreaterThanOrEqual(data.links.length);
  });
});
