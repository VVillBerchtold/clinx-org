import { describe, expect, it } from 'vitest';
import { STATES, STATE_REGISTRY, stateName, statesWith, tileMapSvg } from '../src/lib/states';

describe('states', () => {
  it('lists the 50 states and the District of Columbia once each', () => {
    expect(STATES.length).toBe(51);
    expect(new Set(STATES.map((s) => s.code)).size).toBe(51);
    expect(new Set(STATES.map((s) => s.name)).size).toBe(51);
  });
  it('gives no two states the same tile', () => {
    expect(new Set(STATES.map((s) => `${s.col},${s.row}`)).size).toBe(51);
  });
  it('registers only known states, and every live state has a page', () => {
    for (const [code, entry] of Object.entries(STATE_REGISTRY)) {
      expect(() => stateName(code)).not.toThrow();
      if (entry.status === 'live') expect(entry.href).toMatch(/^\/scorecard\/[a-z]{2}\/$/);
      if (entry.status === 'law') {
        expect(entry.visibility).toBeDefined();
        expect(entry.stands ?? '').toMatch(/\.$/);
        expect(entry.sources?.length ?? 0).toBeGreaterThan(0);
        for (const src of entry.sources ?? []) expect(src.href).toMatch(/^https:\/\//);
      }
    }
  });
  it('has Rhode Island and Vermont live, and keeps Vermont\'s law and Board links', () => {
    expect(statesWith('live').map((s) => s.code)).toEqual(['MN', 'RI', 'VT']);
    const vt = STATE_REGISTRY['VT']!;
    expect(vt.href).toBe('/scorecard/vt/');
    expect(vt.summary).toBe('Fiscal year 2025 · marked draft by the state');
    expect(vt.sources?.map((x) => x.href)).toContain('https://gmcboard.vermont.gov/node/24841');
    expect(vt.listingNote?.quote).toBe('Brattleboro Memorial Hospital - did not report in 2026 for FY 2025');
  });
  it('draws every state, links the live ones and carries no style attribute', () => {
    const svg = tileMapSvg('t');
    expect(svg.split('class="tile"').length - 1).toBe(51);
    expect(svg.split('<a ').length - 1).toBe(statesWith('live').length);
    expect(svg).toContain('href="/scorecard/ri/"');
    expect(svg).toContain('href="/scorecard/vt/"');
    expect(svg).not.toMatch(/\sstyle=/);
  });
});
