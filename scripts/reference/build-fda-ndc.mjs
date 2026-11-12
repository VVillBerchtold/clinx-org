#!/usr/bin/env node
/**
 * Builds reference/fda-ndc/names.csv: for every drug code (NDC) that a filing gives as one 11-digit code,
 * the name the FDA's National Drug Code Directory lists for it.
 *
 * The directory is a public file of the U.S. Food and Drug Administration:
 *   https://www.accessdata.fda.gov/cder/ndctext.zip   (product.txt and package.txt, tab separated)
 * Download it and unpack it into a new, empty folder of its own, then run:
 *   node scripts/reference/build-fda-ndc.mjs <folder with product.txt and package.txt> <date retrieved, YYYY-MM-DD> [<the zip>]
 *     [--report <file.md>]   also write what changed since the names file in the repository
 *     [--accept-changes]     write the files even when the amount of change is unusual
 * The monthly refresh does the same through scripts/refresh/pull-fda-ndc.sh.
 *
 * The two files are data: nothing in them is run, and their text is copied as listed.
 *
 * How a filed code is matched. Filings write a code as 11 digits (5-4-2). The directory writes the same code
 * as 10 digits in one of three layouts, with dashes: 4-4-2, 5-3-2 or 5-4-1. The short part gets one leading
 * zero; that is the standard way to write a 10-digit code as 11 digits, and the dashes say which part is
 * short, so nothing is guessed. A code is matched
 *   - `package`: the directory lists this package code;
 *   - `product`: the directory does not list this package, but lists the product (the first nine digits);
 *   - `none`:    neither is listed;
 *   - `unclear`: the directory lists it more than once with different names. No name is taken.
 *
 * A name once listed is kept. The directory drops a product when it leaves the market, and a filing about an
 * earlier year still names it. So when a code that had a name is no longer listed, its line stays as it was,
 * with the day of the copy that listed it in `listed_on`. A line whose `listed_on` is older than the day in
 * SOURCE.json is such a kept name, and the site says so beside it.
 *
 * Exit codes: 0 written; 2 wrong arguments; 3 the amount of change is unusual and nothing was written (a
 * person reads the report, then runs it again with --accept-changes); anything else, the files could not be read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCsv } from '../dataset-shape.mjs';

export const SOURCE_URL = 'https://www.accessdata.fda.gov/cder/ndctext.zip';
/** The FDA's page about the directory: where a reader is sent, since the file itself is a download. */
export const SOURCE_PAGE = 'https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory';

export const NAMES_HEADER = ['ndc_11', 'match', 'fda_product_ndc', 'proprietary_name', 'proprietary_name_suffix', 'nonproprietary_name', 'dosage_form', 'strength', 'labeler_name', 'listed_on'];
/** A line's match and its seven listed fields sit at 1 to 8; `listed_on` at 9 is not part of the listing. */
const LISTED = [2, 9];

const PRODUCT_COLUMNS = ['PRODUCTID', 'PRODUCTNDC', 'PROPRIETARYNAME', 'PROPRIETARYNAMESUFFIX', 'NONPROPRIETARYNAME', 'DOSAGEFORMNAME', 'LABELERNAME', 'ACTIVE_NUMERATOR_STRENGTH', 'ACTIVE_INGRED_UNIT'];
const PACKAGE_COLUMNS = ['PRODUCTID', 'NDCPACKAGECODE'];

/** The 11 digits of a cell filed as one NDC (eleven digits, or 5-4-2 with dashes); null for anything else. Same rule as src/lib/drug-groups.ts. */
export function filedKey(cell) {
  const text = cell.trim();
  if (/^[0-9]{11}$/.test(text)) return text;
  if (/^[0-9]{5}-[0-9]{4}-[0-9]{2}$/.test(text)) return text.replaceAll('-', '');
  return null;
}

/** A 10-digit package code with dashes (4-4-2, 5-3-2 or 5-4-1) as 11 digits; null for any other layout. */
export function package10to11(code) {
  const m = /^([0-9]+)-([0-9]+)-([0-9]+)$/.exec(code.trim());
  if (!m) return null;
  const [, a, b, c] = m;
  const shape = `${a.length}-${b.length}-${c.length}`;
  if (shape === '4-4-2') return `0${a}${b}${c}`;
  if (shape === '5-3-2') return `${a}0${b}${c}`;
  if (shape === '5-4-1') return `${a}${b}0${c}`;
  return null;
}

