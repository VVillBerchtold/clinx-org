// Two small parts of the page that have no engine behind them: the join that keeps a number with
// its unit in a narrow cell, and the step that brings the answer to a fill into view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tight } from '../../src/scripts/schedule-designer/dom';

describe('a length in a narrow cell', () => {
  it('keeps each number with its unit, so a break can only fall between the hours and the minutes', () => {
    expect(tight('6 h 40 min')).toBe('6\u00a0h 40\u00a0min');
    expect(tight('8 h')).toBe('8\u00a0h');
    expect(tight('20 min')).toBe('20\u00a0min');
    expect(tight('0 h')).toBe('0\u00a0h');
  });
  it('joins a span of two lengths the same way', () => {
    expect(tight('27 h 48 min to 31 h')).toBe('27\u00a0h 48\u00a0min to 31\u00a0h');
  });
  it('leaves other words as they are', () => {
    expect(tight('')).toBe('');
    expect(tight('3 under')).toBe('3 under');
    expect(tight('Exam 1 has 2 hours')).toBe('Exam 1 has 2 hours');
    expect(tight('On target')).toBe('On target');
  });
});

describe('the answer to a fill, brought into view', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A page of three parts: the line under the week, the pinned bar, and a window 700 high. Returns how often the line was asked into view. */
  async function run(line: { answer: boolean; top: number; bottom: number } | null, footTop: number | null): Promise<{ calls: unknown[][] }> {
    const calls: unknown[][] = [];
    const parts: Record<string, unknown> = {
      'sd-status': line && {
        classList: { contains: (name: string) => name === 'is-answer' && line.answer },
        getBoundingClientRect: () => ({ top: line.top, bottom: line.bottom }),
        scrollIntoView: (...how: unknown[]) => calls.push(how),
      },
      'sd-foot': footTop === null ? null : { getBoundingClientRect: () => ({ top: footTop }) },
    };
    // The step waits two frames, so the week has been fitted first. Here a frame runs at once.
    vi.stubGlobal('window', { innerHeight: 700, requestAnimationFrame: (step: () => void) => (step(), 1) });
    vi.stubGlobal('document', { getElementById: (id: string) => parts[id] ?? null });
    const { showAnswer } = await import('../../src/scripts/schedule-designer/design-week');
    showAnswer();
    return { calls };
  }

  it('scrolls the least it can when the answer is under the pinned bar', async () => {
    const { calls } = await run({ answer: true, top: 640, bottom: 680 }, 627);
    expect(calls).toEqual([[{ block: 'nearest' }]]);
  });
  it('scrolls when the answer has gone above the window', async () => {
    const { calls } = await run({ answer: true, top: -30, bottom: 10 }, 627);
    expect(calls.length).toBe(1);
  });
  it('moves nothing when the answer is already in view above the bar', async () => {
    const { calls } = await run({ answer: true, top: 503, bottom: 615 }, 627);
    expect(calls).toEqual([]);
  });
  it('counts from the lower edge of the window when there is no bar', async () => {
    expect((await run({ answer: true, top: 640, bottom: 690 }, null)).calls).toEqual([]);
    expect((await run({ answer: true, top: 680, bottom: 720 }, null)).calls.length).toBe(1);
  });
  it('leaves an ordinary line alone, and a page with no line', async () => {
    expect((await run({ answer: false, top: 640, bottom: 680 }, 627)).calls).toEqual([]);
    expect((await run(null, 627)).calls).toEqual([]);
  });
});
