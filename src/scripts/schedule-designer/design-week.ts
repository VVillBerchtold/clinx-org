// The week: one column a day (or one a person in the Day view), drawn from minutes. This file
// handles the pointer, the keyboard cursor, the small menu on a day's heading, the frame the times
// scroll in, and the columns that fit the width. The details of a selected block are drawn outside
// the week, so that a click aimed at a block can never land on a button. What a click or a key
// does in each mode is decided in intent.ts. The arithmetic of adding and clearing is the engine's.
import { activityOf, allClashes, blocksOn, clearDay, clock, clockRange, copyDay, dayExtent, dayName, dayShort, endOf, erase, factsOf, freeRooms, lengthText, paint, personColour, personOf, siteOf, snapDown, snapRange, snapUp, teamOf, visitTypeOf } from './engine/index';
import type { Block, Colour, Day, Schedule, Step } from './engine/index';
import { announce, byId, calm, dot, el, fill, icon, iconButton, pointing } from './dom';
import { app, chooseTool, chooseWhere, commit, emit, firstTool, showPerson, toolFor } from './state';
import type { Tool } from './state';
import { runSay, runsOf } from './group';
import { bandEl, blockEl, blockSay, clashNotesOf, column, gutter, ppmOf, put, viewRange } from './week-draw';
import type { Geo } from './week-draw';
import { does, keyStart } from './intent';
import { replacedSay } from './add-say';
import type { Piece } from './add-say';
import type { Does, Under } from './intent';
import { fillNow, sayBeside, switchMode } from './design-palette';
import { firstRow, offAfter, offKind, offSay, offShort } from './work-say';
import { dayFill, emptySupportAddSay, emptySupportSay, nameAndRole, stripLanes, teamRows, teamWhen, withChoices, withLine } from './team-say';

/** One column of the week: a person on a day. */
export interface Column {
  key: string;
  personId: string;
  day: Day;
  step: Step;
  /** The heading: the day in the Person view, the person in the Day view. */
  title: string;
  short: string;
  sub: string;
}

type Mode = 'person' | 'day';

interface Drag {
  pointerId: number;
  col: Column;
  body: HTMLElement;
  a: number;
  b: number;
  preview: HTMLElement | null;
  /** A finger waits a moment before it adds or clears, so that a swipe still scrolls. */
  locked: boolean;
  timer: number;
  x: number;
  y: number;
  /** Where the pointer was pressed, so the times follow it only once it has moved toward an edge. */
  y0: number;
  frame: number;
}

/** A press on the week in Look. What it was is known when the pointer lifts. */
interface Press {
  pointerId: number;
  x: number;
  y: number;
  at: number;
  touch: boolean;
}

/** The block whose details are open, or the blocks of one band. */
interface Picked {
  ids: string[];
  key: string;
}

/** The support person whose time with a provider is open in the details: from a click on their strip (one day) or on their name (the week). */
interface Team {
  supportId: string;
  providerId: string;
  day: Day | null;
  /** Who the details are about: the support person, on a provider's week, or the provider, on a support person's week. */
  about: 'support' | 'provider';
}

const GUTTER = 52;
/** The frame is never shorter than this, however small the window. */
const LEAST_FRAME = 200;
/** On a phone the frame may be shorter, so the line under the week stays above the bar along the bottom on a short screen. */
const LEAST_PHONE = 144;
/** The least while the details are open under the week. */
const LEAST_HELD = 120;
/** A finger held this long has pressed and held. */
const HOLD_MS = 450;
let host: HTMLElement;
let redraw: () => void = () => {};
let cols: Column[] = [];
let shown: Column[] = [];
let mode: Mode = 'person';
let single = false;
let dayFirst = 0;
let perPage = 1;
let layoutKey = '';
let geo: Geo = { from: 480, to: 1020, ppm: 1.2 };
let cursor: { key: string; minute: number } | null = null;
let menuKey: string | null = null;
let drag: Drag | null = null;
let press: Press | null = null;
let picked: Picked | null = null;
let team: Team | null = null;
/** When a click or a tap last opened the details. Their two buttons wait a moment after it, so the second click of a double click does nothing. */
let pickedAt = 0;
/** What the details card on the page is about, so a card for a new choice can be told from the same one drawn again. */
let shownAbout = '';
const SETTLE_MS = 400;
let hover: HTMLElement | null = null;
/** The start and end of every block in the columns shown, for the cues at the edges of the frame. */
let spans: [number, number][] = [];
/** Whose week, or which day, the frame last showed its first rows for. */
let topKey = '';
let wantTop = true;

const schedule = (): Schedule | null => app.schedule;
const colOf = (key: string | null | undefined): Column | undefined => cols.find((col) => col.key === key);
const scrollerOf = (): HTMLElement | null => host.querySelector<HTMLElement>('.sd-cv-scroll');

function focusWeek(): void {
  host.querySelector<HTMLElement>('.sd-cv-body')?.focus({ preventScroll: true });
}

function layout(count: number, forMode: Mode): { single: boolean; perPage: number } {
  const room = host.clientWidth - GUTTER;
  if (host.clientWidth === 0 || count === 0) return { single: false, perPage: Math.max(1, count) };
  if (forMode === 'person') {
    const fits = room / count >= 84;
    return { single: !fits, perPage: fits ? count : 1 };
  }
  return { single: false, perPage: Math.max(1, Math.min(count, Math.floor(room / 132))) };
}

// ---------- Drawing ----------

function headCell(col: Column): HTMLElement {
  const active = mode === 'day' && col.personId === app.personId;
  const name =
    mode === 'day'
      ? el('button', { type: 'button', class: 'sd-ch-name', 'data-open': col.personId, title: `Open the week of ${col.title}` }, col.title)
      : el('span', { class: 'sd-ch-name', title: col.title }, el('span', { class: 'sd-ch-long' }, col.title), el('span', { class: 'sd-ch-short', 'aria-hidden': 'true' }, col.short));
  // Copying and clearing a day change the schedule, so the menu is there only in Add and in Erase.
  const more = app.mode === 'look' ? null : iconButton('more', mode === 'day' ? `More for ${col.title}` : `Copy or clear ${col.title}`, {
    class: 'sd-icon-btn sd-ch-more',
    'data-menu': col.key,
    'data-k': `menu:${col.key}`,
    'aria-haspopup': 'true',
    'aria-expanded': menuKey === col.key ? 'true' : 'false',
  });
  return el('div', { class: `sd-ch${active ? ' is-active' : ''}`, 'data-key': col.key }, el('div', { class: 'sd-ch-say' }, name, el('span', { class: 'sd-ch-sub' }, col.sub)), more);
}

/** Above the columns on a narrow screen: a tab for each day, or the pager for people. */
function topRow(): HTMLElement | null {
  if (mode === 'person' && single) {
    const tabs = el('div', { class: 'sd-daytabs', role: 'group', 'aria-label': 'Day' });
    for (const col of cols) {
      tabs.append(el('button', { type: 'button', class: 'sd-daytab', 'data-tab': String(col.day), 'data-k': `tab:${col.day}`, 'aria-pressed': col.day === app.day ? 'true' : 'false', 'aria-label': col.title }, col.short));
    }
    return tabs;
  }
  if (mode === 'day' && perPage < cols.length) {
    const last = Math.min(cols.length, dayFirst + perPage);
    return el(
      'div',
      { class: 'sd-pager' },
      iconButton('prev', 'Earlier people', { 'data-page': '-1', 'data-k': 'page:-1', disabled: dayFirst === 0 }),
      el('span', {}, `People ${dayFirst + 1} to ${last} of ${cols.length}`),
      iconButton('next', 'More people', { 'data-page': '1', 'data-k': 'page:1', disabled: last >= cols.length }),
    );
  }
  return null;
}

function menuEl(col: Column): HTMLElement {
  const s = schedule();
  const menu = el('div', { class: 'sd-menu', role: 'dialog', 'aria-label': mode === 'day' ? `More for ${col.title}` : `Copy or clear ${col.title}` });
  if (!s) return menu;
  if (mode === 'person') {
    // While adding time with a provider, a support person's day can be filled from that provider's patient time on that day alone.
    const filling = dayFill(s, col.personId, app.tool, col.day, app.mode === 'add');
    if (filling) menu.append(el('button', { type: 'button', class: 'sd-menu-item', 'data-act': 'fill-day', 'data-fill': filling.providerId, 'data-k': 'fill-day' }, icon('copy', 16), filling.say));
    const others = s.days.filter((day) => day !== col.day);
    if (others.length > 0) {
      const go = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-act': 'copy', disabled: true }, 'Copy');
      const boxes = others.map((day) => {
        const box = el('input', { type: 'checkbox', value: String(day) });
        box.addEventListener('change', () => {
          go.disabled = !menu.querySelector('input:checked');
        });
        return el('label', { class: 'sd-menu-day' }, box, el('span', {}, dayShort(day)));
      });
      menu.append(el('p', { class: 'sd-menu-h' }, `Copy ${col.title} to`), el('div', { class: 'sd-menu-days' }, ...boxes), go, el('p', { class: 'sd-menu-note' }, 'Copying replaces what is already on those days. Undo brings it back.'));
    }
    menu.append(el('button', { type: 'button', class: 'sd-menu-item', 'data-act': 'clear' }, icon('trash', 16), `Clear ${col.title}`));
  } else {
    menu.append(
      el('button', { type: 'button', class: 'sd-menu-item', 'data-open': col.personId }, icon('person', 16), 'Open their week'),
      el('button', { type: 'button', class: 'sd-menu-item', 'data-act': 'clear' }, icon('trash', 16), `Clear ${dayName(col.day)} for them`),
    );
  }
  return menu;
}

