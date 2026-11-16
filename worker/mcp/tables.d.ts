import type { Tables } from './index.js';

export declare const DATA_URL: string;
export declare const FILES: Readonly<Record<'laws' | 'bills' | 'notices' | 'events' | 'filings' | 'filingsIndex' | 'reporting', string>>;
/** The name of the file that holds one report's lines, from its filing id: filings/<filing id>.json. */
export declare function reportFile(filingId: string): string;
/**
 * Make a loader: from a web address with `fetcher`, or through `reader`, which is given a file's name.
 * The filed reports and the reporting states are read on their own: when either cannot be read, the
 * tables it feeds are `null` and the other tools carry on. The health center files (see
 * health-centers.js) are read only when a health center tool asks for one.
 */
export declare function makeTables(options?: {
  source?: string;
  fetcher?: (url: URL, init?: { headers?: Record<string, string> }) => Promise<Response>;
  reader?: (name: string) => Promise<unknown>;
  now?: () => number;
}): Tables;
