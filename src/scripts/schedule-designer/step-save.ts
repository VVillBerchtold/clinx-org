// Step 4, Check and save: what the page found in the week, the clinic's totals, and the ways to
// keep the work: the file the schedule is in, a workbook to download, or paper. When the schedule
// is in a file, saving into that file is the main action and a download is a separate copy. Where
// the browser can remember a file, the card for that file carries the switch that turns it on.
import { check, dayShort, siteOfRoom, tallyClinic, toWorkbook } from './engine/index';
import type { Finding, Schedule } from './engine/index';
import { announce, byId, dot, el, fileNameOf, fill, hrs, icon, keepFocus, num, plural } from './dom';
import { picker } from './dropdown';
import { app, dirty, emit, go, showPerson } from './state';
import type { FileHandle } from './state';
import { signed, slotNum } from './slots';
import { checkSay, departmentSay, showSay } from './check-say';
import type { FindingSection } from './check-say';
import { initPrint, printWeeks } from './print';
import { showPart } from './setup-parts';
import { followFile, rememberSwitch } from './kept';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface SavePicker {
  showSaveFilePicker(options: object): Promise<FileHandle>;
}

/**
 * The name a saved workbook gets. A schedule opened from a workbook keeps that workbook's name, so
 * the person finds one file with one name. Otherwise the name is made from the schedule's name.
 * A copy beside a file the page can write into is named from the schedule, to tell the two apart.
 */
function nameToSave(s: Schedule): string {
  if (!app.handle && /\.xlsx$/i.test(app.fileName)) return app.fileName;
  return `${fileNameOf(s.name)}.xlsx`;
}

let busy = false;
/** What the last save said, whether it went wrong, and the schedule it was said about. */
let said = { text: '', problem: false, about: null as Schedule | null };
let printWho = '';
/** The finding whose "Show it" was chosen last, so that coming back to this step returns to it. */
let shownId = '';

/** Design has just opened from "Show it": the line under the week says what is shown, and the keyboard goes to the week. */
function shown(s: Schedule, finding: Finding): void {
  app.status = showSay(s, finding);
  go(3);
  byId('sd-design').querySelector<HTMLElement>('.sd-cv-body')?.focus({ preventScroll: true });
  announce(`Step 3 of 4: Design. ${app.status}`);
}

function show(finding: Finding): void {
  const s = app.schedule;
  if (!s) return;
  shownId = finding.id;
  if (finding.personId !== undefined && finding.id.startsWith('work-contract:')) {
    // Working hours beside the contract are both entered in Set up, so that is where this one goes.
    app.setupPersonId = finding.personId;
    app.setupTab = 'people';
    showPart('sd-wh');
    app.status = '';
    go(2, false);
    announce(`Set up, People: the working hours of ${s.people.find((person) => person.id === finding.personId)?.name ?? 'this person'}.`);
    return;
  }
  if (finding.personId !== undefined) {
    showPerson(finding.personId);
    app.view = 'person';
    app.flash = { personId: finding.personId, ...(finding.day !== undefined ? { day: finding.day } : {}), ...(finding.start !== undefined ? { start: finding.start } : {}) };
    shown(s, finding);
    return;
  }
  if (finding.roomId !== undefined) {
    const site = siteOfRoom(s, finding.roomId);
    if (site) app.siteId = site.id;
    if (finding.day !== undefined) app.day = finding.day;
    app.view = 'rooms';
    app.flash = { roomId: finding.roomId };
    shown(s, finding);
    return;
  }
  app.setupTab = 'kinds';
  // This one opens Set up, so the line under the week keeps no sentence from an earlier "Show it".
  app.status = '';
  go(2);
}

function findings(sections: readonly FindingSection[]): HTMLElement {
  const box = el('div', { class: 'sd-finds' });
  for (const part of sections) {
    const section = el('section', { class: `sd-level is-${part.level}` }, el('h3', {}, el('span', { class: 'sd-level-badge' }, icon(part.icon, 18)), part.title, el('span', { class: 'cc-count' }, num(part.count))));
    for (const group of part.groups) {
      const items = group.items.map((finding) => {
        const button = el('button', { type: 'button', class: 'sd-show', 'data-k': `show:${finding.id}` }, 'Show it', icon('right', 14));
        button.addEventListener('click', () => show(finding));
        return el('li', {}, el('p', {}, finding.say), button);
      });
      section.append(el('div', { class: 'sd-group' }, el('h4', {}, group.name), el('ul', {}, ...items)));
    }
    box.append(section);
  }
  return box;
}

