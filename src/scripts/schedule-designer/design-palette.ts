// The strip above the week. First the switch that says what a click on the week does: Look, Add
// or Erase, with one sentence beside it. In Add, one more row with two dropdowns: what to add (a
// visit type or another kind of time) and where that time is spent (a site and a room, or remote).
// For support staff, what to add starts with time with each provider they work with, and one
// button fills their week from that provider's patient time.
import { activityOf, departmentOf, fillWith, personColour, personOf, roomOf, siteOf, visitTypeOf } from './engine/index';
import type { Colour, Day, Schedule, Where } from './engine/index';
import { announce, el, fill, icon, pointing } from './dom';
import { picker } from './dropdown';
import { whatChoices, whereChoices, whereKey, whereOf } from './add-say';
import { app, chooseTool, chooseWhere, commit, emit, sameTool, setMode } from './state';
import { offerAnswer, offerUndo, showAnswer, sitWeek } from './design-week';
import type { Mode, Tool } from './state';
import { FILL_REST, fillLabel, fillSay, fillStart, withChoices, withName } from './team-say';

export interface ToolRow {
  tool: Tool;
  name: string;
  note: string;
  colour: Colour;
}

/**
 * The kinds of time that can be added for a person, in the order the number keys pick them. For a
 * provider: their department's visit types, then other time. For support staff: time with each
 * provider they work with, then other time, then their department's visit types.
 */
export function toolList(s: Schedule, personId: string): ToolRow[] {
  const person = personOf(s, personId);
  const department = person ? departmentOf(s, person.departmentId) : undefined;
  const visits: ToolRow[] = (department?.visitTypes ?? []).map((type) => ({ tool: { kind: 'visit', visitTypeId: type.id }, name: type.name, note: `${type.minutes} min`, colour: type.colour }));
  const others: ToolRow[] = s.activities.map((activity) => ({ tool: { kind: 'activity', activityId: activity.id }, name: activity.name, note: activity.paid ? '' : 'Unpaid', colour: activity.colour }));
  if (person?.kind !== 'support') return [...visits, ...others];
  const withs: ToolRow[] = withChoices(s, personId).map((choice) => ({ tool: { kind: 'with', personId: choice.personId }, name: withName(choice.name), note: choice.role, colour: personColour(s, choice.personId) }));
  return [...withs, ...others, ...visits];
}


const MODES: readonly { value: Mode; say: string; icon: string }[] = [
  { value: 'look', say: 'Look', icon: 'look' },
  { value: 'add', say: 'Add', icon: 'plus' },
  { value: 'erase', say: 'Erase', icon: 'eraser' },
];

/** Where added time goes, as the end of a sentence: " in Exam 1 at Tannery Row". */
function placeWords(s: Schedule, where: Where): string {
  if (where.kind === 'remote') return ', remote';
  if (where.kind === 'none') return ' with no place';
  const site = siteOf(s, where.siteId)?.name ?? '';
  const room = where.roomId === null ? '' : (roomOf(s, where.roomId)?.name ?? '');
  if (room && site) return ` in ${room} at ${site}`;
  return site ? ` at ${site}` : ' with no place';
}

/**
 * The one sentence beside the switch: what a click or a drag on the week does now. With a finger
 * the sentence on the page is one short line, because it stays at the upper edge of the screen
 * with the switch, and the line under the week says how to tap and drag. `spoken` is the sentence
 * for a screen reader, which keeps the how.
 */
export function modeSay(s: Schedule, spoken = false): string {
  const finger = pointing() === 'touch';
  if (app.mode === 'look') return finger ? 'Tap a block to see it. No block changes.' : 'Click a block to see it. No block changes while you look.';
  if (app.mode === 'erase') return finger ? 'Erasing. Tap, or hold and drag.' : 'Drag over the times you want to clear.';
  if (app.tool.kind === 'none') return 'There is no kind of time to add yet. Add one in Set up.';
  const how = spoken ? ' Tap, or hold and drag.' : '';
  if (app.tool.kind === 'with') {
    // Time with a provider goes where the provider is, so the sentence names no place of its own.
    const name = personOf(s, app.tool.personId)?.name ?? 'a provider';
    return finger ? `Adding time with ${name}.${how}` : `Adding time with ${name}. Drag over the times you want.`;
  }
  if (finger) return `Adding ${whatSay(s).name}.${how}`;
  return `Adding ${whatSay(s).name}${placeWords(s, app.where)}. Drag over the times you want.`;
}

