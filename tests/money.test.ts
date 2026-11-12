import { describe, expect, it } from 'vitest';
import { drawFigure, drawFiguresInText, formatPercentMicro, formatUsd, formatUsdMillions, parseCents, parseMicro, ratioMicro, sumCents, usdRounded } from '../src/lib/money';

describe('usdRounded', () => {
  it('writes large amounts in millions or billions', () => {
    expect(usdRounded(127624378100)).toEqual({ figure: '$1.28', unit: 'billion' });
    expect(usdRounded(115240330700)).toEqual({ figure: '$1.15', unit: 'billion' });
    expect(usdRounded(12384047400)).toEqual({ figure: '$123.8', unit: 'million' });
    expect(usdRounded(100_000_000)).toEqual({ figure: '$1.0', unit: 'million' });
  });
  it('moves to billions where the millions would round up to 1,000', () => {
    expect(usdRounded(99_994_999_999)).toEqual({ figure: '$999.9', unit: 'million' });
    expect(usdRounded(99_995_000_000)).toEqual({ figure: '$1.00', unit: 'billion' });
  });
  it('gives an amount under a million exactly', () => {
    expect(usdRounded(99_999_999)).toEqual({ figure: formatUsd(99_999_999), unit: '' });
    expect(usdRounded(0).unit).toBe('');
  });
  it('refuses an amount below zero', () => {
    expect(() => usdRounded(-1)).toThrow(RangeError);
  });
});

describe('drawFigure', () => {
  it('adds thousands separators and changes no digit', () => {
    expect(drawFigure('982072')).toBe('982,072');
    expect(drawFigure('250279.19', 'money')).toBe('250,279.19');
    expect(drawFigure('1,234,567.00', 'money')).toBe('1,234,567.00');
    expect(drawFigure('46815')).toBe('46,815');
    expect(drawFigure('812')).toBe('812');
    expect(drawFigure('0')).toBe('0');
  });
  it('writes an amount filed with one decimal with two', () => {
    expect(drawFigure('48110.4', 'money')).toBe('48,110.40');
    expect(drawFigure('48110.4')).toBe('48,110.4');
    expect(drawFigure('48110', 'money')).toBe('48,110');
  });
  it('keeps a sign and a dollar sign', () => {
    expect(drawFigure('-1234.5', 'money')).toBe('-1,234.50');
    expect(drawFigure('$1234')).toBe('$1,234');
    expect(drawFigure('-$98765.43', 'money')).toBe('-$98,765.43');
  });
  it('leaves anything that is not one plain number as filed', () => {
    for (const text of ['', 'N/R', '1,23', '12 345', '1.234.567', '00123', '(1234)', '1234 est.', '12-34', '1e6']) {
      expect(drawFigure(text, 'money')).toBe(text);
    }
  });
});

describe('drawFiguresInText', () => {
  it('draws the long figures of a note with separators', () => {
    expect(drawFiguresInText('Schedule C prints 441658 claims in total and Schedule G prints 982072.')).toBe(
      'Schedule C prints 441,658 claims in total and Schedule G prints 982,072.',
    );
    expect(drawFiguresInText('Schedule B prints a total of 250270.19 and the rows give 250279.19')).toBe(
      'Schedule B prints a total of 250,270.19 and the rows give 250,279.19',
    );
  });
  it('draws a four-digit figure only after "prints" or "total of"', () => {
    expect(drawFiguresInText('The form prints 8,332 claims and the schedule prints 8352.')).toBe(
      'The form prints 8,332 claims and the schedule prints 8,352.',
    );
    expect(drawFiguresInText('Filed for 2025 on page 12.')).toBe('Filed for 2025 on page 12.');
  });
  it('leaves codes, identifiers, dates and grouped figures alone', () => {
    for (const text of [
      'NDC 00074433902 and 59676-0580-15',
      'HRSA ID CH010670 and FQHC638110',
      'filed 2025-11-03, read 11/03/2025',
      'the page prints 2,880,632.00',
      'sha256 d2043d5712345',
      'row #123456',
    ]) {
      expect(drawFiguresInText(text)).toBe(text);
    }
  });
});

describe('parseCents', () => {
  it('reads amounts as printed', () => {
    expect(parseCents('1,408,968.83')).toBe(140896883);
    expect(parseCents('250279.19')).toBe(25027919);
    expect(parseCents('230,947')).toBe(23094700);
    expect(parseCents('$12.5')).toBe(1250);
    expect(parseCents('0.07')).toBe(7);
  });
  it('reads parentheses and a minus sign as negative', () => {
    expect(parseCents('(12.50)')).toBe(-1250);
    expect(parseCents('-3.00')).toBe(-300);
  });
  it('treats a lone dash as zero and N/A or blank as no amount', () => {
    expect(parseCents('-')).toBe(0);
    expect(parseCents('N/A')).toBeNull();
    expect(parseCents('N/R')).toBeNull();
    expect(parseCents('')).toBeNull();
  });
  it('refuses what it cannot read exactly', () => {
    expect(() => parseCents('12.345')).toThrow();
    expect(() => parseCents('twelve')).toThrow();
    expect(() => parseCents('1,23.00')).toThrow();
  });
});

describe('sums stay exact in cents', () => {
  it('adds without floating-point drift', () => {
    expect(sumCents([parseCents('0.10')!, parseCents('0.20')!])).toBe(30);
    const margins = ['2403107.19', '280287.82', '2618945.76', '13721315.57', '20598029.77', '5408917', '2797083'].map((v) => parseCents(v)!);
    expect(sumCents(margins)).toBe(4782768611);
  });
});

describe('formatUsd', () => {
  it('formats with thousands separators and two decimals', () => {
    expect(formatUsd(4782768611)).toBe('$47,827,686.11');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(100)).toBe('$1.00');
    expect(formatUsd(-1250)).toBe('-$12.50');
  });
});

describe('formatUsdMillions', () => {
  it('rounds half up to a tenth of a million', () => {
    expect(formatUsdMillions(4782768611)).toBe('$47.8 million');
    expect(formatUsdMillions(4775000000)).toBe('$47.8 million');
    expect(formatUsdMillions(4774999999)).toBe('$47.7 million');
    expect(formatUsdMillions(100000000)).toBe('$1.0 million');
  });
  it('keeps the exact amount below one million dollars', () => {
    expect(formatUsdMillions(99999999)).toBe('$999,999.99');
  });
});

describe('shares', () => {
  it('reads a six-decimal fraction exactly', () => {
    expect(parseMicro('0.233039')).toBe(233039);
    expect(parseMicro('0.5')).toBe(500000);
    expect(() => parseMicro('0.1234567')).toThrow();
  });
  it('formats millionths as a percentage, rounded half up', () => {
    expect(formatPercentMicro(233039)).toBe('23.3%');
    expect(formatPercentMicro(368500)).toBe('36.9%');
    expect(formatPercentMicro(368499)).toBe('36.8%');
    expect(formatPercentMicro(19297, 2)).toBe('1.93%');
    expect(formatPercentMicro(500000, 0)).toBe('50%');
  });
  it('divides cents by cents with no floating point', () => {
    expect(ratioMicro(560016_74, 2403107_19)).toBe(233039);
    expect(ratioMicro(1, 0)).toBeNull();
    expect(ratioMicro(1, -5)).toBeNull();
  });
});
