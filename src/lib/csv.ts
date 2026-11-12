/** Reads CSV text (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes) into records keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const source = text.startsWith('﻿') ? text.slice(1) : text;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];
  return rows.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells, expected ${header.length}`);
    const record: Record<string, string> = {};
    header.forEach((name, column) => {
      record[name] = cells[column]!;
    });
    return record;
  });
}