let beside = '';

/**
 * Puts a sentence about the time under the pointer in the place of the one beside the switch, or
 * brings the usual one back with an empty one. Only the words change. The line keeps the height it
 * had and the new words stay on one line, so the week never moves under the pointer.
 */
export function sayBeside(extra: string): void {
  if (extra === beside) return;
  const line = document.getElementById('sd-mode-say');
  const s = app.schedule;
  if (!s || !line) return;
  if (extra) {
    if (!beside) {
      // The note gets the lines the sentence has now, so the strip keeps its height.
      const high = line.offsetHeight;
      const row = parseFloat(getComputedStyle(line).lineHeight) || high;
      const lines = String(Math.max(1, Math.round(high / row)));
      line.style.minHeight = `${high}px`;
      line.style.setProperty('-webkit-line-clamp', lines);
      line.style.setProperty('line-clamp', lines);
    }
    line.classList.add('is-note');
    line.textContent = extra;
    line.title = extra;
  } else {
    line.classList.remove('is-note');
    line.style.minHeight = '';
    line.style.removeProperty('-webkit-line-clamp');
    line.style.removeProperty('line-clamp');
    line.removeAttribute('title');
    line.textContent = modeSay(s);
  }
  beside = extra;
}

/** Switches the mode, says the new sentence to a screen reader, and draws the step again. */
export function switchMode(mode: Mode): void {
  const s = app.schedule;
  if (!s) return;
  setMode(mode);
  announce(`${MODES.find((item) => item.value === mode)?.say ?? ''}. ${modeSay(s, true)}`);
  emit('look');
  // The strip changed height, so on a phone the page is set to it again.
  sitWeek();
}

function pick(change: () => void): void {
  change();
  app.notice = null;
  if (app.schedule) announce(modeSay(app.schedule, true));
  emit('look');
}

/** Chooses the kind of time a number key names. Only Add listens to the number keys. */
export function chooseKind(at: number): void {
  const s = app.schedule;
  if (!s || app.mode !== 'add') return;
  const row = toolList(s, app.personId)[at];
  if (row && !sameTool(app.tool, row.tool)) pick(() => chooseTool(row.tool));
}

function whatSay(s: Schedule): { name: string; colour: Colour | null } {
  const tool = app.tool;
  if (tool.kind === 'visit') {
    const type = visitTypeOf(s, tool.visitTypeId);
    return { name: type?.name ?? 'Appointment', colour: type?.colour ?? null };
  }
  if (tool.kind === 'activity') {
    const activity = activityOf(s, tool.activityId);
    return { name: activity?.name ?? 'Other time', colour: activity?.colour ?? null };
  }
  if (tool.kind === 'with') return { name: withName(personOf(s, tool.personId)?.name ?? ''), colour: personColour(s, tool.personId) };
  return { name: 'Nothing yet', colour: null };
}

/**
 * Fills the week of the person shown with time beside the provider chosen in What to add, or one
 * day of it: the day named by a day's menu, or the day shown in the Day view. It belongs to Add.
 * It never overwrites, and the line under the week then says what was added and what was left out.
 */
export function fillNow(providerId: string, day?: Day): void {
  const s = app.schedule;
  if (!s || app.mode !== 'add') return;
  const on = day ?? (app.view === 'day' ? app.day : undefined);
  const { schedule, plan } = on === undefined ? fillWith(s, app.personId, providerId) : fillWith(s, app.personId, providerId, on);
  app.status = fillSay(plan);
  app.notice = null;
  announce(app.status);
  offerAnswer(plan.why, schedule !== s);
  if (schedule === s) {
    emit('look');
    showAnswer();
    return;
  }
  offerUndo();
  commit(schedule);
  showAnswer();
}

