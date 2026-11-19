// Drawing a day from minutes: the hour labels down the side, the grid lines, and the blocks.
// The Person, Day and Rooms views and the printed pages all draw with these few functions.
// A block's place on the page is worked out from its minutes and set through element.style.
import { allClashes, clock, clockRange, endOf, factsOf, isDayOff, offHours, personOf, roomOf } from './engine/index';
import type { Block, Day, Schedule, Step } from './engine/index';
import { el } from './dom';
import { runSay } from './group';
import type { Run } from './group';

/** How a stretch of minutes becomes a stretch of the page. */
export interface Geo {
  /** The first minute drawn. */
  from: number;
  /** The last minute drawn. */
  to: number;
  /** Pixels for one minute. */
  ppm: number;
  /** True on a printed page, where places are set as a share of the height and not in pixels. */
  share?: boolean;
}

/** A grid row is this many pixels tall on screen, whatever the grid. */
export const ROW = 24;

const ranges = new WeakMap<Schedule, { from: number; to: number }>();

/**
 * The minutes to draw: the hours the schedule shows, made wider by whole hours when a block sits
 * outside them, so that nothing painted is ever out of sight.
 */
export function viewRange(s: Schedule): { from: number; to: number } {
  const known = ranges.get(s);
  if (known) return known;
  let from = s.dayStart;
  let to = s.dayEnd;
  for (const block of s.blocks) {
    if (block.start < from) from = Math.min(from, Math.floor(block.start / 60) * 60);
    if (endOf(block) > to) to = Math.max(to, Math.ceil(endOf(block) / 60) * 60);
  }
  const range = { from, to };
  ranges.set(s, range);
  return range;
}

/** Pixels for a minute, so that one row of the finest grid among these people is one ROW tall. */
export function ppmOf(steps: readonly Step[]): number {
  return ROW / (steps.includes(15) ? 15 : 20);
}

/** Puts an element at a stretch of minutes inside its column. */
export function put(node: HTMLElement, from: number, to: number, geo: Geo, inset = 1): void {
  if (geo.share) {
    const whole = geo.to - geo.from;
    node.style.top = `${((from - geo.from) / whole) * 100}%`;
    node.style.height = `${((to - from) / whole) * 100}%`;
    return;
  }
  node.style.top = `${Math.round((from - geo.from) * geo.ppm) + inset}px`;
  node.style.height = `${Math.max(4, Math.round((to - from) * geo.ppm) - inset * 2)}px`;
}

/** "8 am", "12 pm": an hour for the side of the grid. */
function hourText(minute: number): string {
  return clock(minute).replace(':00', '');
}

/** The hour labels down the side. */
export function gutter(geo: Geo): HTMLElement {
  const side = el('div', { class: 'sd-gutter', 'aria-hidden': 'true' });
  if (!geo.share) side.style.height = `${Math.round((geo.to - geo.from) * geo.ppm)}px`;
  for (let minute = Math.ceil(geo.from / 60) * 60; minute <= geo.to; minute += 60) {
    const label = el('span', { class: 'sd-hour' }, hourText(minute));
    label.style.top = geo.share ? `${((minute - geo.from) / (geo.to - geo.from)) * 100}%` : `${Math.round((minute - geo.from) * geo.ppm)}px`;
    side.append(label);
  }
  return side;
}

/**
 * An empty column for one day: its height, its grid lines at the person's step counted from the
 * first minute the schedule shows, and a shade over any time outside the hours shown. When the
 * column is one person's day, the time outside their working hours gets its own quiet look, and a
 * day off says so. Nothing of that is drawn while the person has no working hours entered.
 */
export function column(s: Schedule, geo: Geo, step: Step, attrs: Record<string, string> = {}, who?: { personId: string; day: Day }): HTMLElement {
  const body = el('div', { class: 'sd-col', ...attrs });
  if (geo.share) {
    for (let minute = s.dayStart; minute < geo.to; minute += step) {
      if (minute <= geo.from) continue;
      const line = el('span', { class: minute % 60 === 0 ? 'sd-line is-hour' : 'sd-line' });
      line.style.top = `${((minute - geo.from) / (geo.to - geo.from)) * 100}%`;
      body.append(line);
    }
  } else {
    const px = (minutes: number): string => `${Math.round(minutes * geo.ppm)}px`;
    body.style.height = px(geo.to - geo.from);
    body.style.setProperty('--sd-slot-h', px(step));
    body.style.setProperty('--sd-slot-y', px((((s.dayStart - geo.from) % step) + step) % step));
    body.style.setProperty('--sd-hour-h', px(60));
    body.style.setProperty('--sd-hour-y', px((60 - (geo.from % 60)) % 60));
  }
  if (geo.from < s.dayStart) {
    const shade = el('span', { class: 'sd-shade' });
    put(shade, geo.from, s.dayStart, geo, 0);
    body.append(shade);
  }
  if (geo.to > s.dayEnd) {
    const shade = el('span', { class: 'sd-shade' });
    put(shade, s.dayEnd, geo.to, geo, 0);
    body.append(shade);
  }
  if (who) {
    const dayOff = isDayOff(s, who.personId, who.day);
    if (dayOff) body.classList.add('is-dayoff');
    for (const span of offHours(s, who.personId, who.day)) {
      const from = Math.max(span.from, geo.from);
      const to = Math.min(span.to, geo.to);
      if (to <= from) continue;
      // The edge beside working time gets a line, so the start and the end of the day can be read.
      const classes = ['sd-off'];
      if (dayOff) classes.push('is-dayoff');
      if (span.from > s.dayStart) classes.push('is-after');
      if (span.to < s.dayEnd) classes.push('is-before');
      const shade = el('span', { class: classes.join(' ') }, dayOff ? el('span', { class: 'sd-off-say' }, 'Day off') : null);
      put(shade, from, to, geo, 0);
      body.append(shade);
    }
  }
  return body;
}

