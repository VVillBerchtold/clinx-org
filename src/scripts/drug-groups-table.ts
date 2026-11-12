/**
 * Progressive enhancement for a state's page of all drug rows. Without this script the page is a plain table
 * with every drug, most filers first. With it, the toolbar (hidden in the HTML) is turned on: search, a filter
 * by number of filers, a filter by filer, an order, a live count and a sum of the amounts shown.
 *
 * A drug is one <tbody class="dg">: a first row with the name, code and added figures, and for a drug with
 * more than one row a second row that holds the rows as filed in a <details>. Money is added in whole cents
 * (data-a). A drug with no claims figure carries one fixed sort value in data-c; there is no count to read.
 */
import { addCents, formatAtScale, matchRanges, queryTokens, rowMatches } from '../lib/drugs';

interface Field {
  el: HTMLElement;
  text: string;
  marked: boolean;
}

interface Group {
  el: HTMLTableSectionElement;
  index: number;
  cents: number;
  claims: number;
  filers: number;
  kind: string;
  who: Set<string>;
  code: string;
  name: string;
  /** Everything a search reads: the name shown, the listed ingredient and labeler, and every name as filed. */
  names: string;
  ndc: string;
  head: Field[];
  filed: Field[];
  details: HTMLDetailsElement | null;
  openedByMatch: boolean;
}

const root = document.querySelector<HTMLElement>('[data-drug-groups]');

