/** Makes text safe to place inside HTML or SVG. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A small converter for the dataset's own documents (METHODS.md, DATA_DICTIONARY.md).
 * It handles what they use: headings, paragraphs, bullet lists, tables, bold, code, links
 * (links are written as plain text; the documents link only to files in the dataset repository).
 * All text is escaped first. The document's own `#` title is dropped: each page has its own h1.
 */

export interface Section {
  id: string;
  title: string;
  /** Rendered HTML of the section body (without its heading). */
  html: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Inline markdown to HTML. */
export function renderInline(text: string): string {
  let out = escapeXml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

export function plainText(text: string): string {
  return text.replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode && trimmed[i - 1] !== '\\') {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

function renderTable(rows: string[], caption: string): string {
  const head = splitRow(rows[0]!);
  const body = rows.slice(2).map(splitRow);
  const th = head.map((h) => `<th scope="col">${renderInline(h)}</th>`).join('');
  const trs = body
    .map((cells) => {
      const [first = '', ...rest] = cells;
      return `<tr><th scope="row">${renderInline(first)}</th>${rest.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`;
    })
    .join('');
  // A wide table scrolls sideways inside its box: the box takes keyboard focus so the arrow keys can scroll it.
  return `<div class="table-wrap" tabindex="0" role="group" aria-label="${escapeXml(plainText(caption))}, a table"><table><caption><span>${renderInline(caption)}</span></caption><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/** Splits the document at its `##` headings. Text before the first `##` is returned as a section with an empty title. */
export function renderSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  let current: { title: string; html: string[] } = { title: '', html: [] };
  let heading = '';
  let lastParagraph = '';
  let i = 0;

  const flush = (): void => {
    if (current.title !== '' || current.html.length > 0) {
      sections.push({ id: slugify(current.title), title: current.title, html: current.html.join('\n') });
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
    } else if (/^# /.test(line)) {
      i++; // the document's own title
    } else if (/^## /.test(line)) {
      flush();
      heading = line.slice(3).trim();
      current = { title: heading, html: [] };
      lastParagraph = '';
      i++;
    } else if (/^### /.test(line)) {
      const text = line.slice(4).trim();
      current.html.push(`<h3 id="${slugify(text)}">${renderInline(text)}</h3>`);
      i++;
    } else if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableRule(lines[i + 1]!)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(lines[i++]!);
      const short = lastParagraph !== '' && plainText(lastParagraph).length <= 100;
      const caption = short ? `${plainText(heading)}: ${plainText(lastParagraph).replace(/[.:]$/, '')}` : plainText(heading);
      current.html.push(renderTable(rows, caption));
    } else if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i]!)) {
        let item = lines[i]!.replace(/^\s*[-*] /, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!)) item += ' ' + lines[i++]!.trim();
        items.push(`<li>${renderInline(item)}</li>`);
      }
      current.html.push(`<ul>${items.join('')}</ul>`);
      lastParagraph = '';
    } else {
      const paragraph: string[] = [lines[i++]!.trim()];
      while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{1,3} |\s*\||\s*[-*] )/.test(lines[i]!)) paragraph.push(lines[i++]!.trim());
      lastParagraph = paragraph.join(' ');
      current.html.push(`<p>${renderInline(lastParagraph)}</p>`);
    }
  }
  flush();
  return sections;
}
