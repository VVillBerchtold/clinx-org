// The File Check page: three steps in one frame. This script shows one step at a time and asks
// the worker beside it to read the file. It stores nothing in the browser and makes no request.
import type { CheckReport, Finding, RuleId, SheetSummary } from './engine/index.js';
import type { CheckedFile, FromWorker, ToWorker, WorkerReady } from './protocol';
import { SAMPLE_ANSWER, answerOf } from './selftest';

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

// ---------- The words for what is found ----------

type Weight = Finding['weight'];

const WEIGHTS: { weight: Weight; title: string; say: string }[] = [
  { weight: 'fix', title: 'To fix', say: 'These break a pivot table, a lookup or a script.' },
  { weight: 'look', title: 'Worth a look', say: 'These may be as you meant them. Check each one.' },
  { weight: 'note', title: 'Good to know', say: 'Nothing is wrong here. A script needs to be told about these.' },
];

/** Each thing the check looks for: its name on the page, and one line on why it matters. */
const RULES: Record<RuleId, { title: string; why: string }> = {
  'number-as-text': { title: 'Numbers stored as text', why: 'A sum skips them, and they sort apart from the real numbers.' },
  'mixed-kinds': { title: 'More than one kind of value', why: 'A column of amounts with a word in it cannot be added up by a script.' },
  'mixed-dates': { title: 'Dates written in more than one way', why: 'A date typed as text does not sort or group with real dates.' },
  'near-duplicates': { title: 'One value, spelled more than one way', why: 'A pivot table lists each spelling as its own row.' },
  'error-cells': { title: 'Error codes in cells', why: 'One error cell turns a total of the whole column into an error.' },
  'blank-rows': { title: 'Empty rows inside the data', why: 'A spreadsheet program takes the first empty row as the end of the data.' },
  'total-row': { title: 'A row of totals', why: 'A pivot table or a script counts it as one more row of data.' },
  'repeated-heading': { title: 'A heading used more than once', why: 'A script picks a column by its heading and cannot tell the two apart.' },
  'empty-heading': { title: 'A column with no heading', why: 'A pivot table refuses a range that has an empty heading.' },
  'two-heading-rows': { title: 'Two rows of headings', why: 'Most tools read one row of headings and take the second as data.' },
  'merged-cells': { title: 'Merged cells', why: 'A merged range keeps its value in one cell and leaves the others empty.' },
  'uneven-rows': { title: 'Rows of uneven length', why: 'Every value after the extra or missing field lands in the wrong column.' },
  'decimal-comma': { title: 'Amounts with a decimal comma', why: 'A program set for a decimal point reads 12,5 as text or as 125.' },
  'repeated-id': { title: 'An ID that appears twice', why: 'One of the two rows may have been entered twice.' },
  'stray-spaces': { title: 'Stray spaces', why: 'Two values that look the same do not match in a lookup or a filter.' },
  'leading-zeros': { title: 'Codes that start with a zero', why: 'Turned into numbers, the zeros in front are lost.' },
};

// ---------- What the page remembers while it is open ----------

