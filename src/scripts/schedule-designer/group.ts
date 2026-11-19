// The Grouped look of the week: touching visits of one type in one place are drawn as one band.
// This changes the drawing only. The schedule still holds one block for each appointment.
import type { Block, Where } from './engine/index';

/** A stretch of a day that is drawn as one piece: one block, or a run of visits that are alike and touch. */
export interface Run {
  /** The blocks of the run, first to last. A run of one is drawn as an ordinary block. */
  blocks: Block[];
  /** The minute the first block starts. */
  from: number;
  /** The minute the last block ends. */
  to: number;
}

const endOf = (block: Block): number => block.start + block.minutes;

function samePlace(a: Where, b: Where): boolean {
  if (a.kind === 'site' && b.kind === 'site') return a.siteId === b.siteId && a.roomId === b.roomId;
  return a.kind === b.kind;
}

/** True when `next` carries the run on: a visit of the same type, in the same place, starting the minute the one before it ends. */
function carriesOn(last: Block, next: Block): boolean {
  return last.what.kind === 'visit' && next.what.kind === 'visit' && last.what.visitTypeId === next.what.visitTypeId && last.personId === next.personId && last.day === next.day && endOf(last) === next.start && samePlace(last.where, next.where);
}

/**
 * Sorts the blocks of one person on one day into runs. Visits join a run when they are the same
 * type, in the same site and room (or both remote, or both with no place), with no gap between
 * them. Any other kind of time is always a run of one.
 */
export function runsOf(blocks: readonly Block[]): Run[] {
  const inOrder = [...blocks].sort((a, b) => a.start - b.start);
  const runs: Run[] = [];
  for (const block of inOrder) {
    const run = runs[runs.length - 1];
    const last = run?.blocks[run.blocks.length - 1];
    if (run && last && carriesOn(last, block)) {
      run.blocks.push(block);
      run.to = endOf(block);
    } else {
      runs.push({ blocks: [block], from: block.start, to: endOf(block) });
    }
  }
  return runs;
}

/** What a band says: "Standard, 8 visits, 9:00 am to 11:40 am". The time is given already written. */
export function runSay(name: string, count: number, time: string): string {
  return `${name}, ${count} visits, ${time}`;
}
