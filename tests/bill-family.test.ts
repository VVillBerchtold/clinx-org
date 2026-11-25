import { describe, expect, it } from 'vitest';
import { LINK_COLUMNS, chainOf, familySvg, getFamily, linksCsv, parentLink, parseFamily } from '../src/lib/bill-family';

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

  it('draws one row in the picture per member of the family', () => {
    const f = data.families[0]!;
    const svg = familySvg(data, f, 'bf-test');
    expect(svg.match(/class="bf-row"/g)?.length).toBe(f.members.length);
  });

  it('writes the links download with its header and one row per link', () => {
    const csv = linksCsv(raw());
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(LINK_COLUMNS.join(','));
    expect(lines.length - 1).toBeGreaterThanOrEqual(data.links.length);
  });
});