function totals(s: Schedule): HTMLElement {
  const clinic = tallyClinic(s);
  const rows: HTMLElement[] = [];
  let department = '';
  for (const row of clinic.types) {
    if (row.departmentName !== department) {
      department = row.departmentName;
      rows.push(el('tr', { class: 'sd-tot-dept' }, el('th', { scope: 'rowgroup', colspan: String(clinic.days.length + 2) }, department)));
    }
    rows.push(el('tr', {}, el('th', { scope: 'row' }, dot(row.colour), el('span', {}, row.name)), ...row.byDay.map((count) => el('td', { class: count === 0 ? 'is-zero' : '' }, num(count))), el('td', { class: 'is-week' }, num(row.week))));
  }
  const counted = clinic.departments.reduce((sum, row) => sum + row.peopleCounted, 0);
  const people = clinic.departments.reduce((sum, row) => sum + row.people, 0);
  const target = clinic.departments.reduce((sum, row) => sum + row.targetSlots, 0);
  const actual = Math.round(clinic.departments.reduce((sum, row) => sum + row.actualSlots, 0) * 10) / 10;
  // A department's word comes from each person's own verdict. One person under and one over add
  // up to no difference in slots, and that is not the same as everyone being on target.
  const slotRows = clinic.departments.map((row) => {
    const word = departmentSay(s, row.departmentId);
    return el(
      'tr',
      {},
      // The "counted" note sits under the people figure, and on a phone under the name, where it has room.
      el(
        'th',
        { scope: 'row' },
        el('span', { class: 'sd-tot-dept-name' }, el('span', {}, row.name), el('span', { class: `sd-state${word.state === 'none' ? '' : ` is-${word.state === 'mixed' ? 'short' : word.state}`}` }, word.say)),
        row.peopleCounted < row.people ? el('span', { class: 'sd-tot-sub is-narrow' }, `${row.peopleCounted} of ${row.people} counted`) : null,
      ),
      el('td', {}, num(row.people), row.peopleCounted < row.people ? el('span', { class: 'sd-tot-sub is-roomy' }, `${row.peopleCounted} counted`) : null),
      el('td', {}, slotNum(row.targetSlots)),
      el('td', {}, slotNum(row.actualSlots)),
      el('td', { class: 'is-week' }, row.peopleCounted > 0 ? signed(row.variance) : ''),
    );
  });
  return el(
    'section',
    { class: 'sd-totals' },
    el('h3', {}, 'The clinic’s week'),
    el('h4', { class: 'sd-tot-h' }, 'Slots by department'),
    el(
      'table',
      { class: 'sd-table sd-tot sd-tot-slots' },
      el('caption', { class: 'visually-hidden' }, 'Each department: whether its people are on target, how many people it has, their target slots added up, the scheduled slots and the difference'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Department'), el('th', { scope: 'col' }, 'People'), el('th', { scope: 'col' }, 'Target'), el('th', { scope: 'col' }, 'Scheduled'), twoWays('Difference', 'Diff.'))),
      el('tbody', {}, ...slotRows),
      clinic.departments.length > 1
        ? el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, 'Whole clinic'), el('td', {}, num(people)), el('td', {}, slotNum(target)), el('td', {}, slotNum(actual)), el('td', { class: 'is-week' }, signed(Math.round((actual - target) * 10) / 10))))
        : null,
    ),
    el(
      'p',
      { class: 'sd-card-note' },
      'A department is on target only when each person counted in it is on target. The difference is the scheduled slots less the target, added up.',
      counted < people ? ` The slots count ${plural(counted, 'person', 'people')} of ${people}. Someone who is ramping, has no contract hours or has an empty week is left out, so the sums compare weeks that are meant to match their targets.` : '',
    ),
    el('h4', { class: 'sd-tot-h' }, 'Appointments by visit type'),
    el(
      'table',
      { class: 'sd-table sd-tot' },
      el('caption', { class: 'visually-hidden' }, 'Appointments of each visit type on each day, for the whole clinic'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Visit type'), ...clinic.days.map((day) => el('th', { scope: 'col' }, dayShort(day))), el('th', { scope: 'col' }, 'Week'))),
      el('tbody', {}, ...rows),
      el(
        'tfoot',
        {},
        el('tr', {}, el('th', { scope: 'row' }, el('span', { class: 'sd-long' }, 'All appointments'), el('span', { class: 'sd-short' }, 'Total')), ...clinic.byDay.map((count) => el('td', {}, num(count))), el('td', { class: 'is-week' }, num(clinic.appointments))),
        el('tr', { class: 'sd-tot-care' }, el('th', { scope: 'row' }, 'Patient care hours'), ...clinic.careMinutesByDay.map((minutes) => el('td', {}, hrs(minutes))), el('td', { class: 'is-week' }, hrs(clinic.careMinutes))),
      ),
    ),
    // On a phone the hours have more digits than a day column can hold, so they get a strip of their own under the table.
    el(
      'div',
      { class: 'sd-tot-carephone' },
      el('h4', { class: 'sd-tot-h' }, 'Patient care hours'),
      el('dl', { class: 'sd-care-strip' }, ...clinic.days.map((day, at) => el('div', {}, el('dt', {}, dayShort(day)), el('dd', {}, hrs(clinic.careMinutesByDay[at] ?? 0)))), el('div', { class: 'is-week' }, el('dt', {}, 'Week'), el('dd', {}, hrs(clinic.careMinutes)))),
    ),
  );
}