/** A product code with a dash (4-4, 5-3 or 5-4) as the first nine digits of an 11-digit code; null for any other layout. */
export function product10to9(code) {
  const m = /^([0-9]+)-([0-9]+)$/.exec(code.trim());
  if (!m) return null;
  const [, a, b] = m;
  const shape = `${a.length}-${b.length}`;
  if (shape === '4-4') return `0${a}${b}`;
  if (shape === '5-3') return `${a}0${b}`;
  if (shape === '5-4') return `${a}${b}`;
  return null;
}

/** The strength of each active ingredient with its unit, as listed: "50 mg/1; 200 mg/1; 25 mg/1". */
export function strengthText(numerators, units) {
  const n = numerators.trim();
  const u = units.trim();
  if (n === '' && u === '') return '';
  const ns = n.split(';').map((s) => s.trim());
  const us = u.split(';').map((s) => s.trim());
  if (ns.length !== us.length) return `${n} ${u}`.trim();
  return ns.map((value, i) => `${value} ${us[i]}`.trim()).join('; ');
}

/**
 * Tab-separated text with a header line into records. A line with the wrong number of fields, or a header
 * without a column this script reads, stops the build.
 */
export function parseTable(text, name, needed = []) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split('\t').map((key) => key.trim());
  for (const column of needed) if (!header.includes(column)) throw new Error(`${name}: no column ${column}. The directory's layout has changed`);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const parts = lines[i].split('\t');
    if (parts.length !== header.length) throw new Error(`${name} line ${i + 1}: ${parts.length} fields, the header has ${header.length}`);
    const record = {};
    header.forEach((key, k) => (record[key] = parts[k].trim()));
    out.push(record);
  }
  return out;
}

/**
 * The lines of an earlier names file that carry a name, by code. A file written before `listed_on` existed
 * takes `fallbackDay` (the day in its SOURCE.json) for every line.
 */
export function previousNames(csvText, fallbackDay) {
  const [head, ...rows] = readCsv(csvText);
  const at = (name) => head.indexOf(name);
  const out = new Map();
  for (const row of rows) {
    const match = row[at('match')];
    if (match !== 'package' && match !== 'product') continue;
    const line = NAMES_HEADER.map((name) => (at(name) < 0 ? '' : (row[at(name)] ?? '')));
    if (line[9] === '') line[9] = fallbackDay;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line[9])) throw new Error(`names.csv ${line[0]}: a name with no day it was listed on`);
    out.set(line[0], line);
  }
  return out;
}

/**
 * The names for a list of filed 11-digit codes. Returns one line per code, in code order, the counts, and what
 * changed against `previous` (see previousNames).
 *   retrieved: the day of this copy of the directory, written to `listed_on` of every line it lists.
 *   previousRetrieved: the day of the copy the earlier names file was built from; a name it listed that this
 *   copy does not is reported once, as newly kept.
 */
export function buildNames(products, packages, filedCodes, { retrieved = '', previous = new Map(), previousRetrieved = '' } = {}) {
  const productById = new Map();
  const idsByNine = new Map();
  const add = (map, key, id) => {
    const set = map.get(key);
    if (set) set.add(id);
    else map.set(key, new Set([id]));
  };
  for (const p of products) {
    if (productById.has(p.PRODUCTID)) throw new Error(`product.txt lists PRODUCTID ${p.PRODUCTID} twice`);
    productById.set(p.PRODUCTID, p);
    const nine = product10to9(p.PRODUCTNDC);
    if (nine) add(idsByNine, nine, p.PRODUCTID);
  }
  const idsByEleven = new Map();
  let oddPackages = 0;
  for (const k of packages) {
    const eleven = package10to11(k.NDCPACKAGECODE);
    if (eleven === null) {
      oddPackages++;
      continue;
    }
    add(idsByEleven, eleven, k.PRODUCTID);
  }

  const fields = (id) => {
    const p = productById.get(id);
    if (!p) return null;
    return [p.PRODUCTNDC, p.PROPRIETARYNAME, p.PROPRIETARYNAMESUFFIX, p.NONPROPRIETARYNAME, p.DOSAGEFORMNAME, strengthText(p.ACTIVE_NUMERATOR_STRENGTH, p.ACTIVE_INGRED_UNIT), p.LABELERNAME];
  };
  const counts = { package: 0, product: 0, none: 0, unclear: 0, kept: 0 };
  const changes = { added: [], changed: [], kept: [], removed: [] };
  const lines = [];
  for (const code of [...new Set(filedCodes)].sort()) {
    if (!/^[0-9]{11}$/.test(code)) throw new Error(`Not an 11-digit code: ${code}`);
    let match = 'none';
    let ids = idsByEleven.get(code);
    if (ids) match = 'package';
    else {
      ids = idsByNine.get(code.slice(0, 9));
      if (ids) match = 'product';
    }
    let listed = null;
    if (ids) {
      const found = [...ids].map(fields).filter((f) => f !== null);
      // A package can be listed under more than one record; a name is taken only when they all say the same.
      const different = new Set(found.map((f) => f.slice(1).join('\t')));
      if (different.size === 1 && found[0][1] !== '') listed = found[0];
      else match = 'unclear';
    }
    const before = previous.get(code);
    let line;
    if (listed) {
      line = [code, match, ...listed, retrieved];
      if (!before) changes.added.push({ code, now: line });
      else if (before.slice(1, LISTED[1]).join('\t') !== line.slice(1, LISTED[1]).join('\t')) changes.changed.push({ code, before, now: line });
    } else if (before && match === 'none') {
      // No longer in the directory: the name it had is kept, with the day it was last listed.
      line = [...before];
      match = before[1];
      counts.kept++;
      if (previousRetrieved === '' || before[9] === previousRetrieved) changes.kept.push({ code, now: line });
    } else {
      line = [code, match, '', '', '', '', '', '', '', ''];
      if (before) changes.removed.push({ code, before, now: line });
    }
    counts[match]++;
    lines.push(line);
  }
  return { lines, counts, changes, oddPackages, products: products.length, packages: packages.length };
}

