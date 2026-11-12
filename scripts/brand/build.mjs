// Draws the ClinX wordmark and mark from one set of outlines and writes the drawings under public/.
// Run: node scripts/brand/build.mjs        (no dependencies; README.md beside this file has the rest)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LETTERS, KERN } from './outlines.mjs';

export const COLOURS = { purple: '#3437e6', lilac: '#8f96ff', ink: '#0b0d24', mist: '#f1f2fb', pageLight: '#f4f5fc', pageDark: '#080a1a' };
const TRACKING = -20; // the header's letter-spacing, -0.02em
const round = (n) => Math.round(n * 100) / 100;
const [STEM, DOT] = LETTERS.i.d.split(/(?=M)/);

// Where each letter sits, and the box the whole word needs. y runs from 760 above the baseline to 14 below it.
export function wordmarkShapes() {
  const chars = [...'ClinX'];
  let x = 0;
  const ink = [];
  const dot = { x: 0, d: DOT };
  chars.forEach((ch, i) => {
    if (ch === 'i') { ink.push({ x: round(x), d: STEM }); dot.x = round(x); }
    else ink.push({ x: round(x), d: LETTERS[ch].d });
    x += LETTERS[ch].adv + TRACKING + (KERN[ch + (chars[i + 1] ?? '')] ?? 0);
  });
  const left = LETTERS.C.left;
  const right = x - TRACKING - (LETTERS.X.adv - LETTERS.X.right);
  return { ink, dot, viewBox: `${round(left)} -760 ${round(right - left)} 774` };
}

export function wordmark(inkColour, dotColour) {
  const { ink, dot, viewBox } = wordmarkShapes();
  const place = (s) => `transform="translate(${s.x} 0) scale(1 -1)" d="${s.d}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="ClinX">`
    + `<g fill="${inkColour}">${ink.map((s) => `<path ${place(s)}/>`).join('')}</g>`
    + `<path fill="${dotColour}" ${place(dot)}/></svg>\n`;
}

// The mark is the dot of the i by itself: 191 wide and 152 high in the typeface, drawn `width` wide in a 512 square.
const DOT_CENTRE = [139.83, 672.9];
function dotPath(width, attrs = '') {
  const k = width / 191;
  return `<path${attrs} transform="translate(${round(256 - DOT_CENTRE[0] * k)} ${round(256 + DOT_CENTRE[1] * k)}) scale(${round(k)} ${round(-k)})" d="${DOT}"/>`;
}
const square = (body, label = 'ClinX') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${label}">${body}</svg>\n`;
export const mark = (colour) => square(dotPath(452, ` fill="${colour}"`));
// For places that cut a picture to a circle or cannot show through: the dot on a filled square.
export const markOn = (background, colour, width = 290) => square(`<rect width="512" height="512" fill="${background}"/>` + dotPath(width, ` fill="${colour}"`));
// The tab icon follows the reader's light or dark setting by itself.
export const favicon = () => square(`<style>path{fill:${COLOURS.purple}}@media (prefers-color-scheme:dark){path{fill:${COLOURS.lilac}}}</style>` + dotPath(452));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = (path, text) => { writeFileSync(new URL(`../../public/${path}`, import.meta.url), text); console.log(`wrote public/${path}`); };
  out('brand/clinx-wordmark-on-light.svg', wordmark(COLOURS.ink, COLOURS.purple));
  out('brand/clinx-wordmark-on-dark.svg', wordmark(COLOURS.mist, COLOURS.lilac));
  out('brand/clinx-mark.svg', mark(COLOURS.purple));
  out('brand/clinx-mark-on-dark.svg', mark(COLOURS.lilac));
  out('brand/clinx-mark-square.svg', markOn(COLOURS.pageLight, COLOURS.purple));
  out('favicon.svg', favicon());
}