/** A column heading with a short form for a narrow window. */
function twoWays(long: string, short: string): HTMLElement {
  return el('th', { scope: 'col' }, el('span', { class: 'sd-long' }, long), el('span', { class: 'sd-short', title: long }, short));
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name });
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function workbook(s: Schedule): Promise<Blob> {
  const bytes = await toWorkbook(s);
  return new Blob([bytes.slice().buffer], { type: XLSX });
}

function finish(text: string, problem: boolean): void {
  busy = false;
  said = { text, problem, about: app.schedule };
  if (app.step !== 4) app.toast = { say: text, undo: false };
  announce(text);
  emit('look');
}

/**
 * Saves the schedule as a workbook the browser downloads. When the schedule is in a file, the
 * download is a separate copy: that file has not been written, so the work still counts as unsaved.
 */
export async function saveWorkbook(): Promise<void> {
  const s = app.schedule;
  if (!s || busy) return;
  busy = true;
  emit('look');
  try {
    const name = nameToSave(s);
    download(await workbook(s), name);
    if (app.handle) {
      finish(`A separate copy, ${name}, went to your downloads, and ${app.handle.name} was not changed.`, false);
      return;
    }
    app.saved = s;
    app.fileName = name;
    finish(`Your browser saved ${name} with your downloads.`, false);
  } catch {
    finish('The workbook could not be made. Nothing was saved. Try once more.', true);
  }
}

/** Saves into the file the schedule is in, or into a place the person chooses. */
async function saveInto(choose: boolean): Promise<void> {
  const s = app.schedule;
  if (!s || busy) return;
  busy = true;
  emit('look');
  try {
    let handle = choose ? null : app.handle;
    if (!handle) {
      const picker = window as unknown as Partial<SavePicker>;
      if (typeof picker.showSaveFilePicker !== 'function') {
        busy = false;
        await saveWorkbook();
        return;
      }
      handle = await picker.showSaveFilePicker({ suggestedName: nameToSave(s), types: [{ description: 'Excel workbook', accept: { [XLSX]: ['.xlsx'] } }] });
    }
    const blob = await workbook(s);
    const writer = await handle.createWritable();
    await writer.write(blob);
    await writer.close();
    const moved = handle !== app.handle;
    // The schedule is in this file from now on. A remembered file moves with it (see kept.ts).
    const followed = moved ? await followFile(handle) : false;
    app.handle = handle;
    app.saved = s;
    app.fileName = handle.name;
    finish(followed ? `Saved into ${handle.name}, and this computer now remembers that file.` : `Saved into ${handle.name}.`, false);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      busy = false;
      emit('look');
      return;
    }
    finish('The browser did not let this page write to that file. Save the workbook as a download.', true);
  }
}

