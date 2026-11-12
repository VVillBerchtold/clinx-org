/**
 * Progressive enhancement for a drug page. Without this script the page is a plain table with every row in the
 * order filed. With it, the toolbar (hidden in the HTML) is turned on: search, a filter, an order, a live count
 * and a sum of the amounts shown.
 *
 * Money is added in whole cents, as integers (data-a on each row). A row whose claim count is left out carries
 * data-k "f" (fewer than 6) or "n" (not shown) and one fixed sort value in data-c; there is no count to read.
 */
import { addCents, formatAtScale, matchRanges, queryTokens, rowMatches, type AmountScale } from '../lib/drugs';

interface Field {
  el: HTMLElement;
  text: string;
  marked: boolean;
}

interface Row {
  el: HTMLTableRowElement;
  index: number;
  cents: number;
  claims: number;
  kind: string;
  name: string;
  /** Everything the search reads as a name: the name as filed and, where shown, the FDA directory's name, ingredient and labeler. */
  find: string;
  ndc: string;
  fields: Field[];
  /** The "N more" details and the field inside it, when the row has one. */
  more: { el: HTMLDetailsElement; field: Field } | null;
  openedByMatch: boolean;
}

const root = document.querySelector<HTMLElement>('[data-drug-tool]');

if (root) {
  const body = root.querySelector<HTMLTableSectionElement>('#drug-rows');
  const query = root.querySelector<HTMLInputElement>('[data-drug-q]');
  const orderSelect = root.querySelector<HTMLSelectElement>('[data-drug-order]');
  const countEl = root.querySelector<HTMLElement>('[data-drug-count]');
  const sumEl = root.querySelector<HTMLElement>('[data-drug-sum]');
  const empty = root.querySelector<HTMLElement>('.drug-empty');
  const clearButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-drug-clear]'));
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="drug-show"]'));
  const scale: AmountScale = root.dataset['scale'] === '0' ? 0 : 2;

  if (body && query && orderSelect && countEl && sumEl && empty) {
    const makeField = (el: HTMLElement): Field => ({ el, text: el.textContent ?? '', marked: false });

    const rows: Row[] = Array.from(body.rows).map((el, index) => {
      const nameEl = el.querySelector<HTMLElement>('.drug-name');
      const ndcEls = Array.from(el.querySelectorAll<HTMLElement>('.ndc'));
      const detailsEl = el.querySelector<HTMLDetailsElement>('details');
      const fields: Field[] = [];
      const nameField = nameEl && !nameEl.classList.contains('none') ? makeField(nameEl) : null;
      if (nameField) fields.push(nameField);
      const found = Array.from(el.querySelectorAll<HTMLElement>('[data-drug-find]')).map(makeField);
      fields.push(...found);
      // The name as the filer typed it, where the page draws it another way: a search reads both.
      const typed = Array.from(el.querySelectorAll<HTMLElement>('[data-typed]')).map((e) => e.dataset['typed'] ?? '');
      const ndcFields = ndcEls.map(makeField);
      fields.push(...ndcFields);
      const restEl = detailsEl?.querySelector<HTMLElement>('.ndc') ?? null;
      const restField = restEl ? (ndcFields.find((f) => f.el === restEl) ?? null) : null;
      return {
        el,
        index,
        cents: Number(el.dataset['a']),
        claims: Number(el.dataset['c']),
        kind: el.dataset['k'] ?? '',
        name: nameField?.text ?? '',
        find: [nameField?.text ?? '', ...found.map((f) => f.text), ...typed].join('|'),
        ndc: ndcFields.map((f) => f.text).join(', '),
        fields,
        more: detailsEl && restField ? { el: detailsEl, field: restField } : null,
        openedByMatch: false,
      };
    });
    const total = rows.length;
    const fmt = (n: number): string => n.toLocaleString('en-US');

    const byIndex = (a: Row, b: Row): number => a.index - b.index;
    const ORDERS: Record<string, (a: Row, b: Row) => number> = {
      filed: byIndex,
      'amount-desc': (a, b) => b.cents - a.cents || byIndex(a, b),
      'amount-asc': (a, b) => a.cents - b.cents || byIndex(a, b),
      'claims-desc': (a, b) => b.claims - a.claims || byIndex(a, b),
      name: (a, b) => Number(a.name === '') - Number(b.name === '') || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || byIndex(a, b),
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

    let appliedOrder = 'filed';
    let lastCount = countEl.textContent ?? '';
    let timer = 0;

    const chosenShow = (): string => radios.find((r) => r.checked)?.value ?? 'all';

    const apply = (): void => {
      const tokens = queryTokens(query.value);
      const show = chosenShow();
      const filtered = tokens.length > 0 || show !== 'all';

      let shown = 0;
      const cents: number[] = [];
      for (const row of rows) {
        const keep = (show === 'all' || row.kind === show) && rowMatches(tokens, row.find, row.ndc);
        row.el.hidden = !keep;
        if (!keep) continue;
        shown++;
        cents.push(row.cents);
        for (const field of row.fields) paint(field, tokens.length > 0 ? matchRanges(field.text, tokens) : []);
        if (row.more) {
          if (row.more.field.marked) {
            row.more.el.open = true;
            row.openedByMatch = true;
          } else if (row.openedByMatch) {
            row.more.el.open = false;
            row.openedByMatch = false;
          }
        }
      }

      const wanted = orderSelect.value in ORDERS ? orderSelect.value : 'filed';
      if (wanted !== appliedOrder) {
        body.append(...[...rows].sort(ORDERS[wanted]!).map((r) => r.el));
        appliedOrder = wanted;
      }

      const count = `Showing ${fmt(shown)} of ${fmt(total)} rows`;
      if (count !== lastCount) {
        countEl.textContent = count;
        lastCount = count;
        countEl.classList.remove('fade');
        void countEl.offsetWidth;
        countEl.classList.add('fade');
      }
      sumEl.textContent = filtered ? `Amounts shown add up to ${formatAtScale(addCents(cents), scale)} (added by this page)` : '';
      empty.hidden = shown > 0;

      const isSet = query.value !== '' || show !== 'all' || wanted !== 'filed';
      for (const button of clearButtons) {
        button.disabled = !isSet && button.closest('.drug-empty') === null;
        if (!button.closest('.drug-empty')) button.classList.toggle('is-off', !isSet);
      }
    };

    const clear = (): void => {
      query.value = '';
      const all = radios.find((r) => r.value === 'all');
      if (all) all.checked = true;
      orderSelect.value = 'filed';
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
