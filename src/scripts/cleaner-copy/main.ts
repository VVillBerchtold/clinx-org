// The Cleaner Copy page: four steps in one frame. This script shows one step at a time, keeps the
// person's choices, and asks the worker beside it to read the file and write the copy.
// It stores nothing in the browser and makes no request.
import type { Check, CheckItem, Choices, ColumnInfo, DescribedSheet, LegendGroup, Report, SheetInfo } from './engine/index.js';
import type { FromWorker, LoadedFile, MadeCopy, ToWorker, WorkerReady } from './protocol';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
function icon(name: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#cc-i-${name}`);
  svg.append(use);
  return svg;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const num = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function seconds(ms: number): string {
  return ms < 950 ? 'under a second' : `${(ms / 1000).toFixed(1)} seconds`;
}

/** Above this the page does not try: the work needs many times the file's size in memory. */
const TOO_LARGE = 60 * 1024 * 1024;

// ---------- What the page remembers while it is open ----------

const state = {
  step: 1,
  /** The furthest step the person may open now. */
  reach: 1,
  agreed: false,
  file: null as LoadedFile | null,
  /** Sheet name to the letters of the columns left alone. */
  keep: new Map<string, Set<string>>(),
  /** Sheet name to the letters of the columns that get codes. A column is never in both lists. */
  code: new Map<string, Set<string>>(),
  /** Sheet name to the name it gets in the copy. */
  rename: new Map<string, string>(),
  swap: new Set<string>(),
  dropExtras: true,
  sheet: 0,
  made: null as MadeCopy | null,
  busy: false,
  failed: '',
};

// ---------- The worker ----------

type Question = ToWorker extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

let worker: Worker | null = null;
let lastId = 0;
const waiting = new Map<number, (answer: FromWorker) => void>();

// The worker's own file is fetched as the page starts. The page waits for it before it starts the
// count of requests, so the count holds only what was asked for after a file was chosen.
let tellReady: () => void = () => {};
const workerReady = new Promise<void>((resolve) => {
  tellReady = resolve;
});

function startWorker(): boolean {
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    tellReady();
    return false;
  }
  // If the worker never answers, the tool goes on and says what went wrong.
  setTimeout(tellReady, 5000);
  worker.onmessage = (event: MessageEvent<FromWorker | WorkerReady>) => {
    if ('ready' in event.data) {
      tellReady();
      return;
    }
    const answer = event.data;
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  };
  worker.onerror = () => {
    tellReady();
    for (const [id, tell] of waiting) tell({ id, ok: false, problem: 'The tool stopped while it was working. The file may be too large for this browser. Reload the page and try again.' });
    waiting.clear();
  };
  return true;
}

function ask(question: Question, transfer: Transferable[] = []): Promise<FromWorker> {
  return new Promise((resolve) => {
    const id = ++lastId;
    if (!worker) {
      resolve({ id, ok: false, problem: 'This browser could not start the tool. Try a current version of Chrome, Edge, Firefox or Safari.' });
      return;
    }
    waiting.set(id, resolve);
    worker.postMessage({ ...question, id }, transfer);
  });
}

// ---------- The count of requests ----------

let chosenAt = Infinity;
let requestsSince = 0;

function showWire(): void {
  const wire = byId('cc-wire');
  const say = byId('cc-wire-say');
  if (chosenAt === Infinity) {
    say.textContent = 'No connection can be opened from this page';
    wire.classList.remove('is-counting', 'is-warn');
    return;
  }
  say.textContent = `${plural(requestsSince, 'request')} since you chose a file`;
  wire.classList.add('is-counting');
  wire.classList.toggle('is-warn', requestsSince > 0);
}

function watchRequests(): void {
  if (typeof PerformanceObserver !== 'function') return;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.startTime >= chosenAt) requestsSince++;
      showWire();
    }).observe({ type: 'resource', buffered: true });
  } catch {
    // A browser without this record still runs the tool; the line keeps its first wording.
  }
}

// ---------- Moving between steps ----------

const STEP_NAMES = ['Before you start', 'Choose a file', 'Choose columns', 'Save the copy'];

function announce(text: string): void {
  byId('cc-live').textContent = text;
}

function allColumns(report: Report): { sheet: SheetInfo; column: ColumnInfo }[] {
  return report.sheets.flatMap((sheet) => sheet.columns.map((column) => ({ sheet, column })));
}

function keptCount(): number {
  let kept = 0;
  for (const letters of state.keep.values()) kept += letters.size;
  return kept;
}

function codedCount(): number {
  let coded = 0;
  for (const letters of state.code.values()) coded += letters.size;
  return coded;
}

/** What happens to a column: randomized values, a code for each value, or left as it is. */
type Mode = 'random' | 'code' | 'keep';

const MODES: { mode: Mode; say: string }[] = [
  { mode: 'random', say: 'Randomized' },
  { mode: 'code', say: 'Coded' },
  { mode: 'keep', say: 'Left as it is' },
];

function modeOf(sheet: string, letter: string): Mode {
  if (state.keep.get(sheet)?.has(letter)) return 'keep';
  if (state.code.get(sheet)?.has(letter)) return 'code';
  return 'random';
}

function setMode(sheet: string, letter: string, mode: Mode): void {
  for (const [list, wanted] of [
    [state.keep, 'keep'],
    [state.code, 'code'],
  ] as const) {
    const letters = list.get(sheet) ?? new Set<string>();
    if (mode === wanted) letters.add(letter);
    else letters.delete(letter);
    if (letters.size) list.set(sheet, letters);
    else list.delete(sheet);
  }
}

