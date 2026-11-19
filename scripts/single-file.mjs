// Packs one tool page from the built site into a single file that holds the whole tool: the page,
// its styles, its fonts, its scripts and its worker. The file works with the network off, and it
// carries a rule that lets it open no connection at all.
//
// The file is made by hand, on purpose, and then kept in the repository. It is not remade on every
// build, so a saved copy stays the same, byte for byte, until someone decides to replace it. Its
// fingerprint (SHA-256) is written to src/lib/saved-copies.json, and the tool's page prints it.
//
// Usage, after `npm run build`:
//   node scripts/single-file.mjs file-check                                   say whether the copy on record matches this build
//   node scripts/single-file.mjs file-check --version 1.0 --made 2026-11-17 --write    make the copy and record it
// After --write, run `npm run build` again so the tool's page prints the new fingerprint.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const RECORD = join(root, 'src', 'lib', 'saved-copies.json');
const SITE = 'https://clinx.org';

/** Each tool that has a saved copy: its built page, the part of that page left out of the copy, and where the copy's own note goes. */
const TOOLS = {
  'file-check': {
    name: 'File Check',
    page: 'tools/file-check/index.html',
    address: '/tools/file-check/',
    // The page's part about the saved copy. A saved copy does not offer a copy of itself.
    leaveOut: /<section id="fc-keep"[\s\S]*?<\/section>/,
    noteBefore: '<p id="cc-off"',
    file: 'tools/file-check/clinx-file-check.html.bin',
    savedAs: 'clinx-file-check.html',
  },
};

const stop = (message) => {
  console.error(`single-file: ${message}`);
  process.exit(1);
};
const sha256 = (data, how) => createHash('sha256').update(data).digest(how);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) stop(`the date must be written as YYYY-MM-DD, found: ${iso}`);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};
const one = (text, pattern, what) => {
  const found = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) ?? [];
  if (found.length !== 1) stop(`expected one ${what} in the page, found ${found.length}`);
};
/** A file the built page names by an address that starts with /_astro/. */
const built = (address) => {
  if (!/^\/_astro\/[\w.-]+$/.test(address)) stop(`the page names a file outside /_astro/: ${address}`);
  const path = join(dist, address);
  if (!existsSync(path)) stop(`the page names a file the build does not have: ${address}`);
  return readFileSync(path);
};
/** Text that sits inside a <script> element must not hold the letters that end one. */
const forScriptElement = (code) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

