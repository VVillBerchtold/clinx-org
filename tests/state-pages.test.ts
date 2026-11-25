import { describe, expect, it } from 'vitest';
import { stateReportTitle, statePages } from '../src/lib/state-pages';
import { STATE_REGISTRY } from '../src/lib/states';

/** A state's pages across the sections, and the one title every state's 340B report page is given. */
describe('the 340B report title', () => {
  it('is "<State> 340B hospital report"', () => {
    expect(stateReportTitle('Minnesota')).toBe('Minnesota 340B hospital report');
  });
});

describe("a state's pages", () => {
  it('include the 340B report of every state in the Scorecard, first', () => {
    for (const [code, entry] of Object.entries(STATE_REGISTRY)) {
      if (entry.status !== 'live' || !entry.href) continue;
      expect(statePages(code)[0]).toEqual({ href: entry.href, label: '340B hospital report' });
    }
  });

  it('link only to pages that are built, each once', () => {
    const pages = statePages('RI');
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    for (const p of pages) expect(p.href).toMatch(/^\/[a-z-]+\/(?:[a-z-]+\/)?ri\/$/);
  });

  it('are empty for a code that is no state', () => {
    expect(statePages('ZZ')).toEqual([]);
  });
});
