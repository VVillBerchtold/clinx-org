import { describe, expect, it } from 'vitest';
import { BAR_SCALE_MICRO, METER, barPercent, meterSvg, meterWidth, tickPath } from '../src/lib/meter';

describe('tick meter', () => {
  it('has one stroke for each of the 100 ticks, evenly spaced', () => {
    const d = tickPath();
    expect(d.split('M').length - 1).toBe(METER.ticks);
    expect(d.startsWith('M1.5 0V46M11.5 0V46')).toBe(true);
    expect(d.endsWith('M991.5 0V46')).toBe(true);
  });
  it('lights the meter to scale: 0 is nothing, 100% is the full width', () => {
    expect(meterWidth(0)).toBe(0);
    expect(meterWidth(1_000_000)).toBe(METER.width);
    expect(meterWidth(367_944)).toBe(367.9);
    expect(meterWidth(128_500)).toBe(128.5);
  });
  it('refuses a share outside the scale instead of clipping it', () => {
    expect(() => meterWidth(1_000_001)).toThrow();
    expect(() => meterWidth(-1)).toThrow();
    expect(() => meterWidth(0.5)).toThrow();
  });
  it('draws the lit width into the clip rectangle and nothing when there is no share', () => {
    expect(meterSvg({ id: 'm1', shareMicro: 250_000 })).toContain('<rect class="sweep" width="250" height="46"/>');
    expect(meterSvg({ id: 'm2', shareMicro: null })).toContain('<rect class="sweep" width="0" height="46"/>');
    expect(meterSvg({ id: 'm3', shareMicro: 1 })).not.toMatch(/\sstyle=/);
  });
});

describe('bar beside a name', () => {
  it('is to scale: 0 is nothing, 50% is the full rail', () => {
    expect(barPercent(0)).toBe('0.0');
    expect(barPercent(BAR_SCALE_MICRO)).toBe('100.0');
    expect(barPercent(250_000)).toBe('50.0');
    expect(barPercent(233_039)).toBe('46.6');
  });
  it('refuses a share outside the scale instead of clipping it', () => {
    expect(() => barPercent(500_001)).toThrow();
    expect(() => barPercent(-1)).toThrow();
  });
});
