// Scans the built site (dist/) for things this site must never contain.
// No dependency: a careful tag scanner is enough for the HTML Astro writes.
// Usage: node scripts/check-dist.mjs [dist-folder]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printedHcWords, withoutPrintedHcWords } from './hc/printed-words.mjs';
import { SECURITY_TXT_PATH, securityTxtProblems, securityTxtSiteLinks } from './security-txt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));
if (!existsSync(dist)) {
  console.error(`check-dist: ${dist} does not exist. Run: npm run build`);
  process.exit(1);
}

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
// A piece of text cut out of a page, kept as its own short text. Without this the piece would keep
// the whole page in memory, and with thousands of large pages that is more than the program may use.
const own = (text) => Buffer.from(text, 'utf8').toString('utf8');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const files = walk(dist);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const urlOf = (file) => '/' + relative(dist, file).split(sep).join('/');

// The policy that must be on every page is the one in public/_headers.
let expectedCsp = null;
const headersPath = join(dist, '_headers');
if (!existsSync(headersPath)) fail('_headers', 'missing from the build');
else {
  const m = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(readFileSync(headersPath, 'utf8'));
  if (!m) fail('_headers', 'no Content-Security-Policy line');
  else expectedCsp = m[1].trim();
}
if (expectedCsp && /unsafe-inline|unsafe-eval/.test(expectedCsp)) fail('_headers', "the policy contains 'unsafe-inline' or 'unsafe-eval'");

// One page, /contact/, may post a form, and only to this site. Its policy is the usual one with form-action 'self'.
const FORM_PAGE = '/contact/index.html';
const FORM_ACTION = '/api/contact';
const formCsp = expectedCsp ? expectedCsp.replace("form-action 'none'", "form-action 'self'") : null;
if (existsSync(headersPath) && formCsp) {
  const block = /^\/contact\/\n((?:[ \t]+.*\n?)+)/m.exec(readFileSync(headersPath, 'utf8'));
  if (!block) fail('_headers', 'no rule for /contact/');
  else {
    if (!/^\s*! Content-Security-Policy\s*$/m.test(block[1])) fail('_headers', 'the /contact/ rule does not first remove the usual policy');
    const own = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(block[1]);
    if (!own || own[1].trim() !== formCsp) fail('_headers', "the /contact/ policy must be the usual one with form-action 'self' and no other change");
  }
}

const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*\/?>/g;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g;

function attributesOf(raw) {
  const attrs = [];
  for (const m of raw.matchAll(ATTR)) attrs.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  return attrs;
}

const isExternal = (v) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(v.trim());
const BANNED_WORDS = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;
// Labels the Minnesota Department of Health prints in its own report contain the word "Top" ("Top 25, unadjusted").
// They are shown as printed on the Minnesota page, marked as the report's words, and the dataset's METHODS.md quotes
// the same label on /methods/ and its data dictionary, shown on /data/. Exactly these phrases are let through on exactly these pages; the same word anywhere else
// in page text, or in our own words, still fails. Longer phrases first.
const PRINTED_LABELS = [
  { page: '/scorecard/mn/index.html', phrase: 'Appendix Table 6.1: Top net 340B revenue by Covered Entity, unadjusted' },
  { page: '/scorecard/mn/index.html', phrase: 'Appendix Table 6.2: Top net 340B revenue, unadjusted and adjusted' },
  { page: '/scorecard/mn/index.html', phrase: 'generated the top 90% of statewide net 340B revenue' },
  { page: '/scorecard/mn/index.html', phrase: 'Top 25' },
  { page: '/methods/index.html', phrase: 'Top 25' },
  { page: '/data/index.html', phrase: 'Top 25' },
  // Minnesota's report of 25 November 2024 (2023 data) prints the same kind of paragraph above its Table 5.
  { page: '/scorecard/mn/2023/index.html', phrase: 'generated the top 90% of statewide net 340B revenue' },
  // Maine's report names its two lists "Top 3 Most Costly ..." and "Top 3 Most Frequently Dispensed ...", and each sentence
  // above a list says "top 3". They are shown as printed, with the report's own titles quoted.
  { page: '/scorecard/me/index.html', phrase: 'Top 3' },
  { page: '/scorecard/me/index.html', phrase: 'top 3' },
  // The data dictionary (shown on /data/) describes Maine's hospital count as the hospitals with the NDC "in their top three".
  { page: '/data/index.html', phrase: 'in their top three' },
];
// A bill's own words (its title, the passage quoted from its text, its latest step, its sponsor) are shown as the
// legislature printed them on the bills pages. Where one of them holds a word this check bans, exactly that text is
// let through on the bills pages; our own words about a bill (its plain sentence) are still checked.
const billsFile = join(root, 'src', 'data', 'bills', '340b-bills.json');
const escapeHtml = (t) => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const PRINTED_BILL_WORDS = existsSync(billsFile)
  ? [...new Set(JSON.parse(readFileSync(billsFile, 'utf8')).bills.flatMap((b) => [b.title, b.quote, b.latest_action, b.sponsor, b.failed_vote, b.session]))]
      .filter((words) => BANNED_WORDS.test(words))
      .flatMap((words) => [words, escapeHtml(words)])
      .sort((a, b) => b.length - a.length)
  : [];
// The same for the calendar: a step, a hearing's name and a session's name are official words.
const eventsFile = join(root, 'src', 'data', 'bills', '340b-events.json');
const PRINTED_EVENT_WORDS = existsSync(eventsFile)
  ? [...new Set(JSON.parse(readFileSync(eventsFile, 'utf8')).events.flatMap((e) => [e.what, e.body, e.where]))]
      .filter((words) => BANNED_WORDS.test(words))
      .flatMap((words) => [words, escapeHtml(words)])
      .sort((a, b) => b.length - a.length)
  : [];
// And for federal rules and notices: a title and the passage quoted from the text are the Federal Register's words.
const noticesFile = join(root, 'src', 'data', 'bills', '340b-notices.json');
const PRINTED_NOTICE_WORDS = existsSync(noticesFile)
  ? [...new Set(JSON.parse(readFileSync(noticesFile, 'utf8')).notices.flatMap((n) => [n.title, n.quote, ...n.agencies]))]
      .filter((words) => BANNED_WORDS.test(words))
      .flatMap((words) => [words, escapeHtml(words)])
      .sort((a, b) => b.length - a.length)
  : [];
