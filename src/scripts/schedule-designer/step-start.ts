// Step 1, Start: the sample clinic, a new schedule, or a workbook this page saved earlier.
// Where the browser can remember a file and the person asked it to, the step leads with that file.
import { fromSetup, fromWorkbook, newSchedule, sampleSchedule } from './engine/index';
import type { Schedule } from './engine/index';
import { announce, byId, el, fill, icon, keepFocus } from './dom';
import { app, dirty, emit, go, load } from './state';
import type { FileHandle } from './state';
import { resetCheck } from './step-save';
import { forgetKept, memory, rememberSwitch, reopenKept, whenSay } from './kept';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** A schedule's workbook is small. A file far larger than that is some other workbook. */
const MOST_BYTES = 30 * 1024 * 1024;
/** The card where a file that could not be opened again can still be chosen. */
const OPEN_CARD = 'Open a saved schedule';

/** What a chosen workbook is for: to carry on with it, or to start a new schedule from its set-up. */
type Use = 'open' | 'setup';

interface Picker {
  showOpenFilePicker(options: object): Promise<FileHandle[]>;
}
interface DropItem {
  getAsFileSystemHandle?(): Promise<(FileHandle & { kind?: string }) | null>;
}

let waiting: (() => void) | null = null;
/** What the file chosen through the plain file box is for. */
let boxUse: Use = 'open';

function showProblem(text: string): void {
  const box = byId('sd-problem');
  box.textContent = text;
  box.hidden = text === '';
  if (text === '') showLost('');
}

/**
 * Says, where the remembered file was offered, that it could not be opened and has been forgotten,
 * and names the card where it can be chosen again. With no words, the line is taken away.
 */
function showLost(text: string): void {
  const box = byId('sd-lost');
  if (text === '') fill(box);
  else fill(box, `${text} Use `, el('strong', {}, OPEN_CARD), ' to choose the workbook.');
  box.hidden = text === '';
}

/** Runs `then` at once, or asks first when it would replace work that is not in a file. */
function replacing(then: () => void): void {
  showProblem('');
  if (!dirty()) {
    then();
    return;
  }
  waiting = then;
  // With a file open the question names the file, as the card above it and the bar do.
  byId('sd-confirm-say').textContent = app.handle
    ? `This schedule has changes that are not saved into ${app.handle.name} yet. Opening another schedule replaces it.`
    : `${app.schedule?.name ?? 'Your schedule'} has changes that are not saved to a file. Opening another schedule replaces it.`;
  const box = byId('sd-confirm');
  box.hidden = false;
  // The question is brought to the middle of the window, clear of the bar along the bottom, and takes the keyboard.
  box.scrollIntoView({ block: 'center' });
  byId('sd-confirm-no').focus({ preventScroll: true });
}

function closeConfirm(): void {
  waiting = null;
  byId('sd-confirm').hidden = true;
}

/** What Set up says when a new schedule has taken its set-up from a workbook. */
export function setupFromSay(name: string): string {
  return `This set-up came from ${name}. The week is empty, and that workbook has not been changed.`;
}

/**
 * Puts a schedule on the page and opens the step to work in. `setupOf` is the name of the workbook
 * a new schedule took its set-up from: that schedule is in no file yet, so it counts as unsaved
 * work from the start, and Set up says where it came from.
 */
function open(schedule: Schedule, from: { fileName?: string; handle?: FileHandle | null }, ready: boolean, setupOf = ''): void {
  load(schedule, from);
  if (setupOf) {
    app.saved = null;
    app.setupFrom = setupOf;
  }
  resetCheck();
  app.done.clear();
  if (ready) app.done.add(2);
  go(ready ? 3 : 2);
  if (setupOf) announce(`Step 2 of 4: Set up. ${setupFromSay(setupOf)}`);
}

/** Reads a workbook this page saved. Gives back the schedule, or one sentence about what went wrong. */
async function parse(file: File): Promise<{ schedule: Schedule } | { problem: string }> {
  if (file.size > MOST_BYTES) return { problem: 'That file is much larger than a schedule this page saves. Choose the workbook you saved from here.' };
  try {
    return await fromWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { problem: 'This file could not be read. Choose a workbook that this page saved.' };
  }
}

async function read(file: File, handle: FileHandle | null, use: Use): Promise<void> {
  showProblem('');
  const result = await parse(file);
  if ('problem' in result) {
    showProblem(result.problem);
    announce(result.problem);
    return;
  }
  const schedule = result.schedule;
  // A new schedule from a set-up holds no file, so its first save asks where to put the new
  // workbook and can never write over the one it came from.
  if (use === 'setup') replacing(() => open(fromSetup(schedule), {}, false, file.name));
  else replacing(() => open(schedule, { fileName: file.name, handle }, true));
}

async function choose(use: Use): Promise<void> {
  const box = byId<HTMLInputElement>('sd-file');
  boxUse = use;
  const picker = window as unknown as Partial<Picker>;
  if (typeof picker.showOpenFilePicker !== 'function') {
    box.click();
    return;
  }
  try {
    const [handle] = await picker.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel workbook', accept: { [XLSX]: ['.xlsx'] } }] });
    if (handle) await read(await handle.getFile(), use === 'open' ? handle : null, use);
  } catch (error) {
    // Closing the file window without choosing is not a problem to report.
    if (!(error instanceof DOMException && error.name === 'AbortError')) box.click();
  }
}

