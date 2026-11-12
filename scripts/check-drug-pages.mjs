// Reads the built drug pages in dist/ and checks what a browser would be given before any script runs.
// For every drug page: the number of rows matches line_items.csv; the toolbar is hidden in the HTML; no inline
// script or style; and no cell, attribute or script carries a claim count of 1 to 5.
// For the largest and the smallest page it also checks the row count by name, so a change that dropped rows is seen.
// Usage: node scripts/check-drug-pages.mjs [dist-folder]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './dataset-shape.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));
const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

const [header, ...csvRows] = readCsv(readFileSync(join(root, 'src', 'data', 'dataset', 'line_items.csv'), 'utf8'));
const col = (name) => header.indexOf(name);
const schedG = csvRows.filter((r) => r[col('schedule')] === 'G');
const expected = new Map(); // filing id -> number of detail rows
for (const r of schedG) if (r[col('row_kind')] === 'detail') expected.set(r[col('filing_id')], (expected.get(r[col('filing_id')]) ?? 0) + 1);
if (expected.size === 0) fail('line_items.csv', 'no Schedule G rows to check against');

const riDir = join(dist, 'scorecard', 'ri');
const pages = existsSync(riDir)
  ? readdirSync(riDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(riDir, d.name, 'drugs', 'index.html')))
      .map((d) => ({ slug: d.name, file: join(riDir, d.name, 'drugs', 'index.html') }))
  : [];
if (pages.length !== expected.size) fail('dist', `${pages.length} drug pages built, ${expected.size} filings have drug rows`);

const bySize = [...expected.entries()].sort((a, b) => a[1] - b[1]);

// Names from the FDA directory, per filing: how many detail rows carry a code the directory lists.
const filedCode = (cell) => {
  const text = cell.trim();
  if (/^[0-9]{11}$/.test(text)) return text;
  if (/^[0-9]{5}-[0-9]{4}-[0-9]{2}$/.test(text)) return text.replaceAll('-', '');
  return null;
};
const namesPath = join(root, 'reference', 'fda-ndc', 'names.csv');
const listedCodes = new Set();
if (!existsSync(namesPath)) fail('reference/fda-ndc/names.csv', 'missing');
else {
  const [nameHead, ...nameLines] = readCsv(readFileSync(namesPath, 'utf8'));
  for (const l of nameLines) if (['package', 'product'].includes(l[nameHead.indexOf('match')])) listedCodes.add(l[nameHead.indexOf('ndc_11')]);
}
const listedRows = new Map(); // filing id -> detail rows whose code the directory lists
for (const r of schedG) {
  if (r[col('row_kind')] !== 'detail') continue;
  const code = filedCode(r[col('ndc_as_filed')]);
  if (code !== null && listedCodes.has(code)) listedRows.set(r[col('filing_id')], (listedRows.get(r[col('filing_id')]) ?? 0) + 1);
}
let fdaRowsShown = 0;
const named = new Map(); // filing id -> rows seen

