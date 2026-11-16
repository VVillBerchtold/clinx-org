import { describe, expect, it } from 'vitest';
import list from '../scripts/brand/share-cards.json';
import { SHARE_CARDS, shareCard, shareCardFor } from '../src/lib/share-cards';

// The pictures are read as they are kept in the repository, as base64 text, and turned back into bytes.
const pictures = import.meta.glob('../public/brand/**/*.png', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;
const bytesOf = (path: string): Uint8Array => {
  const url = pictures[`../public${path}`];
  if (url === undefined) throw new Error(`No picture at ${path}`);
  const binary = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};
const word = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

describe('share cards', () => {
  it('has one picture for each card, 1200 by 630, a PNG, and small', () => {
    expect(SHARE_CARDS.length).toBe(list.cards.length);
    expect(new Set(SHARE_CARDS.map((c) => c.id)).size).toBe(SHARE_CARDS.length);
    for (const card of SHARE_CARDS) {
      const bytes = bytesOf(card.path);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect([word(bytes, 16), word(bytes, 20)]).toEqual([1200, 630]);
      expect([card.width, card.height]).toEqual([1200, 630]);
      expect(bytes.length).toBeLessThan(120 * 1024);
      expect(card.alt.length).toBeGreaterThan(10);
    }
  });

  it('keeps the old single picture out of the site', () => {
    expect(Object.keys(pictures)).not.toContain('../public/brand/share-card.png');
  });

  it('gives every page the card of its section, and the home card to pages outside every section', () => {
    expect(shareCardFor('/').id).toBe('home');
    expect(shareCardFor('/scorecard/').id).toBe('scorecard');
    expect(shareCardFor('/scorecard/ri/').id).toBe('scorecard');
    expect(shareCardFor('/laws/ri/').id).toBe('laws');
    expect(shareCardFor('/bills/congress/').id).toBe('bills');
    expect(shareCardFor('/calendar/ri/').id).toBe('calendar');
    expect(shareCardFor('/notices/').id).toBe('notices');
    expect(shareCardFor('/rebate-pilot/').id).toBe('notices');
    expect(shareCardFor('/tools/file-check/').id).toBe('tools');
    expect(shareCardFor('/data/').id).toBe('data');
    expect(shareCardFor('/methods/').id).toBe('methods');
    expect(shareCardFor('/about/').id).toBe('about');
    expect(shareCardFor('/writing/check-a-page/').id).toBe('writing');
    expect(shareCardFor('/contact/').id).toBe('home');
    expect(shareCardFor('/privacy/').id).toBe('home');
    expect(shareCardFor('/404.html').id).toBe('home');
    expect(() => shareCard('nowhere')).toThrow();
  });

  it('puts no count in a card, since a count goes out of date', () => {
    for (const card of list.cards) expect(`${card.title} ${card.line}`).not.toMatch(/\b\d{2,}\b/);
  });
});
