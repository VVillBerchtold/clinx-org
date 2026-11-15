// The door for the web.
//
// In plain words: the same server, reached by an ordinary web request instead of a helper
// program. A client sends one JSON message in a POST and gets one JSON answer back. Nothing is
// remembered between requests: no sessions, no sign-in, no cookies, and nothing about the
// asker is stored. It is written against the web's standard Request and Response, so the same
// function runs under Node (src/serve.js) and on an edge host such as a Cloudflare Worker
// (src/worker.js).

import { answer, isModern, CODE, MODERN, LEGACY } from './core.js';
import { describeRequest, NOT_A_REQUEST } from './usage.js';

const MOST_BYTES = 64 * 1024; // a real request is a few hundred bytes
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const STATUS = { [CODE.parse]: 400, [CODE.request]: 400, [CODE.params]: 400, [CODE.headers]: 400, [CODE.version]: 400, [CODE.method]: 404, [CODE.internal]: 500 };

/**
 * Answer one web request.
 * `origins` says which web pages may call: 'any' for a public host (the data is public and no
 * credentials exist to steal), 'local' when run on a person's own computer, where a page from
 * elsewhere must not be able to reach it.
 * `counted`, when a host gives one, is handed a short description of each request by kind (which
 * tool, which state, found or not) and never anything about who asked or the words they used:
 * see src/usage.js. A failure inside it never changes the answer.
 */
export async function respond(request, { tables, origins = 'local', counted }) {
  const count = (asked) => {
    try {
      counted?.(asked);
    } catch {
      // Counting is a courtesy to the host. It must never cost an asker their answer.
    }
  };
  const origin = request.headers.get('origin');
  if (origin && origins === 'local' && !LOCAL.test(origin)) return json(403, { jsonrpc: '2.0', error: { code: CODE.request, message: 'This origin may not call this server' } }, origin, origins);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: shared(origin, origins) });
  if (request.method !== 'POST') {
    count(NOT_A_REQUEST);
    return new Response(null, { status: 405, headers: { ...shared(origin, origins), allow: 'POST, OPTIONS' } });
  }
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    count(NOT_A_REQUEST);
    return json(415, rpcError(CODE.request, 'Send JSON with Content-Type: application/json'), origin, origins);
  }

  const body = await readUpTo(request, MOST_BYTES);
  if (body === null) {
    count(NOT_A_REQUEST);
    return json(413, rpcError(CODE.request, 'Request too large'), origin, origins);
  }

  let message;
  try {
    message = JSON.parse(body);
  } catch {
    message = undefined;
  }

  // The newer protocol repeats three facts in headers so a gateway can route without reading the
  // body. Where a header is sent, it has to agree with the body.
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const said = (name) => request.headers.get(name);
    const meta = message.params?._meta ?? {};
    const pairs = [
      ['Mcp-Method', said('mcp-method'), message.method],
      ['Mcp-Name', message.method === 'tools/call' ? said('mcp-name') : null, message.params?.name],
      ['MCP-Protocol-Version', isModern(message) ? said('mcp-protocol-version') : null, meta['io.modelcontextprotocol/protocolVersion']],
    ];
    for (const [name, header, inBody] of pairs) {
      if (header !== null && header !== String(inBody)) {
        count(describeRequest(message, { error: true }));
        return json(400, { jsonrpc: '2.0', id: message.id ?? null, error: { code: CODE.headers, message: `Header mismatch: ${name} header value '${header}' does not match body value '${String(inBody)}'` } }, origin, origins);
      }
    }
  }

  const reply = await answer(body, tables);
  count(describeRequest(message, reply));
  if (reply === null) return new Response(null, { status: 202, headers: shared(origin, origins) });
  // Older clients expect every JSON-RPC answer, errors included, under a plain 200.
  const status = reply.error && (isModern(message) || reply.error.code === CODE.parse) ? STATUS[reply.error.code] ?? 400 : 200;
  return json(status, reply, origin, origins);
}

const rpcError = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } });

function shared(origin, origins) {
  const headers = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
  if (origin && (origins === 'any' || LOCAL.test(origin))) {
    headers['access-control-allow-origin'] = origins === 'any' ? '*' : origin;
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type, accept, mcp-protocol-version, mcp-method, mcp-name';
    headers['access-control-max-age'] = '86400';
    if (origins !== 'any') headers.vary = 'origin';
  }
  return headers;
}

const json = (status, value, origin, origins) => new Response(JSON.stringify(value), { status, headers: { ...shared(origin, origins), 'content-type': 'application/json' } });

/** The request's text, or null when it is longer than allowed. Stops reading as soon as it is too long. */
async function readUpTo(request, most) {
  if (Number(request.headers.get('content-length') ?? 0) > most) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > most) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

export const VERSIONS = [...MODERN, ...LEGACY];
