// The small pieces every reader of a workbook's parts needs: how to find a tag, a setting, a cell.
//
// In plain words: a workbook's parts are text files written in XML. They are read here with
// patterns, not with a full reader of the format. In a pattern, `~` stands for the prefix some
// programs put before every tag, as in <x:c>.

const P = '(?:\\w+:)?';
export const rx = (source, flags = 'g') => new RegExp(source.replaceAll('~', P), flags);

export const CELLS = rx('<~row\\b([^>]*)>|<~c\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/~c>)');
export const VALUE = rx('(<~v\\b[^>]*>)([\\s\\S]*?)(<\\/~v>)', '');
export const FORMULA = rx('(<~f\\b[^>]*>)([\\s\\S]*?)(<\\/~f>)', '');
export const HAS_FORMULA = rx('<~f\\b', '');
export const TEXT_RUNS = rx('(<~t\\b[^>]*>)([\\s\\S]*?)(<\\/~t>)');
export const STRING_ITEMS = rx('<~si\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/~si>)');
export const RELATIONSHIPS = rx('<~Relationship\\b([^>]*?)\\/?>');

export const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );
export const encodeXml = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
export const encodeAttr = (s) => encodeXml(s).replace(/"/g, '&quot;');
const attrPatterns = new Map();
const attrPattern = (name) => attrPatterns.get(name) ?? attrPatterns.set(name, new RegExp(`((?:^|\\s)${name}=")([^"]*)(")`)).get(name);
export const attr = (attrs, name) => attrPattern(name).exec(attrs)?.[2];
export const setAttr = (attrs, name, value) => (attr(attrs, name) === undefined ? `${attrs} ${name}="${value}"` : attrs.replace(attrPattern(name), (_, a, old, c) => a + value + c));
export const dropAttr = (attrs, name) => attrs.replace(new RegExp(`\\s${name}="[^"]*"`), '');
/** The same tag with its attributes swapped for new ones. */
export const swap = (tag, attrs, next) => (attrs === '' ? tag.replace(/^<[\w:.-]+/, (start) => start + next) : tag.replace(attrs, () => next));

export const letters = (number) => {
  let out = '';
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
export const columnNumber = (name) => [...name].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);

/** The text of every entry in a workbook's shared list of strings. */
export function readStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(STRING_ITEMS)) out.push(stringText(m[1] ?? ''));
  return out;
}
/** The text of one entry of that list; a reading guide (rPh) is not part of it. */
export const stringText = (inner) => [...inner.replace(rx('<~rPh\\b[\\s\\S]*?<\\/~rPh>'), '').matchAll(TEXT_RUNS)].map((t) => decodeXml(t[2])).join('');

/** True when a number format shows its number as a date or a time. */
function showsDate(id, code) {
  if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
  if (!code) return false;
  return /[ymdhs]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/general/gi, ''));
}

/** For each cell style in the workbook, whether it shows a date. */
export function dateStyles(xml) {
  const custom = new Map();
  for (const m of xml.matchAll(rx('<~numFmt\\b([^>]*?)\\/?>'))) custom.set(attr(m[1], 'numFmtId'), decodeXml(attr(m[1], 'formatCode') ?? ''));
  const block = rx('<~cellXfs\\b[^>]*>([\\s\\S]*?)<\\/~cellXfs>', '').exec(xml)?.[1] ?? '';
  return [...block.matchAll(rx('<~xf\\b([^>]*?)\\/?>'))].map((m) => {
    const id = attr(m[1], 'numFmtId') ?? '0';
    return showsDate(Number(id), custom.get(id));
  });
}