const state = {
  step: 1,
  /** The furthest step the person may open now. */
  reach: 1,
  file: null as CheckedFile | null,
  sheet: 0,
  busy: false,
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

// ---------- The tool's test of itself ----------

type SelfTest = 'passed' | 'failed' | 'none';

const SELF_TEST_FAILED = 'This copy of the tool did not give the expected answer for its built-in sample, so it will not read a file. Reload the page, or get a fresh copy from clinx.org.';

/** 'none' means the browser could not start the worker. The first step says so when a file is chosen. */
let selfTest: Promise<SelfTest> = Promise.resolve('none');

/** The worker checks the sample report built into the tool, and the answer is held to the one written in selftest.ts. */
async function testItself(): Promise<SelfTest> {
  await workerReady;
  if (!worker) return 'none';
  const late = new Promise<SelfTest>((resolve) => setTimeout(() => resolve('failed'), 15000));
  const run = ask({ type: 'sample' }).then((answer): SelfTest => (answer.ok && answerOf(answer.file.report) === SAMPLE_ANSWER ? 'passed' : 'failed'));
  return Promise.race([run, late]);
}

function showSelfTest(result: SelfTest): void {
  const line = byId('fc-selftest');
  if (result === 'none') {
    line.hidden = true;
    return;
  }
  byId('fc-selftest-say').textContent = result === 'passed' ? 'Passed its own test on the built-in sample' : 'Did not pass its own test';
  line.classList.add('is-counting');
  line.classList.toggle('is-warn', result === 'failed');
  if (result === 'failed') {
    byId<HTMLInputElement>('cc-file').disabled = true;
    byId<HTMLButtonElement>('cc-sample').disabled = true;
    showProblem(SELF_TEST_FAILED);
  }
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

// ---------- Counting what was found ----------

function countOf(findings: Finding[], weight: Weight): number {
  return findings.filter((finding) => finding.weight === weight).length;
}

function onSheet(report: CheckReport, sheet: SheetSummary): Finding[] {
  return report.findings.filter((finding) => finding.sheet === sheet.name);
}

/** "10 to fix, 3 worth a look and 1 good to know", leaving out a kind with nothing in it. */
function sayCounts(findings: Finding[]): string {
  const parts = WEIGHTS.map(({ weight, title }) => [countOf(findings, weight), title.toLowerCase()] as const)
    .filter(([count]) => count > 0)
    .map(([count, words]) => `${num(count)} ${words}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

function verdict(report: CheckReport): { ok: boolean; title: string; say: string } {
  const found = report.findings;
  const what = report.kind === 'csv' ? 'file' : 'workbook';
  if (found.length === 0) return { ok: true, title: 'Nothing found', say: `The check found nothing in this ${what} that would trip up a script or a pivot table.` };
  const fix = countOf(found, 'fix');
  if (fix === 0) return { ok: true, title: `${plural(found.length, 'thing')} to know, and nothing to fix`, say: `${cap(sayCounts(found))}. None of them stops a script or a pivot table.` };
  return { ok: false, title: `${plural(found.length, 'thing')} found`, say: `${cap(sayCounts(found))}. Each one comes with the cells it is in and what to do about it.` };
}

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// ---------- Moving between steps ----------

const STEP_NAMES = ['Choose a file', 'Go through the list', 'Take the list'];
const STEPS = STEP_NAMES.length;

function announce(text: string): void {
  byId('cc-live').textContent = text;
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
  byId('cc-where').textContent = `Step ${state.step} of ${STEPS}: ${STEP_NAMES[state.step - 1] ?? ''}`;
  for (let n = 1; n <= STEPS; n++) byId(`cc-step-${n}`).hidden = n !== state.step;

  // The bar along the bottom.
  const back = byId<HTMLButtonElement>('cc-back');
  const next = byId<HTMLButtonElement>('cc-next');
  const nextSay = byId('cc-next-say');
  const tally = byId('cc-tally');
  const found = state.file?.report.findings ?? [];
  back.hidden = state.step === 1;
  back.disabled = state.busy;
  next.classList.add('accent');
  next.classList.remove('ghost');
  if (state.step === 1) {
    nextSay.textContent = found.length || !state.file ? 'Go through the list' : 'Continue';
    next.disabled = !state.file || state.busy;
    tally.textContent = state.busy ? 'Reading the file.' : state.file ? 'Nothing in the file has been changed.' : '';
  } else if (state.step === 2) {
    nextSay.textContent = 'Take the list';
    next.disabled = false;
    tally.textContent = found.length ? cap(`${sayCounts(found)}.`) : 'Nothing found.';
  } else {
    nextSay.textContent = 'Check another file';
    next.classList.remove('accent');
    next.classList.add('ghost');
    next.disabled = false;
    tally.textContent = '';
  }
}

function go(step: number, focus = true): void {
  if (step < 1 || step > STEPS || step > state.reach) return;
  state.step = step;
  renderFrame();
  if (step === 2) renderList();
  if (step === 3) renderTake();
  if (focus) {
    const heading = byId(`cc-h-${step}`);
    heading.focus({ preventScroll: true });
    const frame = byId('cc');
    if (frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: 'start' });
    announce(`Step ${step} of ${STEPS}: ${STEP_NAMES[step - 1] ?? ''}`);
  }
}

// ---------- Step 1: the file ----------

function stat(label: string, value: string, mark = ''): HTMLElement {
  return el('div', { class: mark || undefined }, el('dt', {}, label), el('dd', {}, value));
}

function showProblem(text: string): void {
  const box = byId('cc-problem');
  box.textContent = text;
  box.hidden = !text;
}

function verdictBox(report: CheckReport): HTMLElement {
  const said = verdict(report);
  return el('div', { class: said.ok ? 'cc-verdict' : 'cc-verdict is-warn' }, el('span', { class: 'cc-badge' }, icon(said.ok ? 'check' : 'search', 22)), el('div', {}, el('strong', {}, said.title), el('p', {}, said.say)));
}

function renderFile(): void {
  const file = state.file;
  byId('cc-drop').hidden = Boolean(file);
  byId('cc-loaded').hidden = !file;
  if (!file) return;
  const report = file.report;
  const sheets = report.sheets.length;
  const rows = report.sheets.reduce((sum, sheet) => sum + sheet.rows, 0);
  byId('cc-file-name').textContent = file.name;
  byId('cc-file-meta').textContent = `${file.kind === 'csv' ? 'CSV file' : `Excel workbook, ${plural(sheets, 'sheet')}`}, ${size(file.size)}, ${plural(rows, 'row')} of data. Checked in ${seconds(file.ms)}.`;
  byId('fc-verdict').replaceChildren(verdictBox(report));
  byId('cc-file-stats').replaceChildren(
    stat('Things found', num(report.findings.length)),
    ...WEIGHTS.map(({ weight, title }) => {
      const count = countOf(report.findings, weight);
      return stat(title, num(count), count ? `fc-stat is-${weight}` : 'fc-stat');
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
  if ((await selfTest) === 'failed') {
    state.busy = false;
    drop.classList.remove('is-busy');
    drop.removeAttribute('aria-busy');
    showProblem(SELF_TEST_FAILED);
    renderFrame();
    return;
  }
  chosenAt = performance.now();
  requestsSince = 0;
  showWire();
  let answer: FromWorker;
  try {
    const bytes = await read();
    answer = bytes ? await ask({ type: 'check', name, bytes }, [bytes.buffer as ArrayBuffer]) : await ask({ type: 'sample' });
  } catch {
    answer = { id: 0, ok: false, problem: 'The browser could not read this file. Close it in Excel and try again.' };
  }
  state.busy = false;
  drop.classList.remove('is-busy');
  drop.removeAttribute('aria-busy');
  if (answer.ok) {
    const report = answer.file.report;
    state.file = answer.file;
    // Open on the first sheet that has something to show.
    state.sheet = Math.max(0, report.sheets.findIndex((sheet) => onSheet(report, sheet).length > 0));
    state.reach = STEPS;
    renderFile();
    announce(`${answer.file.name} has been checked. ${verdict(report).title}. Nothing has been changed.`);
  } else {
    showProblem(answer.problem);
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
  state.file = null;
  state.reach = 1;
  state.sheet = 0;
  byId<HTMLInputElement>('cc-file').value = '';
  showProblem('');
  renderFile();
  renderFrame();
}

// ---------- Step 2: the list, one sheet at a time ----------

function saySheet(report: CheckReport, sheet: SheetSummary): string {
  if (sheet.rows === 0 && sheet.columns === 0) return 'This sheet is empty.';
  const headings = sheet.headingRow ? `headings in row ${num(sheet.headingRow)}` : 'no row of headings found';
  return `${plural(sheet.rows, 'row')} of data, ${plural(sheet.columns, 'column')}, ${headings}.${report.kind === 'workbook' && sheet.hidden ? ' The workbook keeps this sheet hidden.' : ''}`;
}

function findingCard(finding: Finding, sure: boolean): HTMLElement {
  const rule = RULES[finding.rule];
  const about = finding.column ? `Column ${finding.column}${sure && finding.heading ? `, ${finding.heading}` : ''}` : 'The whole sheet';
  const examples =
    finding.examples.length > 0 &&
    el(
      'details',
      { class: 'fc-cells' },
      el('summary', {}, finding.examples.length < finding.count ? `Show ${num(finding.examples.length)} of the ${num(finding.count)} cells` : finding.examples.length === 1 ? 'Show the cell' : 'Show the cells'),
      el(
        'table',
        { class: 'cc-table' },
        el('caption', { class: 'visually-hidden' }, 'Cells from your file'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Cell'), el('th', { scope: 'col' }, 'What it holds'))),
        el('tbody', {}, ...finding.examples.map((example) => el('tr', {}, el('td', { class: 'fc-at' }, example.at), el('td', { class: 'mono fc-value' }, example.value)))),
      ),
      el('p', { class: 'small muted' }, 'Shown only here, on your screen. The list in the last step leaves these values out.'),
    );
  return el(
    'li',
    { class: `fc-find is-${finding.weight}` },
    el('span', { class: 'fc-mark', 'aria-hidden': 'true' }, finding.column ?? icon('columns', 18)),
    el(
      'div',
      { class: 'fc-find-say' },
      el('span', { class: 'fc-about' }, about),
      el('h4', {}, rule.title),
      el('p', {}, finding.say),
      el('p', { class: 'fc-do' }, el('strong', {}, 'What to do'), finding.fix),
      examples,
    ),
  );
}

function renderSheetList(): void {
  const file = state.file;
  if (!file) return;
  const report = file.report;
  byId('cc-sheet-list').replaceChildren(
    ...report.sheets.map((sheet, index) => {
      const found = onSheet(report, sheet);
      const button = el(
        'button',
        { type: 'button', class: 'cc-sheet-tab', 'aria-current': index === state.sheet ? 'true' : undefined },
        el('span', { class: 'cc-sheet-name' }, sheet.name, sheet.hidden && el('span', { class: 'cc-chip' }, 'Hidden')),
        el('span', { class: 'small muted' }, found.length ? cap(sayCounts(found)) : 'Nothing found'),
      );
      button.addEventListener('click', () => {
        state.sheet = index;
        renderList();
      });
      return el('li', {}, button);
    }),
  );
}

function renderList(): void {
  const file = state.file;
  if (!file) return;
  const report = file.report;
  const single = report.sheets.length <= 1;
  byId('fc-chooser').classList.toggle('is-single', single);
  byId('fc-sheets').hidden = single;
  if (!single) renderSheetList();
  const sheet = report.sheets[state.sheet];
  const box = byId('cc-sheet');
  if (!sheet) {
    box.replaceChildren();
    return;
  }
  const found = onSheet(report, sheet);
  const head = el(
    'div',
    { class: 'cc-sheet-head' },
    el('div', {}, el('h3', {}, report.kind === 'csv' ? file.name : sheet.name), el('p', { class: 'small muted' }, saySheet(report, sheet))),
    el('span', { class: 'cc-count' }, num(found.length)),
  );
  const unsure = sheet.headingRow !== null && !sheet.headingsSure && found.length > 0 && el('p', { class: 'fc-unsure small' }, icon('info', 18), `Row ${num(sheet.headingRow)} was taken as the row of headings, and it may be a row of data. The list names these columns by letter.`);
  const groups = WEIGHTS.map(({ weight, title, say }) => {
    const group = found.filter((finding) => finding.weight === weight);
    if (group.length === 0) return null;
    return el(
      'section',
      { class: `fc-group is-${weight}` },
      el('header', {}, el('h3', {}, title, el('span', { class: 'cc-count' }, num(group.length))), el('p', { class: 'small muted' }, say)),
      el('ul', { class: 'fc-finds' }, ...group.map((finding) => findingCard(finding, sheet.headingsSure))),
    );
  });
  const none = found.length === 0 && el('div', { class: 'fc-none' }, el('span', { class: 'cc-badge' }, icon('check', 22)), el('p', {}, el('strong', {}, 'Nothing found here'), 'The check found nothing on this sheet that would trip up a script or a pivot table.'));
  box.replaceChildren(...[head, unsure, ...groups, none].filter((part): part is HTMLElement => part instanceof HTMLElement));
}

// ---------- Step 3: the list to take away ----------

function listName(file: CheckedFile): string {
  const base = file.name.replace(/\.[^.]+$/, '') || 'report';
  return `${base}-file-check.txt`;
}

function save(text: string, name: string): void {
  const address = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = el('a', { href: address, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

async function copyText(text: string, button: HTMLButtonElement, label: HTMLElement, shown: HTMLDetailsElement): Promise<void> {
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
  announce(done ? 'Copied.' : 'Your browser did not allow the copy. The list is shown further down this step, where you can select it.');
  if (!done) {
    shown.open = true;
    shown.scrollIntoView({ block: 'center' });
  }
  window.setTimeout(() => {
    label.textContent = before;
    button.classList.remove('is-done');
  }, 2200);
}

function fold(title: string, open: boolean, ...body: Child[]): HTMLDetailsElement {
  return el('details', { class: 'cc-fold', open }, el('summary', {}, el('span', {}, title)), el('div', { class: 'cc-fold-body' }, ...body));
}

function renderTake(): void {
  const file = state.file;
  if (!file) return;
  const report = file.report;
  const named = report.sheets.some((sheet) => sheet.headingsSure);
  const holds = `Counts and cell places${named ? ', with your headings' : ''}${report.kind === 'workbook' ? ' and sheet names' : ''}. No value from a cell is in it.`;
  byId('fc-take-say').textContent = report.findings.length ? 'The same list as plain text, to keep or to hand to whoever will fix the file.' : 'The check found nothing. The short note below says so.';

  const listFold = fold('The list, to read before you share it', report.findings.length <= 6, el('pre', { class: 'cc-pre' }, file.text));
  const copyLabel = el('span', {}, 'Copy the list');
  const copyButton = el('button', { type: 'button', class: 'btn accent' }, icon('copy'), copyLabel);
  copyButton.addEventListener('click', () => void copyText(file.text, copyButton, copyLabel, listFold));
  const saveButton = el('button', { type: 'button', class: 'btn ghost' }, icon('save'), 'Save the list');
  saveButton.addEventListener('click', () => {
    save(file.text, listName(file));
    announce(`Your browser is saving ${listName(file)}.`);
  });

  byId('fc-take').replaceChildren(
    verdictBox(report),
    el(
      'div',
      { class: 'cc-actions' },
      el('section', { class: 'cc-action is-main' }, el('span', { class: 'label' }, 'For a chat or a ticket'), el('strong', {}, 'The list, ready to paste'), el('p', { class: 'small muted' }, `${holds} An assistant can write the fixes from it.`), copyButton),
      el('section', { class: 'cc-action' }, el('span', { class: 'label' }, 'For your records'), el('strong', {}, listName(file)), el('p', { class: 'small muted' }, `The same list as a text file. ${holds} It goes to your downloads folder.`), saveButton),
    ),
    el(
      'div',
      { class: 'cc-folds' },
      listFold,
      fold(
        'What this check looks for',
        false,
        el('ul', { class: 'fc-rules' }, ...WEIGHTS.flatMap(({ weight, title }) => (Object.keys(RULES) as RuleId[]).filter((rule) => RULE_WEIGHT[rule] === weight).map((rule) => el('li', {}, el('span', { class: `fc-tag is-${weight}` }, title), el('span', {}, el('strong', {}, RULES[rule].title), el('span', { class: 'small muted' }, RULES[rule].why)))))),
      ),
      fold(
        'What it does not check',
        false,
        el(
          'ul',
          { class: 'fc-plain' },
          el('li', {}, 'Whether the numbers are right. The check reads how a file is laid out and typed, and it cannot know what a value should be.'),
          el('li', {}, 'What a formula works out. It reads the value each formula last gave.'),
          el('li', {}, 'Macros, links to other files and hidden parts of a workbook. Cleaner Copy lists those in its second step.'),
          el('li', {}, 'Sheets protected with a password, and the older .xls and .xlsb kinds of workbook. Save those as .xlsx first.'),
        ),
      ),
    ),
  );
}

/** Where each thing sits in the list of what the check looks for. A finding carries its own weight, which can be lighter. */
const RULE_WEIGHT: Record<RuleId, Weight> = {
  'number-as-text': 'fix',
  'mixed-kinds': 'fix',
  'mixed-dates': 'fix',
  'near-duplicates': 'fix',
  'error-cells': 'fix',
  'blank-rows': 'fix',
  'total-row': 'fix',
  'repeated-heading': 'fix',
  'empty-heading': 'fix',
  'two-heading-rows': 'fix',
  'uneven-rows': 'fix',
  'decimal-comma': 'fix',
  'merged-cells': 'look',
  'repeated-id': 'look',
  'stray-spaces': 'look',
  'leading-zeros': 'note',
};

// ---------- Start ----------

function start(): void {
  const frame = document.getElementById('cc');
  if (!frame) return;
  byId('cc-off').hidden = true;
  frame.hidden = false;
  startWorker();
  watchRequests();
  showWire();
  selfTest = testItself();
  void selfTest.then(showSelfTest);

  for (const button of document.querySelectorAll<HTMLButtonElement>('#cc-steps [data-go]')) {
    button.addEventListener('click', () => go(Number(button.dataset['go'])));
  }
  byId('cc-back').addEventListener('click', () => go(state.step - 1));
  byId('cc-next').addEventListener('click', () => {
    if (state.step === STEPS) {
      forgetFile();
      go(1);
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
    if (file && state.step === 1 && !state.file) takeFile(file);
  });
  drop.addEventListener('dragenter', () => drop.classList.add('is-over'));
  drop.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !drop.contains(event.relatedTarget)) drop.classList.remove('is-over');
  });

  renderFrame();
}

start();