/** The whole tool as one text. The same build always gives the same text. */
export function pack(tool, version, made) {
  const pagePath = join(dist, tool.page);
  if (!existsSync(pagePath)) stop(`${tool.page} is not built. Run: npm run build`);
  let html = readFileSync(pagePath, 'utf8');
  if (html.includes('\r')) stop('the page holds a carriage return, which a browser would change as it reads the file');

  // 1. The part of the page about the saved copy is left out, and the copy's own note goes in.
  one(html, tool.leaveOut, 'part about the saved copy');
  html = html.replace(tool.leaveOut, '');
  if (html.split(tool.noteBefore).length !== 2) stop(`expected one place for the note (${tool.noteBefore})`);
  const note = `<p class="panel fc-saved"><strong>Saved copy.</strong> ${tool.name}, version ${version}, made ${longDate(made)} and kept by ClinX. This one file holds the whole tool and opens no connection. Its fingerprint is printed at <a href="${SITE}${tool.address}">clinx.org${tool.address}</a>, with the way to compare it.</p>`;
  html = html.replace(tool.noteBefore, note + tool.noteBefore);
  one(html, /<title>[^<]*<\/title>/, 'title');
  html = html.replace(/<title>/, '<title>Saved copy: ');

  // 2. Styles: every stylesheet becomes one <style>, with the two fonts written into it.
  const sheets = [];
  html = html.replace(/<link\b[^>]*>/g, (tag) => {
    const rel = /\brel="([^"]*)"/.exec(tag)?.[1] ?? '';
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (rel === 'stylesheet') {
      sheets.push(built(href).toString('utf8'));
      return sheets.length === 1 ? '<style></style>' : '';
    }
    // Icons and early loading of fonts are files beside the page. A single file has none.
    if (['icon', 'apple-touch-icon', 'preload', 'modulepreload', 'manifest'].includes(rel)) return '';
    return tag;
  });
  if (sheets.length === 0) stop('the page has no stylesheet');
  const css = sheets.join('\n').replace(/url\((['"]?)([^)'"]+)\1\)/g, (whole, _quote, address) => {
    if (address.startsWith('data:')) return whole;
    if (!address.endsWith('.woff2')) stop(`a stylesheet names a file that is not a font: ${address}`);
    return `url(data:font/woff2;base64,${built(address).toString('base64')})`;
  });
  if (/<\/style/i.test(css)) stop('a stylesheet holds the letters that end a <style> element');
  html = html.replace('<style></style>', () => `<style>${css}</style>`);

  // 3. Scripts: each one is written into the page, and the worker is written into the script that starts it.
  const scripts = [];
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (_whole, attrs, body) => {
    // A block of data about the page for search engines. It is not a program, and the copy leaves it out.
    if (/type="application\/ld\+json"/.test(attrs)) return '';
    const src = /\bsrc="([^"]*)"/.exec(attrs)?.[1];
    if (!src || body.trim() !== '' || !/type="module"/.test(attrs)) stop(`a script of a kind this program does not know: <script${attrs}>`);
    let code = built(src).toString('utf8');
    if (/\bfrom\s*["'`]|\bimport\s*["'`(]/.test(code)) stop(`${src} loads another file, so it cannot be written into the page as it is`);
    const workers = [];
    // The worker is started from its own text, held in this script. It is started as a plain
    // script and not as a module: a browser refuses a module worker made this way when the page
    // was opened from a file on the computer. The worker loads nothing and hands nothing out, so
    // the two kinds run the same; "use strict" keeps the stricter reading a module has.
    code = code.replace(/new Worker\(new URL\(`(\/_astro\/[\w.-]+\.js)`,``\+import\.meta\.url\),\{type:`module`\}\)/g, (_all, address) => {
      const worker = built(address).toString('utf8');
      if (/\bfrom\s*["'`]|\bimport\s*["'`(]|import\.meta|\bexport\s*[{*]|\bexport\s+(?:default|const|let|var|function|class|async)\b/.test(worker)) stop(`${address} loads another file or hands something out, so it cannot be written into the page as it is`);
      workers.push(`"use strict";\n${worker}`);
      return `new Worker(URL.createObjectURL(new Blob([__worker${workers.length}],{type:\`text/javascript\`})))`;
    });
    if (/new Worker\(/.test(code) && workers.length === 0) stop(`${src} starts a worker in a way this program does not know`);
    if (code.includes('import.meta')) stop(`${src} still asks where it was loaded from`);
    code = forScriptElement(workers.map((worker, i) => `const __worker${i + 1}=${JSON.stringify(worker)};\n`).join('') + code);
    if (code.includes('\r')) stop(`${src} holds a carriage return`);
    scripts.push(code);
    return `<script type="module">${code}</script>`;
  });
  if (scripts.length === 0) stop('the page has no script');

  // 4. Links to the rest of the site point at the site, since the file may be opened anywhere.
  html = html.replace(/\b(href|action)="\/(?!\/)/g, `$1="${SITE}/`);

  // 5. The rule the browser holds the file to: only the scripts and the styles written into this
  //    file may run, a worker may be started only from the file's own text, and no connection may be opened.
  const policy = [
    "default-src 'none'",
    `script-src ${scripts.map((code) => `'sha256-${sha256(code, 'base64')}'`).join(' ')}`,
    `style-src 'sha256-${sha256(css, 'base64')}'`,
    'font-src data:',
    'worker-src blob:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const policyTag = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
  one(html, policyTag, 'Content-Security-Policy tag');
  html = html.replace(policyTag, `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  if (html.indexOf('http-equiv="Content-Security-Policy"') > html.indexOf('<style>')) stop('the rule must come before the styles and the scripts');

  // 6. Nothing in the file may name another file.
  for (const [pattern, what] of [
    [/\ssrc=/, 'an element that loads a file (src=)'],
    [/\/_astro\//, 'an address under /_astro/'],
    [/\b(?:href|action)="\/(?!\/)/, 'a link that starts at the site root'],
    [/<link\b[^>]*rel="(?:stylesheet|icon|preload)"/, 'a link to a stylesheet, an icon or a font'],
    [/unsafe-inline|unsafe-eval/, "'unsafe-inline' or 'unsafe-eval'"],
  ]) {
    if (pattern.test(html)) stop(`the packed file still holds ${what}`);
  }
  return html;
}

const [, , key, ...rest] = process.argv;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tool = TOOLS[key];
  if (!tool) stop(`name a tool: ${Object.keys(TOOLS).join(', ')}`);
  const arg = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
  const on = record[key];
  const version = arg('--version') ?? on?.version;
  const made = arg('--made') ?? on?.made;
  if (!version || !made) stop('give --version and --made (YYYY-MM-DD)');
  const text = pack(tool, version, made);
  const bytes = Buffer.from(text, 'utf8');
  const print = sha256(bytes, 'hex');
  if (rest.includes('--write')) {
    const out = join(root, 'public', tool.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    record[key] = { name: tool.name, file: `/${tool.file}`, savedAs: tool.savedAs, version, made, bytes: bytes.length, sha256: print };
    writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
    console.log(`single-file: wrote public/${tool.file}, ${bytes.length} bytes, version ${version}, made ${made}.`);
    console.log(`single-file: SHA-256 ${print}`);
    console.log('single-file: now run `npm run build` again, so the page prints this fingerprint.');
  } else if (on?.sha256 === print) {
    console.log(`single-file: the saved copy on record (version ${on.version}) is what this build gives.`);
  } else {
    console.log(`single-file: this build gives a different file from the saved copy on record${on ? ` (version ${on.version})` : ''}.`);
    console.log('single-file: the copy on record stays as it is until it is remade with --write and a new version.');
  }
}
