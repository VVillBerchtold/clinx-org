/**
 * Progressive enhancement: filters the dates ahead on the funding calendar by what the opportunity
 * is (names health centers, carries the Health Center Program's listing) and by kind of date.
 * Without this script the whole list is there and the filter is not drawn.
 *
 * Markup: a box with `data-fund-filter` (hidden until this script runs) holding a select with
 * `data-fund-scope` and a select with `data-fund-kind`. Rows are `[data-fund-row]` with
 * `data-names`, `data-program` ("true" or "false") and `data-kind`. A month's section is
 * `[data-fund-month]`; it is hidden when none of its rows is shown.
 */

export {};

function enhance(box: HTMLElement): void {
  const scope = box.querySelector<HTMLSelectElement>('[data-fund-scope]');
  const kind = box.querySelector<HTMLSelectElement>('[data-fund-kind]');
  const count = document.querySelector<HTMLElement>('[data-fund-count]');
  const none = document.querySelector<HTMLElement>('[data-fund-none]');
  if (!scope || !kind) return;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-fund-row]'));
  const months = Array.from(document.querySelectorAll<HTMLElement>('[data-fund-month]'));
  const ahead = rows.filter((row) => row.closest('[data-fund-ahead]') !== null);

  const apply = (): void => {
    const wantedScope = scope.value;
    const wantedKind = kind.value;
    for (const row of rows) {
      const inScope = wantedScope === '' || (wantedScope === 'names' && row.dataset['names'] === 'true') || (wantedScope === 'program' && row.dataset['program'] === 'true');
      row.hidden = !(inScope && (wantedKind === '' || row.dataset['kind'] === wantedKind));
    }
    for (const month of months) month.hidden = month.querySelectorAll('[data-fund-row]:not([hidden])').length === 0;
    const shown = ahead.filter((row) => !row.hidden).length;
    if (count) count.textContent = shown === ahead.length ? `Showing all ${ahead.length} dates ahead.` : `Showing ${shown} of ${ahead.length} dates ahead.`;
    if (none) none.hidden = shown > 0;
  };

  scope.addEventListener('change', apply);
  kind.addEventListener('change', apply);
  box.hidden = false;
  apply();
}

document.querySelectorAll<HTMLElement>('[data-fund-filter]').forEach(enhance);