/** A save button. While a save runs it is marked as busy and stays where the keyboard is. */
function saveButton(key: string, look: string, glyph: string, say: string | HTMLElement, run: () => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: `btn ${look}`, 'data-k': key, 'aria-disabled': busy ? 'true' : undefined }, icon(glyph), busy ? 'Saving' : say);
  button.addEventListener('click', run);
  return button;
}

/**
 * The save button names the file where the name fits on one line. Where it does not, the button says
 * "this file", the card above it shows the name, and a screen reader still hears the name.
 */
function fitSaveName(): void {
  const button = byId('sd-check').querySelector<HTMLElement>('[data-k="save-into"]');
  const say = button?.querySelector<HTMLElement>('.sd-save-say');
  const name = app.handle?.name;
  if (!button || !say || !name) return;
  say.textContent = `Save into ${name}`;
  button.removeAttribute('aria-label');
  if (say.scrollWidth <= say.clientWidth) return;
  say.textContent = 'Save into this file';
  button.setAttribute('aria-label', `Save into ${name}`);
}

function actions(s: Schedule): HTMLElement {
  const canPick = typeof (window as unknown as Partial<SavePicker>).showSaveFilePicker === 'function';
  const name = nameToSave(s);
  const handle = app.handle;
  let first: HTMLElement;
  let second: HTMLElement | null = null;

  if (handle) {
    // The schedule is in a file. Saving into it is the main action, and the only one that makes the work "Saved".
    // The button names the file. fitSaveName() swaps the name for "this file" where it does not fit on one line.
    const into = saveButton('save-into', 'accent', 'file', el('span', { class: 'sd-save-say' }, `Save into ${handle.name}`), () => void saveInto(false));
    const other = el('button', { type: 'button', class: 'cc-link', 'data-k': 'save-other' }, 'Save somewhere else');
    other.addEventListener('click', () => void saveInto(true));
    first = el(
      'div',
      { class: 'cc-action is-main' },
      el('span', { class: 'label' }, dirty() ? 'Not saved yet' : 'Saved'),
      el('strong', {}, handle.name),
      el('p', {}, 'Your schedule is in this workbook. Saving writes the week into it, so there is one file to keep.'),
      // The switch sits above the buttons, so the buttons of the three cards stay on one line.
      rememberSwitch('save'),
      el('div', { class: 'sd-action-row' }, into, other),
    );
    second = el(
      'div',
      { class: 'cc-action' },
      el('span', { class: 'label' }, 'A separate copy'),
      el('strong', {}, name),
      el('p', {}, `Your browser puts a copy with your downloads. ${handle.name} stays as it is.`),
      el('div', { class: 'sd-action-row' }, saveButton('save', 'ghost', 'save', 'Download a copy', () => void saveWorkbook())),
    );
  } else {
    first = el(
      'div',
      { class: 'cc-action is-main' },
      el('span', { class: 'label' }, dirty() ? 'Not saved yet' : app.fileName ? 'Saved' : 'Keep it'),
      el('strong', {}, name),
      el('p', {}, 'An Excel workbook with a sheet for each person, the clinic’s totals and the rooms. This page opens it again when the week needs to change.'),
      saveButton('save', 'accent', 'save', 'Save the workbook', () => void saveWorkbook()),
    );
    if (canPick) {
      second = el(
        'div',
        { class: 'cc-action' },
        el('span', { class: 'label' }, 'A place you choose'),
        el('strong', {}, 'Pick the folder'),
        el('p', {}, 'Your browser asks where to put the workbook. Later saves go into the same file.'),
        el('div', { class: 'sd-action-row' }, saveButton('save-into', 'ghost', 'file', 'Choose where to save', () => void saveInto(false))),
      );
    }
  }

  const who = picker('Who to print', [{ value: '', say: 'Everyone' }, ...s.people.map((person) => ({ value: person.id, say: person.name }))], printWho, (value) => {
    printWho = value;
  });
  const print = el('button', { type: 'button', class: 'btn ghost', 'data-k': 'print', disabled: s.people.length === 0 }, icon('print'), 'Print');
  print.addEventListener('click', () => printWeeks(printWho));
  const paper = el('div', { class: 'cc-action' }, el('span', { class: 'label' }, 'On paper'), el('strong', {}, 'Print the week'), el('p', {}, 'Each person’s week fills one page, with the counts beside it.'), el('div', { class: 'sd-action-row' }, who, print));

  return el('div', { class: `cc-actions${second ? ' has-three' : ''}` }, first, second, paper);
}

