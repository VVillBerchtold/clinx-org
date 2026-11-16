// The words of the health centers pages that scripts/check-dist.mjs lets through its banned-word rule.
//
// In plain words: the rule refuses the words best, highest, lowest, worst and "top " in any page's text. Three
// kinds of text on the health centers pages are an agency's own and are printed as published:
//   1. two of HRSA's own line titles in the records workbooks, which hold the word "best",
//   2. the name, street and city of a health center or of one of its sites, as HRSA's files print them
//      (a health center in Broad Top, Pennsylvania, for example), and
//   3. the paragraphs of HRSA's own descriptions and eligibility texts on the funding pages.
// Exactly that text is let through, on exactly those pages. ClinX's own sentences on the same pages are still
// held to the rule: only a stretch of text equal to the agency's phrase is taken out before the rule is applied.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './records.mjs';

/** The words the page check refuses. The same expression is in scripts/check-dist.mjs and src/lib/hc-funding.ts. */
export const BANNED = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;

export const RECORDS_PAGES = '/health-centers/records/';
export const FUNDING_PAGES = '/health-centers/funding/';

/** HRSA's own titles, as its workbooks print them, that hold a banned word. Longer first. */
export const RECORDS_TITLES = [
  'If yes, which category best describes your health center’s role in the health professional education/training process? (Select all that apply.)',
  'Patients Best Served in a Language Other than English',
];

const escapeHtml = (t) => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const both = (words) => [...new Set([words, escapeHtml(words)])];

/** One paragraph for each line of a text, spaces gathered, as the funding pages print them. */
export function paragraphsOf(body) {
  return String(body)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

/** The paragraphs of HRSA's descriptions and eligibility texts that hold a banned word, read from the copied file. */
export function fundingParagraphs(root) {
  const file = join(root, 'src', 'data', 'health-centers', 'funding', 'opportunities.json');
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.opportunities;
  return [...new Set(list.flatMap((o) => [o.description, o.eligibility].flatMap((t) => paragraphsOf(t ?? ''))))].filter((p) => BANNED.test(p));
}

/** The columns of HRSA's lists of health centers and of sites that hold a name or a place. */
export const NAME_COLUMNS = ['name_as_published', 'street', 'address_line_2', 'city'];
export const SITE_NAME_COLUMNS = ['site_name', 'operated_by', 'street', 'city'];

/**
 * The names and places HRSA's files print for a health center or a site that hold a banned word, read from
 * the copied files. `centersCsv` is the text of health-centers.csv and `centerDocs` the parsed center files.
 */
export function namesWithBannedWord(centersCsv, centerDocs) {
  const found = new Set();
  const take = (words) => {
    if (typeof words === 'string' && BANNED.test(`${words} `)) found.add(words);
  };
  for (const row of parseCsv(centersCsv).records) for (const column of NAME_COLUMNS) take(row[column]);
  for (const doc of centerDocs) {
    for (const year of Object.values(doc.years ?? {})) {
      const columns = year.sites?.columns ?? [];
      const at = SITE_NAME_COLUMNS.map((c) => columns.indexOf(c)).filter((i) => i >= 0);
      for (const site of year.sites?.rows ?? []) for (const i of at) take(site[i]);
    }
  }
  return [...found];
}

/** The same, from the site's copy of the records. */
export function recordsNames(root) {
  const dir = join(root, 'src', 'data', 'health-centers', 'records');
  const list = join(dir, 'health-centers.csv');
  if (!existsSync(list)) return [];
  const folder = join(dir, 'centers');
  const docs = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(folder, f), 'utf8'))) : [];
  return namesWithBannedWord(readFileSync(list, 'utf8'), docs);
}

/** Everything the allowance needs, read once. */
export function printedHcWords(root) {
  return {
    records: [...RECORDS_TITLES, ...recordsNames(root)].flatMap(both).sort((a, b) => b.length - a.length),
    funding: fundingParagraphs(root).flatMap(both).sort((a, b) => b.length - a.length),
  };
}

/** The page's text with the agency's own phrases taken out, where the page is one that prints them. */
export function withoutPrintedHcWords(page, text, words) {
  let checked = text;
  if (page.startsWith(RECORDS_PAGES)) for (const phrase of words.records) checked = checked.replaceAll(phrase, ' ');
  if (page.startsWith(FUNDING_PAGES)) for (const paragraph of words.funding) checked = checked.replaceAll(paragraph, ' ');
  return checked;
}