// A workbook filer's own words (what it typed in a cell of its Excel workbook) are shown as typed on that filer's page.
// Where one of them holds a word this check bans ("the highest quality care"), exactly that text is let through on the
// Ohio pages; our own words on those pages are still checked.
const filedPath = join(root, 'src', 'data', 'dataset', '340b-state-filings.json');
const PRINTED_WORKBOOK_WORDS = existsSync(filedPath)
  ? [
      ...new Set(
        JSON.parse(readFileSync(filedPath, 'utf8'))
          .line_items.filter((r) => String(r.filing_id).startsWith('oh-'))
          .flatMap((r) => [r.answer_as_filed, r.description_as_filed, r.label_as_filed, r.name_as_filed, r.note])
          .filter((words) => typeof words === 'string' && BANNED_WORDS.test(words)),
      ),
    ]
      .flatMap((words) => [words, escapeHtml(words)])
      .sort((a, b) => b.length - a.length)
  : [];
// The health centers pages print two of HRSA's own line titles and the agency's own description paragraphs as published.
// Where one holds a word this check bans, exactly that text is let through on the records pages and the funding pages
// (see scripts/hc/printed-words.mjs); the site's own sentences on those pages are still checked.
const PRINTED_HC_WORDS = printedHcWords(root);
// The site's own way back to the start of a page. It is a navigation label on every page, never a word about a filer.
const NAV_LABELS = ['Back to top'];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// The one address the site prints: ClinX's own contact address. Any other address on a page is a failure.
const CONTACT_ADDRESS = 'will@clinx.org';

const SITE = 'https://clinx.org';
const listedPages = []; // public addresses of pages a search engine may list
const unlistedPages = [];
const shareImages = new Set();
const ids = new Map(); // url path -> Set of ids
const links = []; // { page, target }
const labelPages = new Map(); // url path -> the page's blocks of data for search engines (text)
const scriptPages = new Map(); // script file -> Set of the pages that load it

// One file is built differently from every page, and is known here by its exact address: the
// standalone copy of Schedule Designer (scripts/standalone.mjs). It is a download a person opens
// from their own computer, so its styles and its script are inside the file. It is left out of the
// page checks below and has its own, further down (checkStandalone). Every other file is checked as before.
const STANDALONE = '/tools/schedule-designer/clinx-schedule-designer.html';
const STANDALONE_PAGE = '/tools/schedule-designer/index.html';
// Schedule Designer can remember where a person's file is when they ask it to: one record, in one
// browser database of this name. Only the script of that one page, and the copy, may name a database.
const DESIGNER_DATABASE = 'clinx-schedule-designer';
const SCRIPT_WORDS = ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts', 'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB'];
function checkDesignerDatabase(where, js) {
  if (!js.includes('indexedDB')) return;
  if (js.split('indexedDB.open(').length - 1 !== 1) fail(where, 'the script must open its one database in exactly one place');
  if (!js.includes(DESIGNER_DATABASE)) fail(where, `the script names a database but not ${DESIGNER_DATABASE}`);
}

