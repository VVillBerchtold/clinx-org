import { describe, expect, it } from 'vitest';
import { clock, clockRange, dayName, gridLines, hoursOf, hoursText, lengthText, onGrid, snapDown, snapNear, snapRange, snapUp } from '../../src/scripts/schedule-designer/engine/time';

describe('Schedule Designer: times as words', () => {
  it('writes a minute of the day as a clock time', () => {
    expect(clock(0)).toBe('12:00 am');
    expect(clock(15)).toBe('12:15 am');
    expect(clock(560)).toBe('9:20 am');
    expect(clock(720)).toBe('12:00 pm');
    expect(clock(785)).toBe('1:05 pm');
    expect(clock(1020)).toBe('5:00 pm');
    expect(clock(1440)).toBe('12:00 am');
  });

  it('writes a range with the word "to"', () => {
    expect(clockRange(540, 560)).toBe('9:00 am to 9:20 am');
    expect(clockRange(690, 750)).toBe('11:30 am to 12:30 pm');
  });

  it('names the days from Monday', () => {
    expect(dayName(0)).toBe('Monday');
    expect(dayName(6)).toBe('Sunday');
  });

  it('writes a length in hours and minutes', () => {
    expect(lengthText(20)).toBe('20 min');
    expect(lengthText(1)).toBe('1 min');
    expect(lengthText(60)).toBe('1 h');
    expect(lengthText(90)).toBe('1 h 30 min');
    expect(lengthText(300)).toBe('5 h');
    expect(lengthText(620)).toBe('10 h 20 min');
    expect(lengthText(400)).toBe('6 h 40 min');
    expect(lengthText(480)).toBe('8 h');
    expect(lengthText(0)).toBe('0 h');
    expect(lengthText(1727.999)).toBe('28 h 48 min');
  });

  it('turns minutes into hours with two decimal places', () => {
    expect(hoursOf(1580)).toBe(26.33);
    expect(hoursOf(480)).toBe(8);
    expect(hoursOf(450)).toBe(7.5);
    expect(hoursText(1580)).toBe('26.33');
    expect(hoursText(480)).toBe('8');
    expect(hoursText(450)).toBe('7.5');
    expect(hoursText(0)).toBe('0');
  });
});

describe('Schedule Designer: the grid', () => {
  it('lists the lines of a day from its first minute', () => {
    expect(gridLines(480, 540, 20)).toEqual([480, 500, 520]);
    expect(gridLines(480, 540, 15)).toEqual([480, 495, 510, 525]);
  });

  it('starts the grid at the first minute shown, not at the hour', () => {
    // A clinic that opens at 7:30 with 20 min appointments has them at 7:30, 7:50, 8:10.
    expect(gridLines(450, 520, 20)).toEqual([450, 470, 490, 510]);
    expect(onGrid(470, 20, 450)).toBe(true);
    expect(onGrid(480, 20, 450)).toBe(false);
    expect(onGrid(430, 20, 450)).toBe(true);
  });

  it('says whether a minute sits on a grid', () => {
    expect(onGrid(500, 20, 480)).toBe(true);
    expect(onGrid(495, 20, 480)).toBe(false);
    expect(onGrid(495, 15, 480)).toBe(true);
  });

  it('snaps down, up and to the nearer line', () => {
    expect(snapDown(509, 20, 480)).toBe(500);
    expect(snapDown(500, 20, 480)).toBe(500);
    expect(snapUp(501, 20, 480)).toBe(520);
    expect(snapUp(500, 20, 480)).toBe(500);
    expect(snapNear(509, 20, 480)).toBe(500);
    expect(snapNear(510, 20, 480)).toBe(520);
    expect(snapDown(470, 20, 480)).toBe(460);
  });

  it('never snaps outside the day', () => {
    expect(snapDown(-5, 15, 480)).toBe(0);
    expect(snapUp(1439, 20, 480)).toBe(1440);
    expect(snapDown(3, 20, 10)).toBe(0);
  });

  it('turns two points of a drag into whole cells, whichever way the drag went', () => {
    expect(snapRange(505, 547, 20, 480)).toEqual({ from: 500, to: 560 });
    expect(snapRange(547, 505, 20, 480)).toEqual({ from: 500, to: 560 });
    // A click is one point: it covers the cell it lands in.
    expect(snapRange(505, 505, 20, 480)).toEqual({ from: 500, to: 520 });
    expect(snapRange(500, 500, 15, 480)).toEqual({ from: 495, to: 510 });
    // A point on a line belongs to the cell below it; the last line of the day belongs to the cell above.
    expect(snapRange(520, 520, 20, 480)).toEqual({ from: 520, to: 540 });
    expect(snapRange(1440, 1440, 20, 480)).toEqual({ from: 1420, to: 1440 });
  });
});
