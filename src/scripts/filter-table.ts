/**
 * Progressive enhancement: filters the rows of a list of filers by name or ID and by kind.
 * Without this script the list is whole and the filter is not drawn.
 *
 * Markup: an element with `data-filter` (hidden until this script runs) holding an input with
 * `data-filter-text` and, where the list has kinds, a select with `data-filter-kind`; the rows to filter are the rows of the
 * table `data-filter-table`, each with `data-search` (lower case text to match) and `data-kind`.
 */

export {};

function enhance(box: HTMLElement): void {
  const table = document.querySelector<HTMLTableElement>('table[data-filter-table]');
  const text = box.querySelector<HTMLInputElement>('[data-filter-text]');
  const kind = box.querySelector<HTMLSelectElement>('[data-filter-kind]');
  const count = document.querySelector<HTMLElement>('[data-filter-count]');
  const none = document.querySelector<HTMLElement>('[data-filter-none]');
  if (!table || !text || table.tBodies.length === 0) return;

  // A table may hold its rows in groups, one body for each, with a heading row (`data-filter-group`)
  // that is not itself filtered. A group with no row left to show is hidden whole.
  const bodies = Array.from(table.tBodies);
  const rows = bodies.flatMap((body) => Array.from(body.rows).filter((row) => !row.hasAttribute('data-filter-group')));
  const total = rows.length;

  const apply = (): void => {
    const words = text.value.toLowerCase().split(/\s+/).filter(Boolean);
    const wanted = kind?.value ?? '';
    let shown = 0;
    for (const row of rows) {
      const haystack = row.dataset['search'] ?? '';
      const match = words.every((w) => haystack.includes(w)) && (wanted === '' || row.dataset['kind'] === wanted);
      row.hidden = !match;
      if (match) shown += 1;
    }
    if (bodies.length > 1) for (const body of bodies) body.hidden = !Array.from(body.rows).some((row) => !row.hasAttribute('data-filter-group') && !row.hidden);
    if (count) count.textContent = shown === total ? `Showing all ${total}.` : `Showing ${shown} of ${total}.`;
    if (none) none.hidden = shown > 0;
  };

  text.addEventListener('input', apply);
  kind?.addEventListener('change', apply);
  box.hidden = false;
  apply();
}

document.querySelectorAll<HTMLElement>('[data-filter]').forEach(enhance);
