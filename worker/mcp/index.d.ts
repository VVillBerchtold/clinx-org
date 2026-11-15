// The shapes of the pieces a host uses, for programs written in TypeScript.
// The code itself is plain JavaScript; this file only describes it.

/** A function that resolves to the tables, fetched at most once an hour. */
export type Tables = () => Promise<Record<string, unknown>>;

/** What was asked, by kind. Nothing in it can tell one asker from another (see usage.js). */
export interface Asked {
  /** server/discover, initialize, ping, tools/list, tools/call, notification, other, or "not a request". */
  method: string;
  /** The tool's name, "unknown" for a tool the server does not have, blank when no tool was called. */
  tool: string;
  outcome: 'answered' | 'mistake' | 'tables unreachable' | 'refused' | 'no answer';
  /** A state's two letters, US or FED; blank when none was given. */
  place: string;
  /** The filters used, by name, for example "kind=contract-pharmacy text". Never a typed value. */
  filters: string;
  /** The id of the public row a get_ tool found; blank otherwise. */
  looked_up: string;
  /** The name the client program gives itself, cut down to plain letters. */
  client: string;
  /** The protocol version asked for, where the request names one. */
  version: string;
}
