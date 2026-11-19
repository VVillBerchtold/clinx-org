// Printing: one person's week on a page. The pages are built just before the browser prints and
// taken away afterwards. The print rules in the stylesheet hide everything else on the site.
import { blocksOn, dayName, departmentOf, factsOf, personOf, tallyPerson, weekExtent } from './engine/index';
import type { Colour, Schedule } from './engine/index';
import { byId, dot, el, fill, hrs, plural } from './dom';
import { app } from './state';
import { slotNote, slotNum, slotWords, verdictSay } from './slots';
import { blockEl, clashNotesOf, column, gutter, viewRange } from './week-draw';
import type { Geo } from './week-draw';
import { teamRows, withChoices, withLine, worksWithLine } from './team-say';

/** Who to print: one person, or everyone when this is empty. */
let chosen = '';
let built = false;

function page(s: Schedule, personId: string): HTMLElement | null {
  const person = personOf(s, personId);
  const tally = tallyPerson(s, personId);
  // A provider's page says who is with them in the week, and a support person's page says which providers they work with, as the line above the days does on the screen.
  const beside = person?.kind === 'support' ? worksWithLine(withChoices(s, personId)) : withLine(teamRows(s, personId));
  if (!person || !tally) return null;
  // The page runs from the earlier of this person's first working minute and first block to the
  // later of their last, rounded out to the hour, so a week of eight hours is not printed small
  // inside fifteen. With no working hours and nothing on their week it shows the hours of the schedule.
  const extent = weekExtent(s, personId);
  const range = extent ? { from: Math.floor(extent.from / 60) * 60, to: Math.ceil(extent.to / 60) * 60 } : viewRange(s);
  // On paper a place is a share of the height. The pixels for a minute only pick how much a block says.
  const geo: Geo = { from: range.from, to: range.to, ppm: 560 / Math.max(60, range.to - range.from), share: true };
  const department = departmentOf(s, person.departmentId);

  const head = el('div', { class: 'sd-p-days' }, el('span', {}), ...s.days.map((day) => el('span', {}, dayName(day))));
  const grid = el('div', { class: 'sd-p-grid' }, gutter(geo));
  const template = `11mm repeat(${s.days.length}, minmax(0, 1fr))`;
  head.style.gridTemplateColumns = template;
  grid.style.gridTemplateColumns = template;
  // The key names every kind of time painted on this page, each in the same form: how many
  // blocks there are and the hours they add up to. Appointments come first, then other time.
  const kinds = new Map<string, { name: string; colour: Colour; care: boolean; count: number; minutes: number }>();
  let clashes = 0;
  const notes = clashNotesOf(s);
  for (const day of s.days) {
    const node = column(s, geo, person.step, {}, { personId, day });
    for (const block of blocksOn(s, personId, day)) {
      node.append(blockEl(s, block, geo));
      const facts = factsOf(s, block);
      const id = block.what.kind === 'visit' ? `v:${block.what.visitTypeId}` : block.what.kind === 'with' ? `w:${block.what.personId}` : `a:${block.what.activityId}`;
      const kind = kinds.get(id) ?? { name: facts.name, colour: facts.colour, care: facts.care, count: 0, minutes: 0 };
      kind.count++;
      kind.minutes += block.minutes;
      kinds.set(id, kind);
      if (notes.has(block.id)) clashes++;
    }
    grid.append(node);
  }
  const rows = [...kinds.values()];
  const key = [...rows.filter((kind) => kind.care), ...rows.filter((kind) => !kind.care)].map((kind) => el('li', {}, dot(kind.colour), `${kind.name}: ${kind.count} (${hrs(kind.minutes)})`));
  return el(
    'section',
    { class: 'sd-p-page' },
    el(
      'header',
      { class: 'sd-p-head' },
      el('div', {}, el('p', { class: 'sd-p-name' }, person.name), el('p', { class: 'sd-p-role' }, [person.role, department?.name].filter(Boolean).join(', ')), beside === '' ? null : el('p', { class: 'sd-p-role' }, beside)),
      tally.kind === 'support'
        ? el('div', { class: 'sd-p-facts' }, el('p', {}, el('strong', {}, hrs(tally.week.paidMinutes)), ` paid on the week against ${hrs(tally.contractMinutes)} of contract. `, el('strong', {}, 'Support staff'), '.'), el('p', {}, tally.week.withMinutes > 0 ? `${hrs(tally.week.withMinutes)} with ${tally.withProviders.filter((row) => row.minutes > 0).map((row) => row.name).join(' and ')}` : 'No time with a provider yet'))
        : el('div', { class: 'sd-p-facts' }, el('p', {}, el('strong', {}, slotWords(tally.slots.actual)), ` a week against a target of ${slotNum(tally.slots.target)}. `, el('strong', {}, verdictSay(tally.slots, s.tolerance).head), '.'), el('p', {}, `${plural(tally.week.appointments, 'appointment')} and ${hrs(tally.week.careMinutes)} of patient care`), slotNote(s, personId) === '' ? null : el('p', { class: 'sd-p-slot' }, slotNote(s, personId))),
      el('div', { class: 'sd-p-title' }, el('p', {}, s.name), el('p', {}, s.clinic)),
    ),
    head,
    grid,
    key.length > 0 ? el('div', { class: 'sd-p-foot' }, el('p', { class: 'sd-p-key-h' }, 'Blocks of each kind of time on this page, with their hours'), el('ul', { class: 'sd-p-key' }, ...key)) : null,
    clashes > 0 ? el('p', { class: 'sd-p-note' }, el('span', { class: 'sd-b-clash', 'aria-hidden': 'true' }, '!'), `A block with this mark is in a room that someone else is also in at that time. ${plural(clashes, 'block')} on this page ${clashes === 1 ? 'has' : 'have'} it.`) : null,
  );
}

function build(): void {
  const s = app.schedule;
  if (!s) return;
  const ids = chosen && personOf(s, chosen) ? [chosen] : s.people.map((person) => person.id);
  fill(byId('sd-print'), ...ids.map((id) => page(s, id)));
  document.documentElement.classList.add('sd-printing');
  built = true;
}

function clear(): void {
  fill(byId('sd-print'));
  document.documentElement.classList.remove('sd-printing');
  built = false;
  chosen = '';
}

/** Prints one person's week, or everyone's when no person is named. */
export function printWeeks(personId: string): void {
  chosen = personId;
  build();
  window.print();
}

export function initPrint(): void {
  // The browser's own Print command prints the weeks too, once a schedule is open.
  window.addEventListener('beforeprint', () => {
    if (!built && app.schedule && app.schedule.people.length > 0) build();
  });
  window.addEventListener('afterprint', clear);
}
