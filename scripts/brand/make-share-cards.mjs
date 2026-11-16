// Draws every share card: the picture a link to a page of clinx.org shows when it is shared.
//
// In plain words: it opens scripts/brand/share-cards.html once for each card listed in
// scripts/brand/share-cards.json, fills in that card's words, and saves a 1200 by 630 picture to
// public/brand/share/<id>.png. The pictures are kept in the repository, so a visitor and the site's
// build never need this script. Run it only when a card's words or the look change.
//
// What it needs, none of which is part of the site's own packages:
//   1. Node 22 or newer, and `npm ci` run once in this repository (the cards load the two typefaces from node_modules).
//   2. A folder where the npm package "playwright-core" is installed. Give it as the first argument.
//   3. A Chromium "headless shell" browser from Playwright, which Playwright keeps under
//      ~/Library/Caches/ms-playwright on a Mac. To use another browser, set CHROMIUM to its program.
//   4. Optionally ImageMagick (`magick`): when it is there, each picture is reduced to 256 colours,
//      which makes the file much smaller and looks the same on these flat drawings.
//
// Usage:
//   node scripts/brand/make-share-cards.mjs <folder with playwright-core> [card id ...]
//
// It makes no network request. Look at every picture it writes before you commit it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(here, '../../public/brand/share');
const list = JSON.parse(readFileSync(join(here, 'share-cards.json'), 'utf8'));
const [toolsFolder, ...only] = process.argv.slice(2);
if (!toolsFolder) {
  console.error('Give the folder where playwright-core is installed. See the top of this file.');
  process.exit(1);
}
const { chromium } = createRequire(join(resolve(toolsFolder), 'package.json'))('playwright-core');

function browserProgram() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
  if (!shell) throw new Error('No Chromium headless shell found in ' + cache + '. Set CHROMIUM to a browser program.');
  const inner = readdirSync(join(cache, shell)).find((d) => d.startsWith('chrome'));
  return join(cache, shell, inner, 'headless_shell');
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserProgram(), args: ['--allow-file-access-from-files'] });
try {
  for (const card of list.cards) {
    if (only.length > 0 && !only.includes(card.id)) continue;
    // A fresh page for each card, so the card handed in is the one the page draws.
    const page = await browser.newPage({ viewport: { width: list.width, height: list.height }, deviceScaleFactor: 1 });
    await page.addInitScript((c) => { window.CARD = c; }, { ...card, where: card.id === 'home' ? 'clinx.org' : `clinx.org${card.paths[0]}` });
    await page.goto(pathToFileURL(join(here, 'share-cards.html')).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const file = join(out, `${card.id}.png`);
    await page.screenshot({ path: file, type: 'png' });
    await page.close();
    try {
      execFileSync('magick', [file, '-colors', '256', '-define', 'png:compression-level=9', '-strip', `PNG8:${file}`]);
    } catch {
      // No ImageMagick: the full-colour picture stays as it is.
    }
    console.log(`${card.id}.png ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
