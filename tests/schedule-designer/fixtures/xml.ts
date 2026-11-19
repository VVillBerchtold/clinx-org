// A small, strict XML reader for the tests. It throws on anything that is not well formed, so a
// workbook part that would make Excel ask to repair the file fails a test here first.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The text directly inside this element, entities read. */
  text: string;
}

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function plain(raw: string, where: string): string {
  if (raw.replace(ENTITY, '').includes('&')) throw new Error(`a stray & in ${where}: ${raw.slice(0, 60)}`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/.test(raw)) throw new Error(`a character XML does not allow in ${where}`);
  if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(raw)) throw new Error(`half of a character pair in ${where}`);
  return raw.replace(ENTITY, (_, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return NAMED[name] ?? '';
  });
}

/** Reads a whole XML document and gives back its one top element. Throws when it is not well formed. */
export function parseXml(source: string): XmlNode {
  let at = 0;
  if (source.startsWith('<?xml')) {
    const end = source.indexOf('?>');
    if (end < 0) throw new Error('the first line is not closed');
    at = end + 2;
  }
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/?)>/y;
  const attribute = /([A-Za-z_][\w.:-]*)="([^"<]*)"/g;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    const top = stack[stack.length - 1];
    if (!top) throw new Error('more closing tags than opening ones');
    const between = source.slice(at, open < 0 ? source.length : open);
    if (between.includes('>')) throw new Error(`a stray > near ${between.slice(0, 60)}`);
    top.text += plain(between, `the text of <${top.name}>`);
    if (open < 0) break;
    tag.lastIndex = open;
    const found = tag.exec(source);
    if (!found) throw new Error(`a tag that cannot be read at ${open}: ${source.slice(open, open + 80)}`);
    const [whole, closing, name = '', attributes = '', selfClosing] = found;
    at = open + whole.length;
    if (closing) {
      if (attributes || selfClosing) throw new Error(`a closing tag with more in it: ${whole}`);
      if (stack.length < 2 || top.name !== name) throw new Error(`</${name}> closes <${top.name}>`);
      stack.pop();
      continue;
    }
    const node: XmlNode = { name, attrs: {}, children: [], text: '' };
    for (const [, key = '', value = ''] of attributes.matchAll(attribute)) {
      if (key in node.attrs) throw new Error(`<${name}> has ${key} twice`);
      node.attrs[key] = plain(value, `${key} of <${name}>`);
    }
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1]?.name}> is never closed`);
  if (root.text.trim() !== '') throw new Error('text outside the top element');
  const [only, ...more] = root.children;
  if (!only || more.length > 0) throw new Error('a document needs exactly one top element');
  return only;
}

/** The first child element with this name. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((inner) => inner.name === name);
}

/** Every child element with this name. */
export function childrenOf(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((inner) => inner.name === name) ?? [];
}

/** Every element with this name anywhere inside. */
export function everywhere(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const inner of node.children) {
    if (inner.name === name) out.push(inner);
    everywhere(inner, name, out);
  }
  return out;
}

export interface SheetCell {
  ref: string;
  /** The style number. */
  style: number;
  /** The words in the cell, for a cell of text, or the words a formula last gave. */
  text?: string;
  /** The number in the cell, or the number a formula last gave. */
  number?: number;
  /** The formula, without an equals sign. */
  formula?: string;
}

/** The cells of a worksheet by their place, such as "B5". */
export function cellsOf(sheet: XmlNode): Map<string, SheetCell> {
  const cells = new Map<string, SheetCell>();
  for (const row of childrenOf(child(sheet, 'sheetData'), 'row')) {
    for (const c of childrenOf(row, 'c')) {
      const cell: SheetCell = { ref: c.attrs['r'] ?? '', style: Number(c.attrs['s'] ?? 0) };
      const words = everywhere(c, 't');
      if (c.attrs['t'] === 'inlineStr') cell.text = words.map((t) => t.text).join('');
      const formula = child(c, 'f');
      if (formula) cell.formula = formula.text;
      const value = child(c, 'v');
      // A formula that gives words keeps the words it last gave beside it, marked t="str".
      if (value && c.attrs['t'] === 'str') cell.text = value.text;
      else if (value) cell.number = Number(value.text);
      cells.set(cell.ref, cell);
    }
  }
  return cells;
}

/** Column letters to a number: A is 1, AA is 27. */
export function columnNumber(letters: string): number {
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n;
}

/** A number to column letters: 1 is A, 27 is AA. */
export function columnLetters(n: number): string {
  let out = '';
  for (let left = n; left > 0; left = Math.floor((left - 1) / 26)) out = String.fromCharCode(65 + ((left - 1) % 26)) + out;
  return out;
}

/** "B5:C7" as numbers. A single cell is a range of one. */
export function rangeOf(ref: string): { c1: number; r1: number; c2: number; r2: number } {
  const found = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!found) throw new Error(`not a range: ${ref}`);
  const [, a = '', b = '', c, d] = found;
  return { c1: columnNumber(a), r1: Number(b), c2: columnNumber(c ?? a), r2: Number(d ?? b) };
}
