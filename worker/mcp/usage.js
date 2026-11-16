// What was asked, by kind.
//
// In plain words: whoever hosts the server may want to know which questions people bring to it,
// so the work goes where it is used: which tool, about which state, with which filters, and
// whether the answer was found. This file turns one request and its answer into that short
// description. It is built so that nothing about the asker can get into it:
//
//   - never the words someone searched for, a date they gave, or anything else typed freely;
//   - never an internet address, a browser or device description, or anything that could tell
//     one asker from another;
//   - a value is kept only when it comes from a fixed list this server already publishes (a tool's
//     name, a state's code, a kind of bill), or when it is the id of a public row the server
//     found and gave back.
//
// The server itself keeps nothing. A host that wants counts passes a `counted` function to the
// web door (src/http.js) and decides where the descriptions go.

import { MODERN, LEGACY, UNREACHABLE } from './core.js';
import { TOOLS, isPlace, FILINGS_UNREAD, REPORTING_UNREAD } from './tools.js';

const METHODS = ['server/discover', 'initialize', 'ping', 'tools/list', 'tools/call'];
const CLIENT_KEY = 'io.modelcontextprotocol/clientInfo';
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

/** A request that never became a message: the wrong kind of web request, or not JSON. */
export const NOT_A_REQUEST = Object.freeze({ method: 'not a request', tool: '', outcome: 'refused', place: '', filters: '', looked_up: '', client: '', version: '' });

/** The name a client program gives itself, cut down to plain letters so it cannot carry anything else. */
function programName(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9._ -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** The filters used, by name. A value is added only when it is one of the tool's own listed choices. */
function filtersOf(tool, args) {
  const named = [];
  for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
    if (name === 'state' || !(name in args) || args[name] === '' || args[name] === undefined) continue;
    const value = args[name];
    if (Array.isArray(schema.enum) && schema.enum.includes(value)) named.push(`${name}=${value}`);
    else if (schema.type === 'boolean' && typeof value === 'boolean') named.push(`${name}=${value}`);
    else named.push(name);
  }
  return named.sort().join(' ');
}

function outcomeOf(reply) {
  if (reply === null || reply === undefined) return 'no answer';
  if (reply.error) return 'refused';
  if (reply.result?.isError) return [UNREACHABLE, FILINGS_UNREAD, REPORTING_UNREAD].includes(reply.result.content?.[0]?.text) ? 'tables unreachable' : 'mistake';
  return 'answered';
}

/**
 * Describe one request and its answer. `message` is the parsed request (anything at all), `reply`
 * the answer the server gave (null for a notification).
 */
export function describeRequest(message, reply) {
  if (message === null || typeof message !== 'object' || Array.isArray(message) || typeof message.method !== 'string') return NOT_A_REQUEST;
  const params = message.params !== null && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {};
  const meta = params._meta !== null && typeof params._meta === 'object' ? params._meta : {};
  const method = METHODS.includes(message.method) ? message.method : message.method.startsWith('notifications/') ? 'notification' : 'other';
  const outcome = outcomeOf(reply);

  const asked = meta[VERSION_KEY] ?? (method === 'initialize' ? params.protocolVersion : undefined);
  const version = asked === undefined ? '' : [...MODERN, ...LEGACY].includes(asked) ? asked : 'other';
  const client = programName(meta[CLIENT_KEY]?.name ?? (method === 'initialize' ? params.clientInfo?.name : undefined));

  let tool = '';
  let place = '';
  let filters = '';
  let lookedUp = '';
  if (method === 'tools/call') {
    const known = typeof params.name === 'string' ? TOOLS.find((t) => t.name === params.name) : undefined;
    tool = known ? known.name : 'unknown';
    const args = params.arguments !== null && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
    if (known) {
      const code = typeof args.state === 'string' ? args.state.trim().toUpperCase() : '';
      place = isPlace(code) ? code : '';
      filters = filtersOf(known, args);
      // The id comes from the answer, not from what was typed: it is a public row the server found.
      const found = outcome === 'answered' ? reply.result.structuredContent : undefined;
      lookedUp = found?.bill?.bill_id ?? found?.law?.law_id ?? found?.notice?.notice_id ?? found?.filing?.filing_id ?? '';
    }
  }
  return { method, tool, outcome, place, filters, looked_up: lookedUp, client, version };
}
