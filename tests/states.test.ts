import { describe, expect, it } from 'vitest';
import { GROUP_IDS, REPORTING_GROUPS, STATES, STATE_REGISTRY, stateName, statesFile, statesFileText, statesInGroup, statesWith, tileMapSvg } from '../src/lib/states';

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
  it('has Idaho, Maine, Minnesota, Ohio, Rhode Island and Vermont live, and keeps Vermont\'s law and Board links', () => {
    expect(statesWith('live').map((s) => s.code)).toEqual(['ID', 'ME', 'MN', 'OH', 'RI', 'VT']);
    const vt = STATE_REGISTRY['VT']!;
    expect(vt.href).toBe('/scorecard/vt/');
    expect(vt.summary).toBe('Fiscal year 2025 · marked draft by the state');
    expect(vt.sources?.map((x) => x.href)).toContain('https://gmcboard.vermont.gov/node/24841');
    expect(vt.listingNote?.quote).toBe('Brattleboro Memorial Hospital - did not report in 2026 for FY 2025');
  });
  it('keeps Idaho\'s law, its report and the state page that lists it, in the law\'s own words for the date', () => {
    const id = STATE_REGISTRY['ID']!;
    expect(id.status).toBe('live');
    expect(id.href).toBe('/scorecard/id/');
    expect(id.visibility).toBe('totals');
    expect(id.stands).toContain('Before November 15');
    expect(id.stands).not.toMatch(/by November 15/);
    expect(id.sources?.map((x) => x.href)).toEqual([
      'https://legislature.idaho.gov/statutesrules/idstat/Title41/T41CH3/SECT41-351/',
      'https://idaho-sco-central-registry-documents.s3.us-gov-west-1.amazonaws.com/340B+Program+Reports/CY2025+340B+Program+Report.pdf',
      'https://transparent.idaho.gov/featured-resources',
    ]);
  });
  it('draws every state, links the live ones and carries no style attribute', () => {
    const svg = tileMapSvg('t');
    expect(svg.split('class="tile"').length - 1).toBe(51);
    expect(svg.split('<a ').length - 1).toBe(statesWith('live').length);
    expect(svg).toContain('href="/scorecard/ri/"');
    expect(svg).toContain('href="/scorecard/vt/"');
    expect(svg).toContain('href="/scorecard/id/"');
    expect(svg).toContain('href="/scorecard/oh/"');
    expect(svg).not.toMatch(/\sstyle=/);
  });
});

describe('kinds of reporting', () => {
  it('puts every state with a reporting law in one of the four kinds, as agreed', () => {
    expect(GROUP_IDS).toEqual(['own-reports', 'named-in-state-report', 'state-totals', 'not-posted-yet']);
    const members = (id: (typeof GROUP_IDS)[number]): string[] => statesInGroup(id).map((s) => s.code).sort();
    expect(members('own-reports')).toEqual(['OH', 'RI', 'VT']);
    expect(members('named-in-state-report')).toEqual(['MN']);
    expect(members('state-totals')).toEqual(['HI', 'ID', 'IN', 'ME']);
    expect(members('not-posted-yet')).toEqual(['CO', 'IL', 'WA']);
    expect(Object.keys(STATE_REGISTRY).sort()).toEqual(GROUP_IDS.flatMap(members).sort());
    for (const g of REPORTING_GROUPS) expect(g.description).toMatch(/\.$/);
  });

  it('says what is public today for every state, and never claims a report that is not there', () => {
    for (const e of Object.values(STATE_REGISTRY)) expect(e.publicNow).toMatch(/\.$/);
    expect(STATE_REGISTRY['OH']!.publicNow).toContain('241 Excel workbooks');
    expect(STATE_REGISTRY['ME']!.stands).toContain('summary report');
    expect(STATE_REGISTRY['ME']!.stands).not.toMatch(/post each report/);
    expect(STATE_REGISTRY['IN']!.stands).not.toMatch(/public report/);
    expect(STATE_REGISTRY['IL']!.stands).toContain('August 1, 2027');
    expect(STATE_REGISTRY['IL']!.stands).toContain('a reading of the dates');
    expect(STATE_REGISTRY['WA']!.publicNow).toContain('not a report under this law');
  });

  it('writes the open file from the registry in the agreed shape', () => {
    const file = statesFile('https://clinx.org');
    expect(Object.keys(file)).toEqual(['about', 'updated', 'groups', 'states']);
    expect(file.groups.map((g) => g.id)).toEqual([...GROUP_IDS]);
    expect(file.states.length).toBe(Object.keys(STATE_REGISTRY).length);
    for (const st of file.states) {
      expect(Object.keys(st)).toEqual(['state', 'name', 'group', 'on_clinx', 'what_is_public', 'where_it_stands', 'scorecard_url', 'sources']);
      const entry = STATE_REGISTRY[st.state]!;
      expect(st.group).toBe(entry.group);
      expect(st.on_clinx).toBe(entry.status === 'live');
      expect(st.scorecard_url).toBe(st.on_clinx ? `https://clinx.org${entry.href}` : null);
      expect(st.sources.length).toBeGreaterThan(0);
      for (const src of st.sources) expect(src.url).toMatch(/^https:\/\//);
    }
    expect(file.states.filter((s) => s.on_clinx).map((s) => s.state).sort()).toEqual(['ID', 'ME', 'MN', 'OH', 'RI', 'VT']);
    expect(statesFileText('https://clinx.org').endsWith('\n')).toBe(true);
    // No person's name, address or number goes in the file.
    expect(statesFileText('https://clinx.org')).not.toMatch(/@[a-z0-9-]+\.|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/i);
  });
});