for (const { slug, file } of pages) {
  const where = `/scorecard/ri/${slug}/drugs/`;
  const html = readFileSync(file, 'utf8');
  const filingId = `ri-2025-${slug}`;
  const want = expected.get(filingId);
  if (want === undefined) {
    fail(where, `no Schedule G rows for ${filingId} in line_items.csv`);
    continue;
  }

  const bodyMatch = /<tbody id="drug-rows">([\s\S]*?)<\/tbody>/.exec(html);
  if (!bodyMatch) {
    fail(where, 'no <tbody id="drug-rows">');
    continue;
  }
  const rowTags = [...bodyMatch[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)];
  named.set(filingId, rowTags.length);
  if (rowTags.length !== want) fail(where, `${rowTags.length} rows in the page, ${want} in the data`);

  // Every row whose code the FDA directory lists says so once, and no other row does.
  const fdaLines = rowTags.filter(([, , inner]) => inner.includes('Listed by the FDA as')).length;
  fdaRowsShown += fdaLines;
  if (fdaLines !== (listedRows.get(filingId) ?? 0)) fail(where, `${fdaLines} rows carry a name from the FDA directory, the names file gives ${listedRows.get(filingId) ?? 0}`);
  if (fdaLines > 0 && !html.includes('is not part of the filing')) fail(where, 'rows carry a name from the FDA directory, and the page does not say whose name it is');

  // The toolbar is hidden until the script turns it on.
  const toolbar = /<div\b[^>]*class="drug-sticky"[^>]*>/.exec(html);
  if (!toolbar) fail(where, 'no toolbar');
  else if (!/\shidden(?=[\s>=])/.test(toolbar[0])) fail(where, 'the toolbar is not hidden in the HTML');

  // No inline script, no inline style.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/^\s*type="application\/ld\+json"\s*$/.test(m[1])) continue; // data for search engines, read by check-dist.mjs; the browser does not run it
    if (!/\bsrc\s*=/.test(m[1]) || m[2].trim() !== '') fail(where, 'an inline <script>');
  }
  if (!/<script\b[^>]*\bsrc="[^"]*"/.test(html)) fail(where, 'no script file is loaded');
  if (/<style\b/i.test(html)) fail(where, 'an inline <style>');
  if (/<[a-z][^>]*\sstyle\s*=/i.test(html)) fail(where, 'a style attribute');

  // The small-number rule, cell by cell.
  let fewer = 0;
  for (const [, attrs, inner] of rowTags) {
    const k = /\bdata-k="([^"]*)"/.exec(attrs)?.[1];
    const c = /\bdata-c="([^"]*)"/.exec(attrs)?.[1];
    if (c === undefined || k === undefined) {
      fail(where, `a row without data-c or data-k: ${attrs}`);
      continue;
    }
    if (/^[1-5]$/.test(c)) fail(where, `a data-c of ${c} (a count of 1 to 5) in a row`);
    const cell = /<td class="num c-claims">([\s\S]*?)<\/td>/.exec(inner)?.[1] ?? '';
    const text = cell.replace(/<[^>]*>/g, '').trim();
    if (k === 'f') {
      fewer++;
      if (c !== '0.5') fail(where, `a "fewer than 6" row with data-c "${c}", expected 0.5`);
      if (!text.startsWith('fewer than 6')) fail(where, `a "fewer than 6" row whose cell reads "${text}"`);
    } else if (k === 'n') {
      if (c !== '0.5' || text !== 'not shown') fail(where, `a "not shown" row with data-c "${c}" and cell "${text}"`);
    } else if (k === 's') {
      if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(text)) fail(where, `a shown count that is not a number: "${text}"`);
      else if (/^[1-5]$/.test(text.replaceAll(',', ''))) fail(where, `a claims cell of ${text} (a count of 1 to 5)`);
      if (c !== text.replaceAll(',', '')) fail(where, `data-c "${c}" differs from the cell "${text}"`);
    } else fail(where, `an unknown data-k "${k}"`);
  }
  const wantFewer = schedG.filter((r) => r[col('filing_id')] === filingId && r[col('claims_withheld')] === 'fewer_than_6').length;
  if (fewer !== wantFewer) fail(where, `${fewer} rows say "fewer than 6", the data has ${wantFewer}`);

  // The foot rows and the stat strip print no small count either: every number in a claims cell of the foot is 0 or 6 and more.
  const foot = /<tfoot>([\s\S]*?)<\/tfoot>/.exec(html)?.[1] ?? '';
  for (const m of foot.matchAll(/<td class="num c-claims">([\s\S]*?)<\/td>/g)) {
    const t = m[1].replace(/<[^>]*>/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim().replaceAll(',', '');
    if (!/^\d+$/.test(t) || (Number(t) >= 1 && Number(t) <= 5)) fail(where, `a foot claims cell reads "${t}"`);
  }
}

