// The choices of the two dropdowns in Add, worked out with no page in hand: what to add, under a
// heading for each kind of time, and where, under a heading for each site.
import { lengthText, roomOf, siteOf } from './engine/index';
import type { Schedule, Where } from './engine/index';
import type { Choice } from './dropdown-keys';

/** One kind of time that can be added, as the list of kinds gives it. */
export interface KindRow {
  tool: { kind: string };
  name: string;
  note: string;
  colour: number;
}

/** The heading each kind of time sits under. */
export const KIND_HEADING: Readonly<Record<string, string>> = { with: 'With a provider', activity: 'Other time', visit: 'Appointments' };

/**
 * The choices of "What to add", in the order of the rows, which is the order the number keys use.
 * Each has its swatch, and its length or role as the quiet line. The value is the row's place.
 */
export function whatChoices(rows: readonly KindRow[]): Choice[] {
  return rows.map((row, at) => {
    const choice: Choice = { value: String(at), say: row.name, group: KIND_HEADING[row.tool.kind] ?? 'Other time', swatch: row.colour };
    if (row.note !== '') choice.note = row.note;
    return choice;
  });
}

/** One text for a place, to be the value of a choice. */
export function whereKey(where: Where): string {
  if (where.kind === 'site') return JSON.stringify(['site', where.siteId, where.roomId]);
  return JSON.stringify([where.kind]);
}

/** The place a choice's value names, or nothing when the schedule no longer has it. */
export function whereOf(s: Schedule, value: string): Where | null {
  let parts: unknown;
  try {
    parts = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parts)) return null;
  if (parts[0] === 'remote') return { kind: 'remote' };
  if (parts[0] === 'none') return { kind: 'none' };
  const siteId: unknown = parts[1];
  const roomId: unknown = parts[2];
  if (parts[0] !== 'site' || typeof siteId !== 'string' || !siteOf(s, siteId)) return null;
  if (roomId === null) return { kind: 'site', siteId, roomId: null };
  if (typeof roomId !== 'string' || roomOf(s, roomId) === undefined) return null;
  return { kind: 'site', siteId, roomId };
}

/** The heading over the two places that are at no site. */
export const NO_SITE_HEADING = 'At no site';

/**
 * The choices of "Where": under each site, the site with no room and then its rooms; then Remote
 * and No place. With more than one site the closed button says a room's site too, the room first,
 * as a block's details do, so a narrow button never cuts the room off.
 */
export function whereChoices(s: Schedule): Choice[] {
  const out: Choice[] = [];
  const many = s.sites.length > 1;
  for (const site of s.sites) {
    out.push({ value: whereKey({ kind: 'site', siteId: site.id, roomId: null }), say: site.name, note: 'No room', group: site.name });
    for (const room of site.rooms) {
      const choice: Choice = { value: whereKey({ kind: 'site', siteId: site.id, roomId: room.id }), say: room.name, group: site.name };
      if (many) choice.full = `${room.name}, ${site.name}`;
      out.push(choice);
    }
  }
  out.push({ value: whereKey({ kind: 'remote' }), say: 'Remote', group: NO_SITE_HEADING });
  out.push({ value: whereKey({ kind: 'none' }), say: 'No place', group: NO_SITE_HEADING });
  return out;
}

/**
 * The first room of a site that nobody else is in at any time this week, for a provider whose own
 * week has no appointments yet. Null when the site has no rooms or other people use every one.
 */
export function openRoom(s: Schedule, siteId: string, personId: string): string | null {
  const taken = new Set<string>();
  for (const block of s.blocks) if (block.personId !== personId && block.where.kind === 'site' && block.where.roomId !== null) taken.add(block.where.roomId);
  return siteOf(s, siteId)?.rooms.find((room) => !taken.has(room.id))?.id ?? null;
}

/** A stretch of one kind of time in one place, for telling what an addition took the place of. */
export interface Piece {
  name: string;
  /** The same for two stretches of the same kind of time in the same place. */
  kind: string;
  start: number;
  end: number;
}

/**
 * What new time took the place of, for the sentence under the week. `gone` are the blocks that
 * were on the day before and are not on it now. `left` are the blocks on it now that were not
 * there before, which holds what remains of a block that was only partly covered. A block that
 * lost part of its time is named with the time that went: "20 min of Admin time". Empty when
 * nothing went.
 */
export function replacedSay(gone: readonly Piece[], left: readonly Piece[]): string {
  const names = [...new Set(gone.map((piece) => piece.name))];
  if (names.length === 0) return '';
  if (names.length > 2) return `${gone.length} blocks`;
  return names
    .map((name) => {
      let whole = 0;
      let lost = 0;
      for (const piece of gone) {
        if (piece.name !== name) continue;
        const kept = left.filter((other) => other.kind === piece.kind && other.start >= piece.start && other.end <= piece.end).reduce((sum, other) => sum + other.end - other.start, 0);
        whole += piece.end - piece.start;
        lost += piece.end - piece.start - kept;
      }
      return lost > 0 && lost < whole ? `${lengthText(lost)} of ${name}` : name;
    })
    .join(' and ');
}
