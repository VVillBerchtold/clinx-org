import { describe, expect, it } from 'vitest';
import { canon, sameSchedule } from '../../src/scripts/schedule-designer/same';
import { blocksOf, erase, paint, sampleSchedule, setHours, setStep, setWork, workOn } from '../../src/scripts/schedule-designer/engine/index';

const first = () => {
  const s = sampleSchedule();
  const person = s.people[0];
  if (!person) throw new Error('no people');
  return { s, person };
};

describe('whether the schedule is what was last saved or opened', () => {
  it('is the same as itself, and as the sample built again', () => {
    const { s } = first();
    expect(sameSchedule(s, s)).toBe(true);
    expect(sameSchedule(s, sampleSchedule())).toBe(true);
    expect(sameSchedule(null, null)).toBe(true);
    expect(sameSchedule(s, null)).toBe(false);
  });

  it('differs after the grid is changed, and is the same again after it is changed back', () => {
    const { s, person } = first();
    const other = person.step === 15 ? 20 : 15;
    const flipped = setStep(s, person.id, other);
    expect(flipped).not.toBe(s);
    expect(sameSchedule(flipped, s)).toBe(false);
    const back = setStep(flipped, person.id, person.step);
    expect(back).not.toBe(s);
    expect(sameSchedule(back, s)).toBe(true);
  });

  it('differs after the hours shown are changed, and is the same again after they are put back', () => {
    const { s } = first();
    const narrow = setHours(s, s.dayStart + 60, s.dayEnd);
    expect(sameSchedule(narrow, s)).toBe(false);
    expect(sameSchedule(setHours(narrow, s.dayStart, s.dayEnd), s)).toBe(true);
  });

  it('is the same again after an erased block is added back, though the block has a new id', () => {
    const { s, person } = first();
    const block = blocksOf(s, person.id).find((one) => one.what.kind === 'visit');
    if (!block) throw new Error('no visit');
    const erased = erase(s, { personId: person.id, day: block.day, from: block.start, to: block.start + block.minutes });
    expect(sameSchedule(erased, s)).toBe(false);
    const again = paint(erased, { personId: person.id, day: block.day, from: block.start, to: block.start + block.minutes, what: block.what, where: block.where });
    expect(blocksOf(again, person.id)).toHaveLength(blocksOf(s, person.id).length);
    expect(sameSchedule(again, s)).toBe(true);
  });

  it('is the same again after working hours are changed and put back', () => {
    const { s, person } = first();
    const day = s.days[0];
    if (day === undefined) throw new Error('no days');
    const was = workOn(s, person.id, day);
    const changed = setWork(s, person.id, day, [{ from: 540, to: 900 }]);
    expect(sameSchedule(changed, s)).toBe(false);
    expect(sameSchedule(setWork(changed, person.id, day, was), s)).toBe(true);
  });

  it('does not depend on the order an object was written in, and leaves a block id out', () => {
    const { s } = first();
    const turned = { ...s, people: s.people.map((person) => Object.fromEntries(Object.entries(person).reverse())) } as unknown as typeof s;
    expect(canon(turned)).toBe(canon(s));
    const renamed = { ...s, blocks: s.blocks.map((block, at) => ({ ...block, id: `other-${at}` })).reverse() };
    expect(sameSchedule(renamed, s)).toBe(true);
  });

  it('sees a block that moved by one grid step', () => {
    const { s } = first();
    const moved = { ...s, blocks: s.blocks.map((block, at) => (at === 0 ? { ...block, start: block.start + 5 } : block)) };
    expect(sameSchedule(moved, s)).toBe(false);
  });
});
