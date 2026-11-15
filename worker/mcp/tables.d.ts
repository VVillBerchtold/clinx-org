import type { Tables } from './index.js';

export declare const DATA_URL: string;
export declare const FILES: Readonly<Record<'laws' | 'bills' | 'notices' | 'events', string>>;
/** Make a loader: from a web address with `fetcher`, or through `reader`, which is given a file's name. */
export declare function makeTables(options?: {
  source?: string;
  fetcher?: (url: URL, init?: { headers?: Record<string, string> }) => Promise<Response>;
  reader?: (name: string) => Promise<unknown>;
  now?: () => number;
}): Tables;