/** A dropdown of the Add row with its small label, so the field carries the verb and cannot read as a filter. */
function field(label: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'sd-add-field' }, el('span', { class: 'sd-add-label', 'aria-hidden': 'true' }, label), control);
}

export function drawPalette(root: HTMLElement): void {
  const s = app.schedule;
  if (!s) return;
  const person = personOf(s, app.personId);
  const department = person ? departmentOf(s, person.departmentId) : undefined;
  const rows = toolList(s, app.personId);

  // The switch and its sentence are always there. The sentence is the guide: it says what the week will do.
  const modes = el('div', { class: 'sd-seg sd-mode-seg', role: 'group', 'aria-label': 'What a click on the week does' });
  for (const mode of MODES) {
    const button = el('button', { type: 'button', class: 'sd-seg-btn', 'data-k': `mode:${mode.value}`, 'aria-pressed': app.mode === mode.value ? 'true' : 'false' }, icon(mode.icon, 16), el('span', {}, mode.say));
    button.addEventListener('click', () => {
      if (app.mode !== mode.value) switchMode(mode.value);
    });
    modes.append(button);
  }
  beside = '';
  const strip = el('div', { class: 'sd-mode' }, modes, el('p', { class: 'sd-mode-say', id: 'sd-mode-say' }, modeSay(s)));
  root.dataset['mode'] = app.mode;
  if (app.mode !== 'add') {
    fill(root, strip);
    return;
  }

  // What to add: the one dropdown, with a heading for each kind of time and a swatch on each choice.
  const support = person?.kind === 'support';
  const at = rows.findIndex((row) => sameTool(app.tool, row.tool));
  const what = field(
    'What to add',
    picker(
      'What to add',
      whatChoices(rows),
      String(at),
      (value) => {
        const row = rows[Number(value)];
        if (row) pick(() => chooseTool(row.tool));
      },
      'sd-add-pick',
    ),
  );
  const hints: HTMLElement[] = [];
  if (support && !rows.some((row) => row.tool.kind === 'with')) hints.push(el('p', { class: 'sd-pal-none' }, `Nobody is on the “works with” list of ${person?.name ?? 'this person'} yet. Add a provider in Set up to add time with them.`));
  if (!support && !rows.some((row) => row.tool.kind === 'visit')) hints.push(el('p', { class: 'sd-pal-none' }, department ? `${department.name} has no visit types yet. Add one in Set up.` : 'Add a person in Set up to add appointments.'));

  // Time with a provider is spent where the provider is, so there is no place to choose. The fill button stands where Where does.
  const tool = app.tool;
  if (tool.kind === 'with') {
    const provider = personOf(s, tool.personId);
    const day = app.view === 'day' ? app.day : undefined;
    const say = fillLabel(provider?.name ?? '', day);
    const button = el('button', { type: 'button', class: 'btn ghost sd-btn-sm sd-fillbtn', 'data-k': 'fill', title: say, 'aria-label': say }, icon('copy', 16), el('span', {}, fillStart(day), el('span', { class: 'sd-fill-more' }, FILL_REST)));
    button.addEventListener('click', () => fillNow(tool.personId));
    // On a phone the button keeps its first words and sits beside the field.
    fill(root, strip, el('div', { class: 'sd-add-row is-with' }, what, button, ...hints));
    return;
  }

  // Where: the same dropdown, with a heading for each site.
  const where = field(
    'Where',
    picker(
      'Where',
      whereChoices(s),
      whereKey(app.where),
      (value) => {
        const next = whereOf(s, value);
        if (next) pick(() => chooseWhere(next));
      },
      'sd-add-pick',
    ),
  );
  if (app.parked && app.where.kind === 'none') hints.push(el('p', { class: 'sd-pal-none' }, `${whatSay(s).name} is unpaid time, so it is added with no place.`));
  fill(root, strip, el('div', { class: 'sd-add-row' }, rows.length > 0 ? what : null, where, ...hints));
}