if (root) {
  const table = root.querySelector<HTMLTableElement>('[data-drug-table]');
  const query = root.querySelector<HTMLInputElement>('[data-drug-q]');
  const orderSelect = root.querySelector<HTMLSelectElement>('[data-drug-order]');
  const filerSelect = root.querySelector<HTMLSelectElement>('[data-drug-filer]');
  const countEl = root.querySelector<HTMLElement>('[data-drug-count]');
  const sumEl = root.querySelector<HTMLElement>('[data-drug-sum]');
  const empty = root.querySelector<HTMLElement>('.drug-empty');
  const clearButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-drug-clear]'));
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="drug-show"]'));

  if (table && query && orderSelect && filerSelect && countEl && sumEl && empty) {
    const makeField = (el: HTMLElement): Field => ({ el, text: el.textContent ?? '', marked: false });

    const groups: Group[] = Array.from(table.querySelectorAll<HTMLTableSectionElement>('tbody.dg')).map((el, index) => {
      const nameEl = el.querySelector<HTMLElement>('.dg-head .drug-name:not(.none)');
      const ndcEl = el.querySelector<HTMLElement>('.dg-head .ndc');
      const nameField = nameEl ? makeField(nameEl) : null;
      const ndcField = ndcEl ? makeField(ndcEl) : null;
      const filed = Array.from(el.querySelectorAll<HTMLElement>('[data-as-filed]')).map(makeField);
      // More words a search reads at the head of a drug: the listed ingredient and labeler, and the name as filed.
      const found = Array.from(el.querySelectorAll<HTMLElement>('.dg-head [data-drug-find]')).map(makeField);
      // Each name as its filer typed it, where the page draws it another way: a search reads both.
      const typed = Array.from(el.querySelectorAll<HTMLElement>('[data-typed]')).map((e) => e.dataset['typed'] ?? '');
      const head = [nameField, ...found, ndcField].filter((f): f is Field => f !== null);
      return {
        el,
        index,
        cents: Number(el.dataset['a']),
        claims: Number(el.dataset['c']),
        filers: Number(el.dataset['n']),
        kind: el.dataset['k'] ?? '',
        who: new Set((el.dataset['f'] ?? '').split(' ')),
        code: el.dataset['code'] ?? '',
        name: nameField?.text ?? '',
        names: [nameField?.text ?? '', ...found.map((f) => f.text), ...filed.map((f) => f.text), ...typed].join('|'),
        ndc: ndcField?.text ?? '',
        head,
        filed,
        details: el.querySelector<HTMLDetailsElement>('details'),
        openedByMatch: false,
      };
    });
    const total = groups.length;
    const fmt = (n: number): string => n.toLocaleString('en-US');

    const byIndex = (a: Group, b: Group): number => a.index - b.index;
    const byName = (a: Group, b: Group): number => Number(a.name === '') - Number(b.name === '') || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    const ORDERS: Record<string, (a: Group, b: Group) => number> = {
      filers: byIndex,
      'amount-desc': (a, b) => b.cents - a.cents || byIndex(a, b),
      'amount-asc': (a, b) => a.cents - b.cents || byIndex(a, b),
      'claims-desc': (a, b) => b.claims - a.claims || byIndex(a, b),
      name: (a, b) => byName(a, b) || byIndex(a, b),
      code: (a, b) => Number(a.code === '') - Number(b.code === '') || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || byIndex(a, b),
    };

    const paint = (field: Field, ranges: [number, number][]): void => {
      if (ranges.length === 0) {
        if (field.marked) {
          field.el.textContent = field.text;
          field.marked = false;
        }
        return;
      }
      const nodes: (string | HTMLElement)[] = [];
      let at = 0;
      for (const [start, end] of ranges) {
        if (start > at) nodes.push(field.text.slice(at, start));
        const mark = document.createElement('mark');
        mark.textContent = field.text.slice(start, end);
        nodes.push(mark);
        at = end;
      }
      if (at < field.text.length) nodes.push(field.text.slice(at));
      field.el.replaceChildren(...nodes);
      field.marked = true;
    };

    let appliedOrder = 'filers';
    let lastCount = countEl.textContent ?? '';
    let timer = 0;

    const chosenShow = (): string => radios.find((r) => r.checked)?.value ?? 'all';

    const apply = (): void => {
      const tokens = queryTokens(query.value);
      const show = chosenShow();
      const filer = filerSelect.value;
      const filtered = tokens.length > 0 || show !== 'all' || filer !== '';

      let shown = 0;
      const cents: number[] = [];
      for (const group of groups) {
        const keep = (show === 'all' || group.kind === show) && (filer === '' || group.who.has(filer)) && rowMatches(tokens, group.names, group.ndc);
        group.el.hidden = !keep;
        if (!keep) continue;
        shown++;
        cents.push(group.cents);
        let inHead = false;
        for (const field of group.head) {
          paint(field, tokens.length > 0 ? matchRanges(field.text, tokens) : []);
          inHead ||= field.marked;
        }
        let inFiled = false;
        for (const field of group.filed) {
          paint(field, tokens.length > 0 ? matchRanges(field.text, tokens) : []);
          inFiled ||= field.marked;
        }
        // A match that is only in a filer's own wording would not be seen: the rows are opened for it.
        if (group.details) {
          if (inFiled && !inHead) {
            if (!group.details.open) {
              group.details.open = true;
              group.openedByMatch = true;
            }
          } else if (group.openedByMatch) {
            group.details.open = false;
            group.openedByMatch = false;
          }
        }
      }

      const wanted = orderSelect.value in ORDERS ? orderSelect.value : 'filers';
      if (wanted !== appliedOrder) {
        const sorted = [...groups].sort(ORDERS[wanted]!).map((g) => g.el);
        for (const el of sorted) table.insertBefore(el, empty);
        appliedOrder = wanted;
      }

      const count = `Showing ${fmt(shown)} of ${fmt(total)} drugs`;
      if (count !== lastCount) {
        countEl.textContent = count;
        lastCount = count;
        countEl.classList.remove('fade');
        void countEl.offsetWidth;
        countEl.classList.add('fade');
      }
      sumEl.textContent = filtered ? `Amounts shown add up to ${formatAtScale(addCents(cents), 2)} (added by this page, all filers)` : '';
      empty.hidden = shown > 0;

      const isSet = query.value !== '' || show !== 'all' || filer !== '' || wanted !== 'filers';
      for (const button of clearButtons) {
        button.disabled = !isSet && button.closest('.drug-empty') === null;
        if (!button.closest('.drug-empty')) button.classList.toggle('is-off', !isSet);
      }
    };

    const clear = (): void => {
      query.value = '';
      const all = radios.find((r) => r.value === 'all');
      if (all) all.checked = true;
      filerSelect.value = '';
      orderSelect.value = 'filers';
      apply();
      query.focus();
    };

    query.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 80);
    });
    query.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && query.value !== '') {
        event.stopPropagation();
        query.value = '';
        apply();
      }
    });
    for (const radio of radios) radio.addEventListener('change', apply);
    orderSelect.addEventListener('change', apply);
    filerSelect.addEventListener('change', apply);
    for (const button of clearButtons) button.addEventListener('click', clear);

    // "/" jumps to the search field, unless the reader is typing somewhere.
    document.addEventListener('keydown', (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      query.focus();
      query.select();
    });

    // A browser may bring back what was typed when the reader returns to the page.
    window.addEventListener('pageshow', apply);

    for (const el of root.ownerDocument.querySelectorAll<HTMLElement>('[data-drug-js]')) el.hidden = false;
    apply();
  }
}
