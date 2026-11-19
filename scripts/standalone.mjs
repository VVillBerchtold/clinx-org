// Writes the standalone copy of Schedule Designer after the build: one HTML file a person can
// keep on their computer and open in their browser, with a checksum file beside it.
//   dist/tools/schedule-designer/clinx-schedule-designer.html
//   dist/tools/schedule-designer/clinx-schedule-designer.html.sha256
//
// In plain words: the copy is the tool's own page with everything it needs written into the file.
// Its styles are one <style> block, its script is one <script> block, and its two fonts are
// written in as data. It has no site menu and no footer, loads nothing and links nowhere. A policy
// in the file itself lets exactly those two blocks run, by their fingerprints, and refuses every
// connection.
//
// The markup and the styles are taken from the page the build just wrote, so the copy can never
// drift from the page. The script is bundled again from its source with the bundler Astro brings
// (Vite). Nothing is fetched. If the built page stops looking the way this script expects, it
// stops with a sentence that says what it could not find.
// Usage: node scripts/standalone.mjs [dist-folder]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));
const FOLDER = join(dist, 'tools', 'schedule-designer');
const NAME = 'clinx-schedule-designer.html';
const WHERE = 'clinx.org/tools/schedule-designer/';

const stop = (message) => {
  console.error(`standalone: ${message}`);
  process.exit(1);
};
/** The one piece of `text` that `pattern` finds. Stops when there is none, or more than one. */
function one(text, pattern, what) {
  const found = [...text.matchAll(pattern)];
  if (found.length !== 1) stop(`expected one ${what} in the built page, found ${found.length}`);
  return found[0];
}

const pagePath = join(FOLDER, 'index.html');
if (!existsSync(pagePath)) stop(`${pagePath} does not exist. Run: npm run build`);
const page = readFileSync(pagePath, 'utf8');

// The tool's name and the version this copy prints are written once, in src/lib/site.ts.
const site = readFileSync(join(root, 'src', 'lib', 'site.ts'), 'utf8');
const toolName = one(site, /^export const SCHEDULE_DESIGNER = '([^']+)';$/gm, 'tool name (in src/lib/site.ts)')[1];
const version = one(site, /^export const SCHEDULE_DESIGNER_VERSION = '([0-9][0-9.]*)';$/gm, 'version (in src/lib/site.ts)')[1];
// The day of the release is written beside the version. Nothing in the copy comes from the clock,
// so two builds of the same source give the same file and the same checksum.
const released = one(site, /^export const SCHEDULE_DESIGNER_RELEASED = '([0-9]{1,2} [A-Z][a-z]+ [0-9]{4})';$/gm, 'release date (in src/lib/site.ts)')[1];

// ---------- The markup: the tool's own part of the page ----------

let body = one(page, /<main id="main"[^>]*>([\s\S]*)<\/main>/g, '<main>')[1];
// The page's script is a file on the site. Here it is written into the copy, below.
body = body.replace(one(body, /<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/g, 'script tag')[0], '');
// The trail back to the site's Tools page.
body = body.replace(one(body, /<nav class="kicker"[\s\S]*?<\/nav>/g, 'trail')[0], '');
// A copy read on a website cannot run there: the site lets only its own script files run.
body = body.replace(
  one(body, /<p id="sd-off" class="panel cc-off">[\s\S]*?<\/p>/g, 'scripts-off line')[0],
  '<p id="sd-off" class="panel cc-off">This copy works when you open it from your computer with scripts turned on. If you are reading it on a website, download the file and open it from your computer.</p>',
);
// The page offers the download. The copy says what it is.
body = body.replace(
  one(body, /<section id="sd-own"[\s\S]*?<\/section>/g, '"Keep your own copy" section')[0],
  `<section id="sd-own" class="cc-about sd-own" aria-labelledby="sd-own-h"><h2 id="sd-own-h">Keep your own copy</h2><div class="sd-own-card"><div class="sd-own-say"><p>This file is the whole tool. It works from your computer, loads nothing from anywhere and opens no connection. You can keep it wherever you keep your workbooks.</p><p>This is version ${version}, released ${released}. The copy does not update itself. For the current one, go to ${WHERE} in your browser. A checksum file is published beside the download there. It holds the SHA-256 of the copy, for checking that a file is the one published.</p></div></div></section>`,
);
// The card that opens the article about the tool leads to the site, so the copy leaves it out.
body = body.replace(one(body, /<a class="cc-read"[\s\S]*?<\/a>/g, 'article card')[0], '');
// Nothing in the copy may point at the site or anywhere else: only at places inside the file.
for (const m of body.matchAll(/\s(?:href|src|srcset|action|poster|data)="([^"]*)"/g)) {
  if (!m[1].startsWith('#')) stop(`the tool's markup points outside the file: ${m[1]}`);
}

