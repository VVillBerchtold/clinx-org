import { beforeEach, describe, expect, it } from 'vitest';
import { ASSISTANTS_PAGE, COUNT_COLUMNS, WAIT_SECONDS, forgetTables, handleAssistants, type AssistantsEnv } from '../worker/assistants';
import worker, { type SiteEnv } from '../worker/index';
import config from '../wrangler.jsonc?raw';
import { split } from '../worker/mcp/split.js';
import { FILES, reportFile } from '../worker/mcp/tables.js';
import { HC_FILES, areaFile, centerFile } from '../worker/mcp/health-centers.js';
import { ASSISTANT_FILES, linesIndex, recordsIndex, setsIndex } from '../src/lib/hc-assistant';
import { rawFile as areasFile } from '../src/lib/hc-areas';
import { fundingFile } from '../src/lib/hc-funding';
import { centerKeys, rawFile as recordsFile } from '../src/lib/hc-records';

/**
 * The door for assistants, checked against the files this site was built from (public/data and src/data/health-centers).
 * No network is used: the made-up host below hands out the site's own files, as the real one does.
 */
const SITE = 'https://clinx.org';
const TABLES = import.meta.glob('../public/data/340b-*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// The site also writes an index of the filed reports and one file for each report at build time (src/pages/data), cut by the server's own `split`: the made-up host hands them out the same way.
const CUT = split(JSON.parse(TABLES['../public/data/340b-state-filings.json']!));
// The health center files are written at build time too (src/pages/data/health-centers): three small files made by src/lib/hc-assistant.ts, and the copied files as they are.
const made = new Map<string, string>();
const once = (name: string, make: () => unknown): string => {
  if (!made.has(name)) made.set(name, JSON.stringify(make()));
  return made.get(name)!;
};
const healthCenterText = (name: string): string | undefined => {
  if (name === HC_FILES.sets) return once(name, setsIndex);
  if (name === HC_FILES.records) return once(name, recordsIndex);
  if (name === HC_FILES.lines) return once(name, linesIndex);
  if (name === HC_FILES.opportunities) return fundingFile('opportunities.json');
  if (name === HC_FILES.deadlines) return fundingFile('deadlines.json');
  if (name === HC_FILES.areas) return areasFile('states.json');
  const key = centerKeys().find((k) => centerFile(k) === name);
  if (key !== undefined) return recordsFile(`centers/${key}.json`);
  const state = /^health-centers\/areas\/states\/([a-z]{2})\.json$/.exec(name);
  if (state && areaFile(state[1]!) === name) {
    try {
      return areasFile(`states/${state[1]!.toUpperCase()}.json`);
    } catch {
      return undefined;
    }
  }
  return undefined;
};
const tableText = (name: string): string | undefined => {
  if (name.startsWith('health-centers/')) return healthCenterText(name);
  if (name === FILES.filingsIndex) return JSON.stringify(CUT.index);
  const id = Object.keys(CUT.reports).find((k) => reportFile(k) === name);
  if (id !== undefined) return JSON.stringify(CUT.reports[id]);
  return TABLES[`../public/data/${name}`];
};

interface Point {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

function makeEnv(options: { allow?: (key: string) => boolean; counts?: boolean; missing?: (pathname: string) => boolean } = {}) {
  const asked: string[] = [];
  const points: Point[] = [];
  const keys: string[] = [];
  const env: AssistantsEnv = {
    ASSETS: {
      fetch: async (request) => {
        const { pathname } = new URL(request.url);
        asked.push(pathname);
        const text = pathname.startsWith('/data/') && !options.missing?.(pathname) ? tableText(pathname.slice('/data/'.length)) : undefined;
        if (text === undefined) return new Response('Not found', { status: 404 });
        return new Response(text, { headers: { 'Content-Type': 'application/json' } });
      },
    },
    MCP_LIMIT: { limit: async ({ key }) => (keys.push(key), { success: options.allow ? options.allow(key) : true }) },
    ...(options.counts === false ? {} : { MCP_USAGE: { writeDataPoint: (point: Point) => void points.push(point) } }),
    SITE_ORIGIN: SITE,
  };
  return { env, asked, points, keys };
}

const ask = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`${SITE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'CF-Connecting-IP': '203.0.113.7', ...headers }, body: JSON.stringify(body) });
const call = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const row = (point: Point) => Object.fromEntries(COUNT_COLUMNS.map((column, i) => [column, point.blobs[i]]));

interface Reply {
  result: { isError: boolean; content: { type: string; text: string }[]; tools: { name: string }[] };
  error?: { code: number; message: string };
}
/** A tool's answer as an object. The reply carries it once, as JSON in one block of text. */
const read = (result: Reply['result']): Record<string, any> => JSON.parse(result.content[0]!.text);

beforeEach(() => forgetTables());

describe('the door for assistants: answers', () => {
  it('lists the tools and answers a question from the site\'s own files', async () => {
    const { env, asked } = makeEnv();
    const listed = (await (await handleAssistants(ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), env)).json()) as Reply;
    expect(listed.result.tools.map((t) => t.name)).toEqual(['find_bills', 'get_bill', 'find_laws', 'get_law', 'find_notices', 'get_notice', 'calendar', 'reporting_states', 'find_filings', 'get_filing', 'state_overview', 'find_health_centers', 'get_health_center_report', 'find_funding_opportunities', 'health_center_calendar', 'shortage_area_changes', 'about_the_data']);
    expect(asked).toEqual([]);

    const response = await handleAssistants(ask(call('about_the_data')), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = ((await response.json()) as Reply).result;
    // The answer is in the reply once, as text.
    expect(Object.keys(result)).toEqual(['content', 'isError']);
    const about = read(result);
    const built = JSON.parse(tableText('340b-notices.json')!) as { notices: unknown[] };
    expect(about.counts.notices).toBe(built.notices.length);
    expect(about.counts.bills).toBeGreaterThan(200);
    expect([...asked].sort()).toEqual(['/data/340b-bills.json', '/data/340b-events.json', '/data/340b-filings-index.json', '/data/340b-notices.json', '/data/340b-reporting-states.json', '/data/340b-state-laws.json', '/data/health-centers/index.json']);
    // The one health center file about_the_data reads is the small page of facts about the three sets.
    expect(about.health_centers.records.health_centers).toBe(recordsIndex().health_centers.length);
    expect(about.health_centers.funding.read_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(about.health_centers.shortage_areas.read_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await handleAssistants(ask(call('find_bills', { state: 'RI' })), env);
    expect(asked).toHaveLength(7);
  });

  it('answers the health center questions from the site\'s own files, each value as the file holds it', async () => {
    const { env, asked } = makeEnv();
    const answer = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = ((await (await handleAssistants(ask(call(name, args)), env)).json()) as Reply).result;
      expect(reply.isError, name).toBe(false);
      return read(reply);
    };
    // A 340B question reads no health center file.
    await answer('find_bills', { state: 'RI' });
    expect(asked.filter((path) => path.startsWith('/data/health-centers/'))).toEqual([]);

    const index = recordsIndex();
    const found = await answer('find_health_centers', { state: 'RI', limit: 100 });
    expect(found.matched).toBe(index.health_centers.filter((c) => c.state === 'RI').length);
    expect(found.matched).toBeGreaterThan(0);
    expect(asked.filter((path) => path.startsWith('/data/health-centers/'))).toEqual([ASSISTANT_FILES.records]);
    const names = (found.health_centers as { name: string }[]).map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));

    // One table of one report: every value and every mark is the one in the health center's own file.
    const first = found.health_centers[0] as { key: string; clinx_page: string };
    expect(first.clinx_page).toBe(`${SITE}${index.health_centers.find((c) => c.key === first.key)!.page}`);
    const listed = await answer('get_health_center_report', { health_center: first.key });
    expect(listed.year).toBe(index.latest_year);
    const tableName = (listed.tables as { table: string; status: string }[]).find((t) => t.status === 'present')!.table;
    const table = await answer('get_health_center_report', { health_center: first.key, table: tableName, limit: 200 });
    const own = JSON.parse(recordsFile(`centers/${first.key}.json`)) as { years: Record<string, { values: Record<string, string | null> }> };
    const published = new Set(Object.values(own.years[String(index.latest_year)]!.values));
    let cells = 0;
    for (const line of table.lines as { cells: { value?: string; mark?: string; means?: string }[] }[]) {
      for (const cell of line.cells) {
        cells += 1;
        if (cell.value !== undefined) expect(published.has(cell.value)).toBe(true);
        if (cell.mark !== undefined) expect(['-', '--', '---']).toContain(cell.mark), expect(cell.means).toBeTruthy();
      }
    }
    expect(cells).toBeGreaterThan(0);
    expect(asked).toContain(ASSISTANT_FILES.lines);
    expect(asked).toContain(`/data/${centerFile(first.key)}`);

    const sets = setsIndex();
    const funding = await answer('find_funding_opportunities', { limit: 100 });
    expect(funding.matched).toBe((sets.funding as { opportunities: number }).opportunities);
    expect(funding.read_on).toBe((sets.funding as { read_on: string }).read_on);
    const dates = await answer('health_center_calendar', { from: '2000-01-01', limit: 100 });
    expect(dates.matched).toBe((sets.funding as { dated_lines: number }).dated_lines);

    const states = JSON.parse(areasFile('states.json')) as { states: Record<string, unknown> };
    const nation = await answer('shortage_area_changes');
    expect(nation.national_counts).toEqual((sets.areas as { national_counts: unknown }).national_counts);
    const ri = await answer('shortage_area_changes', { state: 'RI' });
    expect(ri.counts).toEqual(states.states['RI']);
    const proposed = await answer('shortage_area_changes', { state: 'RI', show: 'proposed', limit: 100 });
    expect(proposed.matched).toBe((JSON.parse(areasFile('states/RI.json')) as { proposed: unknown[] }).proposed.length);
    expect(asked).toContain(`/data/${areaFile('RI')}`);

    // No answer holds an email address or a phone number.
    const said = JSON.stringify([found, listed, table, funding, dates, nation, ri, proposed]);
    expect(said).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(said).not.toMatch(/\(?\b\d{3}\)?[ .-]\d{3}[.-]\d{4}\b/);
  });

  it('goes on answering about 340B when the health center files cannot be read, and says so for a health center question', async () => {
    const { env, points } = makeEnv({ missing: (pathname) => pathname.startsWith('/data/health-centers/') });
    const reply = async (name: string, args: Record<string, unknown> = {}) => ((await (await handleAssistants(ask(call(name, args)), env)).json()) as Reply).result;
    for (const name of ['find_health_centers', 'find_funding_opportunities', 'health_center_calendar', 'shortage_area_changes']) {
      const refused = await reply(name);
      expect(refused.isError, name).toBe(true);
      expect(refused.content[0]!.text, name).toMatch(/could not be read just now.*The other tools still work\. Try again in a minute\.$/);
    }
    expect((await reply('find_bills', { state: 'RI' })).isError).toBe(false);
    expect((await reply('get_notice', { notice_id: 'fr-2026-15633' })).isError).toBe(false);
    const about = read(await reply('about_the_data'));
    expect(about.counts.bills).toBeGreaterThan(200);
    expect(about.health_centers.unavailable).toMatch(/could not be read just now/);
    expect(points.map(row).map((r) => [r.tool, r.outcome])).toEqual([
      ['find_health_centers', 'tables unreachable'],
      ['find_funding_opportunities', 'tables unreachable'],
      ['health_center_calendar', 'tables unreachable'],
      ['shortage_area_changes', 'tables unreachable'],
      ['find_bills', 'answered'],
      ['get_notice', 'answered'],
      ['about_the_data', 'answered'],
    ]);
  });

  it('answers one Ohio workbook from the index and that workbook\'s own file, without reading the whole filed reports file', async () => {
    const { env, asked } = makeEnv();
    const part = async (args: Record<string, unknown>) => read(((await (await handleAssistants(ask(call('get_filing', { filing_id: 'oh-2025-dsh360059', ...args })), env)).json()) as Reply).result);
    const out = await part({});
    expect(out.filing.filing_id).toBe('oh-2025-dsh360059');
    // One answer holds 100 lines. A longer report says how many are left and how to ask for them.
    expect(out.lines_total).toBe(168);
    expect(out.lines.length).toBe(100);
    expect(out.more).toMatch(/^68 more lines: ask again with offset 100 /);
    const rest = await part({ offset: 100 });
    expect(rest.lines.length).toBe(68);
    expect(rest.more).toBeUndefined();
    expect(out.official_file.url).toMatch(/\.xlsx/);
    expect(asked).toContain('/data/340b-filings-index.json');
    expect(asked).toContain('/data/filings/oh-2025-dsh360059.json');
    expect(asked).not.toContain('/data/340b-state-filings.json');
    // A count of 1 to 5 is never in the answer.
    for (const line of [...out.lines, ...rest.lines] as Record<string, string>[]) if (line.claims_withheld) expect(line.claims).toBeUndefined();
  });

  it('answers the rebate pilot notice with its page on this site', async () => {
    const { env } = makeEnv();
    const out = read(((await (await handleAssistants(ask(call('get_notice', { notice_id: 'fr-2026-15633' })), env)).json()) as Reply).result);
    expect(out.notice.effective).toBe('2027-01-01');
    expect(out.notice.explained_at).toBe('https://clinx.org/rebate-pilot/');
  });

  it('is reached through the site\'s one program at /mcp, and nowhere else', async () => {
    const { env } = makeEnv();
    const whole: SiteEnv = { ...env, EMAIL: { send: async () => undefined }, CONTACT_TO: 'owner@example.org', CONTACT_FROM: 'form@example.org' };
    const response = await worker.fetch(ask({ jsonrpc: '2.0', id: 1, method: 'ping' }), whole);
    expect(response.status).toBe(200);
    for (const path of ['/mcp/', '/mcp/anything', '/api/mcp']) {
      const other = await worker.fetch(new Request(`${SITE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), whole);
      expect(other.status).toBe(404);
    }
    const { ASSETS: _files, ...withoutFiles } = whole;
    expect((await worker.fetch(ask({ jsonrpc: '2.0', id: 1, method: 'ping' }), withoutFiles)).status).toBe(404);
  });

  it('lets a page on any site call it, since the tables are public and there is nothing to sign in to', async () => {
    const { env } = makeEnv();
    const response = await handleAssistants(ask({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://some.app' }), env);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('sends a person who opens the address in a browser to the page that explains it', async () => {
    const { env, points } = makeEnv();
    const response = await handleAssistants(new Request(`${SITE}/mcp`, { headers: { Accept: 'text/html,application/xhtml+xml' } }), env);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(ASSISTANTS_PAGE);
    expect(points).toEqual([]);
    const program = await handleAssistants(new Request(`${SITE}/mcp`, { headers: { Accept: 'text/event-stream' } }), env);
    expect(program.status).toBe(405);
  });
});

describe('the door for assistants: an address that asks too often', () => {
  it('is turned away with a wait, and the others are not', async () => {
    const { env, keys, asked } = makeEnv({ allow: (key) => key !== '203.0.113.7' });
    const refused = await handleAssistants(ask(call('about_the_data')), env);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBe(String(WAIT_SECONDS));
    expect(((await refused.json()) as Reply).error?.message).toMatch(/Too many requests/);
    expect(asked).toEqual([]);
    const other = await handleAssistants(ask(call('about_the_data'), { 'CF-Connecting-IP': '198.51.100.2' }), env);
    expect(other.status).toBe(200);
    expect(keys).toEqual(['203.0.113.7', '198.51.100.2']);
  });

  it('works when the host gives no limiter and no counter', async () => {
    const { env } = makeEnv({ counts: false });
    delete env.MCP_LIMIT;
    expect((await handleAssistants(ask(call('about_the_data')), env)).status).toBe(200);
  });
});

describe('the door for assistants: what is counted', () => {
  it('counts a question by kind', async () => {
    const { env, points } = makeEnv();
    await handleAssistants(ask(call('find_bills', { state: 'tx', kind: 'contract-pharmacy', text: 'words nobody else should see' })), env);
    await handleAssistants(ask(call('get_notice', { notice_id: 'fr-2026-15633' })), env);
    expect(points.map(row)).toEqual([
      { method: 'tools/call', tool: 'find_bills', outcome: 'answered', place: 'TX', filters: 'kind=contract-pharmacy text', looked_up: '', client: '', version: '' },
      { method: 'tools/call', tool: 'get_notice', outcome: 'answered', place: '', filters: 'notice_id', looked_up: 'fr-2026-15633', client: '', version: '' },
    ]);
    expect(points.map((p) => [p.indexes, p.doubles])).toEqual([[['find_bills'], [1]], [['get_notice'], [1]]]);
  });

  it('counts a health center question by kind too, without the health center asked about', async () => {
    const { env, points } = makeEnv();
    const key = recordsIndex().health_centers[0]!.key;
    await handleAssistants(ask(call('get_health_center_report', { health_center: key, table: 'Table 3A', text: 'words nobody else should see' })), env);
    await handleAssistants(ask(call('shortage_area_changes', { state: 'ri', show: 'proposed', kind: 'hpsa-pc' })), env);
    expect(points.map(row)).toEqual([
      { method: 'tools/call', tool: 'get_health_center_report', outcome: 'answered', place: '', filters: 'health_center table text', looked_up: '', client: '', version: '' },
      { method: 'tools/call', tool: 'shortage_area_changes', outcome: 'answered', place: 'RI', filters: 'kind=hpsa-pc show=proposed', looked_up: '', client: '', version: '' },
    ]);
    expect(JSON.stringify(points)).not.toContain(key);
  });

  it('never counts the words, the address, or anything else about the asker', async () => {
    const { env, points } = makeEnv({ allow: (key) => key !== '192.0.2.99' });
    const secret = 'Jane Doe 555-12-3456 jane@example.org';
    const headers = { 'CF-Connecting-IP': '203.0.113.7', 'User-Agent': 'SecretBrowser/9 (Jane Doe)', Referer: 'https://intranet.example.org/jane', Cookie: 'session=abc123', Authorization: 'Bearer abc123', 'X-Forwarded-For': '203.0.113.7' };
    await handleAssistants(ask(call('find_bills', { text: secret, state: 'RI' }), headers), env);
    await handleAssistants(ask(call('get_bill', { bill_id: secret }), headers), env);
    await handleAssistants(ask(call('calendar', { from: '2027-01-15', notice_id: secret }), headers), env);
    await handleAssistants(ask({ jsonrpc: '2.0', id: 1, method: secret }, headers), env);
    await handleAssistants(new Request(`${SITE}/mcp`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: secret }), env);
    await handleAssistants(ask(call('about_the_data'), { ...headers, 'CF-Connecting-IP': '192.0.2.99' }), env);
    expect(points).toHaveLength(6);
    const written = JSON.stringify(points);
    for (const piece of ['Jane', 'Doe', '555', 'jane@', 'example.org', '203.0.113', '192.0.2', 'SecretBrowser', 'intranet', 'abc123', '2027-01-15']) expect(written).not.toContain(piece);
    for (const point of points) {
      expect(point.blobs).toHaveLength(COUNT_COLUMNS.length);
      expect(point.indexes).toHaveLength(1);
    }
    expect(row(points[5]!).outcome).toBe('limited');
  });

  it('gives the answer even when the count cannot be written', async () => {
    const { env } = makeEnv();
    env.MCP_USAGE = { writeDataPoint: () => { throw new Error('the counter is down'); } };
    expect((await handleAssistants(ask(call('about_the_data')), env)).status).toBe(200);
  });
});

describe('the host configuration', () => {
  it('sends only /api/ and /mcp to the program, and names the files, the limiter and the counts as the program expects', () => {
    expect(config).toContain('"run_worker_first": ["/api/*", "/mcp"]');
    expect(config).toContain('"binding": "ASSETS"');
    expect(config).toMatch(/"name": "MCP_LIMIT", "namespace_id": "1002", "simple": \{ "limit": 200, "period": 60 \}/);
    expect(config).toContain('"analytics_engine_datasets": [{ "binding": "MCP_USAGE", "dataset": "clinx_mcp_usage" }]');
    expect(config).toContain('"workers_dev": false');
  });
});