/** How many columns get which treatment, as one or two short sentences. */
function sayColumns(total: number, coded: number, kept: number): string {
  if (coded === 0 && kept === 0) return `All ${plural(total, 'column')} will get randomized values.`;
  const parts = [`${num(total - coded - kept)} of ${plural(total, 'column')} will get randomized values.`];
  if (coded) parts.push(`${coded === 1 ? '1 gets' : `${num(coded)} get`} codes.`);
  if (kept) parts.push(`${kept === 1 ? '1 is' : `${num(kept)} are`} left as ${kept === 1 ? 'it is' : 'they are'}.`);
  return parts.join(' ');
}

function nameInCopy(sheet: SheetInfo): string {
  return state.rename.get(sheet.name) ?? sheet.name;
}

function nameProblem(sheet: SheetInfo): string | null {
  if (!state.file || !state.rename.has(sheet.name)) return null;
  const name = nameInCopy(sheet).trim();
  if (name === sheet.name) return null;
  if (!name) return 'A sheet needs a name.';
  if (name.length > 31) return 'A sheet name can be at most 31 characters.';
  if (/[[\]:*?/\\]/.test(name)) return 'A sheet name cannot contain [ ] : * ? / or \\.';
  if (name.startsWith("'") || name.endsWith("'")) return 'A sheet name cannot start or end with an apostrophe.';
  const others = state.file.report.sheets.filter((other) => other !== sheet).map((other) => nameInCopy(other).trim().toLowerCase());
  if (others.includes(name.toLowerCase())) return 'Another sheet already has this name.';
  return null;
}

function firstNameProblem(): string | null {
  for (const sheet of state.file?.report.sheets ?? []) {
    const problem = nameProblem(sheet);
    if (problem) return `${sheet.name}: ${problem}`;
  }
  return null;
}

function renderFrame(): void {
  // The numbered steps along the top.
  for (const button of document.querySelectorAll<HTMLButtonElement>('#cc-steps [data-go]')) {
    const n = Number(button.dataset['go']);
    const current = n === state.step;
    button.classList.toggle('is-current', current);
    button.classList.toggle('is-done', !current && n <= state.reach && n < Math.max(state.step, state.reach));
    button.disabled = state.busy || current || n > state.reach;
    if (current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  byId('cc-where').textContent = `Step ${state.step} of 4: ${STEP_NAMES[state.step - 1] ?? ''}`;
  for (let n = 1; n <= 4; n++) byId(`cc-step-${n}`).hidden = n !== state.step;

  // The bar along the bottom.
  const back = byId<HTMLButtonElement>('cc-back');
  const next = byId<HTMLButtonElement>('cc-next');
  const nextSay = byId('cc-next-say');
  const tally = byId('cc-tally');
  back.hidden = state.step === 1;
  back.disabled = state.busy;
  next.hidden = false;
  next.classList.add('accent');
  next.classList.remove('ghost');
  tally.classList.remove('is-problem');
  if (state.step === 1) {
    nextSay.textContent = 'Continue';
    next.disabled = !state.agreed;
    tally.textContent = state.agreed ? '' : 'Tick the box to continue.';
  } else if (state.step === 2) {
    nextSay.textContent = 'Continue';
    next.disabled = !state.file || state.busy;
    tally.textContent = state.busy ? 'Reading the file.' : state.file ? 'If this is the right file, continue.' : '';
  } else if (state.step === 3) {
    const problem = firstNameProblem();
    nextSay.textContent = state.made ? 'See the copy' : 'Make the copy';
    next.disabled = Boolean(problem);
    if (problem) {
      tally.textContent = problem;
      tally.classList.add('is-problem');
    } else if (state.file) {
      const total = allColumns(state.file.report).length;
      tally.textContent = sayColumns(total, codedCount(), keptCount());
    }
  } else {
    nextSay.textContent = 'Start over';
    next.classList.remove('accent');
    next.classList.add('ghost');
    next.disabled = state.busy;
    tally.textContent = '';
  }
}

function go(step: number, focus = true): void {
  if (step < 1 || step > 4 || step > state.reach) return;
  state.step = step;
  renderFrame();
  if (step === 3) renderChooser();
  if (step === 4 && !state.made && !state.busy) void make();
  if (focus) {
    const heading = byId(`cc-h-${step}`);
    heading.focus({ preventScroll: true });
    const frame = byId('cc');
    if (frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: 'start' });
    announce(`Step ${step} of 4: ${STEP_NAMES[step - 1] ?? ''}`);
  }
}

/** A choice changed, so a copy made earlier no longer matches it. */
function choicesChanged(): void {
  state.made = null;
  state.failed = '';
  state.reach = Math.min(state.reach, 3);
  renderFrame();
}

// ---------- Step 2: the file ----------

function stat(label: string, value: string, note = ''): HTMLElement {
  return el('div', {}, el('dt', {}, label), el('dd', {}, value, el('span', { class: 'cc-stat-note' }, note)));
}

function showProblem(text: string): void {
  const box = byId('cc-problem');
  box.textContent = text;
  box.hidden = !text;
}

function renderFile(): void {
  const file = state.file;
  byId('cc-drop').hidden = Boolean(file);
  byId('cc-loaded').hidden = !file;
  if (!file) return;
  const report = file.report;
  const columns = allColumns(report);
  byId('cc-file-name').textContent = file.name;
  byId('cc-file-meta').textContent = `${file.kind === 'csv' ? 'CSV file' : 'Excel workbook'}, ${size(file.size)}. Read in ${seconds(file.ms)}. Nothing has been changed.`;
  const cells = columns.reduce((sum, c) => sum + c.column.cells, 0);
  const formulas = columns.reduce((sum, c) => sum + c.column.formulas, 0);
  const hidden = report.sheets.filter((sheet) => sheet.state !== 'visible').length;
  byId('cc-file-stats').replaceChildren(
    file.kind === 'csv' ? stat('Kind', 'CSV') : stat('Sheets', num(report.sheets.length), hidden ? `${num(hidden)} hidden` : ''),
    stat('Columns', num(columns.length)),
    stat('Cells with a value', num(cells)),
    stat('Formulas', num(formulas)),
  );

  // What the file can do, and what it carries: grouped by kind, each with where it is.
  const groups = new Map<string, { where: string[]; detail: string[] }>();
  for (const found of report.worthKnowing) {
    const group = groups.get(found.what) ?? { where: [], detail: [] };
    if (found.where && !group.where.includes(found.where)) group.where.push(found.where);
    if (found.detail && !group.detail.includes(found.detail)) group.detail.push(found.detail);
    groups.set(found.what, group);
  }
  byId('cc-finds-h').textContent = groups.size ? `${plural(groups.size, 'thing')} worth knowing about this file` : 'Nothing in this file runs or reaches outside it';
  byId('cc-finds-say').textContent = groups.size
    ? 'None of these stops you. They are listed so nothing in the file comes as a surprise. This is a list in plain words, not a virus check.'
    : 'The page looked for macros, hidden sheets, saved connections, built-in queries and formulas that fetch something. It found none. This is not a virus check.';
  byId('cc-finds-list').replaceChildren(
    ...[...groups].map(([what, group]) => {
      const where = group.where.slice(0, 4).join(', ') + (group.where.length > 4 ? `, and ${num(group.where.length - 4)} more` : '');
      const detail = group.detail.slice(0, 3).join('\n\n');
      return el(
        'li',
        {},
        el('span', { class: 'cc-find-mark' }, icon('info', 18)),
        el('div', {}, el('strong', {}, what), where && el('span', { class: 'small muted' }, where), detail.length > 0 && el('details', {}, el('summary', {}, 'Show what it says'), el('pre', {}, detail))),
      );
    }),
  );
}

async function take(name: string, read: () => Promise<Uint8Array | null>): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  showProblem('');
  const drop = byId('cc-drop');
  drop.classList.add('is-busy');
  drop.setAttribute('aria-busy', 'true');
  renderFrame();
  await workerReady;
  chosenAt = performance.now();
  requestsSince = 0;
  showWire();
  let answer: FromWorker;
  try {
    const bytes = await read();
    answer = bytes ? await ask({ type: 'load', name, bytes }, [bytes.buffer as ArrayBuffer]) : await ask({ type: 'sample' });
  } catch {
    answer = { id: 0, ok: false, problem: 'The browser could not read this file. Close it in Excel and try again.' };
  }
  state.busy = false;
  drop.classList.remove('is-busy');
  drop.removeAttribute('aria-busy');
  if (answer.ok && answer.type === 'loaded') {
    state.file = answer.file;
    state.keep = new Map();
    state.code = new Map();
    state.rename = new Map();
    state.swap = new Set();
    state.dropExtras = true;
    state.sheet = Math.max(0, answer.file.report.sheets.findIndex((sheet) => sheet.columns.length > 0));
    state.made = null;
    state.failed = '';
    state.reach = 3;
    renderFile();
    announce(`${answer.file.name} has been read. Nothing has been changed.`);
  } else {
    showProblem(answer.ok ? 'The file could not be read.' : answer.problem);
  }
  renderFrame();
}

