/**
 * Progressive enhancement: makes tables with `data-sortable` sortable.
 * Without this script the tables are plain, ordered tables.
 * Column headers with `data-sort="text"` or `data-sort="number"` get a real button.
 * A cell may carry `data-value` (a plain integer or text) to sort by instead of its shown text.
 */

type Kind = 'text' | 'number';

function cellValue(cell: HTMLTableCellElement | undefined): string {
  if (!cell) return '';
  return cell.dataset['value'] ?? cell.textContent?.trim() ?? '';
}

function compare(a: string, b: string, kind: Kind): number {
  // Empty values go last in either direction (handled by the caller).
  if (kind === 'number') return Number(a) - Number(b);
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

function enhance(table: HTMLTableElement): void {
  const body = table.tBodies[0];
  const headerRow = table.tHead?.rows[0];
  if (!body || !headerRow) return;

  const original = Array.from(body.rows);
  const headers = Array.from(headerRow.cells);
  // Lets the styles show the headings as a row of sort buttons on a phone.
  table.dataset['sortReady'] = '';

  headers.forEach((th, column) => {
    const kind = th.dataset['sort'];
    if (kind !== 'text' && kind !== 'number') return;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = th.textContent?.trim() ?? '';
    th.textContent = '';
    th.append(button);
    th.setAttribute('aria-sort', 'none');

    button.addEventListener('click', () => {
      const next = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      for (const other of headers) if (other.hasAttribute('aria-sort')) other.setAttribute('aria-sort', 'none');
      th.setAttribute('aria-sort', next);

      const direction = next === 'ascending' ? 1 : -1;
      const rows = original
        .map((row, index) => ({ row, index, value: cellValue(row.cells[column]) }))
        .sort((x, y) => {
          if (x.value === '' && y.value !== '') return 1;
          if (y.value === '' && x.value !== '') return -1;
          return direction * compare(x.value, y.value, kind) || x.index - y.index;
        });
      body.append(...rows.map((r) => r.row));
    });
  });
}

document.querySelectorAll<HTMLTableElement>('table[data-sortable]').forEach(enhance);
