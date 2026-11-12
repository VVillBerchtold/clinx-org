import { describe, expect, it } from 'vitest';
import { dayOf, formatDate } from '../src/lib/data';

describe('the day shown for a date or a timestamp', () => {
  it('keeps a plain date as it is', () => {
    expect(dayOf('2026-11-12')).toBe('2026-11-12');
    expect(formatDate('2026-11-12')).toBe('12 November 2026');
  });

  it('shows an evening retrieval on the US East Coast day, not the next day in UTC', () => {
    expect(dayOf('2026-11-12T02:16:14Z')).toBe('2026-11-11');
    expect(formatDate('2026-11-12T02:16:14Z')).toBe('11 November 2026');
  });

  it('keeps a daytime retrieval on the same day, in winter and in summer', () => {
    expect(dayOf('2026-11-11T15:00:00Z')).toBe('2026-11-11');
    expect(dayOf('2026-07-01T03:59:59Z')).toBe('2026-06-30');
    expect(dayOf('2026-07-01T04:00:00Z')).toBe('2026-07-01');
  });

  it('refuses a timestamp that is not one', () => {
    expect(() => dayOf('2026-13-45T99:99:99Z')).toThrow();
  });
});
