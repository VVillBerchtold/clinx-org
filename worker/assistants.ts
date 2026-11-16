/**
 * The door for assistants, at /mcp.
 *
 * In plain words: an AI assistant can look things up in the site's open data (the 340B tables of
 * filed reports, laws, bills, federal notices and the calendar, and the health centers files) by
 * sending a small question here and getting rows back. The program
 * that answers is written and tested in its own folder and copied into worker/mcp/ by
 * scripts/sync-mcp.mjs. This file is only the host's side of it:
 *
 *   - it reads the tables from the site's own files, the same ones anyone can download, so an
 *     answer always matches the pages and nothing is fetched from anywhere else;
 *   - it turns away one address that asks far too often;
 *   - it counts what is asked by kind (which tool, which state, found or not), so the work goes
 *     where it is used. It never keeps the words someone searched for, and never who asked.
 *
 * It only reads. There is no sign-in, no cookie, and nothing to change.
 */
import { respond } from './mcp/http.js';
import { makeTables } from './mcp/tables.js';
import type { Asked, Tables } from './mcp/index.js';

/** What the program is given by the host. */
export interface AssistantsEnv {
  /** The site's own files. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Counts requests per visitor address. Optional: the door works without it. */
  MCP_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Where the counts go. Optional: with none, nothing is counted. */
  MCP_USAGE?: { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void };
  /** The site's own address, for example https://clinx.org. */
  SITE_ORIGIN: string;
}

/** The page that explains this door to a person. */
export const ASSISTANTS_PAGE = '/data/#assistants';
/** How long an address that asked too often is asked to wait, in seconds. */
export const WAIT_SECONDS = 60;

/** The order of the columns in a count. scripts/usage/mcp-usage.mjs reads them back by this order. */
export const COUNT_COLUMNS = ['method', 'tool', 'outcome', 'place', 'filters', 'looked_up', 'client', 'version'] as const;

/** One request as a row of the counts. `outcome` is also "limited" for an address turned away. */
export type Counted = Omit<Asked, 'outcome'> & { outcome: Asked['outcome'] | 'limited' };

const BLANK: Counted = { method: '', tool: '', outcome: 'limited', place: '', filters: '', looked_up: '', client: '', version: '' };

/** Adds one request to the counts. A count that cannot be written is dropped; the answer is never held up. */
export function count(env: Pick<AssistantsEnv, 'MCP_USAGE'>, asked: Counted): void {
  try {
    env.MCP_USAGE?.writeDataPoint({ indexes: [asked.tool || asked.method || asked.outcome], blobs: COUNT_COLUMNS.map((column) => asked[column]), doubles: [1] });
  } catch {
    // Nothing to do: counting is for the site's keeper, not for the asker.
  }
}

// The tables are read once and kept for an hour by this copy of the program. The files they come
// from change only when the site is published, and publishing starts fresh copies of the program.
let files: AssistantsEnv['ASSETS'] | undefined;
let tables: Tables | undefined;

function tablesFrom(env: AssistantsEnv): Tables {
  files = env.ASSETS;
  tables ??= makeTables({
    source: `${env.SITE_ORIGIN}/data/`,
    fetcher: (url, init) => files!.fetch(new Request(url, init)),
  });
  return tables;
}

/** For the tests: forget the tables held, as a fresh copy of the program would. */
export function forgetTables(): void {
  tables = undefined;
  files = undefined;
}

const PLAIN = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** Handles one request to /mcp. */
export async function handleAssistants(request: Request, env: AssistantsEnv): Promise<Response> {
  // A person who opens the address in a browser is sent to the page that explains it.
  if (request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html')) {
    return new Response(null, { status: 303, headers: { ...PLAIN, Location: ASSISTANTS_PAGE } });
  }

  if (env.MCP_LIMIT && request.method === 'POST') {
    // The address is handed to the host's counter for this one check and is not kept by the site.
    const visitor = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.MCP_LIMIT.limit({ key: visitor });
    if (!success) {
      count(env, BLANK);
      const body = { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Too many requests from this address. Try again in ${WAIT_SECONDS} seconds.` } };
      return new Response(JSON.stringify(body), { status: 429, headers: { ...PLAIN, 'Content-Type': 'application/json', 'Retry-After': String(WAIT_SECONDS), 'Access-Control-Allow-Origin': '*' } });
    }
  }

  return respond(request, { tables: tablesFrom(env), origins: 'any', counted: (asked) => count(env, asked) });
}
