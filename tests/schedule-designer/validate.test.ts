import { describe, expect, it } from 'vitest';
import { validate } from '../../src/scripts/schedule-designer/engine/validate';
import type { Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { NOWHERE, REMOTE, activity, block, room, small, visit, withBlocks } from './fixtures/small';

const good = withBlocks(small(), [
  block('b1', 'pA', 0, 480, 60, activity('aAdmin'), NOWHERE),
  block('b2', 'pA', 0, 540, 20, visit('v20'), room('s1', 'r1')),
  block('b3', 'pA', 0, 560, 20, visit('v20'), room('s1', null)),
  block('b4', 'pB', 0, 540, 60, visit('v60'), REMOTE),
]);

/** A copy that a test may change. */
const copy = (): Schedule => JSON.parse(JSON.stringify(good)) as Schedule;

/** The problem a changed copy gives, or nothing when it is accepted. */
function problemAfter(change: (s: Schedule) => void): string | undefined {
  const s = copy();
  change(s);
  const result = validate(s);
  return 'problem' in result ? result.problem : undefined;
}

describe('Schedule Designer: checking a schedule read from a file', () => {
  it('accepts a good schedule and gives back an equal copy', () => {
    const result = validate(copy());
    expect(result).toEqual({ schedule: good });
    expect('schedule' in result && result.schedule).not.toBe(good);
  });

  it('drops anything it does not know', () => {
    const s = copy() as unknown as Record<string, unknown>;
    s['extra'] = 'x';
    (s['people'] as Record<string, unknown>[])[0]!['note'] = 'x';
    expect(validate(s)).toEqual({ schedule: good });
  });

  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [undefined, null, 0, 'text', [], {}, { format: 'clinx-schedule' }, { format: 'clinx-schedule', version: 1 }, () => 1, Symbol('x'), new Map(), { format: 'clinx-schedule', version: 1, people: 'no' }];
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      },
    );
    for (const value of [...odd, trap]) {
      const result = validate(value);
      expect('problem' in result && typeof result.problem === 'string' && result.problem.length > 10).toBe(true);
    }
  });

  it('says so when the file is something else or from a newer version', () => {
    expect(problemAfter((s) => ((s as { format: string }).format = 'other'))).toMatch(/not a schedule/i);
    expect(problemAfter((s) => ((s as { version: number }).version = 2))).toMatch(/newer version/i);
    expect(problemAfter((s) => ((s as { version: number }).version = 0))).toBeTruthy();
  });

  it('refuses a schedule whose parts do not fit together', () => {
    const cases: [string, (s: Schedule) => void][] = [
      ['a name that is not text', (s) => ((s as { name: unknown }).name = 5)],
      ['a name that is too long', (s) => (s.name = 'x'.repeat(81))],
      ['no days', (s) => (s.days = [])],
      ['a day twice', (s) => (s.days = [0, 0])],
      ['a day out of order', (s) => (s.days = [1, 0])],
      ['a day that is not a day', (s) => (s.days = [7 as 0])],
      ['hours the wrong way round', (s) => (s.dayEnd = 400)],
      ['hours past midnight', (s) => (s.dayEnd = 1500)],
      ['an id used twice', (s) => (s.people[1]!.id = 'pA')],
      ['an id shared by a room and a person', (s) => (s.sites[0]!.rooms[0]!.id = 'pB')],
      ['an empty id', (s) => (s.activities[0]!.id = '')],
      ['a person in no department', (s) => (s.people[0]!.departmentId = 'nope')],
      ['a grid that is neither 15 nor 20', (s) => (s.people[0]!.step = 30 as 15)],
      ['hours that are not a number', (s) => ((s.people[0] as { contractHours: unknown }).contractHours = '34')],
      ['set-aside hours below zero', (s) => (s.people[0]!.setAside[0]!.hours = -1)],
      ['no list of set-aside hours', (s) => delete (s.people[0] as { setAside?: unknown }).setAside],
      ['hours set aside for an unknown activity', (s) => (s.people[0]!.setAside[0]!.activityId = 'nope')],
      ['two set-aside lines for one activity', (s) => (s.people[0]!.setAside[1]!.activityId = 'aAdmin')],
      ['a department with no care factor', (s) => delete (s.departments[0] as { careFactor?: unknown }).careFactor],
      ['a care factor of zero', (s) => (s.departments[0]!.careFactor = 0)],
      ['a care factor above 1', (s) => (s.departments[0]!.careFactor = 1.01)],
      ['a care factor that is not a number', (s) => ((s.departments[0] as { careFactor: unknown }).careFactor = '0.8')],
      ['a department with no slots in an hour', (s) => delete (s.departments[1] as { slotsPerHour?: unknown }).slotsPerHour],
      ['fewer than 1 slot in an hour', (s) => (s.departments[0]!.slotsPerHour = 0.5)],
      ['more than 12 slots in an hour', (s) => (s.departments[0]!.slotsPerHour = 13)],
      ['a person with no care factor of their own or null', (s) => delete (s.people[0] as { careFactor?: unknown }).careFactor],
      ['a person whose own care factor is out of range', (s) => (s.people[0]!.careFactor = 1.5)],
      ['a person with no slots in an hour of their own or null', (s) => delete (s.people[0] as { slotsPerHour?: unknown }).slotsPerHour],
      ['a person whose own slots in an hour are out of range', (s) => (s.people[0]!.slotsPerHour = 0)],
      ['a person who does not say whether they are ramping', (s) => delete (s.people[0] as { ramping?: unknown }).ramping],
      ['ramping that is not yes or no', (s) => ((s.people[0] as { ramping: unknown }).ramping = 1)],
      ['no tolerance', (s) => delete (s as { tolerance?: unknown }).tolerance],
      ['a tolerance below zero', (s) => (s.tolerance = -1)],
      ['a tolerance that is too wide', (s) => (s.tolerance = 101)],
      ['a tolerance that is not a number', (s) => ((s as { tolerance: unknown }).tolerance = Number.NaN)],
      ['a colour that is not a swatch', (s) => (s.activities[0]!.colour = 13 as 1)],
      ['paid that is not yes or no', (s) => ((s.activities[0] as { paid: unknown }).paid = 'yes')],
      ['a visit length of zero', (s) => (s.departments[0]!.visitTypes[0]!.minutes = 0)],
      ['a block for nobody', (s) => (s.blocks[0]!.personId = 'nope')],
      ['a block on a day not shown', (s) => (s.blocks[0]!.day = 6)],
      ['a block that starts before midnight', (s) => (s.blocks[0]!.start = -10)],
      ['a block that ends after midnight', (s) => (s.blocks[0]!.start = 1400)],
      ['a block with half minutes', (s) => (s.blocks[0]!.start = 480.5)],
      ['a block with no length', (s) => (s.blocks[0]!.minutes = 0)],
      ['an appointment of an unknown type', (s) => (s.blocks[1]!.what = { kind: 'visit', visitTypeId: 'nope' })],
      ['an appointment of the wrong length', (s) => (s.blocks[1]!.minutes = 25)],
      ['an unknown activity', (s) => (s.blocks[0]!.what = { kind: 'activity', activityId: 'nope' })],
      ['an unknown kind of time', (s) => ((s.blocks[0] as { what: unknown }).what = { kind: 'other' })],
      ['an unknown site', (s) => (s.blocks[1]!.where = { kind: 'site', siteId: 'nope', roomId: null })],
      ['a room at another site', (s) => (s.blocks[1]!.where = { kind: 'site', siteId: 's1', roomId: 'r3' })],
      ['an unknown kind of place', (s) => ((s.blocks[0] as { where: unknown }).where = { kind: 'moon' })],
      ['two blocks at once for one person', (s) => (s.blocks[2]!.start = 550)],
    ];
    for (const [what, change] of cases) {
      const problem = problemAfter(change);
      expect(problem, what).toBeTruthy();
      expect(problem, what).not.toMatch(/undefined|NaN|\bbest\b|\bworst\b|highest|lowest|\btop\s|[—–]| - /);
    }
  });

  it('accepts standards anywhere inside their limits, and a person\'s own', () => {
    expect(problemAfter((s) => (s.departments[0]!.careFactor = 0.001))).toBeUndefined();
    expect(problemAfter((s) => (s.departments[0]!.careFactor = 1))).toBeUndefined();
    expect(problemAfter((s) => (s.departments[0]!.slotsPerHour = 12))).toBeUndefined();
    expect(problemAfter((s) => (s.departments[0]!.slotsPerHour = 1.5))).toBeUndefined();
    expect(problemAfter((s) => Object.assign(s.people[0]!, { careFactor: 0.75, slotsPerHour: 2, ramping: true }))).toBeUndefined();
    expect(problemAfter((s) => (s.tolerance = 100))).toBeUndefined();
    const s = copy();
    Object.assign(s.people[0]!, { careFactor: 0.75, slotsPerHour: 2, ramping: true });
    s.tolerance = 2.5;
    expect(validate(s)).toEqual({ schedule: s });
  });

  it('refuses a schedule larger than the tool is built for', () => {
    expect(problemAfter((s) => (s.people = Array.from({ length: 151 }, (_, i) => ({ ...s.people[0]!, id: `x${i}` }))))).toMatch(/too large|more than/i);
  });
});
