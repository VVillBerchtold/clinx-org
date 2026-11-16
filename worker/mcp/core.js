// The server itself: one function that takes one message and gives back one answer.
//
// In plain words: an assistant such as Claude talks to a server like this one in small JSON
// messages ("what can you do?", "run this tool with these inputs"). This file reads one such
// message and writes the reply. It does not know or care how the message arrived; the two
// doors (src/stdio.js for a program on your own computer, src/http.js for the web) both hand
// their messages to `handle` below.
//
// The Model Context Protocol changed shape in its 2026-07-28 revision: before it, a client
// opened with an `initialize` message and the two sides agreed a version once; since it, every
// request names its version inside `params._meta` and there is no opening handshake. Both kinds
// of client are in use, so this server answers both. A request that carries the newer `_meta`
// is answered the newer way; everything else is answered the older way.

import { TOOLS, InputError } from './tools.js';
import { echo } from './inputs.js';

export const SERVER = {
  name: 'clinx-340b',
  title: 'ClinX open data: 340B and health centers',
  version: '0.3.1',
  description: 'ClinX\'s open data for clinics, in two groups. 340B: state laws on the books, bills in Congress and the state legislatures, federal rules and notices, the reports covered entities and states have filed, the states whose law requires reports, and a calendar of their dates. Health centers: what each health center reported to HRSA, HRSA\'s funding opportunities and their dates, and shortage designations and health center sites by state.',
  websiteUrl: 'https://clinx.org',
};

export const MODERN = ['2026-07-28'];
export const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_KEY = 'io.modelcontextprotocol/serverInfo';
const HOUR_MS = 60 * 60 * 1000;

export const INSTRUCTIONS = [
  'Read-only lookups over ClinX\'s open data for clinics, in two groups: the federal 340B drug pricing program, and federally funded health centers.',
  'find_laws and get_law cover state laws already on the books; find_bills and get_bill cover bills in Congress (state "US") and the state legislatures; find_notices and get_notice cover the rules, proposed rules and notices federal agencies publish in the Federal Register (place "FED"), with comment deadlines and effective dates; calendar gives dated steps, hearings, session days and federal dates; reporting_states lists the states whose law requires 340B reports, grouped by what the public can see; find_filings and get_filing cover the reports covered entities and states have filed, with every figure exactly as filed; state_overview gives one state, Congress or the federal agencies at a glance; about_the_data says where the tables come from and when each was last brought up to date.',
  'The health center tools: find_health_centers lists the health centers whose yearly reports to HRSA (the Uniform Data System) are held; get_health_center_report gives one health center\'s report for a year, table by table, with every value exactly as HRSA published it; find_funding_opportunities covers HRSA\'s funding opportunities on Grants.gov, forecasts and posted notices; health_center_calendar gives their dated lines and the Federal Register\'s; shortage_area_changes gives HRSA\'s shortage designations and health center sites for a state or territory, with what changed in the last 365 days.',
  'Every row carries a link to the official page: cite it. Summaries are a reading aid written by a person from the official text, not legal advice, and a bill\'s summary can trail a newer version of its text. A bill at the stage Did not pass is finished. For a federal rule or notice the Federal Register governs. A filed report is given exactly as the official file prints it, a claim count of 1 to 5 is never given, and ClinX ranks no filer. Dates on the calendar can move.',
  'In a health center report a cell HRSA marked is given as the mark and its meaning, never as a number, and a withheld value is never worked out. ClinX ranks no health center and compares none with another. A forecast date is HRSA\'s estimate and can move.',
].join(' ');

/** What a tool says when the tables cannot be fetched. */
export const UNREACHABLE = 'The tables at clinx.org could not be reached just now. Try again in a minute.';

/** Codes for the things that can go wrong, as the protocol numbers them. */
export const CODE = { parse: -32700, request: -32600, method: -32601, params: -32602, internal: -32603, headers: -32020, version: -32022 };

const fail = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } });

