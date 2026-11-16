import { describe, expect, it } from 'vitest';
import { ASSISTANTS_PAGE } from '../worker/assistants';
import { HEALTH_CENTER_TOOLS } from '../worker/mcp/health-center-tools.js';
import { TOOLS } from '../worker/mcp/tools.js';
import { ASSISTANTS_ADDRESS, CLAUDE_ADD_LINK, TOOL_LINES, VSCODE_ADD_LINK, VSCODE_SETTINGS, assistantToolCount, assistantToolGroups } from '../src/lib/assistant-tools';
import page from '../src/pages/data/assistants/index.astro?raw';
import dataPage from '../src/pages/data/index.astro?raw';

/**
 * The page that tells a person how to use ClinX with an AI assistant lists every lookup the server
 * offers. The list is read from the server's own definitions, so it cannot fall behind them.
 */
describe('the list of lookups on the assistants page', () => {
  const groups = assistantToolGroups();
  const listed = groups.flatMap((g) => g.tools);

  it('holds every lookup the server lists, once, with the server\'s own title', () => {
    expect(listed.length).toBe(TOOLS.length);
    expect(assistantToolCount()).toBe(TOOLS.length);
    expect(listed.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of listed) expect(t.title).toBe(TOOLS.find((d) => d.name === t.name)!.title);
  });

  it('puts the health center lookups in their own group, in the server\'s order', () => {
    const hc = groups.find((g) => g.id === 'health-centers')!;
    expect(hc.tools.map((t) => t.name)).toEqual(HEALTH_CENTER_TOOLS.map((t) => t.name));
    const first = groups.find((g) => g.id === '340b')!;
    const hcNames = new Set(HEALTH_CENTER_TOOLS.map((t) => t.name));
    expect(first.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name).filter((n) => !hcNames.has(n) && n !== 'about_the_data'));
    expect(groups.find((g) => g.id === 'all')!.tools.map((t) => t.name)).toEqual(['about_the_data']);
  });

  it('gives each lookup one plain line with none of the words the site never uses', () => {
    for (const t of listed) {
      expect(t.line.length).toBeGreaterThan(30);
      expect(t.line.length).toBeLessThan(200);
      expect(t.line).not.toMatch(/\b(?:highest|lowest|worst|best)\b|\btop\s/i);
      expect(t.line).not.toMatch(/[—–]/);
      // A reader never sees the names of the inputs.
      expect(t.line).not.toMatch(/_id\b|\bfind_|\bget_/);
    }
  });

  it('stops the build when no lookup is read', () => {
    expect(() => assistantToolGroups([], [])).toThrow(/No lookups were read/);
  });

  it('stops the build when the server adds a lookup that has no line', () => {
    const more = [...TOOLS, { name: 'find_something_new', title: 'Something new' }];
    expect(() => assistantToolGroups(more, HEALTH_CENTER_TOOLS)).toThrow(/find_something_new has no line/);
  });

  it('stops the build when a line names a lookup the server no longer lists', () => {
    const fewer = TOOLS.filter((t) => t.name !== 'get_law');
    expect(() => assistantToolGroups(fewer, HEALTH_CENTER_TOOLS)).toThrow(/get_law/);
    expect(Object.keys(TOOL_LINES).length).toBe(TOOLS.length);
  });
});

describe('the assistants page', () => {
  it('is the page a browser is sent to from the address', () => {
    expect(ASSISTANTS_PAGE).toBe('/data/assistants/');
  });

  it('builds its list from the definitions and writes no lookup by hand', () => {
    expect(page).toContain('assistantToolGroups()');
    expect(page).toContain('<strong>{t.title}</strong>');
    for (const t of TOOLS) expect(page).not.toContain(`<strong>${t.title}`);
  });

  it('gives the address and the ways to add it', () => {
    expect(ASSISTANTS_ADDRESS).toBe('https://clinx.org/mcp');
    expect(CLAUDE_ADD_LINK).toBe('https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=ClinX&connectorUrl=https%3A%2F%2Fclinx.org%2Fmcp');
    expect(JSON.parse(VSCODE_SETTINGS)).toEqual({ servers: { clinx: { type: 'http', url: 'https://clinx.org/mcp' } } });
    expect(VSCODE_ADD_LINK.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(VSCODE_ADD_LINK.slice('vscode:mcp/install?'.length)))).toEqual({ name: 'clinx', type: 'http', url: 'https://clinx.org/mcp' });
  });

  it('has its parts in order', () => {
    const ids = [...page.matchAll(/<h2 id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['address', 'add', 'answers', 'questions', 'keep-in-mind', 'privacy', 'problem', 'code']);
    expect(page).toContain('href="/privacy/#assistants"');
    expect(page).toContain('href="/contact/"');
    expect(page).toContain('REPOSITORIES.assistants');
  });

  it('has at least three questions to try for 340B and three for health centers', () => {
    const block = page.slice(page.indexOf('const questions'), page.indexOf('---', page.indexOf('const questions')));
    const parts = block.split("label: '").slice(1);
    expect(parts.length).toBe(2);
    for (const part of parts) expect((part.match(/\?',/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('never says what a page about assistants must not say', () => {
    expect(page).not.toMatch(/anonymi[sz]ed|de-identified|\bsafe\b|HIPAA/i);
  });
});

describe('the Data page', () => {
  it('keeps its part on assistants short and points to the page', () => {
    expect(dataPage).toContain('<h2 id="assistants">');
    expect(dataPage).toContain('href="/data/assistants/"');
    expect(dataPage).not.toContain('Questions to try');
  });
});
