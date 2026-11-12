// Writes dist/sitemap.xml after the build: one entry for every built page that a search engine
// may list. It reads the pages themselves, so the list can never name a page that was not built
// or leave one out. A page that asks not to be listed (the private preview, "not found", the
// contact form's answer pages) is skipped; if no page may be listed, no file is written.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));

function pagesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pagesIn(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

const addresses = [];
for (const file of pagesIn(dist)) {
  const html = readFileSync(file, 'utf8');
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) continue;
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!canonical) throw new Error(`${relative(dist, file).split(sep).join('/')}: no canonical address`);
  addresses.push(canonical[1]);
}
addresses.sort();

const target = join(dist, 'sitemap.xml');
if (addresses.length === 0) {
  if (existsSync(target)) rmSync(target);
  console.log('sitemap: no page may be listed (private preview), so no sitemap.xml was written.');
} else {
  const body = addresses.map((a) => `  <url><loc>${a.replace(/&/g, '&amp;')}</loc></url>`).join('\n');
  writeFileSync(target, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
  console.log(`sitemap: ${addresses.length} pages listed in sitemap.xml.`);
}