const describe = ({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } });

/** True when the message asks the newer, handshake-free way. */
export const isModern = (message) => typeof message?.params?._meta?.[VERSION_KEY] === 'string' && !LEGACY.includes(message.params._meta[VERSION_KEY]);

/**
 * Answer one message. `tables` is a function that resolves to the tables (see src/tables.js).
 * Returns the reply, or null when the message was a notification, which gets no reply.
 */
export async function handle(message, tables) {
  if (message === null || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return fail(message?.id, CODE.request, 'Not a JSON-RPC 2.0 request');
  }
  const { id, method } = message;
  if (id === undefined) return null; // a notification: nothing to answer
  if (typeof id !== 'string' && typeof id !== 'number') return fail(null, CODE.request, 'id must be a string or a number');
  const params = message.params ?? {};
  if (typeof params !== 'object' || Array.isArray(params)) return fail(id, CODE.params, 'params must be an object');

  const modern = isModern(message);
  if (modern) {
    const asked = params._meta[VERSION_KEY];
    if (!MODERN.includes(asked)) return fail(id, CODE.version, 'Unsupported protocol version', { supported: [...MODERN, ...LEGACY], requested: asked });
    const capabilities = params._meta[CAPABILITIES_KEY];
    if (capabilities === null || typeof capabilities !== 'object') return fail(id, CODE.params, `Missing ${CAPABILITIES_KEY} in params._meta`);
  }
  // The newer protocol wants two extra things on every answer: that it is complete, and who answered.
  const done = (result) => ({ jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result, _meta: { [SERVER_KEY]: SERVER } } : result });

  switch (method) {
    case 'server/discover':
      return { jsonrpc: '2.0', id, result: { resultType: 'complete', supportedVersions: MODERN, capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: HOUR_MS, cacheScope: 'public', _meta: { [SERVER_KEY]: SERVER } } };

    case 'initialize': {
      const asked = params.protocolVersion;
      return done({
        protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER.name, title: SERVER.title, version: SERVER.version },
        instructions: INSTRUCTIONS,
      });
    }

    case 'ping':
      return done({});

    case 'tools/list':
      return done({ tools: TOOLS.map(describe), ...(modern ? { ttlMs: HOUR_MS, cacheScope: 'public' } : {}) });

    case 'tools/call': {
      const tool = typeof params.name === 'string' ? TOOLS.find((t) => t.name === params.name) : undefined;
      if (!tool) return fail(id, CODE.params, `Unknown tool: ${echo(params.name)}`);
      const args = params.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) return fail(id, CODE.params, 'arguments must be an object');
      return done(await call(tool, args, tables));
    }

    default:
      return fail(id, CODE.method, `Method not found: ${method}`);
  }
}

/** Run one tool. A problem with the inputs, or with reaching the tables, is the tool's answer, marked as an error. */
async function call(tool, args, tables) {
  const said = (text) => ({ content: [{ type: 'text', text }], isError: true });
  const known = Object.keys(tool.inputSchema.properties ?? {});
  const extra = Object.keys(args).filter((key) => !known.includes(key));
  if (extra.length) return said(`${tool.name} does not take ${extra.map(echo).join(', ')}. It takes: ${known.join(', ') || 'nothing'}.`);
  let held;
  try {
    held = await tables();
  } catch {
    return said(UNREACHABLE);
  }
  try {
    const result = await tool.run(held, args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
  } catch (error) {
    if (error instanceof InputError) return said(error.message);
    throw error;
  }
}

/** Answer a line of text (stdio) or a request body (HTTP): parse it, answer it, never throw. */
export async function answer(text, tables) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return fail(null, CODE.parse, 'Not valid JSON');
  }
  if (Array.isArray(message)) return fail(null, CODE.request, 'One message at a time: batches are not supported');
  try {
    return await handle(message, tables);
  } catch {
    return fail(message?.id, CODE.internal, 'The server could not answer this request');
  }
}