// The largest and the smallest page, by name.
if (bySize.length > 0) {
  for (const [label, [filingId, want]] of [['smallest', bySize[0]], ['largest', bySize[bySize.length - 1]]]) {
    const seen = named.get(filingId);
    if (seen !== want) fail(`${label} page (${filingId})`, `${seen ?? 'no'} rows built, ${want} expected`);
  }
}

// The page of all filers' rows, and its download.
const allPage = join(riDir, 'drugs', 'index.html');
const detailTotal = [...expected.values()].reduce((sum, v) => sum + v, 0);
let allGroups = 0;
let fdaNote = '';
if (!existsSync(allPage)) fail('/scorecard/ri/drugs/', 'the page of all drug rows is not built');
else {
  const where = '/scorecard/ri/drugs/';
  const html = readFileSync(allPage, 'utf8');
  const toolbar = /<div\b[^>]*class="drug-sticky"[^>]*>/.exec(html);
  if (!toolbar) fail(where, 'no toolbar');
  else if (!/\shidden(?=[\s>=])/.test(toolbar[0])) fail(where, 'the toolbar is not hidden in the HTML');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/^\s*type="application\/ld\+json"\s*$/.test(m[1])) continue; // data for search engines, read by check-dist.mjs; the browser does not run it
    if (!/\bsrc\s*=/.test(m[1]) || m[2].trim() !== '') fail(where, 'an inline <script>');
  }
  if (/<style\b/i.test(html)) fail(where, 'an inline <style>');
  if (/<[a-z][^>]*\sstyle\s*=/i.test(html)) fail(where, 'a style attribute');

  allGroups = (html.match(/<tbody class="dg"/g) ?? []).length;
  // Every row as filed is on the page once: alone under its drug, or in the rows behind "N filers".
  const singles = (html.match(/class="dg-by"/g) ?? []).length;
  const nested = (html.match(/class="num dg-amt"/g) ?? []).length;
  if (singles + nested !== detailTotal) fail(where, `${singles + nested} rows as filed on the page, ${detailTotal} in the data`);

  for (const m of html.matchAll(/\bdata-c="([^"]*)"/g)) {
    if (/^[1-5]$/.test(m[1])) fail(where, `a data-c of ${m[1]} (a count of 1 to 5)`);
    else if (m[1] !== '0.5' && !/^(0|[6-9]|[1-9]\d+)$/.test(m[1])) fail(where, `a data-c that is not a count: "${m[1]}"`);
  }
  const WORDS = new Set(['fewer than 6', 'not shown', 'no count shown']);
  let fewer = 0;
  for (const m of html.matchAll(/<td class="num (c-claims|dg-claims)">([\s\S]*?)<\/td>/g)) {
    const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\(the count is not shown\)/, '').replace(/\s+/g, ' ').trim();
    if (WORDS.has(text)) {
      if (m[1] === 'dg-claims' && text === 'fewer than 6') fewer++;
      continue;
    }
    const digits = text.replace(/^at least /, '').replaceAll(',', '');
    if (!/^\d+$/.test(digits)) fail(where, `a claims cell that is not a count: "${text}"`);
    else if (Number(digits) >= 1 && Number(digits) <= 5) fail(where, `a claims cell of ${text} (a count of 1 to 5)`);
  }
  // A drug with one row prints its "fewer than 6" in the first row; those are counted from the pills beside a "Filed by".
  const singleFewer = [...html.matchAll(/<tbody class="dg"[^>]*>([\s\S]*?)<\/tbody>/g)].filter((m) => !m[1].includes('class="dg-more"') && /<td class="num c-claims">[\s\S]*?fewer than 6/.test(m[1])).length;
  const wantFewer = schedG.filter((r) => r[col('row_kind')] === 'detail' && r[col('claims_withheld')] === 'fewer_than_6').length;
  if (fewer + singleFewer !== wantFewer) fail(where, `${fewer + singleFewer} rows say "fewer than 6", the data has ${wantFewer}`);

  // Names from the FDA directory: every code filed as one 11-digit NDC shows its listed name or says it has none.
  const namesFile = join(root, 'reference', 'fda-ndc', 'names.csv');
  if (!existsSync(namesFile)) fail(where, 'reference/fda-ndc/names.csv is missing');
  else {
    const [nameHead, ...nameLines] = readCsv(readFileSync(namesFile, 'utf8'));
    const matchOf = new Map(nameLines.map((l) => [l[nameHead.indexOf('ndc_11')], l[nameHead.indexOf('match')]]));
    const filedCodes = new Set();
    for (const r of schedG) {
      if (r[col('row_kind')] !== 'detail') continue;
      const cell = r[col('ndc_as_filed')].trim();
      if (/^[0-9]{11}$/.test(cell)) filedCodes.add(cell);
      else if (/^[0-9]{5}-[0-9]{4}-[0-9]{2}$/.test(cell)) filedCodes.add(cell.replaceAll('-', ''));
    }
    let listed = 0;
    for (const code of filedCodes) {
      const match = matchOf.get(code);
      if (match === undefined) fail(where, `drug code ${code} was never looked up in the FDA directory`);
      else if (match === 'package' || match === 'product') listed++;
    }
    const shown = (html.match(/class="dg-fda"/g) ?? []).length;
    const notListed = (html.match(/The FDA directory does not list this code/g) ?? []).length;
    if (shown !== listed) fail(where, `${shown} drugs show a name from the FDA directory, the names file lists ${listed}`);
    if (notListed !== filedCodes.size - listed) fail(where, `${notListed} drugs say the FDA directory does not list the code, expected ${filedCodes.size - listed}`);
    fdaNote = ` ${listed} of ${filedCodes.size} drug codes carry a name from the FDA directory.`;
  }

  const csvFiles = existsSync(join(dist, 'data')) ? readdirSync(join(dist, 'data')).filter((f) => /^drug-rows-ri-\d{4}\.csv$/.test(f)) : [];
  if (csvFiles.length !== 1) fail('/data/', `${csvFiles.length} drug-rows-ri files, expected 1`);
  else {
    const name = csvFiles[0];
    if (!html.includes(`href="/data/${name}"`)) fail(where, `no link to /data/${name}`);
    const [head, ...lines] = readCsv(readFileSync(join(dist, 'data', name), 'utf8'));
    const at = (n) => head.indexOf(n);
    if (lines.length !== detailTotal) fail(`/data/${name}`, `${lines.length} lines, ${detailTotal} rows in the data`);
    for (const line of lines) {
      const claims = line[at('claims')];
      const asFiled = line[at('claims_as_filed')].replaceAll(',', '');
      const withheld = line[at('claims_withheld')];
      if (withheld === '') {
        if (!/^(0|[6-9]|[1-9]\d+)$/.test(claims) || claims !== asFiled) fail(`/data/${name}`, `a claims field of "${claims}" (as filed "${asFiled}")`);
      } else if (claims !== '' || asFiled !== '') fail(`/data/${name}`, `a count beside claims_withheld "${withheld}"`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems.slice(0, 40)) console.error(`check-drug-pages: ${p}`);
  console.error(`check-drug-pages: FAILED with ${problems.length} problem(s).`);
  process.exit(1);
}
const lo = bySize[0];
const hi = bySize[bySize.length - 1];
console.log(`check-drug-pages: ${pages.length} drug pages; smallest ${lo[1]} rows, largest ${hi[1]} rows; toolbar hidden, no inline script or style, no claim count of 1 to 5; ${fdaRowsShown} rows carry a name from the FDA directory. The page of all filers: ${allGroups} drugs, ${detailTotal} rows on the page and in its download.${fdaNote} All checks pass.`);