function takeFile(file: File): void {
  if (file.size > TOO_LARGE) {
    showProblem(`This file is ${size(file.size)}. For now the tool takes files up to ${size(TOO_LARGE)}.`);
    return;
  }
  void take(file.name, async () => new Uint8Array(await file.arrayBuffer()));
}

function forgetFile(): void {
  void ask({ type: 'forget' });
  state.file = null;
  state.made = null;
  state.reach = 2;
  byId<HTMLInputElement>('cc-file').value = '';
  showProblem('');
  renderFile();
  renderFrame();
}

// ---------- Step 3: the choices ----------

function fewValues(column: ColumnInfo): boolean {
  return column.different > 0 && column.different <= 12 && column.cells >= 20 && column.holds.includes('text');
}

function renderSheetList(): void {
  const file = state.file;
  if (!file) return;
  byId('cc-sheet-list').replaceChildren(
    ...file.report.sheets.map((sheet, index) => {
      const kept = state.keep.get(sheet.name)?.size ?? 0;
      const coded = state.code.get(sheet.name)?.size ?? 0;
      const total = sheet.columns.length;
      const replaced = kept === 0 ? `${plural(total, 'column')}, all replaced` : `${num(total - kept)} of ${num(total)} replaced`;
      const say = total === 0 ? 'No cells with a value' : coded ? `${replaced}, ${num(coded)} coded` : replaced;
      const button = el(
        'button',
        { type: 'button', class: 'cc-sheet-tab', 'aria-current': index === state.sheet ? 'true' : undefined },
        el('span', { class: 'cc-sheet-name' }, nameInCopy(sheet).trim() || sheet.name, sheet.state !== 'visible' && el('span', { class: 'cc-chip' }, 'Hidden')),
        el('span', { class: 'small muted' }, say),
      );
      button.addEventListener('click', () => {
        state.sheet = index;
        renderChooser();
      });
      return el('li', {}, button);
    }),
  );
}

