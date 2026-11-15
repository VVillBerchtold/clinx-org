import { beforeEach, describe, expect, it } from 'vitest';
import { ASSISTANTS_PAGE, COUNT_COLUMNS, WAIT_SECONDS, forgetTables, handleAssistants, type AssistantsEnv } from '../worker/assistants';
import worker, { type SiteEnv } from '../worker/index';
import config from '../wrangler.jsonc?raw';

/**
 * The door for assistants, checked against the tables this site was built from (public/data).
 * No network is used: the made-up host below hands out the site's own files, as the real one does.
 */
const SITE = 'https://clinx.org';
const TABLES = import.meta.glob('../public/data/340b-*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const tableText = (name: string): string | undefined => TABLES[`../public/data/${name}`];

interface Point {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

function makeEnv(options: { allow?: (key: string) => boolean; counts?: boolean } = {}) {
  const asked: string[] = [];
  const points: Point[] = [];
  const keys: string[] = [];
  const env: AssistantsEnv = {
    ASSETS: {
      fetch: async (request) => {
        const { pathname } = new URL(request.url);
        asked.push(pathname);
        const text = pathname.startsWith('/data/') ? tableText(pathname.slice('/data/'.length)) : undefined;
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
  result: { isError: boolean; structuredContent: Record<string, any>; tools: { name: string }[] };
  error?: { code: number; message: string };
}

beforeEach(() => forgetTables());

describe('the door for assistants: answers', () => {
  it('lists the tools and answers a question from the site\'s own files', async () => {
    const { env, asked } = makeEnv();
    const listed = (await (await handleAssistants(ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), env)).json()) as Reply;
    expect(listed.result.tools.map((t) => t.name)).toEqual(['find_bills', 'get_bill', 'find_laws', 'get_law', 'find_notices', 'get_notice', 'calendar', 'state_overview', 'about_the_data']);
    expect(asked).toEqual([]);

    const response = await handleAssistants(ask(call('about_the_data')), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const about = ((await response.json()) as Reply).result.structuredContent;
    const built = JSON.parse(tableText('340b-notices.json')!) as { notices: unknown[] };
    expect(about.counts.notices).toBe(built.notices.length);
    expect(about.counts.bills).toBeGreaterThan(200);
    expect([...asked].sort()).toEqual(['/data/340b-bills.json', '/data/340b-events.json', '/data/340b-notices.json', '/data/340b-state-laws.json']);

    await handleAssistants(ask(call('find_bills', { state: 'RI' })), env);
    expect(asked).toHaveLength(4);
  });

  it('answers the rebate pilot notice with its page on this site', async () => {
    const { env } = makeEnv();
    const out = ((await (await handleAssistants(ask(call('get_notice', { notice_id: 'fr-2026-15633' })), env)).json()) as Reply).result.structuredContent;
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
    expect(config).toMatch(/"name": "MCP_LIMIT", "namespace_id": "1002", "simple": \{ "limit": 60, "period": 60 \}/);
    expect(config).toContain('"analytics_engine_datasets": [{ "binding": "MCP_USAGE", "dataset": "clinx_mcp_usage" }]');
    expect(config).toContain('"workers_dev": false');
  });
});