function placeMenu(menu: HTMLElement, key: string): void {
  const button = host.querySelector<HTMLElement>(`[data-menu="${CSS.escape(key)}"]`);
  if (!button) return;
  const frame = host.getBoundingClientRect();
  const at = button.getBoundingClientRect();
  // The menu opens under the whole heading, so the day's name and its slot count stay readable.
  const under = (button.closest('.sd-ch') ?? button).getBoundingClientRect();
  const left = Math.min(Math.max(0, at.right - frame.left - menu.offsetWidth), Math.max(0, host.clientWidth - menu.offsetWidth));
  menu.style.left = `${left}px`;
  menu.style.top = `${under.bottom - frame.top + 4}px`;
}

function cursorCell(col: Column, minute: number): HTMLElement {
  const cell = el('span', { class: 'sd-cursor', 'aria-hidden': 'true' });
  put(cell, minute, minute + col.step, geo, 0);
  return cell;
}

/** The blocks a click on this one selects: the block, or its whole band in the Grouped look. */
function idsWith(s: Schedule, col: Column, block: Block): string[] {
  if (app.visits !== 'grouped') return [block.id];
  const run = runsOf(blocksOn(s, col.personId, col.day)).find((item) => item.blocks.includes(block));
  return run ? run.blocks.map((item) => item.id) : [block.id];
}