// The data a page gives search engines must be well-formed, must describe this page, and must name
// only pages and files this site really has.
function checkLabels(page, raw, listed) {
  const ownAddress = SITE + page.replace(/index\.html$/, '');
  if (!listed) return fail(page, 'a page search engines may not list carries data for them');
  if (/[<>&]/.test(raw)) return fail(page, 'data for search engines contains a raw <, > or &');
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return fail(page, 'data for search engines is not valid JSON');
  }
  if (doc['@context'] !== 'https://schema.org' || !Array.isArray(doc['@graph']) || doc['@graph'].length === 0) return fail(page, 'data for search engines must be a schema.org @graph with something in it');
  const visit = (value, key) => {
    if (typeof value === 'string') {
      if (value === SITE || value.startsWith(SITE + '/')) links.push({ page, target: value.slice(SITE.length).split('#')[0] || '/' });
      else if (/^http:\/\//.test(value)) fail(page, `data for search engines names an http address: ${value}`);
      if (key !== '@type' && value.trim() === '') fail(page, `data for search engines has an empty ${key}`);
    } else if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(doc, '@graph');
  for (const node of doc['@graph']) {
    if (node['@type'] === 'BreadcrumbList') {
      const items = node.itemListElement ?? [];
      if (items.length < 2 || items.some((it, i) => it.position !== i + 1 || !it.name || !it.item)) fail(page, 'the trail for search engines is not a numbered list of named pages');
      else if (items[0].item !== SITE + '/' || items[items.length - 1].item !== ownAddress) fail(page, `the trail for search engines must run from the home page to ${ownAddress}`);
    }
    if (node['@type'] === 'Dataset') {
      const d = node.description ?? '';
      if (!node.name || d.length < 50 || d.length > 5000) fail(page, 'the dataset description for search engines needs a name and 50 to 5000 characters');
      if (!/^https:\/\/creativecommons\.org\/licenses\//.test(node.license ?? '')) fail(page, 'the dataset for search engines names no licence');
      if (!Array.isArray(node.distribution) || node.distribution.length === 0 || node.distribution.some((f) => !f.contentUrl || !f.encodingFormat)) fail(page, 'the dataset for search engines lists no files');
    }
  }
}

for (const file of htmlFiles) {
  const page = urlOf(file);
  if (page === STANDALONE) continue;
  const source = readFileSync(file, 'utf8');
  // A linked figure must not touch the word before or after it ("of$47.8 million").
  if (/[A-Za-z,]<a class="cited"/.test(source) || /<\/span><\/a>[A-Za-z]/.test(source)) fail(page, 'a linked figure touches the word beside it (missing space)');
  const noComments = source.replace(/<!--[\s\S]*?-->/g, '');
  const pageIds = new Set();
  ids.set(page, pageIds);

  // Inline script or style with content. One kind of block is let through: the data a search engine
  // reads (type application/ld+json). The browser does not run it; checkLabels() below reads it.
  const labelBlocks = [];
  for (const m of noComments.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributesOf(m[1]);
    if (attrs.length === 1 && attrs[0][0] === 'type' && attrs[0][1] === 'application/ld+json') {
      labelBlocks.push(own(m[2]));
      continue;
    }
    const hasSrc = attrs.some(([n]) => n === 'src');
    if (!hasSrc || m[2].trim() !== '') fail(page, 'inline <script>');
  }
  if (labelBlocks.length > 1) fail(page, `${labelBlocks.length} blocks of data for search engines, expected at most one`);
  labelPages.set(page, labelBlocks);
  if (/<style\b/i.test(noComments)) fail(page, 'inline <style>');

  let h1 = 0;
  let tables = 0;
  let captions = 0;
  let sawCsp = false;
  const canonicals = [];
  const ogImages = [];
  let unlisted = false;
  let sawTitle = false;
  let sawDescription = false;
  let sawLang = false;

  for (const m of noComments.matchAll(TAG)) {
    const name = m[1].toLowerCase();
    const attrs = attributesOf(m[2]);
    const get = (n) => attrs.find(([k]) => k === n)?.[1];

    if (name === 'h1') h1++;
    if (name === 'table') tables++;
    if (name === 'caption') captions++;
    if (name === 'title') sawTitle = true;
    if (name === 'html' && get('lang') === 'en') sawLang = true;
    if (['iframe', 'object', 'embed', 'base', 'frame'].includes(name) || (name === 'form' && page !== FORM_PAGE)) fail(page, `<${name}> element`);

    for (const [n, v] of attrs) {
      if (n === 'style') fail(page, 'style attribute');
      if (/^on[a-z]+$/.test(n)) fail(page, `${n} event handler attribute`);
      if (n === 'id') pageIds.add(own(v));
      if ((n === 'src' || n === 'srcset') && (isExternal(v) || /(^|,\s*)https?:\/\//i.test(v))) fail(page, `${n} points outside the site: ${v}`);
    }

    if (name === 'form') {
      const action = get('action');
      if (action !== undefined && (page !== FORM_PAGE || action !== FORM_ACTION || (get('method') ?? '').toLowerCase() !== 'post')) fail(page, `a form posts to ${action}; only ${FORM_PAGE} may post, to ${FORM_ACTION}`);
    }
    if (name === 'link') {
      const href = get('href');
      if (get('rel') === 'canonical') {
        // The one <link> that carries a full address: this page's own public address.
        canonicals.push(href ?? '');
        continue;
      }
      if (href !== undefined && (isExternal(href) || /^https?:/i.test(href))) fail(page, `<link href> points outside the site: ${href}`);
    }
    if (name === 'meta') {
      if (get('http-equiv')?.toLowerCase() === 'content-security-policy') {
        sawCsp = true;
        const content = get('content') ?? '';
        if (/unsafe-inline|unsafe-eval/.test(content)) fail(page, "CSP meta contains 'unsafe-inline' or 'unsafe-eval'");
        // The meta copy is the header's policy without frame-ancestors, which browsers ignore in a meta tag.
        const pagePolicy = page === FORM_PAGE ? formCsp : expectedCsp;
        const expectedMeta = pagePolicy ? pagePolicy.replace("; frame-ancestors 'none'", '') : null;
        if (expectedMeta && content !== expectedMeta) fail(page, 'CSP meta differs from public/_headers (frame-ancestors aside)');
        if (/frame-ancestors/.test(content)) fail(page, 'CSP meta carries frame-ancestors, which browsers ignore there');
      }
      if (get('name') === 'description' && (get('content') ?? '').trim() !== '') sawDescription = true;
      if (get('name') === 'robots' && /noindex/.test(get('content') ?? '')) unlisted = true;
      if (get('property') === 'og:image') {
        ogImages.push(get('content') ?? '');
        shareImages.add(own(get('content') ?? ''));
      }
    }

    // Links to check: anything on this site.
    if (name === 'a' || name === 'link') {
      const href = get('href');
      if (href !== undefined) links.push({ page, target: own(href) });
    }
    if (name === 'script' || name === 'img') {
      const src = get('src');
      if (src !== undefined) links.push({ page, target: own(src) });
      if (name === 'script' && src !== undefined) scriptPages.set(src, (scriptPages.get(src) ?? new Set()).add(page));
    }
  }

  if (ogImages.length !== 1) fail(page, `has ${ogImages.length} link-preview pictures, expected exactly one`);
  if (h1 !== 1) fail(page, `has ${h1} <h1>, expected exactly one`);
  if (!sawCsp) fail(page, 'no Content-Security-Policy meta tag');
  const ownAddress = SITE + page.replace(/index\.html$/, '');
  if (page !== '/404.html' && (canonicals.length !== 1 || canonicals[0] !== ownAddress)) fail(page, `the canonical link must be ${ownAddress}, found: ${canonicals.join(', ') || 'none'}`);
  (unlisted ? unlistedPages : listedPages).push(page === '/404.html' ? page : ownAddress);
  for (const raw of labelBlocks) checkLabels(page, raw, !unlisted);
  if (!sawTitle) fail(page, 'no <title>');
  if (!sawDescription) fail(page, 'no meta description');
  if (!sawLang) fail(page, 'html lang is not "en"');
  if (tables !== captions) fail(page, `${tables} tables but ${captions} captions`);
  const strayAddresses = (source.match(EMAIL) ?? []).filter((address) => address !== CONTACT_ADDRESS);
  if (strayAddresses.length > 0) fail(page, `contains an email address other than ${CONTACT_ADDRESS}`);

  const text = noComments
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  // Ohio's pages show a dollar figure to the cent and a percentage to two decimals in their figure cells; the long tails stay in the downloads.
  // A cell that holds the words a filer typed is shown as typed and is not a figure.
  if (page.startsWith('/scorecard/oh/')) {
    for (const cellMatch of noComments.matchAll(/<td\b[^>]*class="[^"]*\b(?:num|share)\b[^"]*"[^>]*>([\s\S]*?)<\/td>/g)) {
      const longTail = /^-?\$[\d,]+\.\d{3,}$|^-?[\d,]+\.\d{3,}%$/.exec(cellMatch[1].replace(/<[^>]*>/g, ' ').trim());
      if (longTail) fail(page, `a figure is shown with more decimals than the display rule allows: ${longTail[0]}`);
    }
  }
  let checked = text;
  for (const { page: onPage, phrase } of PRINTED_LABELS) {
    if (page === onPage) checked = checked.replaceAll(phrase, ' ');
  }
  if (page.startsWith('/bills/') || page.startsWith('/calendar/')) {
    for (const words of PRINTED_BILL_WORDS) checked = checked.replaceAll(words, ' ');
  }
  if (page.startsWith('/scorecard/oh/')) {
    for (const words of PRINTED_WORKBOOK_WORDS) checked = checked.replaceAll(words, ' ');
  }
  if (page.startsWith('/calendar/')) {
    for (const words of PRINTED_EVENT_WORDS) checked = checked.replaceAll(words, ' ');
  }
  if (page.startsWith('/notices/') || page.startsWith('/calendar/') || page.startsWith('/rebate-pilot/')) {
    for (const words of PRINTED_NOTICE_WORDS) checked = checked.replaceAll(words, ' ');
  }
  checked = withoutPrintedHcWords(page, checked, PRINTED_HC_WORDS);
  for (const label of NAV_LABELS) checked = checked.replaceAll(label, ' ');
  const word = BANNED_WORDS.exec(checked);
  if (word) fail(page, `page text contains "${word[0].trim()}" near: ...${checked.slice(Math.max(0, word.index - 40), word.index + 40).replace(/\s+/g, ' ')}...`);
}

for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8');
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (isExternal(m[2]) || /^https?:/i.test(m[2])) fail(urlOf(file), `CSS url() points outside the site: ${m[2]}`);
  }
  if (/@import/i.test(css)) fail(urlOf(file), '@import in CSS');
}

// Scripts: nothing on this site may connect anywhere. The one exception is the demo's
// "Try to send something" button: a single request to a reserved address that the policy refuses.
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const js = readFileSync(file, 'utf8');
  const name = urlOf(file);
  // The script that Schedule Designer's page loads, and no other page does, may name the one database.
  const users = scriptPages.get(name) ?? new Set();
  const isDesigner = users.size === 1 && users.has(STANDALONE_PAGE);
  for (const word of SCRIPT_WORDS) {
    if (word === 'indexedDB' && isDesigner) continue;
    if (js.includes(word)) fail(name, `script uses ${word}`);
  }
  if (isDesigner) checkDesignerDatabase(name, js);
  const calls = js.split('fetch(').length - 1;
  const isDemo = /\/_astro\/demo\.[^/]*\.js$/.test(name);
  if (calls > (isDemo ? 1 : 0)) fail(name, `script has ${calls} network call(s)`);
  if (isDemo && calls === 1 && !/fetch\(\s*[`'"]https:\/\/example\.invalid\//.test(js)) fail(name, 'the demo\'s one network call does not go to the reserved address');
  for (const m of js.matchAll(/https?:\/\/[^\s`'"\\)]+/g)) {
    // Two kinds of address are names and are never fetched: the web's own format names (w3.org) and
    // the names the Excel file format requires inside every workbook (schemas.openxmlformats.org).
    // Cleaner Copy writes the second kind into the legend workbook it builds.
    const formatName = /^http:\/\/www\.w3\.org\//.test(m[0]) || /^http:\/\/schemas\.openxmlformats\.org\//.test(m[0]);
    if (!/^https:\/\/example\.invalid\//.test(m[0]) && !formatName) fail(name, `script names an outside address: ${m[0]}`);
  }
}

// The standalone copy of Schedule Designer. It must load nothing at all, carry a policy that
// refuses every connection and lets its one style block and its one script block through by their
// fingerprints, and match the checksum file published beside it.
function checkStandalone() {
  const where = STANDALONE;
  const file = join(dist, STANDALONE);
  if (!existsSync(file)) return fail(where, 'missing from the build (npm run build writes it)');
  const bytes = readFileSync(file);
  const source = bytes.toString('utf8');
  const fileName = STANDALONE.split('/').pop();

  // The checksum file: the SHA-256 of the copy and its name, in the usual one-line form.
  const sumPath = `${file}.sha256`;
  if (!existsSync(sumPath)) fail(`${where}.sha256`, 'missing from the build');
  else if (readFileSync(sumPath, 'utf8') !== `${createHash('sha256').update(bytes).digest('hex')}  ${fileName}\n`) fail(`${where}.sha256`, 'is not the SHA-256 of the copy followed by its name');

  // One style block and one script block, and the policy names exactly those two by fingerprint.
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const styles = [...source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
  if (scripts.length !== 1 || scripts[0][1] !== ' type="module"') fail(where, `has ${scripts.length} script block(s); expected one, a module with no address`);
  if (styles.length !== 1 || styles[0][1] !== '') fail(where, `has ${styles.length} style block(s); expected one`);
  const js = scripts[0]?.[2] ?? '';
  const css = styles[0]?.[2] ?? '';
  const fingerprint = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  const policies = [...source.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/gi)];
  if ((source.match(/http-equiv/gi) ?? []).length !== 1 || policies.length !== 1) fail(where, 'must carry exactly one http-equiv tag, its policy');
  else {
    const policy = policies[0][1];
    const wanted = `default-src 'none'; script-src ${fingerprint(js)}; style-src ${fingerprint(css)}; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
    if (/unsafe-inline|unsafe-eval|unsafe-hashes|\*/.test(policy)) fail(where, 'the policy contains an unsafe word or a wildcard');
    if (!policy.includes("connect-src 'none'")) fail(where, "the policy does not carry connect-src 'none'");
    if (policy !== wanted) fail(where, 'the policy is not the agreed one, or its fingerprints do not match the style and script blocks in the file');
    const at = policies[0].index;
    if (at > (styles[0]?.index ?? 0) || at > (scripts[0]?.index ?? 0)) fail(where, 'the policy comes after a block it should govern');
  }

  // No load of any kind. In the markup an address may only be a place inside the file (#...), and the tab icon is data.
  const markup = source.replace(/<!--[\s\S]*?-->/g, '').replace(js, '').replace(css, '');
  let h1 = 0;
  let sawTitle = false;
  let sawLang = false;
  let unlisted = false;
  for (const m of markup.matchAll(TAG)) {
    const name = m[1].toLowerCase();
    const attrs = attributesOf(m[2]);
    const get = (n) => attrs.find(([k]) => k === n)?.[1];
    if (name === 'h1') h1++;
    if (name === 'title') sawTitle = true;
    if (name === 'html' && get('lang') === 'en') sawLang = true;
    if (name === 'meta' && get('name') === 'robots' && /noindex/.test(get('content') ?? '')) unlisted = true;
    if (['iframe', 'object', 'embed', 'base', 'frame', 'form', 'img', 'picture', 'source', 'video', 'audio', 'track', 'portal', 'fencedframe'].includes(name)) fail(where, `<${name}> element`);
    if (name === 'link' && (get('rel') !== 'icon' || !(get('href') ?? '').startsWith('data:image/'))) fail(where, 'a <link> other than the tab icon written in as data');
    for (const [n, v] of attrs) {
      if (n === 'style') fail(where, 'style attribute');
      if (/^on[a-z]+$/.test(n)) fail(where, `${n} event handler attribute`);
      if (['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data', 'ping', 'background', 'manifest', 'cite', 'longdesc', 'usemap', 'codebase', 'archive', 'imagesrcset'].includes(n)) {
        const inside = v.startsWith('#') || (name === 'link' && v.startsWith('data:image/'));
        if (!inside) fail(where, `${n} points outside the file: ${v.slice(0, 80)}`);
      }
    }
  }
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]{0,40})/gi)) if (!m[1].startsWith('data:')) fail(where, `the styles load a file: ${m[1]}`);
  if (/@import/i.test(css)) fail(where, '@import in the styles');
  // The word http may stand in the file only as the name of its policy tag and as the two kinds of
  // format name that are never fetched (see the scripts check above).
  const withoutNames = source.replaceAll('http-equiv', '').replace(/http:\/\/(?:www\.w3\.org|schemas\.openxmlformats\.org)\/[^\s`'"\\)<]*/g, '');
  const loads = /https?:|\/\/[a-z0-9-]+\.[a-z]{2,}\//i.exec(withoutNames);
  if (loads) fail(where, `names an outside address near: ...${withoutNames.slice(Math.max(0, loads.index - 40), loads.index + 60).replace(/\s+/g, ' ')}...`);

  // The script: no connection of any kind, and no storage but the one database.
  for (const word of SCRIPT_WORDS) if (word !== 'indexedDB' && js.includes(word)) fail(where, `script uses ${word}`);
  if (js.split('fetch(').length - 1 > 0) fail(where, 'script has a network call');
  if (/\bimport\s*\(|(?:^|[;\n])\s*import\b/.test(js)) fail(where, 'script imports another file');
  checkDesignerDatabase(where, js);

  // The page itself.
  if (h1 !== 1) fail(where, `has ${h1} <h1>, expected exactly one`);
  if (!sawTitle) fail(where, 'no <title>');
  if (!sawLang) fail(where, 'html lang is not "en"');
  if (!unlisted) fail(where, 'must ask search engines not to list it');
  const text = markup.replace(/<[^>]*>/g, ' ');
  for (const words of ['Standalone copy', 'This copy does not update itself', 'clinx.org/tools/schedule-designer/', 'Keeps nothing unless you choose otherwise']) {
    if (!text.includes(words)) fail(where, `does not say: ${words}`);
  }
  if (EMAIL.test(text)) fail(where, 'contains an email address');
  EMAIL.lastIndex = 0;
  const word = BANNED_WORDS.exec(text);
  if (word) fail(where, `page text contains "${word[0].trim()}" near: ...${text.slice(Math.max(0, word.index - 40), word.index + 40).replace(/\s+/g, ' ')}...`);
  if (/[\u2013\u2014]/.test(text)) fail(where, 'page text uses a dash as punctuation');
}
checkStandalone();
// The page of the tool offers the copy and its checksum as downloads.
{
  const page = existsSync(join(dist, STANDALONE_PAGE)) ? readFileSync(join(dist, STANDALONE_PAGE), 'utf8') : '';
  for (const href of [STANDALONE, `${STANDALONE}.sha256`]) if (!page.includes(`href="${href}" download`)) fail(STANDALONE_PAGE, `does not offer ${href} as a download`);
}

// Search engines. robots.txt, the pages' own "do not list" tags and sitemap.xml must tell one story:
// either the private preview (every crawler turned away, every page unlisted, no sitemap), or the
// public site (crawlers let in, only the pages in ALWAYS_UNLISTED unlisted, the sitemap naming every other page).
const ALWAYS_UNLISTED = ['/404.html', `${SITE}/contact/sent/`, `${SITE}/contact/problem/`];
const robotsPath = join(dist, 'robots.txt');
const sitemapPath = join(dist, 'sitemap.xml');
let mode = 'missing';
if (!existsSync(robotsPath)) fail('robots.txt', 'missing from the build');
else {
  const robots = readFileSync(robotsPath, 'utf8');
  const closed = /^Disallow:\s*\/\s*$/m.test(robots);
  mode = closed ? 'private preview' : 'public';
  if (closed) {
    if (listedPages.length > 0) fail('robots.txt', `turns crawlers away, but ${listedPages.length} page(s) do not ask to stay unlisted, e.g. ${listedPages[0]}`);
    if (existsSync(sitemapPath)) fail('sitemap.xml', 'exists although robots.txt turns every crawler away');
  } else {
    if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail('robots.txt', 'does not point to the sitemap');
    if (!/^Disallow:\s*\/api\/\s*$/m.test(robots)) fail('robots.txt', 'does not keep crawlers off /api/');
    if (!/^Disallow:\s*\/mcp\s*$/m.test(robots)) fail('robots.txt', 'does not keep crawlers off /mcp');
    const extra = unlistedPages.filter((p) => !ALWAYS_UNLISTED.includes(p));
    if (extra.length > 0) fail('robots.txt', `lets crawlers in, but ${extra.length} page(s) still ask to stay unlisted, e.g. ${extra[0]}`);
    for (const p of ALWAYS_UNLISTED) if (!unlistedPages.includes(p)) fail(p, 'must ask search engines not to list it');
    if (!existsSync(sitemapPath)) fail('sitemap.xml', 'missing from the build');
    else {
      const named = [...readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
      const wanted = [...listedPages].sort();
      if (named.join('\n') !== wanted.join('\n')) fail('sitemap.xml', `names ${named.length} page(s) but ${wanted.length} may be listed`);
    }
    if (htmlFiles.some((f) => /Draft wording/.test(readFileSync(f, 'utf8')))) fail('pages', 'a "Draft wording" tag is on a public build');
  }
}
// Link previews. Every page names exactly one picture (checked page by page above). It must be one of
// the known cards in scripts/brand/share-cards.json, a file in the build, and a PNG of 1200 by 630 (read from the file itself).
const shareList = JSON.parse(readFileSync(join(root, 'scripts', 'brand', 'share-cards.json'), 'utf8'));
const knownCards = new Map(shareList.cards.map((c) => [`${SITE}/brand/share/${c.id}.png`, c.id]));
for (const image of shareImages) {
  if (!knownCards.has(image)) {
    fail('pages', `the link-preview picture is not one of the known cards: ${image}`);
    continue;
  }
  const file = join(dist, image.slice(SITE.length));
  if (!existsSync(file)) {
    fail('pages', `the link-preview picture is not a built file: ${image}`);
    continue;
  }
  const bytes = readFileSync(file);
  const isPng = bytes.length > 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.subarray(12, 16).toString('latin1') === 'IHDR';
  const size = isPng ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [0, 0];
  if (!isPng) fail(image, 'is not a PNG');
  else if (size[0] !== shareList.width || size[1] !== shareList.height) fail(image, `is ${size[0]} by ${size[1]}, expected ${shareList.width} by ${shareList.height}`);
}
for (const [image, id] of knownCards) if (!shareImages.has(image)) fail('pages', `the share card "${id}" is used by no page`);

// The open file of the states with a reporting law (data/340b-reporting-states.json), written by the site from its registry.
const REPORTING_GROUP_IDS = ['own-reports', 'named-in-state-report', 'state-totals', 'not-posted-yet'];
const statesFilePath = join(dist, 'data', '340b-reporting-states.json');
if (!existsSync(statesFilePath)) fail('data/340b-reporting-states.json', 'missing from the build');
else {
  let doc;
  try {
    doc = JSON.parse(readFileSync(statesFilePath, 'utf8'));
  } catch {
    fail('data/340b-reporting-states.json', 'not valid JSON');
  }
  if (doc) {
    const where = 'data/340b-reporting-states.json';
    const text = (v) => typeof v === 'string' && v.trim() !== '';
    if (JSON.stringify(Object.keys(doc)) !== JSON.stringify(['about', 'updated', 'groups', 'states'])) fail(where, 'the top-level fields are not about, updated, groups, states');
    if (!text(doc.about)) fail(where, 'no "about" sentence');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.updated ?? '')) fail(where, 'no "updated" day');
    const groupIds = (doc.groups ?? []).map((g) => g.id);
    if (JSON.stringify(groupIds) !== JSON.stringify(REPORTING_GROUP_IDS)) fail(where, `the groups are not ${REPORTING_GROUP_IDS.join(', ')}`);
    for (const g of doc.groups ?? []) if (!text(g.label) || !text(g.description)) fail(where, `group ${g.id} has no label or description`);
    const scorecard = existsSync(join(dist, 'scorecard', 'index.html')) ? readFileSync(join(dist, 'scorecard', 'index.html'), 'utf8') : '';
    const seenStates = new Set();
    for (const st of doc.states ?? []) {
      const at = `${where}: ${st.state}`;
      if (JSON.stringify(Object.keys(st)) !== JSON.stringify(['state', 'name', 'group', 'on_clinx', 'what_is_public', 'where_it_stands', 'scorecard_url', 'sources'])) fail(at, 'the fields are not the agreed ones');
      if (!/^[A-Z]{2}$/.test(st.state ?? '') || seenStates.has(st.state)) fail(at, 'not a two-letter state code, or listed twice');
      seenStates.add(st.state);
      if (!REPORTING_GROUP_IDS.includes(st.group)) fail(at, `unknown group ${st.group}`);
      if (!text(st.name) || !text(st.what_is_public) || !text(st.where_it_stands)) fail(at, 'a name or a sentence is missing');
      if (typeof st.on_clinx !== 'boolean') fail(at, 'on_clinx is not true or false');
      else if (st.on_clinx) {
        const expect = `${SITE}/scorecard/${st.state.toLowerCase()}/`;
        if (st.scorecard_url !== expect) fail(at, `scorecard_url should be ${expect}`);
        else if (!existsSync(join(dist, 'scorecard', st.state.toLowerCase(), 'index.html'))) fail(at, 'scorecard_url names a page that is not built');
      } else if (st.scorecard_url !== null) fail(at, 'scorecard_url must be null where the Scorecard holds no figures');
      if (!Array.isArray(st.sources) || st.sources.length === 0 || st.sources.some((x) => !text(x.label) || !/^https:\/\/\S+$/.test(x.url ?? ''))) fail(at, 'sources need a label and an https address');
      if (!scorecard.includes(`id="state-${(st.state ?? '').toLowerCase()}"`)) fail(at, 'is not shown on the Scorecard page');
    }
    // The other way: every state the Scorecard page shows under a kind is in the file.
    for (const m of scorecard.matchAll(/class="standing [^"]*" id="state-([a-z]{2})"/g)) if (!seenStates.has(m[1].toUpperCase())) fail(where, `${m[1].toUpperCase()} is on the Scorecard page but not in the file`);
  }
}

// A state with more than one year of a report has a year switch on every one of its year pages: one link for each year,
// the page being read marked with aria-current, and the state address showing the latest year.
{
  const scorecardDir = join(dist, 'scorecard');
  for (const state of existsSync(scorecardDir) ? readdirSync(scorecardDir) : []) {
    const stateDir = join(scorecardDir, state);
    if (!statSync(stateDir).isDirectory()) continue;
    for (const year of readdirSync(stateDir).filter((n) => /^\d{4}$/.test(n))) {
      for (const [page, expectYear] of [[`/scorecard/${state}/${year}/index.html`, year], [`/scorecard/${state}/index.html`, null]]) {
        const file = join(dist, page);
        if (!existsSync(file)) {
          fail(page, 'a year page is built but this page is not');
          continue;
        }
        const html = readFileSync(file, 'utf8');
        const block = /<nav class="year-switch"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
        const found = [...block.matchAll(/<a href="([^"]+)"([^>]*)>(\d{4}) data<\/a>/g)];
        const current = found.filter((m) => /aria-current/.test(m[2]));
        if (found.length < 2) fail(page, 'has no year switch with a link for each year');
        else if (current.length !== 1) fail(page, 'the year switch must mark exactly one year with aria-current');
        else if (expectYear !== null && current[0][3] !== expectYear) fail(page, `the year switch marks ${current[0][3]}, expected ${expectYear}`);
        else if (expectYear === null && current[0][1] !== `/scorecard/${state}/`) fail(page, 'the state address must show the latest year');
      }
    }
  }
}

// The assistants server reads the filed reports as an index and one small file for each record, written at build time
// (src/pages/data). Every record of the whole file must be in the index, every record must have its file, and no file of
// the build may be too big for the host to serve (25 MiB).
const MAX_FILE_BYTES = 25 * 1024 * 1024;
for (const f of files) if (statSync(f).size > MAX_FILE_BYTES) fail(urlOf(f), `is ${(statSync(f).size / 1048576).toFixed(1)} MiB, over the 25 MiB the host allows for one file`);
{
  const where = 'data/340b-filings-index.json';
  const indexPath = join(dist, 'data', '340b-filings-index.json');
  const wholePath = join(dist, 'data', '340b-state-filings.json');
  if (!existsSync(indexPath)) fail(where, 'missing from the build');
  else if (!existsSync(wholePath)) fail('data/340b-state-filings.json', 'missing from the build (it stays as a download)');
  else {
    let index;
    let whole;
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8'));
      whole = JSON.parse(readFileSync(wholePath, 'utf8'));
    } catch {
      fail(where, 'the index or the whole file is not valid JSON');
    }
    if (index && whole) {
      const listed = new Set(index.filings.map((f) => f.filing_id));
      const wanted = whole.filings.map((f) => f.filing_id);
      if (listed.size !== index.filings.length) fail(where, 'lists a record twice');
      for (const wantedId of wanted) if (!listed.has(wantedId)) fail(where, `does not list ${wantedId}`);
      if (index.filings.length !== wanted.length) fail(where, `lists ${index.filings.length} records, the whole file holds ${wanted.length}`);
      if (index.dataset_version !== whole.dataset_version) fail(where, 'is not of the same dataset version as the whole file');
      const reportFiles = files.filter((f) => urlOf(f).startsWith('/data/filings/') && f.endsWith('.json'));
      if (reportFiles.length !== wanted.length) fail('data/filings', `holds ${reportFiles.length} files, expected one for each of ${wanted.length} records`);
      for (const record of index.filings) {
        const file = join(dist, 'data', 'filings', `${record.filing_id.toLowerCase()}.json`);
        if (!existsSync(file)) {
          fail(`data/filings/${record.filing_id.toLowerCase()}.json`, 'missing from the build');
          continue;
        }
        try {
          const report = JSON.parse(readFileSync(file, 'utf8'));
          if (report.filing_id !== record.filing_id) fail(urlOf(file), 'is the file of another record');
          else if (!Array.isArray(report.lines) || report.lines.length !== record.line_count) fail(urlOf(file), `holds ${report.lines?.length} lines, the index says ${record.line_count}`);
          else if ((report.discrepancies ?? []).length !== record.discrepancy_count) fail(urlOf(file), 'holds a different number of differences from the index');
          // A count of 1 to 5 never leaves the build, in any file.
          for (const line of report.lines) if (/^\s*[1-5]\s*$/.test(String(line.claims ?? '')) || /^\s*[1-5]\s*$/.test(String(line.claims_as_filed ?? ''))) fail(urlOf(file), 'carries a claim count of 1 to 5');
        } catch {
          fail(urlOf(file), 'is not valid JSON');
        }
      }
      // A workbook record has a page of its own, at the address the server also gives, and that page ships no more script or style than a Rhode Island filer's.
      const workbookRecords = index.filings.filter((f) => /\.xlsx?$/i.test(f.source_file ?? ''));
      const weight = (html) => {
        const sum = (pattern) => [...new Set([...html.matchAll(pattern)].map((m) => m[1]))].reduce((n, href) => n + (existsSync(join(dist, href)) ? statSync(join(dist, href)).size : 0), 0);
        return { css: sum(/href="(\/_astro\/[^"]+\.css)"/g), js: sum(/(?:src|href)="(\/_astro\/[^"]+\.js)"/g) };
      };
      const riPage = join(dist, 'scorecard', 'ri', 'landmark', 'index.html');
      const riWeight = existsSync(riPage) ? weight(readFileSync(riPage, 'utf8')) : null;
      for (const record of workbookRecords) {
        const state = String(record.state).toLowerCase();
        const slug = record.filing_id.replace(new RegExp(`^${state}-\\d{4}-`), '');
        const page = join(dist, 'scorecard', state, slug, 'index.html');
        if (!existsSync(page)) {
          fail(`/scorecard/${state}/${slug}/`, `the page of workbook ${record.filing_id} is not built`);
          continue;
        }
        if (riWeight) {
          const w = weight(readFileSync(page, 'utf8'));
          if (w.css > riWeight.css || w.js > riWeight.js) fail(`/scorecard/${state}/${slug}/`, `ships ${w.css} bytes of style and ${w.js} of script, more than a Rhode Island filer's ${riWeight.css} and ${riWeight.js}`);
        }
      }
    }
  }
}

// The file that says where to report a security problem (see scripts/security-txt.mjs). It must be in the build, name a
// contact, carry an end date that is still at least 30 days away, and be served as plain text. The pages of this site
// that it names are added to the links checked below.
{
  const where = SECURITY_TXT_PATH.slice(1);
  const file = join(dist, where);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
  for (const problem of securityTxtProblems(text, SITE)) fail(where, problem);
  if (text !== null) {
    for (const target of securityTxtSiteLinks(text, SITE)) links.push({ page: SECURITY_TXT_PATH, target });
    const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
    const rule = new RegExp(`^${SECURITY_TXT_PATH.replaceAll('.', '\\.')}\\n((?:[ \\t]+.*\\n?)+)`, 'm').exec(headers);
    if (!rule || !/^\s*Content-Type:\s*text\/plain; charset=utf-8\s*$/m.test(rule[1])) fail('_headers', `no rule serves ${SECURITY_TXT_PATH} as plain text. Add these two lines to public/_headers: "${SECURITY_TXT_PATH}" and, under it and indented, "Content-Type: text/plain; charset=utf-8".`);
  }
}

// Every state's 340B report page in the Scorecard (/scorecard/<two letters>/) is titled the same way, in the window's
// title and in its heading: "<State> 340B hospital report" (src/lib/state-pages.ts). A state added later is held to it too.
{
  const decode = (text) => text.replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
  const dir = join(dist, 'scorecard');
  for (const st of existsSync(dir) ? readdirSync(dir) : []) {
    if (!/^[a-z]{2}$/.test(st)) continue;
    const file = join(dir, st, 'index.html');
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
    const h1 = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '');
    const where = `/scorecard/${st}/`;
    if (!/^[A-Z][A-Za-z .]+ 340B hospital report$/.test(h1)) fail(where, `the heading must be "<State> 340B hospital report", not "${h1}"`);
    else if (!title.startsWith(h1)) fail(where, `the window's title must start with "${h1}", not "${title}"`);
  }
}

// Every internal link must resolve to a built file, and every #fragment to an id on that page.
function resolveTarget(page, target) {
  const [beforeHash, fragment] = target.split('#');
  const pathPart = beforeHash.split('?')[0];
  let url;
  if (pathPart === '') url = page;
  else if (pathPart.startsWith('/')) url = pathPart;
  else url = resolve('/', dirname(page), pathPart);
  return { url, fragment };
}
for (const { page, target } of links) {
  const t = target.trim();
  if (t === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(t)) continue; // external or mailto: not checked here
  const { url, fragment } = resolveTarget(page, t);
  let file = join(dist, decodeURIComponent(url));
  if (url.endsWith('/')) file = join(file, 'index.html');
  else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    fail(page, `link does not resolve to a built file: ${target}`);
    continue;
  }
  if (fragment && file.endsWith('.html')) {
    const known = ids.get(urlOf(file));
    if (known && !known.has(decodeURIComponent(fragment))) fail(page, `link to a missing anchor: ${target}`);
  }
}

// The About page says what is on the site. It must link every page the main menu links and every tool,
// so a section or a tool added later cannot be left out of it. The home page and About itself are not
// expected there.
{
  const aboutPath = join(dist, 'about', 'index.html');
  if (!existsSync(aboutPath)) fail('/about/', 'missing from the build');
  else {
    const about = readFileSync(aboutPath, 'utf8');
    const header = /<header\b[\s\S]*?<\/header>/.exec(about)?.[0] ?? '';
    const main = /<main\b[\s\S]*?<\/main>/.exec(about)?.[0] ?? '';
    const hrefs = (html) => new Set([...html.matchAll(/href="(\/[^"#]*)(?:#[^"]*)?"/g)].map((m) => m[1]));
    const inMenu = [...hrefs(header)].filter((h) => h !== '/' && h !== '/about/');
    const toolsDir = join(dist, 'tools');
    const toolPages = existsSync(toolsDir)
      ? readdirSync(toolsDir).filter((name) => existsSync(join(toolsDir, name, 'index.html'))).map((name) => `/tools/${name}/`)
      : [];
    if (inMenu.length < 10) fail('/about/', `the main menu was read as ${inMenu.length} links, too few to be right`);
    const said = hrefs(main);
    for (const want of [...inMenu, ...toolPages]) if (!said.has(want)) fail('/about/', `the About page does not link ${want}, which the site has`);
  }
}

// A saved copy of a tool is one file that holds the whole tool. The built site must carry the very
// file that is on record, and the tool's page must print that file's fingerprint.
{
  const recordPath = join(root, 'src', 'lib', 'saved-copies.json');
  const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : {};
  for (const [key, copy] of Object.entries(record)) {
    const file = join(dist, copy.file);
    const pagePath = join(dist, 'tools', key, 'index.html');
    if (!existsSync(file)) fail(copy.file, 'the saved copy is on record and missing from the build');
    else {
      const data = readFileSync(file);
      const print = createHash('sha256').update(data).digest('hex');
      if (print !== copy.sha256) fail(copy.file, `the saved copy is not the file on record (its SHA-256 is ${print})`);
      if (data.length !== copy.bytes) fail(copy.file, `the saved copy is ${data.length} bytes, and the record says ${copy.bytes}`);
    }
    const html = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : '';
    if (!html.includes(copy.sha256)) fail(`/tools/${key}/`, 'the page does not print the fingerprint of its saved copy');
    if (!html.includes(`href="${copy.file}" download="${copy.savedAs}"`)) fail(`/tools/${key}/`, 'the page does not offer its saved copy under the name on record');
  }
}

if (problems.length > 0) {
  for (const p of problems.slice(0, 60)) console.error(`check-dist: ${p}`);
  if (problems.length > 60) console.error(`check-dist: ... and ${problems.length - 60} more`);
  console.error(`check-dist: FAILED with ${problems.length} problem(s).`);
  process.exit(1);
}
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(`check-dist: ${htmlFiles.length} pages, ${links.length} links, ${files.length} files, ${(bytes / 1024).toFixed(0)} KiB. Search engines: ${mode} (${listedPages.length} pages may be listed). All checks pass.`);