/** Opens the remembered file. One that was refused, moved, deleted or is not a schedule is forgotten, and the page says so. */
async function carryOn(): Promise<void> {
  const name = memory.kept?.name ?? '';
  showProblem('');
  const again = await reopenKept();
  if (!again) return;
  let lost = '';
  if ('problem' in again) {
    lost = again.problem === 'missing' ? `${name} is no longer where it was, so the page has forgotten it.` : `This page was not allowed to open ${name}, so it has forgotten the file.`;
  } else {
    const result = await parse(again.file);
    if ('schedule' in result) {
      const schedule = result.schedule;
      replacing(() => open(schedule, { fileName: again.file.name, handle: again.handle }, true));
      return;
    }
    await forgetKept();
    lost = `${name} could not be read as a schedule this page saved, so the page has forgotten it.`;
  }
  emit('look');
  showLost(lost);
  announce(`${lost} Use ${OPEN_CARD} to choose the workbook.`);
  byId('sd-open').focus();
}

/**
 * Draws what leads the Start step: the file that is open with its switch, or the remembered file
 * with "Continue". With neither, nothing is drawn and the three cards stand as they are.
 */
export function drawStart(): void {
  const lead = byId('sd-lead');
  const kept = memory.kept;
  let card: HTMLElement[] | null = null;
  if (app.handle && memory.can) {
    card = [
      el('span', { class: 'cc-badge big' }, icon('file', 28)),
      el('div', { class: 'sd-lead-say' }, el('h3', {}, `${app.handle.name} is open`), el('p', {}, 'Check and save can write the week back into this file.')),
      el('div', { class: 'sd-lead-do' }, rememberSwitch('start')),
    ];
  } else if (kept) {
    const carry = el('button', { type: 'button', class: 'btn accent', 'data-k': 'continue' }, 'Continue', icon('right'));
    carry.addEventListener('click', () => void carryOn());
    const drop = el('button', { type: 'button', class: 'cc-link', 'data-k': 'forget' }, 'Forget this file');
    drop.addEventListener('click', () => {
      void forgetKept().then(() => {
        announce(`${kept.name} is forgotten. Nothing is kept on this computer.`);
        byId('sd-sample').focus();
      });
    });
    card = [
      el('span', { class: 'cc-badge big' }, icon('file', 28)),
      el('div', { class: 'sd-lead-say' }, el('h3', {}, `Continue with ${kept.name}`), el('p', {}, `Last used here ${whenSay(kept.when, Date.now())}.`)),
      el('div', { class: 'sd-lead-do' }, carry, drop),
    ];
  }
  const working = app.schedule !== null;
  const fileOpen = Boolean(app.handle && memory.can);
  keepFocus(lead, () => fill(lead, ...(card ?? [])));
  lead.hidden = card === null;
  // One thing leads at a time. With a schedule open, the card for its file leads, or no card does
  // and the bar along the bottom carries on. With nothing open, the file to continue with leads,
  // or the sample.
  const continuing = card !== null && !fileOpen && !working;
  lead.classList.toggle('is-main', fileOpen || continuing);
  lead.querySelector('[data-k="continue"]')?.classList.toggle('accent', continuing);
  lead.querySelector('[data-k="continue"]')?.classList.toggle('ghost', !continuing);
  const sampleLeads = !working && card === null;
  byId('sd-sample-card').classList.toggle('is-main', sampleLeads);
  const sample = byId('sd-sample');
  sample.classList.toggle('accent', sampleLeads);
  sample.classList.toggle('ghost', !sampleLeads);
  byId('sd-start-say').textContent = working ? 'Carry on with Continue, or choose another way to begin.' : 'Choose how to begin. The sample clinic is a quick way to see what the tool does.';
}

export function initStart(): void {
  byId('sd-sample').addEventListener('click', () => replacing(() => open(sampleSchedule(), {}, true)));
  byId('sd-new').addEventListener('click', () => replacing(() => open(newSchedule(), {}, false)));
  byId('sd-open').addEventListener('click', () => void choose('open'));
  byId('sd-open-setup').addEventListener('click', () => void choose('setup'));

  const input = byId<HTMLInputElement>('sd-file');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void read(file, null, boxUse);
  });

  const drop = byId('sd-drop');
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    const item = event.dataTransfer?.items[0] as (DataTransferItem & DropItem) | undefined;
    const asked = typeof item?.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null);
    void asked.then((handle) => read(file, handle && handle.kind === 'file' ? handle : null, 'open'));
  });
  // A file dropped anywhere else on the page would make the browser leave it. Stop that.
  for (const kind of ['dragover', 'drop'] as const) {
    window.addEventListener(kind, (event) => {
      if (!(event.target as Element | null)?.closest?.('#sd-drop')) event.preventDefault();
    });
  }

  byId('sd-confirm-yes').addEventListener('click', () => {
    const then = waiting;
    closeConfirm();
    then?.();
  });
  byId('sd-confirm-no').addEventListener('click', () => {
    closeConfirm();
    emit('look');
  });
}