function renderSheet(): void {
  const file = state.file;
  const sheet = file?.report.sheets[state.sheet];
  const panel = byId('cc-sheet');
  if (!file || !sheet) {
    panel.replaceChildren();
    return;
  }
  const head = el('div', { class: 'cc-sheet-head' });

  if (file.kind === 'workbook') {
    const input = el('input', { id: 'cc-rename', type: 'text', maxlength: '40', value: nameInCopy(sheet), autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'cc-rename-help' });
    const help = el('p', { id: 'cc-rename-help', class: 'small muted' }, 'A sheet name can itself name a place or a person. Formulas follow a new name.');
    input.addEventListener('input', () => {
      if (input.value === sheet.name) state.rename.delete(sheet.name);
      else state.rename.set(sheet.name, input.value);
      const problem = nameProblem(sheet);
      help.textContent = problem ?? 'A sheet name can itself name a place or a person. Formulas follow a new name.';
      help.classList.toggle('is-problem', Boolean(problem));
      input.setAttribute('aria-invalid', String(Boolean(problem)));
      choicesChanged();
      renderSheetList();
    });
    head.append(el('div', { class: 'cc-field' }, el('label', { for: 'cc-rename' }, 'Sheet name in the copy'), input, help));
  }

  const facts = el('ul', { class: 'cc-facts' });
  if (sheet.headingRow) facts.append(el('li', {}, `Headings in row ${num(sheet.headingRow)}`));
  else if (sheet.columns.length) facts.append(el('li', {}, 'No heading row found'));
  if (sheet.cellsAboveHeadings > 0) facts.append(el('li', {}, `${plural(sheet.cellsAboveHeadings, 'cell')} above the headings, replaced`));
  if (sheet.tables > 0) facts.append(el('li', {}, plural(sheet.tables, 'table')));
  if (sheet.state !== 'visible') facts.append(el('li', {}, sheet.state === 'veryHidden' ? 'Hidden from the menus' : 'Hidden sheet'));
  head.append(facts);

  if (sheet.columns.length === 0) {
    panel.replaceChildren(head, el('p', { class: 'cc-empty' }, 'This sheet has no cells with a value, so there is nothing to choose here.'));
    return;
  }

  const changed = (): boolean => Boolean(state.keep.get(sheet.name)?.size || state.code.get(sheet.name)?.size);
  const reset = el('button', { type: 'button', class: 'cc-link', hidden: !changed() }, 'Randomize every column on this sheet');
  reset.addEventListener('click', () => {
    state.keep.delete(sheet.name);
    state.code.delete(sheet.name);
    choicesChanged();
    renderChooser();
  });

  const rows = sheet.columns.map((column) => {
    const heading = column.heading.trim();
    const meta = [cap(column.holds || 'empty'), plural(column.cells, 'cell'), `${num(column.different)} different`];
    if (column.formulas) meta.push(plural(column.formulas, 'formula'));
    if (column.from && column.to) meta.push(`${column.from} to ${column.to}`);
    const group = el('div', { class: 'cc-seg', role: 'radiogroup', 'aria-label': `Column ${column.column}${heading ? `, ${heading}` : ''}` });
    const row = el(
      'li',
      { class: `cc-col is-${modeOf(sheet.name, column.column)}` },
      el('span', { class: 'cc-letter', 'aria-hidden': 'true' }, column.column),
      el('span', { class: 'cc-col-say' }, el('strong', {}, heading || '(no heading)', fewValues(column) && el('span', { class: 'cc-chip' }, 'Few different values')), el('span', { class: 'small muted' }, meta.join(' · '))),
      group,
    );
    for (const option of MODES) {
      const off = option.mode === 'code' && !column.canCode;
      const input = el('input', { type: 'radio', name: `cc-mode-${state.sheet}-${column.column}`, value: option.mode, checked: modeOf(sheet.name, column.column) === option.mode, disabled: off });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        setMode(sheet.name, column.column, option.mode);
        row.className = `cc-col is-${option.mode}`;
        reset.hidden = !changed();
        choicesChanged();
        renderSheetList();
      });
      group.append(el('label', { class: off ? 'cc-seg-opt is-off' : 'cc-seg-opt', title: off ? 'Codes are for columns of text or plain numbers, not dates or formulas.' : undefined }, input, el('span', {}, option.say)));
    }
    return row;
  });

  const key = el(
    'dl',
    { class: 'cc-key' },
    el('div', {}, el('dt', {}, 'Randomized'), el('dd', {}, 'Each value becomes a random one of the same shape.')),
    el('div', {}, el('dt', {}, 'Coded'), el('dd', {}, 'Each value becomes a short code. You keep the legend.')),
    el('div', {}, el('dt', {}, 'Left as it is'), el('dd', {}, 'The real values stay in the copy, unchanged.')),
  );
  const few = sheet.columns.some(fewValues);
  panel.replaceChildren(head, el('div', { class: 'cc-cols-head' }, el('h3', {}, plural(sheet.columns.length, 'column')), reset), key, el('ul', { class: 'cc-cols' }, ...rows));
  if (few) panel.append(el('p', { class: 'small muted cc-few' }, 'Few different values: a column such as payer or visit type. A script often depends on its real words. It can be left as it is when the words name no one, or coded when they do.'));
}