/** The picked blocks, first to last, or nothing when any of them is gone. */
function pickedBlocks(s: Schedule): Block[] | null {
  if (!picked) return null;
  const found: Block[] = [];
  for (const id of picked.ids) {
    const block = s.blocks.find((item) => item.id === id);
    if (!block) return null;
    found.push(block);
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The details of the picked block or band, in words: for the panel's name and for a screen reader. */
function pickedSay(s: Schedule, blocks: readonly Block[]): string {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return '';
  const facts = factsOf(s, first);
  const time = clockRange(first.start, endOf(last));
  const what = blocks.length > 1 ? runSay(facts.name, blocks.length, `${dayName(first.day)}, ${time}`) : `${facts.name}${facts.code && facts.kind !== 'with' ? ` (${facts.code})` : ''}, ${dayName(first.day)}, ${time}`;
  return `${what}${facts.place ? `, ${facts.place}` : ''}.`;
}

/** The details of the selected block or band: what it is, when, where, and two quiet buttons. */
function detailEl(s: Schedule): HTMLElement | null {
  const blocks = pickedBlocks(s);
  const first = blocks?.[0];
  const last = blocks?.[blocks.length - 1];
  if (!blocks || !first || !last) return null;
  const facts = factsOf(s, first);
  const many = blocks.length > 1;
  const notes = clashNotesOf(s);
  const clash = blocks.map((block) => notes.get(block.id)).find((note) => note !== undefined);
  const row = (name: string, value: string): HTMLElement[] => [el('dt', {}, name), el('dd', { title: value }, value)];
  // Neither button is the loud kind: looking at a block is not an invitation to change it.
  const more = el('button', { type: 'button', class: 'btn ghost sd-btn-sm', 'data-k': 'detail:more' }, 'Add more like this');
  // Look removes nothing, so the card has no Remove. It says where removing is done.
  const how = el('p', { class: 'sd-detail-how' }, `To remove ${many ? 'them' : 'it'}, choose Erase and ${pointing() === 'touch' ? 'tap' : 'click'} ${many ? 'the band' : 'the block'}.`);
  const close = iconButton('close', 'Close the details', { class: 'sd-icon-btn sd-detail-close', 'data-k': 'detail:close' });
  more.addEventListener('click', () => {
    if (performance.now() - pickedAt > SETTLE_MS) addMoreLike();
  });
  close.addEventListener('click', () => closeDetail(true));
  return el(
    'section',
    { class: 'sd-detail', 'aria-label': pickedSay(s, blocks) },
    el('h3', { class: 'sd-detail-h' }, many ? 'This band' : 'This block'),
    el('div', { class: 'sd-detail-head' }, dot(facts.colour), el('p', { class: 'sd-detail-name', title: facts.name }, facts.name), facts.code && facts.kind !== 'with' ? el('span', { class: 'sd-detail-code' }, facts.code) : null),
    el(
      'dl',
      { class: 'sd-detail-facts' },
      ...(many ? row('How many', `${blocks.length} visits`) : []),
      ...(mode === 'day' ? row('Who', personOf(s, first.personId)?.name ?? '') : []),
      ...row('When', `${dayName(first.day)}, ${clockRange(first.start, endOf(last))}`),
      ...row('Where', facts.place || 'No place'),
    ),
    clash ? el('p', { class: 'sd-detail-note' }, clash) : null,
    el('div', { class: 'sd-detail-acts' }, more, how),
    close,
  );
}

interface TeamFacts {
  /** The person the details are about, and the one whose week is showing. */
  them: { personId: string; name: string; role: string };
  other: string;
  about: 'support' | 'provider';
  when: string;
  where: string;
}

/** The two people the details are open for: who they are, and when and where they are together. */
function teamFacts(s: Schedule): TeamFacts | null {
  if (!team) return null;
  const now = team;
  const support = personOf(s, now.supportId);
  const provider = personOf(s, now.providerId);
  if (!support || !provider) return null;
  const row = teamRows(s, now.providerId, now.day ?? undefined).find((one) => one.personId === now.supportId);
  // A strip or a name on a provider's week stands for time that is there. A provider on a support person's list may have none yet.
  if (!row && now.about === 'support') return null;
  const spans = row?.spans ?? [];
  const sites = [...new Set(spans.map((span) => (span.siteId === null ? '' : (siteOf(s, span.siteId)?.name ?? ''))).filter((name) => name !== ''))];
  const [them, other] = now.about === 'support' ? [support, provider] : [provider, support];
  return { them: { personId: them.id, name: them.name, role: them.role.trim() }, other: other.name, about: now.about, when: spans.length > 0 ? teamWhen(spans) : 'No time together this week yet', where: sites.join(' and ') };
}

/** The same in words, for the panel's name and for a screen reader. */
function teamSay(facts: TeamFacts): string {
  return `${nameAndRole(facts.them)}, with ${facts.other}. ${facts.when}${facts.where ? `, ${facts.where}` : ''}.`;
}

/** The details of the person a name or a strip stands for, beside the one whose week is showing: who, when and where. It changes nothing. */
function teamDetailEl(s: Schedule): HTMLElement | null {
  const facts = teamFacts(s);
  if (!facts) return null;
  const row = facts.them;
  const line = (name: string, value: string): HTMLElement[] => [el('dt', {}, name), el('dd', { title: value }, value)];
  const open = el('button', { type: 'button', class: 'btn ghost sd-btn-sm', 'data-k': 'detail:open' }, 'Open their week');
  open.addEventListener('click', () => {
    if (performance.now() - pickedAt <= SETTLE_MS) return;
    team = null;
    menuKey = null;
    showPerson(row.personId);
    app.view = 'person';
    app.status = '';
    emit('look');
  });
  const close = iconButton('close', 'Close the details', { class: 'sd-icon-btn sd-detail-close', 'data-k': 'detail:close' });
  close.addEventListener('click', () => closeDetail(true));
  return el(
    'section',
    { class: 'sd-detail is-team', 'aria-label': teamSay(facts) },
    el('h3', { class: 'sd-detail-h' }, facts.about === 'support' ? 'Support staff' : 'Provider'),
    el('div', { class: 'sd-detail-head' }, dot(personColour(s, row.personId)), el('p', { class: 'sd-detail-name', title: nameAndRole(row) }, row.name), row.role ? el('span', { class: 'sd-detail-role' }, row.role) : null),
    // Where the card is one line and the headings are hidden, the provider's name keeps the word that says what it is.
    el('dl', { class: 'sd-detail-facts' }, el('dt', {}, 'With'), el('dd', { title: facts.other }, el('span', { class: 'sd-detail-pre' }, 'With '), facts.other), ...line('When', facts.when), ...(facts.where || facts.about === 'support' ? line('Where', facts.where || 'No place') : [])),
    el('div', { class: 'sd-detail-acts' }, open),
    close,
  );
}

/**
 * The line above the days in the Person view. For a provider it lists the support staff who have
 * time with them this week, each with the colour of their strip at the edge of the days. In Look a
 * name is a button that shows when they are with the provider. For support staff it lists the
 * providers they work with.
 */
function teamLine(s: Schedule): HTMLElement | null {
  if (mode !== 'person') return null;
  const person = personOf(s, app.personId);
  if (!person) return null;
  // Both lines are the same: each name is a button that opens that person's details, in every mode. It changes nothing.
  const chip = (them: { personId: string; name: string; role: string }, about: Team['about']): HTMLElement => {
    const on = team !== null && team.day === null && team.about === about && (about === 'support' ? team.supportId : team.providerId) === them.personId;
    return el(
      'button',
      { type: 'button', class: 'sd-teamchip', 'data-team': them.personId, 'data-about': about, 'data-k': `team:${them.personId}`, 'aria-pressed': on ? 'true' : 'false', title: `Show when ${them.name} is with ${person.name}` },
      dot(personColour(s, them.personId)),
      el('span', {}, nameAndRole(them)),
    );
  };
  if (person.kind === 'support') {
    const providers = withChoices(s, person.id);
    if (providers.length === 0) return null;
    return el('div', { class: 'sd-teamline', role: 'group', 'aria-label': `Works with ${providers.map((one) => one.name).join(', ')}` }, el('span', { class: 'sd-teamline-h', 'aria-hidden': 'true' }, 'Works with:'), el('span', { class: 'sd-teamchips' }, ...providers.map((one) => chip(one, 'provider'))));
  }
  const rows = teamRows(s, person.id);
  if (rows.length === 0) return null;
  return el('div', { class: 'sd-teamline', role: 'group', 'aria-label': withLine(rows) }, el('span', { class: 'sd-teamline-h', 'aria-hidden': 'true' }, 'With:'), el('span', { class: 'sd-teamchips' }, ...rows.map((row) => chip(row, 'support'))));
}

const WIDE = '(min-width: 70.0625rem)';
const PHONE = '(max-width: 44rem)';

/**
 * Draws the details where no part of the week is. On a wide window they head the side column. On a
 * narrower one they take the place of the line under the week, and on a phone they are a short
 * sheet above the bar along the bottom. In both the frame gives up the height they need at its
 * lower edge while they are open, so a card of any height leaves the week where it is.
 */
export function drawPicked(): void {
  const s = schedule();
  const row = byId('sd-pick');
  const side = byId('sd-side');
  for (const old of side.querySelectorAll(':scope > .sd-detail')) old.remove();
  const week = s !== null && !host.hidden && cols.length > 0;
  const card = !week || !s ? null : picked ? detailEl(s) : team ? teamDetailEl(s) : null;
  const about = !card ? '' : picked ? `block ${picked.key} ${picked.ids.join(' ')}` : team ? `team ${team.supportId} ${team.providerId} ${team.day ?? 'week'} ${team.about}` : '';
  const fresh = about !== '' && about !== shownAbout;
  shownAbout = about;
  if (window.matchMedia(WIDE).matches) {
    fill(row);
    row.hidden = true;
    if (card) side.prepend(card);
    // The side column scrolls by itself. A card for a new choice heads it, so the column goes back to its start to show the card.
    if (card && fresh) side.scrollTop = 0;
    return;
  }
  row.hidden = !card;
  fill(row, card);
}

/** Brings the selected block into view inside the frame. The page itself keeps still. */
function seePicked(): void {
  const scroller = scrollerOf();
  const node = host.querySelector<HTMLElement>('.is-picked');
  if (!scroller || !node) return;
  const frame = scroller.getBoundingClientRect();
  const at = node.getBoundingClientRect();
  // The block keeps clear of the two ends of the frame, where "Earlier blocks" and "Later blocks" are drawn.
  const edge = Math.max(6, Math.min(44, (frame.height - at.height) / 2));
  if (at.bottom > frame.bottom - edge) scroller.scrollTop += Math.min(at.bottom - frame.bottom + edge, Math.max(0, at.top - frame.top - edge));
  else if (at.top < frame.top + edge) scroller.scrollTop -= frame.top + edge - at.top;
}

/**
 * On a phone, sets the page so the strip with Look, Add and Erase is at the upper edge of the
 * screen and the week is right under it. The frame is sized for exactly that.
 */
export function sitWeek(): void {
  if (!window.matchMedia(PHONE).matches || app.full || host.hidden) return;
  const strip = byId('sd-palette');
  const stage = host.parentElement;
  if (!stage) return;
  const gap = parseFloat(getComputedStyle(byId('sd-work')).rowGap) || 0;
  const by = Math.round(stage.getBoundingClientRect().top - strip.offsetHeight - gap);
  if (by !== 0) window.scrollBy(0, by);
}

/** On a phone, after a change of view: Design goes to the upper edge of the screen, and a week sits as it does on arriving. */
export function seatView(): void {
  if (!window.matchMedia(PHONE).matches || app.full) return;
  byId('sd-design').scrollIntoView({ block: 'start' });
  sitWeek();
}

/**
 * The first row to show: one hour above the earlier of the first working minute and the first
 * block in the columns, or 8:00 in the morning when they hold neither.
 */
function firstMinute(s: Schedule): number {
  let earliest: number | null = null;
  // A person's week opens on the earliest of their days. A day opens on the people in view, so one early person further along does not push the rest down.
  for (const col of mode === 'person' ? cols : shown) {
    const row = firstRow(dayExtent(s, col.personId, mode === 'person' ? col.day : app.day));
    if (row !== null && (earliest === null || row < earliest)) earliest = row;
  }
  return Math.max(geo.from, Math.min(earliest ?? 480, geo.to - 60));
}

let cues: { above: HTMLButtonElement; below: HTMLButtonElement } | null = null;

/** A cue in the line under the week: it says that blocks lie beyond an edge of the frame, and goes to them. It never sits on a block. */
function cueEl(side: 'above' | 'below'): HTMLButtonElement {
  const button = el('button', { type: 'button', class: `sd-cue is-${side}`, 'data-cue': side, 'data-k': `cue:${side}`, 'aria-label': side === 'above' ? 'Show the earlier blocks' : 'Show the later blocks', disabled: true }, icon('down', 14), el('span', {}, side === 'above' ? 'Earlier' : 'Later', el('span', { class: 'sd-cue-more' }, ' blocks')));
  button.addEventListener('click', () => {
    const scroller = scrollerOf();
    if (scroller) scroller.scrollBy({ top: (side === 'above' ? -0.75 : 0.75) * scroller.clientHeight, behavior: calm() ? 'auto' : 'smooth' });
    focusWeek();
  });
  return button;
}

/** Shows a cue at an edge of the frame while blocks lie beyond it. */
export function markCues(): void {
  const upper = cues?.above;
  const lower = cues?.below;
  if (!upper || !lower) return;
  const scroller = scrollerOf();
  // With no week on the page (the Overview, the rooms, nobody yet) there is nothing beyond an edge.
  if (!scroller || host.hidden) {
    upper.disabled = true;
    lower.disabled = true;
    return;
  }
  keepHours(scroller);
  const top = geo.from + scroller.scrollTop / geo.ppm;
  const bottom = geo.from + (scroller.scrollTop + scroller.clientHeight) / geo.ppm;
  let above = false;
  let below = false;
  for (const [start, end] of spans) {
    if (end <= top + 1) above = true;
    else if (start >= bottom - 1) below = true;
  }
  // A cue that is about to go lets the keyboard go back to the week first.
  if ((!above && document.activeElement === upper) || (!below && document.activeElement === lower)) focusWeek();
  upper.disabled = !above;
  lower.disabled = !below;
}

/**
 * Keeps the hour's label at an edge of the frame whole. A label sits across its hour's line, so
 * the edge would cut it in half; it moves just inside the edge until its line has gone by.
 */
export function keepHours(scroller: HTMLElement): void {
  const labels = scroller.querySelectorAll<HTMLElement>('.sd-gutter .sd-hour');
  const top = scroller.scrollTop;
  const bottom = top + scroller.clientHeight;
  const half = 7;
  labels.forEach((label, at) => {
    // The first and the last label already sit inside the ends of the day.
    const y = at === 0 || at === labels.length - 1 ? Number.NaN : parseFloat(label.style.top);
    let shift = 0;
    if (y - half < top && y + half > top) shift = top - (y - half) + 1;
    else if (y + half > bottom && y - half < bottom) shift = bottom - (y + half) - 1;
    label.style.translate = shift === 0 ? '' : `0 ${Math.round(shift)}px`;
  });
}

/**
 * Gives the frame its height: what is left of the window under the Design bar, the strip and the
 * day headings, above the bar along the bottom. The times scroll inside it, so the headings and
 * the strip never leave. On a phone the room is counted from the strip, which the page scrolls to.
 */
export function fitFrame(): void {
  const scroller = scrollerOf();
  if (!scroller || host.hidden) return;
  const phone = window.matchMedia(PHONE).matches;
  const px = (value: string): number => parseFloat(value) || 0;
  const foot = app.full ? 0 : byId('sd-foot').offsetHeight;
  byId('sd').style.setProperty('--sd-foot-h', `${foot}px`);
  let above: number;
  let lead = 0;
  let held = 0;
  const sheet = byId('sd-pick');
  if (phone) {
    // The strip stays at the upper edge of the screen, and the week begins right under it.
    const stage = host.parentElement ?? host;
    above = byId('sd-palette').offsetHeight + px(getComputedStyle(byId('sd-work')).rowGap) + (scroller.getBoundingClientRect().top - stage.getBoundingClientRect().top);
    // An open sheet of details takes its height from the frame, so it never lies over a block.
    held = sheet.hidden ? 0 : sheet.offsetHeight;
    // The day tabs stay under the strip while the page scrolls on.
    byId('sd').style.setProperty('--sd-strip-h', `${byId('sd-palette').offsetHeight}px`);
  } else {
    above = scroller.getBoundingClientRect().top - byId('sd-design').getBoundingClientRect().top;
    // Where the page leaves the start of Design when it scrolls there: the page's own margin for a scroll.
    lead = app.full ? 0 : Math.max(0, px(getComputedStyle(document.documentElement).scrollPaddingTop) + px(getComputedStyle(byId('sd-design')).scrollMarginTop));
    // Between a phone and a wide window the details sit under the week, where the line of words was, and the frame gives up what they need.
    held = sheet.hidden ? 0 : sheet.offsetHeight + px(getComputedStyle(host.parentElement ?? host).rowGap);
  }
  // While the details are up the line under the week steps aside, so they never lie over half of it.
  byId('sd-under').classList.toggle('is-held', held > 0);
  const under = byId('sd-under').offsetHeight + 18;
  const room = window.innerHeight - foot - lead - above - under - held;
  // Under an open sheet the frame may be shorter than its usual least, so the sheet lies over no block.
  host.style.setProperty('--sd-week-h', `${Math.max(held > 0 ? LEAST_HELD : phone ? LEAST_PHONE : LEAST_FRAME, Math.round(room))}px`);
  // A scroll bar that takes room narrows the columns, so the headings give up the same room.
  const head = host.querySelector<HTMLElement>('.sd-cv-head');
  const bar = scroller.offsetWidth - scroller.clientWidth;
  if (head) head.style.paddingRight = bar > 0 ? `${bar}px` : '';
}

function onScroll(): void {
  hideTip();
  clearHover();
  markCues();
}

/** Asks for the first rows again the next time the week is drawn: on arriving in Design. */
export function showFirstRows(): void {
  wantTop = true;
}

/**
 * Draws the columns. `columns` is every column of the view; the ones that fit the width are
 * shown and the rest are a tab or a page away.
 */
export function drawWeek(columns: Column[], forMode: Mode): void {
  const s = schedule();
  if (!s) return;
  // Where the frame was scrolled to, as a time of day, so a redraw keeps the same rows in view.
  const before = scrollerOf();
  const keptMinute = before ? geo.from + before.scrollTop / geo.ppm : null;
  cols = columns;
  mode = forMode;
  hover = null;
  const fit = layout(cols.length, mode);
  single = fit.single;
  perPage = fit.perPage;
  layoutKey = `${mode}:${single}:${perPage}`;

  const flash = app.flash;
  const flashCol = flash ? cols.find((col) => col.personId === flash.personId && (flash.day === undefined || col.day === flash.day)) : undefined;
  if (mode === 'person') {
    if (flashCol) app.day = flashCol.day;
    shown = single ? cols.filter((col) => col.day === app.day) : cols;
    if (shown.length === 0) shown = cols.slice(0, 1);
  } else {
    const want = cols.findIndex((col) => col.key === (flashCol?.key ?? cursor?.key));
    if (want >= 0 && (want < dayFirst || want >= dayFirst + perPage)) dayFirst = want;
    dayFirst = Math.max(0, Math.min(dayFirst, cols.length - perPage));
    shown = cols.slice(dayFirst, dayFirst + perPage);
  }
  if (menuKey && (app.mode === 'look' || !shown.some((col) => col.key === menuKey))) menuKey = null;

  const range = viewRange(s);
  geo = { from: range.from, to: range.to, ppm: ppmOf(cols.map((col) => col.step)) };
  const template = `${GUTTER}px repeat(${Math.max(1, shown.length)}, minmax(0, 1fr))`;

  // "Show it" from Check and save lands on a block: it is selected and its details open.
  if (flash && flashCol) {
    const start = flash.start ?? s.dayStart;
    const under = blocksOn(s, flashCol.personId, flashCol.day).find((block) => block.start <= start && endOf(block) > start);
    picked = under && app.mode === 'look' ? { ids: idsWith(s, flashCol, under), key: flashCol.key } : null;
  }
  // Details belong to Look, to blocks that still exist, in a column that is showing.
  if (picked) {
    const now = picked;
    const there = pickedBlocks(s);
    if (app.mode !== 'look' || !there || !shown.some((col) => col.key === now.key) || (there.length > 1 && app.visits !== 'grouped')) picked = null;
  }
  // The details of a support person belong to Look too, to time that is still there, beside a provider who is showing.
  if (team) {
    const now = team;
    // Opened from a strip in a day, they belong to Look. Opened from a name above the days, they stay in any mode.
    const shownId = now.about === 'support' ? now.providerId : now.supportId;
    const still = now.about === 'support' ? teamRows(s, now.providerId, now.day ?? undefined).some((row) => row.personId === now.supportId) : withChoices(s, now.supportId).some((one) => one.personId === now.providerId);
    if ((app.mode !== 'look' && now.day !== null) || picked || !cols.some((col) => col.personId === shownId) || !still) team = null;
  }
  const chosen = new Set(picked?.ids ?? []);

  const head = el('div', { class: 'sd-cv-head' }, el('span', { class: 'sd-cv-corner', 'aria-hidden': 'true' }), ...shown.map(headCell));
  head.style.gridTemplateColumns = template;
  const body = el('div', { class: 'sd-cv-body' }, gutter(geo));
  body.style.gridTemplateColumns = template;

  let flashed: HTMLElement | null = null;
  spans = [];
  for (const col of shown) {
    const node = column(s, geo, col.step, { 'data-key': col.key }, { personId: col.personId, day: col.day });
    for (const run of app.visits === 'grouped' ? runsOf(blocksOn(s, col.personId, col.day)) : blocksOn(s, col.personId, col.day).map((block) => ({ blocks: [block], from: 0, to: 0 }))) {
      const band = run.blocks.length > 1;
      let on = false;
      for (const block of run.blocks) {
        const one = blockEl(s, block, geo);
        if (band) one.classList.add('is-in');
        if (chosen.has(block.id)) {
          on = true;
          if (!band) one.classList.add('is-picked');
        }
        node.append(one);
        spans.push([block.start, endOf(block)]);
      }
      if (band) {
        const whole = bandEl(s, run, geo);
        if (on) whole.classList.add('is-picked');
        node.append(whole);
      }
    }
    // A provider's day carries a slim strip at its edge for each support person who is with them, in that person's colour.
    if (personOf(s, col.personId)?.kind !== 'support') {
      const beside = teamOf(s, col.personId, col.day);
      if (beside.length > 0) {
        const lanes = stripLanes(s, beside);
        node.classList.add('has-team');
        node.dataset['lanes'] = String(Math.min(3, lanes.size));
        for (const span of beside) {
          const who = personOf(s, span.personId);
          const on = team !== null && team.supportId === span.personId && team.providerId === col.personId && (team.day === null || team.day === col.day);
          const strip = el('span', { class: `sd-team sd-sw-${personColour(s, span.personId)} is-lane-${Math.min(2, lanes.get(span.personId) ?? 0)}${on ? ' is-picked' : ''}`, 'data-who': span.personId, title: `${who ? nameAndRole({ name: who.name, role: who.role.trim() }) : 'Support staff'}, ${clockRange(span.from, span.to)}` });
          put(strip, span.from, span.to, geo, 1);
          node.append(strip);
        }
      }
    }
    if (cursor?.key === col.key) node.append(cursorCell(col, cursor.minute));
    if (flash && flashCol?.key === col.key) {
      const start = flash.start ?? s.dayStart;
      const under = blocksOn(s, col.personId, col.day).find((block) => block.start <= start && endOf(block) > start);
      flashed = el('span', { class: 'sd-flash', 'aria-hidden': 'true' });
      put(flashed, under?.start ?? start, under ? endOf(under) : start + col.step, geo, 0);
      node.append(flashed);
      cursor = { key: col.key, minute: snapDown(start, col.step, s.dayStart) };
    }
    body.append(node);
  }

  // An empty week says so. In Look it offers the one thing to do next.
  let empty: HTMLElement | null = null;
  if (spans.length === 0 && cols.length > 0) {
    const whole = mode === 'person' && !single;
    // A support person's empty week says how to begin: with the fill button, or with the list of providers in Set up.
    const support = mode === 'person' && personOf(s, app.personId)?.kind === 'support';
    if (app.mode === 'look') {
      const add = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'empty-add' }, icon('plus', 16), whole ? 'Add time to this week' : 'Add time to this day');
      add.addEventListener('click', () => {
        if (support) chooseTool(firstTool(s, app.personId));
        switchMode('add');
        focusWeek();
      });
      empty = el('div', { class: 'sd-cv-empty' }, el('p', {}, support ? emptySupportSay(s, app.personId, whole, app.day) : whole ? 'Nothing is on this week yet.' : `Nothing is on ${dayName(app.day)} yet.`), add);
    } else {
      const finger = pointing() === 'touch';
      const say = app.mode === 'erase' ? 'There is nothing to clear here yet.' : support ? emptySupportAddSay(s, app.personId, finger) : finger ? 'Press and hold on a day, then drag down to add time.' : 'Drag down a day to add time.';
      empty = el('div', { class: 'sd-cv-empty' }, el('p', {}, say));
    }
  }

  // Only the grid of days takes the arrow keys. The headings, the tabs and the small menu above
  // it stay ordinary buttons, outside the part a screen reader hands the keys to.
  const who = mode === 'person' ? (personOf(s, app.personId)?.name ?? '') : dayName(app.day);
  const keys = app.mode === 'look' ? 'Arrow keys move. Enter shows the block you are on. No block changes while you look.' : app.mode === 'add' ? 'Arrow keys move, Space adds, Backspace clears.' : 'Arrow keys move, Space clears.';
  body.setAttribute('role', 'application');
  body.setAttribute('tabindex', '0');
  body.setAttribute('data-k', 'week');
  body.setAttribute('aria-label', `The week for ${who}. ${keys}`);
  host.setAttribute('tabindex', '-1');
  host.classList.toggle('is-single', single);
  host.dataset['mode'] = app.mode;
  const openMenu = colOf(menuKey);
  const menu = openMenu ? menuEl(openMenu) : null;
  const scroller = el('div', { class: 'sd-cv-scroll' }, body);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const view = el('div', { class: 'sd-cv-frame' }, scroller, empty);
  fill(host, topRow(), teamLine(s), head, view, menu, el('div', { class: 'sd-tip', hidden: true }));
  drawPicked();
  if (menu && menuKey) placeMenu(menu, menuKey);

  fitFrame();
  const key = `${app.opened}|${mode}|${mode === 'person' ? app.personId : app.day}`;
  // A little above the row, so the hour's label at the side is whole.
  if (key !== topKey || wantTop) scroller.scrollTop = Math.max(0, Math.round((firstMinute(s) - geo.from) * geo.ppm) - 10);
  else if (keptMinute !== null) scroller.scrollTop = Math.round((keptMinute - geo.from) * geo.ppm);
  topKey = key;
  wantTop = false;
  seePicked();
  markCues();

  if (flashed) {
    app.flash = null;
    const mark = flashed;
    // The block is brought to the middle of the frame. The page itself keeps still.
    scroller.scrollTop = Math.max(0, Math.round(mark.offsetTop + mark.offsetHeight / 2 - scroller.clientHeight / 2));
    markCues();
    window.setTimeout(() => mark.remove(), 2600);
  }
}

