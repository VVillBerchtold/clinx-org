// Whether two schedules hold the same thing. The page uses it to say "No changes to save" whenever
// the schedule is again what was last saved or opened, however it got there: an Undo, a setting
// flipped and flipped back, or an erased block added again.
import type { Schedule } from './engine/index';

/** One text for a value, with the names of an object in a fixed order, so the order they were written in never matters. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, one]) => one !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([name, one]) => `${JSON.stringify(name)}:${stable(one)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const kept = new WeakMap<Schedule, string>();

/**
 * One text for a schedule. A block's own id and its place in the list are left out, because a block
 * that is erased and added again gets a new id and a new place while the week reads the same.
 */
export function canon(s: Schedule): string {
  let text = kept.get(s);
  if (text === undefined) {
    const blocks = s.blocks.map((block) => stable({ ...block, id: '' })).sort();
    text = `${stable({ ...s, blocks: [] })}\n${blocks.join('\n')}`;
    kept.set(s, text);
  }
  return text;
}

/** True when the two schedules hold the same people, settings and blocks. */
export function sameSchedule(a: Schedule | null, b: Schedule | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.blocks.length !== b.blocks.length) return false;
  return canon(a) === canon(b);
}