function renderOptions(): void {
  const file = state.file;
  const box = byId('cc-options');
  if (!file) return;
  const report = file.report;
  const cards: HTMLElement[] = [];

  if (report.forALook.length) {
    const list = el(
      'ul',
      { class: 'cc-checks' },
      ...report.forALook.map((found, index) => {
        const id = `cc-swap-${index}`;
        const input = el('input', { id, type: 'checkbox', checked: state.swap.has(found.text) });
        input.addEventListener('change', () => {
          if (input.checked) state.swap.add(found.text);
          else state.swap.delete(found.text);
          choicesChanged();
        });
        return el('li', {}, input, el('label', { for: id }, el('span', { class: 'mono' }, found.text), el('span', { class: 'small muted' }, `${found.what}. First at ${found.first}, ${found.times === 1 ? 'once' : `${num(found.times)} times`}.`)));
      }),
    );
    cards.push(
      el(
        'section',
        { class: 'cc-option' },
        el('h3', {}, 'Text written inside formulas'),
        el('p', { class: 'small muted' }, `${plural(report.forALook.length, 'text')} written inside a formula, a colour rule or a message ${report.forALook.length === 1 ? 'matches' : 'match'} no cell. A formula may depend on the exact words, so they stay unless you tick them.`),
        list,
      ),
    );
  }

  if (report.extras.parts > 0) {
    const input = el('input', { type: 'checkbox', role: 'switch', checked: state.dropExtras, 'aria-label': 'Take out the extra data' });
    const say = el('span', { class: 'cc-col-state' }, state.dropExtras ? 'Taken out' : 'Left in');
    input.addEventListener('change', () => {
      state.dropExtras = input.checked;
      say.textContent = input.checked ? 'Taken out' : 'Left in';
      choicesChanged();
    });
    cards.push(
      el(
        'section',
        { class: 'cc-option' },
        el('h3', {}, 'Extra data from other programs'),
        el('p', { class: 'small muted' }, `This file carries ${plural(report.extras.parts, 'part')} that another program stored in it, such as labels from a document library.${report.extras.queries ? ' The built-in queries are kept either way.' : ''}`),
        el('div', { class: 'cc-option-row' }, say, el('label', { class: 'cc-switch' }, input, el('span', { 'aria-hidden': 'true' }))),
      ),
    );
  }

  box.hidden = cards.length === 0;
  box.replaceChildren(...cards);
}

function renderChooser(): void {
  renderSheetList();
  renderSheet();
  renderOptions();
  renderFrame();
}

function choices(): Choices {
  const keep: Record<string, string[]> = {};
  for (const [sheet, letters] of state.keep) if (letters.size) keep[sheet] = [...letters];
  const code: Record<string, string[]> = {};
  for (const [sheet, letters] of state.code) if (letters.size) code[sheet] = [...letters];
  const rename: Record<string, string> = {};
  for (const [from, to] of state.rename) if (to.trim() && to.trim() !== from) rename[from] = to.trim();
  return { keep, code, rename, swapText: [...state.swap], dropExtras: state.dropExtras };
}

// ---------- Step 4: the copy ----------

const REASONS: Record<CheckItem['kind'], string> = {
  symbols: 'Only punctuation or symbols, with no letters or digits',
  name: 'Also part of a sheet name or another name in the file',
  untouched: 'In a part of the file this tool does not change',
  listed: 'Written inside a formula or a connection, and listed in the step before',
  chance: 'A randomized value that happens to match a different real one',
  digits: 'Digits that also turn up inside a longer value',
  unexplained: 'Not accounted for',
};

function copyName(file: LoadedFile): string {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ending = dot > 0 ? file.name.slice(dot) : file.kind === 'csv' ? '.csv' : '.xlsx';
  return `${base}-cleaner-copy${ending}`;
}

const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The legend's name says what it is, so it is not sent along with the copy by mistake. */
function legendName(file: LoadedFile): string {
  const dot = file.name.lastIndexOf('.');
  return `${dot > 0 ? file.name.slice(0, dot) : file.name}-legend-private.xlsx`;
}

function codesIn(legend: LegendGroup[]): number {
  return legend.reduce((sum, group) => sum + group.entries.length, 0);
}

