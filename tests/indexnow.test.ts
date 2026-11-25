import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newPages, ownPages, readKey, requests, sitemapAddresses } from '../scripts/indexnow.mjs';
import robots from '../src/pages/robots.txt.ts?raw';
import publish from '../scripts/deploy/publish.sh?raw';

/** The IndexNow key file and the script that tells Bing and the other IndexNow engines about new pages. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sitemap = (...pages: string[]): string => `<urlset>${pages.map((p) => `<url><loc>${p}</loc></url>`).join('')}</urlset>`;

describe('the IndexNow key', () => {
  it('is one file at the site root that holds its own name and nothing else', () => {
    const key = readKey();
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(readFileSync(join(root, 'public', `${key}.txt`), 'utf8').trim()).toBe(key);
    expect(readdirSync(join(root, 'public')).filter((n) => /^[a-f0-9]{32}\.txt$/.test(n))).toHaveLength(1);
  });

  it('is sent with the address of the key file, for this site only', () => {
    const [body] = requests('k'.repeat(32), ['https://clinx.org/']);
    expect(body).toEqual({ host: 'clinx.org', key: 'k'.repeat(32), keyLocation: `https://clinx.org/${'k'.repeat(32)}.txt`, urlList: ['https://clinx.org/'] });
  });
});

describe('the pages it sends', () => {
  it('are this site’s own pages, each once', () => {
    expect(ownPages(['https://clinx.org/a/', 'https://example.com/', 'https://clinx.org.evil.example/', 'https://clinx.org/a/', ''])).toEqual(['https://clinx.org/a/']);
  });

  it('reads the addresses of a sitemap, with & as written in XML', () => {
    expect(sitemapAddresses(sitemap('https://clinx.org/a/?x=1&amp;y=2'))).toEqual(['https://clinx.org/a/?x=1&y=2']);
  });

  it('plans only the pages the live sitemap does not have yet', () => {
    expect(newPages(sitemap('https://clinx.org/', 'https://clinx.org/new/'), sitemap('https://clinx.org/', 'https://clinx.org/gone/'))).toEqual(['https://clinx.org/new/']);
  });

  it('goes in requests of at most 10,000 addresses', () => {
    const pages = Array.from({ length: 10001 }, (_, i) => `https://clinx.org/p${i}/`);
    expect(requests('k'.repeat(32), pages).map((r) => r.urlList.length)).toEqual([10000, 1]);
  });
});

describe('Bing can find every page', () => {
  it('robots.txt names the sitemap', () => {
    expect(robots).toContain('Sitemap: ${SITE_URL}/sitemap.xml');
  });

  it('every publish plans and sends the ping, and a failed ping never stops a publish', () => {
    expect(publish).toContain('node scripts/indexnow.mjs plan ||');
    expect(publish).toContain('node scripts/indexnow.mjs send ||');
  });
});
