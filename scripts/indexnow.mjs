// Tells search engines that use IndexNow (Bing, Yandex, Seznam, Naver and others) which pages of clinx.org
// are new or changed, so they read them soon instead of on their next visit.
//
// IndexNow proves the site is ours with a key: a random string the site serves as a plain text file at its
// root (public/<key>.txt, holding the key itself). The key is public by design. It is not a password and
// it opens nothing: anyone may read it, and all it lets anyone do is ask a search engine to re-read a page
// of this site. A new key can replace it at any time (put a new file in public/ and delete the old one).
//
//   node scripts/indexnow.mjs plan [--out <file>]          before a publish: list the pages in dist/sitemap.xml
//                                                          that the live sitemap does not have yet (new pages)
//   node scripts/indexnow.mjs send [--from <file>]         after a publish: send the planned list
//   node scripts/indexnow.mjs send --all                   send every page in dist/sitemap.xml (after a change
//                                                          that touches many pages, such as new page titles)
//   node scripts/indexnow.mjs send <address> [...]         send the pages named
//   add --dry-run to send: print what would be sent, send nothing
//
// It needs no secret. scripts/deploy/publish.sh runs plan and send around every publish; a failure there is
// reported and never stops a publish.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://clinx.org';
const HOST = 'clinx.org';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
// IndexNow takes up to 10,000 addresses in one request.
const BATCH = 10000;
const DEFAULT_PLAN = join(root, '.indexnow-urls.txt');

/** The key, read from the one key file in public/. The file's name and its text must be the same key. */
export function readKey(dir = join(root, 'public')) {
  const files = readdirSync(dir).filter((name) => /^[a-f0-9]{32}\.txt$/.test(name));
  if (files.length !== 1) throw new Error(`indexnow: expected one key file (32 hex characters + .txt) in public/, found ${files.length}`);
  const key = files[0].slice(0, -4);
  const text = readFileSync(join(dir, files[0]), 'utf8').trim();
  if (text !== key) throw new Error(`indexnow: public/${files[0]} must hold its own name, the key, and nothing else`);
  return key;
}

/** The addresses in a sitemap's text. */
export function sitemapAddresses(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

/** Only this site's own pages are ever sent. */
export function ownPages(addresses) {
  return [...new Set(addresses.map((a) => a.trim()).filter((a) => a === `${SITE}/` || a.startsWith(`${SITE}/`)))];
}

/** The pages in the new sitemap that the live one does not list. */
export function newPages(builtXml, liveXml) {
  const live = new Set(sitemapAddresses(liveXml));
  return ownPages(sitemapAddresses(builtXml)).filter((a) => !live.has(a));
}

/** The request bodies for a list of pages, at most BATCH addresses each. */
export function requests(key, pages) {
  const out = [];
  for (let i = 0; i < pages.length; i += BATCH) out.push({ host: HOST, key, keyLocation: `${SITE}/${key}.txt`, urlList: pages.slice(i, i + BATCH) });
  return out;
}

function builtSitemap() {
  const file = join(root, 'dist', 'sitemap.xml');
  if (!existsSync(file)) throw new Error('indexnow: dist/sitemap.xml is missing. Build the site first.');
  return readFileSync(file, 'utf8');
}

function option(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function plan(args) {
  const out = option(args, '--out') ?? DEFAULT_PLAN;
  const response = await fetch(`${SITE}/sitemap.xml`);
  // With no live sitemap to compare against, nothing is planned: sending all would be a guess.
  const liveXml = response.ok ? await response.text() : '';
  const pages = response.ok ? newPages(builtSitemap(), liveXml) : [];
  writeFileSync(out, pages.length > 0 ? `${pages.join('\n')}\n` : '');
  console.log(response.ok ? `indexnow: ${pages.length} new pages planned in ${out}.` : `indexnow: the live sitemap answered ${response.status}; nothing planned.`);
}

async function send(args) {
  const dryRun = args.includes('--dry-run');
  const named = args.filter((a) => a.startsWith('https://'));
  let pages;
  if (args.includes('--all')) pages = ownPages(sitemapAddresses(builtSitemap()));
  else if (named.length > 0) pages = ownPages(named);
  else {
    const from = option(args, '--from') ?? DEFAULT_PLAN;
    pages = existsSync(from) ? ownPages(readFileSync(from, 'utf8').split('\n')) : [];
  }
  if (pages.length === 0) return console.log('indexnow: no pages to send.');
  const key = readKey();
  for (const body of requests(key, pages)) {
    if (dryRun) {
      console.log(`indexnow (dry run): would send ${body.urlList.length} pages, first ${body.urlList[0]}`);
      continue;
    }
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    // 200 and 202 both mean received. 403 means the key file was not found on the live site yet.
    console.log(`indexnow: sent ${body.urlList.length} pages, answer ${response.status}.`);
    if (response.status !== 200 && response.status !== 202) process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const run = command === 'plan' ? plan : command === 'send' ? send : undefined;
  if (!run) {
    console.error('usage: node scripts/indexnow.mjs plan [--out <file>] | send [--from <file> | --all | <address>...] [--dry-run]');
    process.exit(2);
  }
  run(args).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
