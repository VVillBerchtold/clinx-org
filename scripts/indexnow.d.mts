// Types for scripts/indexnow.mjs, for the tests.
export function readKey(dir?: string): string;
export function sitemapAddresses(xml: string): string[];
export function ownPages(addresses: readonly string[]): string[];
export function newPages(builtXml: string, liveXml: string): string[];
export function requests(key: string, pages: readonly string[]): { host: string; key: string; keyLocation: string; urlList: string[] }[];
