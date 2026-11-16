/**
 * Progressive enhancement: finds a health center by name or city in the list of all of them.
 * Without this script the search box is not drawn, and the list can be opened and read whole.
 *
 * Markup: an element with `data-find` (hidden until this script runs) holding an input with
 * `data-find-text`; a `details` element with `data-find-list` whose items each carry `data-search`
 * (lower case text to match); `data-find-count` for the count and `data-find-none` for no match.
 */

export {};

function enhance(box: HTMLElement): void {
  const text = box.querySelector<HTMLInputElement>('[data-find-text]');
  const list = document.querySelector<HTMLDetailsElement>('details[data-find-list]');
  const count = document.querySelector<HTMLElement>('[data-find-count]');
  const none = document.querySelector<HTMLElement>('[data-find-none]');
  if (!text || !list) return;
  const items = Array.from(list.querySelectorAll<HTMLElement>('[data-search]'));
  const total = items.length.toLocaleString('en-US');
  // The list opens while the reader is searching, and closes again if it was this script that opened it.
  let openedHere = false;

  const apply = (): void => {
    const words = text.value.toLowerCase().split(/\s+/).filter(Boolean);
    const searching = words.length > 0;
    let shown = 0;
    for (const item of items) {
      const haystack = item.dataset['search'] ?? '';
      const match = words.every((w) => haystack.includes(w));
      item.hidden = !match;
      if (match) shown += 1;
    }
    if (searching && !list.open) {
      list.open = true;
      openedHere = true;
    } else if (!searching && openedHere) {
      list.open = false;
      openedHere = false;
    }
    list.hidden = searching && shown === 0;
    if (count) count.textContent = searching ? `Showing ${shown.toLocaleString('en-US')} of ${total}.` : '';
    if (none) none.hidden = !searching || shown > 0;
  };

  text.addEventListener('input', apply);
  box.hidden = false;
  apply();
}

document.querySelectorAll<HTMLElement>('[data-find]').forEach(enhance);