/**
 * Reasons to stop and have a person look, before anything is written. An empty list means go on.
 *   previousSource: the SOURCE.json beside the earlier names file, or null on a first run.
 */
export function unusualChange(built, previousSource) {
  const reasons = [];
  const codes = built.lines.length;
  if (previousSource) {
    for (const [key, now] of [['products_listed', built.products], ['packages_listed', built.packages]]) {
      const before = Number(previousSource[key]);
      if (Number.isFinite(before) && before > 0 && now < before * 0.9) reasons.push(`the directory has ${now} ${key === 'products_listed' ? 'products' : 'packages'}, down from ${before}: the file may be cut short`);
    }
    // A first run has nothing to compare; after that, more than one code in twenty changing at once is not routine.
    const limit = Math.max(10, Math.ceil(codes * 0.05));
    const moved = built.changes.changed.length + built.changes.removed.length;
    if (moved > limit) reasons.push(`${moved} of ${codes} codes changed their listing or lost it (more than ${limit})`);
    const newlyKept = built.changes.kept.length;
    if (newlyKept > limit) reasons.push(`${newlyKept} of ${codes} codes are no longer listed (more than ${limit})`);
  }
  if (built.oddPackages > built.packages * 0.01) reasons.push(`${built.oddPackages} package codes are in a layout this script does not read`);
  return reasons;
}