/**
 * A run of visits drawn as one band: the name, how many, the time and the room, with a faint line
 * where each appointment after the first begins. The blocks of the run stay under it, unseen, so
 * the pointer, the keyboard and the small note find each appointment as they always do.
 */
export function bandEl(s: Schedule, run: Run, geo: Geo): HTMLElement {
  const first = run.blocks[0];
  if (!first) return el('div', { class: 'sd-band', hidden: true });
  const facts = factsOf(s, first);
  const whole = run.to - run.from;
  // Each line of words sits in one row of the band, so the faint lines pass between the words.
  const pitch = first.minutes * geo.ppm;
  const row = Math.max(13, pitch > 36 ? pitch / 2 : pitch);
  const time = clockRange(run.from, run.to);
  const node = el(
    'div',
    { class: `sd-band sd-sw-${facts.colour}${whole * geo.ppm < row * 3 ? ' is-low' : ''}`, 'aria-hidden': 'true', title: `${runSay(facts.name, run.blocks.length, time)}${facts.place ? `, ${facts.place}` : ''}` },
    el('span', { class: 'sd-band-row' }, el('span', { class: 'sd-b-name' }, facts.name), facts.placeShort ? el('span', { class: 'sd-b-room' }, facts.placeShort) : null),
    el('span', { class: 'sd-band-row is-more' }, el('span', { class: 'sd-band-count' }, `${run.blocks.length} visits`), el('span', { class: 'sd-b-time' }, time)),
  );
  node.style.setProperty('--sd-band-row', `${row}px`);
  const notes = clashNotesOf(s);
  for (const block of run.blocks) {
    const at = ((block.start - run.from) / whole) * 100;
    if (block !== first) {
      const line = el('span', { class: 'sd-band-line' });
      line.style.top = `${at}%`;
      node.append(line);
    }
    if (notes.has(block.id)) {
      const mark = el('span', { class: 'sd-b-clash' }, '!');
      mark.style.top = `calc(${at}% + 3px)`;
      node.append(mark);
    }
  }
  put(node, run.from, run.to, geo);
  return node;
}

const clashNotes = new WeakMap<Schedule, Map<string, string>>();

/** For each block that sits in a room clash: a short sentence naming who else is in the room. */
export function clashNotesOf(s: Schedule): Map<string, string> {
  const known = clashNotes.get(s);
  if (known) return known;
  const notes = new Map<string, string>();
  const clashes = allClashes(s);
  if (clashes.length > 0) {
    for (const block of s.blocks) {
      if (block.where.kind !== 'site' || block.where.roomId === null) continue;
      const roomId = block.where.roomId;
      const hit = clashes.find((clash) => clash.roomId === roomId && clash.day === block.day && clash.personIds.includes(block.personId) && clash.from < endOf(block) && clash.to > block.start);
      if (!hit) continue;
      const others = hit.personIds.filter((id) => id !== block.personId).map((id) => personOf(s, id)?.name ?? 'someone else');
      notes.set(block.id, `${roomOf(s, roomId)?.name ?? 'This room'} is also taken by ${others.join(' and ')} at this time.`);
    }
  }
  clashNotes.set(s, notes);
  return notes;
}

/** What a block says about itself in one line, for a screen reader and the small note on hover. */
export function blockSay(s: Schedule, block: Block): string {
  const facts = factsOf(s, block);
  const clash = clashNotesOf(s).get(block.id);
  return `${facts.name}${facts.code && facts.kind !== 'with' ? ` (${facts.code})` : ''}, ${clockRange(facts.from, facts.to)}${facts.place ? `, ${facts.place}` : ''}.${clash ? ` ${clash}` : ''}`;
}

/** One block, coloured by its swatch and placed by its minutes. */
export function blockEl(s: Schedule, block: Block, geo: Geo): HTMLElement {
  const facts = factsOf(s, block);
  const tall = block.minutes * geo.ppm;
  const size = tall < 20 ? 'is-xs' : tall < 34 ? 'is-short' : tall < 60 ? 'is-mid' : 'is-tall';
  const clash = clashNotesOf(s).has(block.id);
  const classes = ['sd-block', `sd-sw-${facts.colour}`, size, facts.care ? 'is-care' : 'is-other'];
  if (facts.code) classes.push('has-code');
  // Time with a provider already says their name. Their initials stand in for it only where the name does not fit.
  if (facts.kind === 'with') classes.push('is-with');
  if (!facts.paid) classes.push('is-unpaid');
  if (clash) classes.push('is-clash');
  const node = el(
    'div',
    { class: classes.join(' '), 'data-id': block.id },
    el('span', { class: 'sd-b-name' }, facts.name),
    el('span', { class: 'sd-b-meta' }, facts.code ? el('b', { class: 'sd-b-code' }, facts.code) : null, facts.placeShort ? el('span', { class: 'sd-b-room', title: facts.place }, facts.placeShort) : null),
    el('span', { class: 'sd-b-time' }, clockRange(facts.from, facts.to)),
    clash ? el('span', { class: 'sd-b-clash', 'aria-hidden': 'true' }, '!') : null,
  );
  put(node, block.start, endOf(block), geo);
  return node;
}