function save(bytes: Uint8Array, type: string, name: string): void {
  const address = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = el('a', { href: address, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

async function copyText(text: string, button: HTMLButtonElement, label: HTMLElement, shown?: HTMLDetailsElement | null): Promise<void> {
  const before = label.textContent;
  let done = false;
  try {
    await navigator.clipboard.writeText(text);
    done = true;
  } catch {
    // Some browsers refuse. The same text is shown on the page, where it can be selected by hand.
  }
  label.textContent = done ? 'Copied' : 'Select it below';
  button.classList.toggle('is-done', done);
  announce(done ? 'Copied.' : 'Your browser did not allow the copy. The text is shown further down this step, where you can select it.');
  if (!done && shown) {
    shown.open = true;
    shown.scrollIntoView({ block: 'center' });
  }
  window.setTimeout(() => {
    label.textContent = before;
    button.classList.remove('is-done');
  }, 2200);
}

/** The copy described in words, for pasting into a chat. Built from the copy, never from the original. */
function description(described: DescribedSheet[], kind: LoadedFile['kind']): string {
  const lines = [
    `This describes ${kind === 'csv' ? 'a CSV file' : 'an Excel workbook'}. It was written by Cleaner Copy at clinx.org/tools/cleaner-copy/.`,
    `${kind === 'csv' ? 'The headings and kinds of value' : 'The sheets, headings, kinds of value and formulas'} are as in the real file. The values shown are randomized, except in columns marked "real values".`,
  ];
  if (described.some((sheet) => sheet.columns.some((column) => column.coded))) lines.push('A column marked "coded" shows a code in place of each real value. The same real value always has the same code.');
  if (described.some((sheet) => sheet.columns.some((column) => column.formula))) lines.push('A text written inside a formula is as in the real file, unless it was chosen for replacing.');
  lines.push('');
  for (const sheet of described) {
    lines.push(`${kind === 'csv' ? 'The file' : `Sheet "${sheet.name}"`}${sheet.headingRow ? `, headings in row ${sheet.headingRow}` : ', no heading row'}, ${plural(sheet.columns.length, 'column')}`);
    for (const column of sheet.columns) {
      const parts = [column.holds || 'empty'];
      if (column.kept) parts.push('real values');
      if (column.coded) parts.push('coded');
      if (column.formula) parts.push(`formula ${column.formula}`);
      lines.push(`  ${column.column}  ${column.heading || '(no heading)'}: ${parts.join(', ')}`);
    }
    if (sheet.rows.length) {
      lines.push('  First rows:');
      for (const row of sheet.rows) lines.push(`  ${row.join(' | ')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** What happened, in counts and places only. It holds no value, no heading, no sheet name and no file name. */
function summary(file: LoadedFile, made: MadeCopy): string {
  const report = made.report;
  const check = made.check;
  const kept = keptCount();
  const coded = codedCount();
  const open = check.items.filter((item) => item.kind === 'unexplained');
  const lines = [
    'Cleaner Copy: what happened, with no values from the file',
    `File: ${file.kind === 'csv' ? 'CSV' : 'workbook'}, ${size(file.size)}, ${plural(report.sheets.length, 'sheet')}, ${plural(report.parts, 'part')}`,
    `Copy: ${size(made.bytes.length)}, made and checked in ${seconds(made.ms)}`,
    `Replaced: ${num(report.replaced.differentTexts)} different texts, ${num(report.replaced.number)} numbers, ${num(report.replaced.date)} dates; ${num(report.replaced.formulaResults)} saved formula results cleared`,
    `Columns: ${num(allColumns(report).length - kept - coded)} randomized, ${num(coded)} coded, ${num(kept)} left as they are`,
    ...(coded ? [`Legend: ${num(codesIn(made.legend))} codes, kept out of the copy`] : []),
    ...report.sheets.map((sheet, index) => `Sheet ${index + 1}: ${sheet.state}; headings ${sheet.headingRow ? `row ${sheet.headingRow} (${sheet.headingsFrom})` : 'not found'}; ${plural(sheet.columns.length, 'column')}; ${plural(sheet.columns.reduce((sum, c) => sum + c.formulas, 0), 'formula')}`),
    report.outsideTheCells.length ? 'Outside the cells:' : 'Outside the cells: nothing',
    ...report.outsideTheCells.map((item) => `  ${item.what}: ${num(item.count)} (${item.action})`),
    `Worth knowing: ${[...new Set(report.worthKnowing.map((found) => found.what))].join('; ') || 'nothing'}`,
    check.ran ? `Check: searched for ${num(check.searched)} texts; found ${num(check.items.length)}; not accounted for ${num(open.length)}` : 'Check: skipped, the file is too large',
    ...tallyCheck(check.items.filter((item) => item.kind !== 'unexplained')).map((group) => `  ${group.count} x ${group.kind} | ${group.where} | ${group.sits}`),
    ...open.map((item) => `  not accounted for | ${item.where} | ${item.sits} | ${item.how} | ${item.shape} | pattern ${item.pattern}`),
    `Requests since the file was chosen: ${requestsSince}`,
    `Browser: ${navigator.userAgent}`,
  ];
  return lines.join('\n');
}

function tallyCheck(items: CheckItem[]): { kind: CheckItem['kind']; where: string; sits: string; count: number }[] {
  const groups = new Map<string, { kind: CheckItem['kind']; where: string; sits: string; count: number }>();
  for (const item of items) {
    const key = `${item.kind}|${item.where}|${item.sits}`;
    const group = groups.get(key) ?? { kind: item.kind, where: item.where, sits: item.sits, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function verdict(check: Check): { ok: boolean; title: string; say: string } {
  const open = check.items.filter((item) => item.kind === 'unexplained').length;
  if (!check.ran) return { ok: false, title: 'The copy is made, and the check was skipped', say: 'This file is too large for the page to search its own copy. The values were still replaced cell by cell.' };
  if (open > 0) return { ok: false, title: `${plural(open, 'text')} could not be accounted for`, say: 'Each one is listed below with the place it sits. Look at them before you share the copy.' };
  if (check.items.length === 0) return { ok: true, title: 'The copy is made, and the check found nothing left behind', say: `The page searched the copy for ${num(check.searched)} of the texts it replaced, every one of five characters or more, and found none of them.` };
  return {
    ok: true,
    title: 'The copy is made, and every match is accounted for',
    say: `The page searched the copy for ${num(check.searched)} of the texts it replaced, every one of five characters or more. ${check.items.length === 1 ? '1 match can still be found, for a known reason listed below.' : `${num(check.items.length)} matches can still be found, each for a known reason listed below.`}`,
  };
}

function fold(title: string, count: number | null, ...body: Child[]): HTMLElement {
  return el('details', { class: 'cc-fold' }, el('summary', {}, el('span', {}, title), count !== null && el('span', { class: 'cc-count' }, num(count))), el('div', { class: 'cc-fold-body' }, ...body));
}

function renderResult(): void {
  const file = state.file;
  const made = state.made;
  const result = byId('cc-result');
  byId('cc-working').hidden = !state.busy;
  result.hidden = state.busy;
  if (state.busy) {
    byId('cc-result-say').textContent = 'The copy is being made.';
    return;
  }
  if (state.failed || !file || !made) {
    byId('cc-result-say').textContent = 'The copy could not be made.';
    result.replaceChildren(
      el('div', { class: 'cc-verdict is-warn' }, el('span', { class: 'cc-badge' }, icon('alert', 22)), el('div', {}, el('strong', {}, 'The copy could not be made'), el('p', {}, state.failed || 'Go back a step and try again.'))),
    );
    return;
  }

  const report = made.report;
  const check = made.check;
  const said = verdict(check);
  const kept = keptCount();
  byId('cc-result-say').textContent = 'Save it, then open it and look through it before you share it.';

  const saveButton = el('button', { type: 'button', class: 'btn accent' }, icon('save'), 'Save the copy');
  saveButton.addEventListener('click', () => {
    save(made.bytes, file.kind === 'csv' ? 'text/csv' : WORKBOOK_TYPE, copyName(file));
    announce(`Your browser is saving ${copyName(file)}.`);
  });

  const legendBytes = made.legendBytes;
  const legendButton = el('button', { type: 'button', class: 'btn ghost' }, icon('save'), 'Save the legend');
  legendButton.addEventListener('click', () => {
    if (!legendBytes) return;
    save(legendBytes, WORKBOOK_TYPE, legendName(file));
    announce(`Your browser is saving ${legendName(file)}. It holds real values.`);
  });

  const text = description(made.described, file.kind);
  const describeLabel = el('span', {}, 'Copy the description');
  const describeButton = el('button', { type: 'button', class: 'btn ghost' }, icon('copy'), describeLabel);
  const describedFold = made.described.length > 0 ? (fold('The description, to read before you paste it', null, el('pre', { class: 'cc-pre' }, text)) as HTMLDetailsElement) : null;
  describeButton.addEventListener('click', () => void copyText(text, describeButton, describeLabel, describedFold));

  const actions = el(
    'div',
    { class: legendBytes ? 'cc-actions has-three' : 'cc-actions' },
    el(
      'section',
      { class: 'cc-action is-main' },
      el('span', { class: 'label' }, 'The copy'),
      el('strong', {}, copyName(file)),
      el('p', { class: 'small muted' }, `${size(made.bytes.length)}. Made and checked in ${seconds(made.ms)}. It goes to your downloads folder.`),
      saveButton,
    ),
    made.described.length > 0 &&
      el(
        'section',
        { class: 'cc-action' },
        el('span', { class: 'label' }, 'A description'),
        el('strong', {}, file.kind === 'csv' ? 'The same file, in words' : 'The same workbook, in words'),
        el('p', { class: 'small muted' }, `${file.kind === 'csv' ? 'Headings, kinds of value' : 'Sheets, headings, kinds of value, formulas'} and a few randomized rows, as text to paste into a chat. Often that is all an assistant needs.`),
        describeButton,
      ),
    legendBytes &&
      el(
        'section',
        { class: 'cc-action is-private' },
        el('span', { class: 'label' }, 'The legend, real data'),
        el('strong', {}, legendName(file)),
        el('p', { class: 'small' }, `${plural(codesIn(made.legend), 'code')} for ${plural(codedCount(), 'column')}, each beside the real value it stands for. Keep this file with the real report. Do not send it with the copy.`),
        legendButton,
      ),
  );

  // What the check found.
  const explained = tallyCheck(check.items.filter((item) => item.kind !== 'unexplained'));
  const open = check.items.filter((item) => item.kind === 'unexplained');
  const checkBody: Child[] = [];
  if (!check.ran) checkBody.push(el('p', {}, 'The check did not run on this file.'));
  else if (check.items.length === 0) checkBody.push(el('p', {}, `None of the ${num(check.searched)} texts searched for can be found anywhere in the copy. The check searches for every replaced text of five characters or more. Numbers and dates are replaced cell by cell and are not searched for, because a randomized number can equal a real one by chance.`));
  if (open.length) {
    checkBody.push(
      el('p', {}, 'These texts from your file can still be found in the copy, and the page cannot say why. They are shown only here, on your computer.'),
      el(
        'table',
        { class: 'cc-table' },
        el('caption', { class: 'visually-hidden' }, 'Texts that could not be accounted for'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Text'), el('th', { scope: 'col' }, 'Part of the file'), el('th', { scope: 'col' }, 'Where in it'))),
        el('tbody', {}, ...open.slice(0, 200).map((item) => el('tr', {}, el('td', { class: 'mono' }, item.value), el('td', {}, item.where), el('td', {}, item.sits)))),
      ),
    );
  }
  if (explained.length) {
    checkBody.push(
      el(
        'table',
        { class: 'cc-table' },
        el('caption', { class: 'visually-hidden' }, 'Matches that are accounted for'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Why it can still be found'), el('th', { scope: 'col' }, 'Part of the file'), el('th', { scope: 'col', class: 'is-num' }, 'How many'))),
        el('tbody', {}, ...explained.map((group) => el('tr', {}, el('td', {}, REASONS[group.kind]), el('td', {}, group.where, el('span', { class: 'small muted cc-sits' }, group.sits)), el('td', { class: 'is-num' }, num(group.count))))),
      ),
    );
  }

  // What was changed outside the cells.
  const outside = el(
    'ul',
    { class: 'cc-lines' },
    ...report.outsideTheCells.map((item) => el('li', {}, el('span', {}, el('strong', {}, item.what), el('span', { class: 'small muted' }, cap(item.action))), el('span', { class: 'cc-count' }, num(item.count)))),
  );

  // What is still as it was.
  const still: Child[] = [];
  for (const sheet of report.sheets) {
    const letters = sheet.columns.filter((column) => column.kept);
    if (letters.length) still.push(el('li', {}, el('span', {}, el('strong', {}, `${sheet.name}: ${plural(letters.length, 'column')} left as ${letters.length === 1 ? 'it is' : 'they are'}`), el('span', { class: 'small muted' }, letters.map((column) => `${column.column} ${column.heading}`.trim()).join(', ')))));
  }
  if (kept && file.kind !== 'csv') still.push(el('li', {}, el('span', {}, el('strong', {}, 'Formulas and pivot tables built on those columns'), el('span', { class: 'small muted' }, 'They will show the real values of a column you left as it is, once the spreadsheet program works them out again.'))));
  const leftTexts = report.forALook.filter((found) => !state.swap.has(found.text)).length;
  if (leftTexts) still.push(el('li', {}, el('span', {}, el('strong', {}, `${plural(leftTexts, 'text')} written inside formulas`), el('span', { class: 'small muted' }, 'Left as written. They are listed in the step before.'))));
  for (const what of new Set(report.worthKnowing.map((found) => found.what))) still.push(el('li', {}, el('span', {}, el('strong', {}, what), el('span', { class: 'small muted' }, 'Listed, and still in the copy unless the line above says it was changed.'))));
  still.push(el('li', {}, el('span', {}, el('strong', {}, file.kind === 'csv' ? 'Headings, and the way the file is written' : 'Headings, formats and formulas'), el('span', { class: 'small muted' }, 'Kept, so a script written against the copy fits the real report.'))));

  const summaryText = summary(file, made);
  const summaryLabel = el('span', {}, 'Copy the summary');
  const summaryButton = el('button', { type: 'button', class: 'btn ghost' }, icon('copy'), summaryLabel);
  summaryButton.addEventListener('click', () => void copyText(summaryText, summaryButton, summaryLabel));

  result.replaceChildren(
    el('div', { class: said.ok ? 'cc-verdict' : 'cc-verdict is-warn' }, el('span', { class: 'cc-badge' }, icon(said.ok ? 'check' : 'alert', 22)), el('div', {}, el('strong', {}, said.title), el('p', {}, said.say))),
    el(
      'dl',
      { class: 'cc-stats' },
      stat('Different texts replaced', num(report.replaced.differentTexts)),
      stat('Numbers replaced', num(report.replaced.number)),
      stat('Dates replaced', num(report.replaced.date)),
      stat('Columns left as they are', num(kept), kept ? 'your choice' : ''),
    ),
    actions,
    el(
      'div',
      { class: 'cc-folds' },
      fold('What the check found', check.ran ? check.items.length : null, ...checkBody),
      fold('What was changed outside the cells', report.outsideTheCells.length, report.outsideTheCells.length ? outside : el('p', {}, 'Nothing outside the cells needed changing.')),
      fold('What is still as it was', null, el('ul', { class: 'cc-lines' }, ...still)),
      describedFold,
      fold('A summary without values, for reporting a problem', null, el('p', {}, 'Counts and places only. It holds no value, heading, sheet name or file name from your file.'), el('pre', { class: 'cc-pre' }, summaryText), summaryButton),
    ),
  );
}

async function make(): Promise<void> {
  if (state.busy || !state.file) return;
  state.busy = true;
  state.failed = '';
  renderFrame();
  renderResult();
  const answer = await ask({ type: 'copy', choices: choices() });
  state.busy = false;
  if (answer.ok && answer.type === 'copied') {
    state.made = answer.copy;
    state.reach = 4;
    announce(verdict(answer.copy.check).title);
  } else {
    state.made = null;
    state.failed = answer.ok ? '' : answer.problem;
    announce('The copy could not be made.');
  }
  renderFrame();
  renderResult();
}

// ---------- Start ----------

function start(): void {
  const frame = document.getElementById('cc');
  if (!frame) return;
  byId('cc-off').hidden = true;
  frame.hidden = false;
  startWorker();
  watchRequests();
  showWire();

  for (const button of document.querySelectorAll<HTMLButtonElement>('#cc-steps [data-go]')) {
    button.addEventListener('click', () => go(Number(button.dataset['go'])));
  }

  const agree = byId<HTMLInputElement>('cc-agree');
  agree.checked = false;
  agree.addEventListener('change', () => {
    state.agreed = agree.checked;
    state.reach = agree.checked ? Math.max(2, state.file ? (state.made ? 4 : 3) : 2) : 1;
    renderFrame();
  });

  byId('cc-back').addEventListener('click', () => go(state.step - 1));
  byId('cc-next').addEventListener('click', () => {
    if (state.step === 4) {
      forgetFile();
      go(2);
    } else if (state.step === 3) {
      state.reach = 4;
      go(4);
    } else {
      go(state.step + 1);
    }
  });

  const input = byId<HTMLInputElement>('cc-file');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) takeFile(file);
  });
  byId('cc-sample').addEventListener('click', () => void take('', async () => null));
  byId('cc-other').addEventListener('click', forgetFile);

  // A file dropped anywhere on the page must never open in the tab in place of the tool.
  const drop = byId('cc-drop');
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    const file = event.dataTransfer?.files[0];
    if (file && state.step === 2 && !state.file) takeFile(file);
  });
  drop.addEventListener('dragenter', () => drop.classList.add('is-over'));
  drop.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !drop.contains(event.relatedTarget)) drop.classList.remove('is-over');
  });

  renderFrame();
}

start();