const shown = (line) => [line[3] + (line[4] === '' ? '' : ` ${line[4]}`), line[5], line[7], line[6], line[8]].filter((part) => part !== '').join(' | ');
// The report is Markdown; the directory's text is data, so the characters Markdown reads are written plainly.
const plain = (text) => text.replace(/[`*_[\]<>|\\]/g, (ch) => (ch === '|' ? '/' : ' ')).replace(/\s+/g, ' ').trim();
const ndc = (code) => `${code.slice(0, 5)}-${code.slice(5, 9)}-${code.slice(9)}`;

/** What changed since the earlier names file, as Markdown. */
export function changeReport(built, retrieved, reasons) {
  const { changes, counts } = built;
  const out = [`# FDA drug names: changes on ${retrieved}`, ''];
  out.push(`${built.lines.length} filed codes: ${counts.package} matched by package, ${counts.product} by product, ${counts.none} not listed, ${counts.unclear} unclear. ${counts.kept} of the matched are names kept from an earlier copy of the directory.`, '');
  if (reasons.length > 0) out.push('**Stopped: a person must look.**', '', ...reasons.map((r) => `- ${plain(r)}`), '');
  const part = (title, items, write) => {
    out.push(`## ${title}: ${items.length}`, '');
    for (const item of items.slice(0, 200)) out.push(`- ${ndc(item.code)}: ${write(item)}`);
    if (items.length > 200) out.push(`- and ${items.length - 200} more`);
    if (items.length > 0) out.push('');
  };
  part('Newly named', changes.added, (i) => plain(shown(i.now)));
  part('Listing changed', changes.changed, (i) => `${plain(shown(i.before))} → ${plain(shown(i.now))}`);
  part('No longer listed, name kept', changes.kept, (i) => `${plain(shown(i.now))} (as listed on ${i.now[9]})`);
  part('Name removed (the directory now lists the code more than once, with different names)', changes.removed, (i) => plain(shown(i.before)));
  return out.join('\n') + '\n';
}

const csvField = (value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
export const namesCsv = (lines) => [NAMES_HEADER, ...lines].map((line) => line.map(csvField).join(',')).join('\n') + '\n';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function main() {
  const args = process.argv.slice(2);
  const flags = { report: '', accept: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report') flags.report = args[++i] ?? '';
    else if (args[i] === '--accept-changes') flags.accept = true;
    else rest.push(args[i]);
  }
  const [dir, retrieved, zip] = rest;
  if (!dir || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved ?? '')) {
    console.error('Usage: node scripts/reference/build-fda-ndc.mjs <folder with product.txt and package.txt> <YYYY-MM-DD retrieved> [<the zip>] [--report <file.md>] [--accept-changes]');
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out = join(root, 'reference', 'fda-ndc');
  // The directory's text is Windows-1252, not UTF-8.
  const decode = (buffer) => new TextDecoder('windows-1252').decode(buffer);
  const productBytes = readFileSync(join(dir, 'product.txt'));
  const packageBytes = readFileSync(join(dir, 'package.txt'));
  const products = parseTable(decode(productBytes), 'product.txt', PRODUCT_COLUMNS);
  const packages = parseTable(decode(packageBytes), 'package.txt', PACKAGE_COLUMNS);

  const filed = [];
  const [head, ...rows] = readCsv(readFileSync(join(root, 'src', 'data', 'dataset', 'line_items.csv'), 'utf8'));
  const at = head.indexOf('ndc_as_filed');
  if (at < 0) throw new Error('line_items.csv has no ndc_as_filed column');
  for (const row of rows) {
    const key = filedKey(row[at] ?? '');
    if (key !== null) filed.push(key);
  }

  const hasPrevious = existsSync(join(out, 'names.csv')) && existsSync(join(out, 'SOURCE.json'));
  const previousSource = hasPrevious ? JSON.parse(readFileSync(join(out, 'SOURCE.json'), 'utf8')) : null;
  if (previousSource && typeof previousSource.retrieved === 'string' && retrieved < previousSource.retrieved) {
    throw new Error(`This copy is dated ${retrieved}; the names file is from ${previousSource.retrieved}. An older copy is not written over a newer one`);
  }
  const previous = hasPrevious ? previousNames(readFileSync(join(out, 'names.csv'), 'utf8'), String(previousSource.retrieved ?? '')) : new Map();

  const built = buildNames(products, packages, filed, { retrieved, previous, previousRetrieved: String(previousSource?.retrieved ?? '') });
  const reasons = unusualChange(built, previousSource);
  if (flags.report !== '') writeFileSync(flags.report, changeReport(built, retrieved, reasons));
  const { counts, changes } = built;
  console.log(`build-fda-ndc: ${built.lines.length} filed codes; ${counts.package} matched by package, ${counts.product} by product, ${counts.none} not listed, ${counts.unclear} unclear; ${counts.kept} of the matched are names kept from an earlier copy.`);
  console.log(`build-fda-ndc: since the last names file: ${changes.added.length} newly named, ${changes.changed.length} changed, ${changes.kept.length} no longer listed (name kept), ${changes.removed.length} removed.`);
  if (reasons.length > 0 && !flags.accept) {
    for (const reason of reasons) console.error(`build-fda-ndc: ${reason}.`);
    console.error('build-fda-ndc: the amount of change is unusual. Nothing was written. Read the report, then run again with --accept-changes if it is right.');
    process.exit(3);
  }

  writeFileSync(join(out, 'names.csv'), namesCsv(built.lines));
  const source = {
    name: 'National Drug Code Directory',
    publisher: 'U.S. Food and Drug Administration',
    url: SOURCE_URL,
    page: SOURCE_PAGE,
    retrieved,
    zip_sha256: zip && existsSync(zip) ? sha256(readFileSync(zip)) : '',
    product_txt_sha256: sha256(productBytes),
    package_txt_sha256: sha256(packageBytes),
    products_listed: built.products,
    packages_listed: built.packages,
    packages_in_another_layout: built.oddPackages,
    filed_codes: built.lines.length,
    matched_package: counts.package,
    matched_product: counts.product,
    not_listed: counts.none,
    unclear: counts.unclear,
    kept_from_an_earlier_copy: counts.kept,
  };
  writeFileSync(join(out, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
  const odd = built.lines.filter((line) => line.slice(2).some((value) => /[^\x20-\x7e]/.test(value)));
  if (odd.length > 0) console.log(`build-fda-ndc: ${odd.length} line(s) carry a character outside plain ASCII: ${odd.map((l) => l[0]).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