/** True when the width now fits a different number of columns than were drawn. */
function layoutChanged(): boolean {
  const fit = layout(cols.length, mode);
  return `${mode}:${fit.single}:${fit.perPage}` !== layoutKey;
}

// ---------- The small note that names a block ----------

function showTip(block: HTMLElement): void {
  const s = schedule();
  const tip = host.querySelector<HTMLElement>('.sd-tip');
  const found = s?.blocks.find((item) => item.id === block.dataset['id']);
  if (!s || !tip || !found) return;
  tip.textContent = blockSay(s, found);
  tip.hidden = false;
  const frame = host.getBoundingClientRect();
  const at = block.getBoundingClientRect();
  const left = Math.min(Math.max(0, at.left - frame.left), Math.max(0, host.clientWidth - tip.offsetWidth));
  const above = at.top - frame.top - tip.offsetHeight - 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${above >= 0 && at.top - tip.offsetHeight - 6 > 0 ? above : at.bottom - frame.top + 6}px`;
}

function hideTip(): void {
  const tip = host.querySelector<HTMLElement>('.sd-tip');
  if (tip) tip.hidden = true;
}

// ---------- Selecting a block in Look ----------

function blockAt(s: Schedule, col: Column, minute: number): Block | undefined {
  return blocksOn(s, col.personId, col.day).find((block) => block.start < minute + col.step && endOf(block) > minute);
}

/** Selects a block, or its band, and opens the details. Nothing in the schedule changes. */
function pick(col: Column, block: Block): void {
  const s = schedule();
  if (!s) return;
  picked = { ids: idsWith(s, col, block), key: col.key };
  team = null;
  pickedAt = performance.now();
  cursor = { key: col.key, minute: snapDown(block.start, col.step, s.dayStart) };
  hideTip();
  redraw();
  focusWeek();
  const blocks = pickedBlocks(s);
  if (blocks) announce(`${pickedSay(s, blocks)} Its details are open. Tab goes to Add more like this and Remove.`);
  // On a phone the sheet took its height from the frame, which is true only with the page set to the strip.
  sitWeek();
}

/** Shows who a strip or a name stands for, and when they are with the provider. Nothing in the schedule changes. */
function pickTeam(supportId: string, providerId: string, day: Day | null, about: Team['about'] = 'support'): void {
  const s = schedule();
  // A strip in a day is pressed in Look only: in Add and Erase a press there is on the day. A name above the days opens in any mode.
  if (!s || (app.mode !== 'look' && day !== null)) return;
  team = { supportId, providerId, day, about };
  picked = null;
  pickedAt = performance.now();
  hideTip();
  redraw();
  const facts = teamFacts(s);
  if (facts) announce(`${teamSay(facts)} Their details are open.`);
  sitWeek();
}

function closeDetail(focus = false): void {
  if (!picked && !team) return;
  picked = null;
  team = null;
  redraw();
  if (focus) focusWeek();
}

/** Closes the details without drawing the week again, so that the click that closed them still lands. */
function dropDetail(): void {
  picked = null;
  team = null;
  for (const node of host.querySelectorAll('.is-picked')) node.classList.remove('is-picked');
  for (const node of host.querySelectorAll('.sd-teamchip[aria-pressed="true"]')) node.setAttribute('aria-pressed', 'false');
  drawPicked();
  fitFrame();
  markCues();
}

/**
 * With a finger the Undo button is off the screen, so the line under the week offers it after a
 * change. These are the words of the line it goes with. Call it once the line is written.
 */
let undoLine = '';
export function offerUndo(): void {
  undoLine = pointing() === 'touch' ? app.status : '';
}
export function undoOffered(): string {
  return undoLine;
}

/**
 * The line under the week after a fill is an answer: it is drawn so it is easy to see, it carries
 * Undo when something was added, and the reasons for what was left out wait behind "Why". These
 * are the words of the line it goes with. Call it once the line is written.
 */
let answer = { line: '', why: '', undo: false, open: false };
export function offerAnswer(why: string, undoable: boolean): void {
  answer = { line: app.status, why, undo: undoable, open: false };
}
export function answerOffered(): { line: string; why: string; undo: boolean; open: boolean } {
  return answer;
}
/**
 * Brings the answer to a fill into view when it sits below the window or under the pinned bar, as
 * it can on a phone. It waits until the week has been fitted, and moves nothing when the line is
 * already in view.
 */
export function showAnswer(): void {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const line = document.getElementById('sd-status');
      if (!line || !line.classList.contains('is-answer')) return;
      const foot = document.getElementById('sd-foot');
      const low = foot ? foot.getBoundingClientRect().top : window.innerHeight;
      const box = line.getBoundingClientRect();
      if (box.bottom > low || box.top < 0) line.scrollIntoView({ block: 'nearest' });
    }),
  );
}
/** Shows or hides the reasons behind "Why". */
export function flipWhy(): void {
  answer.open = !answer.open;
}

/** Switches to Add with the kind and the place of the selected block already chosen. */
function addMoreLike(): void {
  const s = schedule();
  const first = s ? pickedBlocks(s)?.[0] : undefined;
  if (!s || !first) return;
  if (mode === 'day') showPerson(first.personId);
  const unpaid = first.what.kind === 'activity' && activityOf(s, first.what.activityId)?.paid === false;
  // Unpaid time has no place. The place chosen before it stays set aside for the next paid kind.
  if (!(unpaid && first.where.kind === 'none')) chooseWhere(first.where);
  chooseTool(first.what);
  picked = null;
  switchMode('add');
  focusWeek();
}

// ---------- Adding and clearing ----------

function minuteAt(body: HTMLElement, y: number): number {
  const minute = geo.from + (y - body.getBoundingClientRect().top) / geo.ppm;
  return Math.min(geo.to - 1, Math.max(geo.from, minute));
}

function rangeOf(col: Column, a: number, b: number): { from: number; to: number } {
  const s = schedule();
  const range = snapRange(a, b, col.step, s?.dayStart ?? geo.from);
  return { from: Math.max(geo.from, range.from), to: Math.min(geo.to, range.to) };
}

/** Adds or clears a stretch, and says what happened. In Look it does nothing at all. */
function apply(col: Column, from: number, to: number, forceClear = false): boolean {
  const s = schedule();
  if (!s || to <= from || app.mode === 'look') return false;
  const clearing = forceClear || app.mode === 'erase';
  const movedPerson = mode === 'day' && app.personId !== col.personId;
  if (movedPerson) showPerson(col.personId, true);
  const tool = toolFor(s, col.personId, app.tool);
  const where = app.where;
  const request = { personId: col.personId, day: col.day, from, to };
  cursor = { key: col.key, minute: snapDown(from, col.step, s.dayStart) };
  if (!clearing && tool.kind === 'none') {
    app.status = 'There is no kind of time to add yet. Add one in Set up.';
    emit('look');
    return false;
  }
  const before = blocksOn(s, col.personId, col.day);
  const next = clearing || tool.kind === 'none' ? erase(s, request) : paint(s, { ...request, what: tool, where });
  if (next === s) {
    app.status = clearing ? 'There is nothing to clear there.' : 'That is already there.';
    announce(app.status);
    emit('look');
    return false;
  }
  let reach = to;
  if (clearing || tool.kind === 'none') {
    app.status = `Cleared ${dayName(col.day)}, ${clockRange(from, to)}. Undo brings it back.`;
    app.notice = null;
  } else {
    // What the new time took the place of: the blocks that were there and are not there now.
    const now = blocksOn(next, col.personId, col.day);
    const after = new Set(now.map(sameAs));
    const was = new Set(before.map(sameAs));
    const piece = (of: Schedule) => (block: Block): Piece => ({ name: factsOf(of, block).name, kind: `${JSON.stringify(block.what)}|${JSON.stringify(block.where)}`, start: block.start, end: endOf(block) });
    // A block that was only partly covered is named with the time that went, such as "20 min of Admin time".
    const gone = replacedSay(before.filter((block) => !after.has(sameAs(block))).map(piece(s)), now.filter((block) => !was.has(sameAs(block))).map(piece(next)));
    let added: string;
    if (tool.kind === 'visit') {
      const type = visitTypeOf(next, tool.visitTypeId);
      const placed = blocksOn(next, col.personId, col.day).filter((block) => block.what.kind === 'visit' && block.what.visitTypeId === tool.visitTypeId && block.start >= from && block.start < Math.max(to, from + 1));
      const last = placed[placed.length - 1];
      reach = last ? endOf(last) : to;
      added = `${placed.length} ${type?.name ?? 'this type'} ${placed.length === 1 ? 'appointment' : 'appointments'}`;
    } else if (tool.kind === 'with') {
      added = `Time with ${personOf(next, tool.personId)?.name ?? 'a provider'} (${lengthText(to - from)})`;
    } else {
      added = `${activityOf(next, tool.activityId)?.name ?? 'Time'} (${lengthText(to - from)})`;
    }
    const when = `${dayName(col.day)}, ${clockRange(from, reach)}`;
    app.status = `${gone ? `Replaced ${gone} with ${added} on ${when}. Undo brings it back.` : `${added} on ${when}.`}${offAfter(next, col.personId, col.day, from, reach)}`;
  }
  if (!clearing && tool.kind !== 'none') {
    app.notice = null;
    if (where.kind === 'site' && where.roomId !== null) {
      const roomId = where.roomId;
      const taken = allClashes(next).some((clash) => clash.day === col.day && clash.roomId === roomId && clash.personIds.includes(col.personId) && clash.from < reach && clash.to > from);
      if (taken) app.notice = { personId: col.personId, day: col.day, from, to: reach, siteId: where.siteId, roomId, free: freeRooms(next, col.day, where.siteId, from, reach, col.personId).filter((room) => room.id !== roomId) };
    }
  }
  announce(app.status);
  offerUndo();
  commit(next);
  return true;
}

/** A block as its time, its kind and its place, to tell whether the same thing is there before and after. */
function sameAs(block: Block): string {
  return `${block.start}|${block.minutes}|${JSON.stringify(block.what)}|${JSON.stringify(block.where)}`;
}

/** The names of some blocks, each once, for a sentence: "New patient", "Lunch and Standard", "4 blocks". */
function namesOf(s: Schedule, blocks: readonly Block[]): string {
  const names = [...new Set(blocks.map((block) => factsOf(s, block).name))];
  if (names.length === 0) return '';
  return names.length <= 2 ? names.join(' and ') : `${blocks.length} blocks`;
}

/**
 * What is under a stretch that adding this kind of time there would replace, by name. Empty when
 * the stretch is free, or when the very same thing is there already.
 */
function underSay(s: Schedule, col: Column, from: number, to: number, tool: Tool, exact: boolean): { replaces: string; same: boolean } {
  const hit = blocksOn(s, col.personId, col.day).filter((block) => block.start < to && endOf(block) > from);
  const what = JSON.stringify(tool);
  const where = JSON.stringify(app.where);
  const alike = (block: Block): boolean => JSON.stringify(block.what) === what && JSON.stringify(block.where) === where;
  const same = exact && hit.length > 0 && hit.every((block) => alike(block) && block.start >= from && endOf(block) <= to) && hit.reduce((sum, block) => sum + block.minutes, 0) === to - from;
  return { replaces: same ? '' : namesOf(s, hit.filter((block) => !alike(block))), same };
}

/** What a stretch would become, for the label on the preview: the words and the colour. */
function previewOf(col: Column, from: number, to: number): { say: string; colour?: Colour; tile?: number } {
  const s = schedule();
  if (!s) return { say: '' };
  const tool = toolFor(s, col.personId, app.tool);
  if (app.mode === 'erase' || tool.kind === 'none') return { say: `Clear ${clockRange(from, to)}` };
  if (tool.kind === 'visit') {
    const type = visitTypeOf(s, tool.visitTypeId);
    const minutes = type?.minutes ?? col.step;
    const count = Math.max(1, Math.floor((to - from) / minutes));
    const under = underSay(s, col, from, from + count * minutes, tool, false).replaces;
    return { say: `${count} ${type?.name ?? ''}${under ? ` in place of ${under}` : ''}, ${clockRange(from, from + count * minutes)}`, ...(type ? { colour: type.colour } : {}), tile: minutes };
  }
  if (tool.kind === 'with') return { say: `With ${personOf(s, tool.personId)?.name ?? 'a provider'}, ${clockRange(from, to)}`, colour: personColour(s, tool.personId) };
  const activity = activityOf(s, tool.activityId);
  const under = underSay(s, col, from, to, tool, false).replaces;
  return { say: `${activity?.name ?? ''}${under ? ` in place of ${under}` : ''}, ${clockRange(from, to)}`, ...(activity ? { colour: activity.colour } : {}) };
}

function startPreview(now: Drag): void {
  const first = previewOf(now.col, now.a, now.a);
  const preview = el('div', { class: `sd-preview${first.colour ? ` sd-sw-${first.colour}` : ' is-erase'}`, 'aria-hidden': 'true' }, el('span', {}));
  if (first.tile) {
    preview.classList.add('is-tiled');
    preview.style.setProperty('--sd-tile', `${Math.round(first.tile * geo.ppm)}px`);
  }
  clearHover();
  now.preview = preview;
  now.body.append(preview);
  now.locked = true;
  host.classList.add('is-painting');
  try {
    host.setPointerCapture(now.pointerId);
  } catch {
    // The pointer is already gone; the stretch is done when it lifts.
  }
  movePreview(now);
}

function movePreview(now: Drag): void {
  if (!now.preview) return;
  const range = rangeOf(now.col, now.a, now.b);
  put(now.preview, range.from, range.to, geo, 0);
  const say = now.preview.firstElementChild;
  if (say) say.textContent = `${previewOf(now.col, range.from, range.to).say}${offTail(now.col, range.from, range.to)}`;
  sayOff(now.col, range.from, range.to);
}

/** In Add, the few words that end a label when the stretch is outside the person's working hours. */
function offTail(col: Column, from: number, to: number): string {
  const s = schedule();
  if (!s || app.mode !== 'add') return '';
  const short = offShort(offKind(s, col.personId, col.day, from, to));
  return short ? `, ${short}` : '';
}

/** In Add, the sentence beside the switch says when the stretch under the pointer is outside working hours. */
function sayOff(col: Column, from: number, to: number): void {
  const s = schedule();
  sayBeside(s && app.mode === 'add' ? offSay(s, col.personId, col.day, from, to) : '');
}

/** While the pointer is dragged to the upper or the lower edge of the frame, the times move with it. */
function follow(now: Drag): void {
  const scroller = scrollerOf();
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  // A press that begins near an edge has not asked for more of the day. Moving toward that edge has.
  const up = now.y < bounds.top + 36 && now.y < now.y0 - 4;
  const down = now.y > bounds.bottom - 36 && now.y > now.y0 + 4;
  const pull = up ? -12 : down ? 12 : 0;
  window.cancelAnimationFrame(now.frame);
  if (pull === 0) return;
  now.frame = window.requestAnimationFrame(() => {
    if (drag !== now) return;
    scroller.scrollBy(0, pull);
    now.b = minuteAt(now.body, now.y);
    movePreview(now);
    follow(now);
  });
}

function endDrag(): void {
  if (!drag) return;
  window.clearTimeout(drag.timer);
  window.cancelAnimationFrame(drag.frame);
  drag.preview?.remove();
  try {
    host.releasePointerCapture(drag.pointerId);
  } catch {
    // Nothing was held.
  }
  host.classList.remove('is-painting');
  drag = null;
  sayBeside('');
}

// ---------- Before the press: what a click here would do ----------

function clearHover(): void {
  hover?.remove();
  hover = null;
  if (!drag) sayBeside('');
}

/** The stretch a click at this minute would add or clear, or nothing when a click would do nothing. */
function hoverRange(s: Schedule, col: Column, minute: number): { from: number; to: number; say: string; colour?: Colour; over?: boolean } | null {
  const step = rangeOf(col, minute, minute);
  if (app.mode === 'erase') {
    const hit = blocksOn(s, col.personId, col.day).filter((block) => block.start < step.to && endOf(block) > step.from);
    if (hit.length === 0) return null;
    // A visit is cleared whole. Other time is cleared one row of the grid at a time.
    let from = step.from;
    let to = step.to;
    for (const block of hit) {
      if (block.what.kind !== 'visit') continue;
      from = Math.min(from, block.start);
      to = Math.max(to, endOf(block));
    }
    return { from, to, say: `Clear ${clockRange(from, to)}` };
  }
  const tool = toolFor(s, col.personId, app.tool);
  if (tool.kind === 'none') return null;
  if (tool.kind === 'visit') {
    const type = visitTypeOf(s, tool.visitTypeId);
    if (!type) return null;
    const end = step.from + type.minutes;
    const under = underSay(s, col, step.from, end, tool, true);
    if (under.same) return { from: step.from, to: end, say: `${type.name} is already here`, colour: type.colour, over: true };
    return { from: step.from, to: end, say: `${type.name}${under.replaces ? ` in place of ${under.replaces}` : ''}, ${clockRange(step.from, end)}`, colour: type.colour, over: under.replaces !== '' };
  }
  if (tool.kind === 'with') return { from: step.from, to: step.to, say: `With ${personOf(s, tool.personId)?.name ?? 'a provider'}, ${clockRange(step.from, step.to)}`, colour: personColour(s, tool.personId), over: false };
  const activity = activityOf(s, tool.activityId);
  if (!activity) return null;
  const under = underSay(s, col, step.from, step.to, tool, false);
  return { from: step.from, to: step.to, say: `${activity.name}${under.replaces ? ` in place of ${under.replaces}` : ''}, ${clockRange(step.from, step.to)}`, colour: activity.colour, over: under.replaces !== '' };
}

function onHover(event: PointerEvent): void {
  const s = schedule();
  const target = event.target as Element;
  const block = target.closest<HTMLElement>('.sd-block');
  if (app.mode === 'look') {
    if (block) showTip(block);
    else hideTip();
    return;
  }
  hideTip();
  const body = target.closest<HTMLElement>('.sd-col');
  const col = colOf(body?.dataset['key']);
  const range = s && body && col ? hoverRange(s, col, minuteAt(body, event.clientY)) : null;
  if (!body || !range) {
    clearHover();
    return;
  }
  if (!hover || hover.parentElement !== body) {
    clearHover();
    hover = el('div', { 'aria-hidden': 'true' }, el('span', {}));
    body.append(hover);
  }
  // Over a block that is already there the faint picture is filled in, so its words are not read through the block's own.
  hover.className = `sd-preview is-hover${range.colour ? ` sd-sw-${range.colour}` : ' is-erase'}${range.over ? ' is-over' : ''}`;
  put(hover, range.from, range.to, geo, 0);
  const say = hover.firstElementChild;
  if (say) say.textContent = `${range.say}${col ? offTail(col, range.from, range.to) : ''}`;
  // The words grow to their length, past the column if need be. Near the right edge of the frame they grow to the left.
  const edge = scrollerOf()?.getBoundingClientRect().right;
  if (say && edge !== undefined && say.getBoundingClientRect().right > edge - 2) hover.classList.add('is-end');
  if (col) sayOff(col, range.from, range.to);
}

// ---------- The pointer ----------

function onDown(event: PointerEvent): void {
  const target = event.target as Element;
  if (event.button !== 0 || drag || target.closest('.sd-cv-head, .sd-menu, .sd-daytabs, .sd-pager, .sd-teamline, .sd-cv-empty')) return;
  const body = target.closest<HTMLElement>('.sd-col');
  const col = colOf(body?.dataset['key']);
  if (!body || !col) return;
  hideTip();
  clearHover();
  if (menuKey) {
    menuKey = null;
    host.querySelector('.sd-menu')?.remove();
  }
  // In Look the press is only remembered. Nothing is held and nothing is drawn, so a finger still scrolls.
  if (app.mode === 'look') {
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, touch: event.pointerType === 'touch' };
    return;
  }
  const minute = minuteAt(body, event.clientY);
  const now: Drag = { pointerId: event.pointerId, col, body, a: minute, b: minute, preview: null, locked: false, timer: 0, x: event.clientX, y: event.clientY, y0: event.clientY, frame: 0 };
  drag = now;
  if (event.pointerType === 'touch') {
    now.timer = window.setTimeout(() => {
      if (drag === now) startPreview(now);
    }, 320);
  } else {
    startPreview(now);
  }
}

function onMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) {
    if (!drag && event.pointerType === 'mouse' && event.buttons === 0) onHover(event);
    return;
  }
  if (!drag.locked) {
    // A finger that moves before the wait is over is scrolling, so nothing is added or cleared.
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) endDrag();
    return;
  }
  drag.y = event.clientY;
  drag.b = minuteAt(drag.body, event.clientY);
  movePreview(drag);
  follow(drag);
}

/** The end of a press in Look: a click shows a block or moves the cursor. A drag and a press and hold do nothing. */
function lookUp(event: PointerEvent, was: Press): void {
  const s = schedule();
  const target = event.target as Element;
  const body = target.closest<HTMLElement>('.sd-col');
  const col = colOf(body?.dataset['key']);
  if (!s || !body || !col) return;
  const node = target.closest<HTMLElement>('.sd-block');
  const on: Under = node ? 'block' : 'empty';
  const moved = Math.hypot(event.clientX - was.x, event.clientY - was.y) > 6;
  const held = was.touch && event.timeStamp - was.at >= HOLD_MS;
  const what = does('look', held ? { by: 'hold', on } : moved ? { by: 'drag', on } : { by: 'click', on });
  // On a phone the sheet takes room from the week as it opens, so the week moves under the finger.
  // The second tap of a double tap is let go, and the details stay on the block that was tapped.
  if (was.touch && performance.now() - pickedAt < SETTLE_MS) return;
  // A click on a strip at the edge of a provider's day shows who it stands for.
  const strip = target.closest<HTMLElement>('.sd-team');
  if (strip && !moved && !held) {
    pickTeam(strip.dataset['who'] ?? '', col.personId, col.day);
    focusWeek();
    return;
  }
  if (what === 'details') {
    const block = s.blocks.find((item) => item.id === node?.dataset['id']);
    if (block) pick(col, block);
  } else if (what === 'cursor') {
    moveCursor(col.key, minuteAt(body, event.clientY));
    focusWeek();
  }
}

function onUp(event: PointerEvent): void {
  if (press && event.pointerId === press.pointerId) {
    const was = press;
    press = null;
    if (app.mode === 'look') lookUp(event, was);
    return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { col, a, b } = drag;
  endDrag();
  const range = rangeOf(col, a, b);
  apply(col, range.from, range.to);
}

// ---------- The keyboard ----------

function sayCursor(): void {
  const s = schedule();
  const col = colOf(cursor?.key);
  if (!s || !col || !cursor) return;
  const minute = cursor.minute;
  const under = blockAt(s, col, minute);
  const where = mode === 'day' ? `${col.title}, ${clock(minute)}` : `${col.title} ${clock(minute)}`;
  const off = offShort(offKind(s, col.personId, col.day, minute, minute + col.step));
  announce(`${where}. ${under ? blockSay(s, under) : 'Empty.'}${off ? ` ${off.charAt(0).toUpperCase()}${off.slice(1)}.` : ''}`);
}

function moveCursor(toKey: string, minute: number): void {
  const s = schedule();
  const col = colOf(toKey);
  if (!s || !col) return;
  const top = snapUp(geo.from, col.step, s.dayStart);
  const snapped = Math.min(Math.max(top, snapDown(minute, col.step, s.dayStart)), Math.max(top, snapDown(geo.to - 1, col.step, s.dayStart)));
  cursor = { key: col.key, minute: snapped };
  // The details belong to the block that was selected. When the cursor leaves, they close.
  picked = null;
  if (mode === 'person' && single && app.day !== col.day) app.day = col.day;
  redraw();
  const cell = host.querySelector<HTMLElement>('.sd-cursor');
  cell?.scrollIntoView({ block: 'nearest' });
  const block = [...host.querySelectorAll<HTMLElement>(`.sd-col[data-key="${CSS.escape(col.key)}"] .sd-block`)].find((node) => {
    const top = parseFloat(node.style.top);
    const at = Math.round((snapped - geo.from) * geo.ppm);
    return top <= at + 1 && top + parseFloat(node.style.height) > at + 1;
  });
  if (block) showTip(block);
  sayCursor();
}

function onKey(event: KeyboardEvent): void {
  const s = schedule();
  const onWeek = event.target instanceof HTMLElement && event.target.classList.contains('sd-cv-body');
  if (!onWeek || !s || cols.length === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Escape' && drag) {
    endDrag();
    return;
  }
  const chosen = cursor && colOf(cursor.key) ? cursor : null;
  const startKey = chosen?.key ?? (shown[0] ?? cols[0])?.key ?? '';
  const at = cols.findIndex((col) => col.key === startKey);
  const col = cols[at];
  if (!col) return;
  const step = col.step;
  // With no cell chosen yet the keys start at the first line of the grid in view, never between two lines.
  const start = chosen ?? { key: col.key, minute: keyStart(geo.from + (scrollerOf()?.scrollTop ?? 0) / geo.ppm, geo.from, geo.to, step, s.dayStart) };
  const tool = toolFor(s, col.personId, app.tool);
  const reach = tool.kind === 'visit' ? Math.max(step, Math.ceil((visitTypeOf(s, tool.visitTypeId)?.minutes ?? step) / step) * step) : step;
  const here = blockAt(s, col, start.minute);
  const on: Under = here ? 'block' : 'empty';
  const act = (what: Does, from: number): void => {
    if (what === 'add') apply(col, from, from + step);
    else if (what === 'clear') apply(col, from, from + step, true);
  };
  let handled = true;
  switch (event.key) {
    case 'ArrowDown': {
      const what = does(app.mode, { by: 'arrow', shift: event.shiftKey, on });
      act(what, start.minute);
      moveCursor(col.key, start.minute + (what === 'add' ? reach : step));
      break;
    }
    case 'ArrowUp': {
      const what = does(app.mode, { by: 'arrow', shift: event.shiftKey, on });
      if (what === 'cursor') moveCursor(col.key, start.minute - step);
      else {
        const up = Math.max(snapUp(geo.from, step, s.dayStart), start.minute - (what === 'add' ? reach : step));
        act(what, up);
        moveCursor(col.key, up);
      }
      break;
    }
    case 'ArrowLeft':
      moveCursor(cols[Math.max(0, at - 1)]?.key ?? col.key, start.minute);
      break;
    case 'ArrowRight':
      moveCursor(cols[Math.min(cols.length - 1, at + 1)]?.key ?? col.key, start.minute);
      break;
    case 'Home':
      moveCursor(col.key, geo.from);
      break;
    case 'End':
      moveCursor(col.key, geo.to);
      break;
    case 'PageUp':
      moveCursor(col.key, start.minute - 60);
      break;
    case 'PageDown':
      moveCursor(col.key, start.minute + 60);
      break;
    case ' ':
    case 'Enter': {
      const what = does(app.mode, { by: 'enter', on });
      if (what === 'details' && here) pick(col, here);
      else if (what === 'say-empty') {
        app.status = 'Nothing here. Choose Add to add time.';
        announce(app.status);
        emit('look');
      } else {
        act(what, start.minute);
        moveCursor(col.key, start.minute);
      }
      break;
    }
    case 'Backspace':
    case 'Delete': {
      const what = does(app.mode, { by: 'delete', on });
      if (what === 'nothing') announce('Nothing is removed while you look. Choose Erase to clear time.');
      else {
        act(what, start.minute);
        moveCursor(col.key, start.minute);
      }
      break;
    }
    default:
      handled = false;
  }
  if (handled) event.preventDefault();
}

// ---------- Headings, tabs, pages, the small menu and the details ----------

function closeMenu(focus = false): void {
  if (!menuKey) return;
  const key = menuKey;
  menuKey = null;
  redraw();
  if (focus) host.querySelector<HTMLElement>(`[data-menu="${CSS.escape(key)}"]`)?.focus();
}

/** Closes the small menu or the details when one is open, and says whether it did. */
export function escapeWeek(): boolean {
  if (menuKey) {
    closeMenu(true);
    return true;
  }
  if (picked || team) {
    closeDetail(true);
    return true;
  }
  return false;
}

function onClick(event: MouseEvent): void {
  const s = schedule();
  const target = event.target as Element;
  if (!s) return;
  const chip = target.closest<HTMLElement>('[data-team]');
  if (chip) {
    const id = chip.dataset['team'] ?? '';
    const about: Team['about'] = chip.dataset['about'] === 'provider' ? 'provider' : 'support';
    const supportId = about === 'support' ? id : app.personId;
    const providerId = about === 'support' ? app.personId : id;
    if (team && team.day === null && team.about === about && team.supportId === supportId && team.providerId === providerId) closeDetail();
    else pickTeam(supportId, providerId, null, about);
    return;
  }
  const tab = target.closest<HTMLElement>('[data-tab]');
  if (tab) {
    app.day = Number(tab.dataset['tab']) as Day;
    team = null;
    picked = null;
    app.status = '';
    emit('look');
    return;
  }
  const page = target.closest<HTMLElement>('[data-page]');
  if (page) {
    dayFirst = Math.max(0, Math.min(cols.length - perPage, dayFirst + Number(page.dataset['page']) * perPage));
    cursor = null;
    picked = null;
    team = null;
    redraw();
    return;
  }
  const open = target.closest<HTMLElement>('[data-open]');
  if (open) {
    menuKey = null;
    picked = null;
    team = null;
    showPerson(open.dataset['open'] ?? '');
    app.view = 'person';
    app.status = '';
    emit('look');
    return;
  }
  const more = target.closest<HTMLElement>('[data-menu]');
  if (more) {
    menuKey = menuKey === more.dataset['menu'] ? null : (more.dataset['menu'] ?? null);
    picked = null;
    redraw();
    host.querySelector<HTMLElement>('.sd-menu input, .sd-menu button')?.focus();
    return;
  }
  const act = target.closest<HTMLElement>('.sd-menu [data-act]');
  const col = colOf(menuKey);
  if (!act || !col) return;
  if (act.dataset['act'] === 'fill-day') {
    menuKey = null;
    fillNow(act.dataset['fill'] ?? '', col.day);
    return;
  }
  if (act.dataset['act'] === 'copy') {
    const days = [...host.querySelectorAll<HTMLInputElement>('.sd-menu input:checked')].map((box) => Number(box.value) as Day);
    const next = copyDay(s, col.personId, col.day, days);
    menuKey = null;
    app.status = `Copied ${dayName(col.day)} to ${days.map((day) => dayName(day)).join(', ')}. Undo brings it back.`;
    announce(app.status);
    offerUndo();
    if (!commit(next)) redraw();
  } else {
    const next = clearDay(s, col.personId, col.day);
    menuKey = null;
    app.status = next === s ? `${dayName(col.day)} is already empty.` : `Cleared ${dayName(col.day)}. Undo brings it back.`;
    announce(app.status);
    if (next !== s) offerUndo();
    if (!commit(next)) emit('look');
  }
}

/** Sets the week up once: the pointer, the keys, and a watch on the width and the height. */
export function initWeek(draw: () => void): void {
  host = byId('sd-canvas');
  redraw = draw;
  cues = { above: cueEl('above'), below: cueEl('below') };
  byId('sd-under').prepend(cues.above);
  byId('sd-under').append(cues.below);
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', () => {
    press = null;
    endDrag();
  });
  host.addEventListener('pointerleave', () => {
    hideTip();
    clearHover();
  });
  host.addEventListener('touchmove', (event) => {
    if (drag?.locked && event.cancelable) event.preventDefault();
  }, { passive: false });
  host.addEventListener('contextmenu', (event) => {
    if (drag) event.preventDefault();
  });
  host.addEventListener('keydown', onKey);
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || (!menuKey && !picked && !team)) return;
    event.stopPropagation();
    if (menuKey) closeMenu(true);
    else closeDetail(true);
  });
  host.addEventListener('click', onClick);
  host.addEventListener('focusout', hideTip);
  // Focus sent to the frame of the week goes on to the grid of days, which is the part that takes the keys.
  host.addEventListener('focus', focusWeek);
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element;
    if (menuKey && !target.closest('.sd-menu, [data-menu]')) closeMenu();
  });
  // A click away from the week closes the details, once that click has done its own work.
  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    if ((picked || team) && performance.now() - pickedAt > SETTLE_MS && !target.closest('.sd-detail, .sd-col, .sd-cue, .sd-teamline')) dropDetail();
  });
  window.addEventListener('resize', () => {
    if (app.step !== 3 || host.hidden) return;
    drawPicked();
    fitFrame();
    markCues();
  });
  if (typeof ResizeObserver === 'function') {
    // The fit waits for the next frame: it changes the height of the very thing being watched.
    let queued = false;
    new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        if (drag || app.step !== 3 || (app.view !== 'person' && app.view !== 'day')) return;
        if (layoutChanged()) redraw();
        else {
          fitFrame();
          markCues();
        }
      });
    }).observe(host);
  }
  // The ring around the whole week is for the keyboard. After a press with a mouse or a finger the week shows none, until a key is pressed.
  const root = byId('sd');
  document.addEventListener('pointerdown', () => root.classList.add('is-pointed'), true);
  document.addEventListener('keydown', () => root.classList.remove('is-pointed'), true);
}

/** Forgets the cursor, the selection and any open menu, for when the view or the person changes. */
export function resetWeek(): void {
  cursor = null;
  menuKey = null;
  picked = null;
  team = null;
  dayFirst = 0;
}