// ---------- The styles: the page's stylesheets, with the two fonts written in ----------

const sheets = [...page.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)">/g)].map((m) => m[1]);
if (sheets.length === 0) stop('the built page names no stylesheet');
let fonts = 0;
const css = sheets
  .map((href) => readFileSync(join(dist, href), 'utf8'))
  .join('\n')
  .replace(/url\(\s*(['"]?)(\/_astro\/[^'")]+\.woff2)\1\s*\)/g, (_, __, href) => {
    fonts += 1;
    return `url(data:font/woff2;base64,${readFileSync(join(dist, href)).toString('base64')})`;
  });
if (fonts !== 2) stop(`expected the two fonts in the styles, found ${fonts}`);
for (const m of css.matchAll(/url\(\s*['"]?([^'")]{0,24})/g)) {
  if (!m[1].startsWith('data:')) stop(`the styles load a file: ${m[1]}`);
}
if (/@import/i.test(css)) stop('the styles contain @import');
if (/<\/style/i.test(css)) stop('the styles contain a closing style tag');

// ---------- The script: bundled from its source into one block ----------

const require = createRequire(join(root, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const bundled = await build({
  root,
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    write: false,
    minify: true,
    target: 'es2022',
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: { input: join(root, 'src', 'scripts', 'schedule-designer', 'main.ts'), output: { format: 'es' } },
  },
});
const chunks = (Array.isArray(bundled) ? bundled[0] : bundled).output;
if (chunks.length !== 1 || chunks[0].type !== 'chunk') stop(`expected the script as one piece, found ${chunks.length}`);
const js = chunks[0].code;
if (/(?:^|[;\n])\s*import\b|\bimport\(|\bexport\b\s*[{*]/.test(js)) stop('the bundled script still imports or exports');
// Inside a script block these two would end the block or start a comment. The bundle has neither; stop if that changes.
if (/<\/script/i.test(js) || js.includes('<!--')) stop('the bundled script contains text that would end its own block');

// ---------- The file ----------

const fingerprint = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const policy = `default-src 'none'; script-src ${fingerprint(js)}; style-src ${fingerprint(css)}; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
const wordmark = one(page, /<header class="site-header">[\s\S]*?(<svg class="wordmark"[\s\S]*?<\/svg>)/g, 'ClinX wordmark')[1];
const icon = `data:image/svg+xml;base64,${readFileSync(join(root, 'public', 'favicon.svg')).toString('base64')}`;
const themes = [...page.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]).join('');

const html = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
  `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">',
  themes,
  '<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">',
  `<title>${toolName}: standalone copy | ClinX</title>`,
  `<meta name="description" content="The standalone copy of ${toolName}, version ${version}, released ${released}. One file that works from your computer and opens no connection.">`,
  `<link rel="icon" href="${icon}" type="image/svg+xml">`,
  `<style>${css}</style>`,
  '</head><body id="top"><a class="skip-link" href="#main">Skip to the content</a>',
  '<header class="sd-sa-head"><div class="wrap">',
  `<span class="mark" role="img" aria-label="ClinX">${wordmark}</span>`,
  `<p class="sd-sa-name">${toolName}<span class="sd-sa-tag">Standalone copy</span></p>`,
  `<p class="sd-sa-meta">Version ${version}, released ${released}</p>`,
  `<p class="sd-sa-note">This copy does not update itself. For the current one, go to ${WHERE} in your browser.</p>`,
  '</div></header>',
  `<main id="main" tabindex="-1">${body}</main>`,
  `<script type="module">${js}</script>`,
  '</body></html>\n',
].join('');

const bytes = Buffer.from(html, 'utf8');
writeFileSync(join(FOLDER, NAME), bytes);
// The usual one-line form, so `shasum -a 256 -c` reads it.
writeFileSync(join(FOLDER, `${NAME}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${NAME}\n`);
console.log(`standalone: ${NAME} written, ${(bytes.length / 1024).toFixed(0)} KB (version ${version}, released ${released}), with its checksum file.`);
