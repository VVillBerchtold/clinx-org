/**
 * Progressive enhancement for the shortage area tracker: filters the rows of a list by the words a
 * reader types (a name, a county, a state, an ID) and, where the list has one, by kind of area.
 * Without this script every list is whole and the filter is not drawn.
 *
 * Markup: an element with `data-hc-filter` and `data-for="<id of the table>"` (hidden until this script
 * runs) holding an input `data-hc-text`, optionally a select `data-hc-kind`, and a line `data-hc-count`.
 * The rows of the table's first body are filtered by their text; a row may carry `data-kind`.
 */

export {};

function enhance(box: HTMLElement): void {
  const table = document.getElementById(box.dataset['for'] ?? '');
  const text = box.querySelector<HTMLInputElement>('[data-hc-text]');
  const kind = box.querySelector<HTMLSelectElement>('[data-hc-kind]');
  const count = box.querySelector<HTMLElement>('[data-hc-count]');
  const body = table instanceof HTMLTableElement ? table.tBodies[0] : undefined;
  if (!body || !text) return;

  const rows = Array.from(body.rows).map((row) => ({ row, haystack: (row.textContent ?? '').toLowerCase().replace(/\s+/g, ' ') }));
  const total = rows.length;

  const apply = (): void => {
    const words = text.value.toLowerCase().split(/\s+/).filter(Boolean);
    const wanted = kind?.value ?? '';
    let shown = 0;
    for (const { row, haystack } of rows) {
      const match = words.every((w) => haystack.includes(w)) && (wanted === '' || row.dataset['kind'] === wanted);
      row.hidden = !match;
      if (match) shown += 1;
    }
    if (count) count.textContent = shown === total ? `Showing all ${total}.` : shown === 0 ? 'No row matches. Clear the filter to see all rows.' : `Showing ${shown} of ${total}.`;
  };

  text.addEventListener('input', apply);
  kind?.addEventListener('change', apply);
  box.hidden = false;
  apply();
}

document.querySelectorAll<HTMLElement>('[data-hc-filter]').forEach(enhance);