export function drawCheck(): void {
  const s = app.schedule;
  if (!s) return;
  const clinic = tallyClinic(s);
  const read = checkSay(s, check(s));
  const { fixes, looks } = read;
  byId('sd-check-say').textContent = read.say;

  const stat = (label: string, value: string, note = ''): HTMLElement => el('div', {}, el('dt', {}, label), el('dd', {}, value, el('span', { class: 'cc-stat-note' }, note)));
  const stats = el(
    'dl',
    { class: 'cc-stats' },
    stat('People', num(s.people.length), plural(s.sites.length, 'site')),
    stat('Appointments', num(clinic.appointments), 'a week'),
    stat('Patient care', hrs(clinic.careMinutes), 'a week'),
    stat('Listed below', num(read.listed), fixes > 0 ? `${num(fixes)} to fix` : looks > 0 ? `${num(looks)} worth a look` : 'nothing to fix'),
  );
  // The green verdict is for a week somebody has painted. Before that there is nothing to judge.
  let verdict: HTMLElement | null = null;
  if (read.state === 'empty') {
    const nobody = s.people.length === 0;
    const next = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'check-next' }, nobody ? 'Add a person' : 'Open Design', icon('right', 16));
    next.addEventListener('click', () => {
      if (nobody) app.setupTab = 'people';
      go(nobody ? 2 : 3);
    });
    verdict = el(
      'div',
      { class: 'cc-verdict sd-verdict-none' },
      el('span', { class: 'cc-badge' }, icon('info', 22)),
      el('div', {}, el('strong', {}, 'There is nothing to check yet'), el('p', {}, nobody ? 'Nobody is in this schedule. Add a person in Set up, then build their week in Design.' : 'Nobody has any time scheduled. Add time to a week in Design and the page will check it here.')),
      next,
    );
  } else if (read.state === 'ready') {
    verdict = el('div', { class: 'cc-verdict' }, el('span', { class: 'cc-badge' }, icon('check', 22)), el('div', {}, el('strong', {}, 'This week is ready to save'), el('p', {}, 'No room is taken twice, and nothing on the week needs a second look.')));
  }
  // What the last save said stays until the schedule changes.
  const status = said.text && (said.problem || said.about === s) ? el('p', { class: `sd-said${said.problem ? ' is-problem' : ''}`, role: 'status' }, icon(said.problem ? 'alert' : 'check', 18), said.text) : null;

  const root = byId('sd-check');
  keepFocus(root, () =>
    fill(
      root,
      read.state === 'empty' ? null : stats,
      verdict,
      read.sections.length > 0 ? findings(read.sections) : null,
      read.state === 'empty' ? null : totals(s),
      el('h3', { class: 'sd-keep-h' }, 'Keep your work'),
      status,
      actions(s),
      el('p', { class: 'sd-excel-note' }, icon('info', 18), el('span', {}, 'Changes typed into the workbook in Excel are not read back. To change the week, open the workbook on this page.')),
    ),
  );
  fitSaveName();
}

export function initCheck(): void {
  initPrint();
  window.addEventListener('resize', () => {
    if (app.step === 4) fitSaveName();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's' && app.schedule && app.step > 1) {
      event.preventDefault();
      void (app.handle ? saveInto(false) : saveWorkbook());
    }
  });
}

/**
 * Coming back to this step after "Show it": the finding that was shown is brought into view and
 * its "Show it" button takes the keyboard, so a long list keeps its place. Gives back false when
 * no finding was shown or the finding is no longer listed, and the step then opens at its start.
 */
export function backToFinding(): boolean {
  const id = shownId;
  shownId = '';
  if (id === '') return false;
  const button = [...byId('sd-check').querySelectorAll<HTMLElement>('.sd-show')].find((node) => node.dataset['k'] === `show:${id}`);
  if (!button) return false;
  (button.closest('li') ?? button).scrollIntoView({ block: 'center' });
  button.focus({ preventScroll: true });
  return true;
}

/** Forgets what the last save said, for when another schedule is opened. */
export function resetCheck(): void {
  said = { text: '', problem: false, about: null };
  printWho = '';
  shownId = '';
}
