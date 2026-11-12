import type { Micro } from './money';

/**
 * The two marks the site draws from a share, both at build time:
 * the tick meter (100 ticks, 0 to 100%) and the bar beside a filing's name (0 to 50%).
 * Nothing here clips a value: a share outside a scale is an error, never a shortened bar.
 */

/** Meter geometry in SVG units: 100 ticks, one every 10 units. */
export const METER = { width: 1000, height: 46, ticks: 100, pitch: 10, inset: 1.5 } as const;

/** One path with a vertical stroke for each of the 100 ticks. */
export function tickPath(): string {
  let d = '';
  for (let i = 0; i < METER.ticks; i++) d += `M${i * METER.pitch + METER.inset} 0V${METER.height}`;
  return d;
}

/** Width, in meter units, of the lit part: 36.8% is 368. */
export function meterWidth(shareMicro: Micro): number {
  if (!Number.isInteger(shareMicro) || shareMicro < 0 || shareMicro > 1_000_000) throw new RangeError(`Share ${shareMicro} is outside 0 to 100%`);
  return Math.round(shareMicro / 100) / 10;
}

export interface MeterOptions {
  /** Unique on the page: used for the clip path's id. */
  id: string;
  shareMicro: Micro | null;
}

/** The meter as inline SVG. Decorative: the row it sits in states the same figure as text. */
export function meterSvg({ id, shareMicro }: MeterOptions): string {
  const ticks = tickPath();
  const lit = shareMicro === null ? 0 : meterWidth(shareMicro);
  return (
    `<svg class="meter-svg" viewBox="0 0 ${METER.width} ${METER.height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    `<clipPath id="${id}"><rect class="sweep" width="${lit}" height="${METER.height}"/></clipPath>` +
    `<path class="ticks" d="${ticks}"/>` +
    `<path class="ticks-on" clip-path="url(#${id})" d="${ticks}"/>` +
    `</svg>`
  );
}

/** The scale of the bars beside names: the full rail is 50%. */
export const BAR_SCALE_MICRO = 500_000;

/** Width of a bar as a percentage of its rail, to one decimal: 23.3% of margin is "46.6". */
export function barPercent(shareMicro: Micro): string {
  if (!Number.isInteger(shareMicro) || shareMicro < 0 || shareMicro > BAR_SCALE_MICRO) throw new RangeError(`Share ${shareMicro} is outside the 0 to 50% scale`);
  return (Math.round((shareMicro * 1000) / BAR_SCALE_MICRO) / 10).toFixed(1);
}

/** Width of a bar as a percentage of its rail, to one decimal, when the full rail stands for `scale` (both in the same unit, not below zero). */
export function barPercentOfScale(value: number, scale: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0 || value < 0 || value > scale) throw new RangeError(`Value ${value} is outside the scale 0 to ${scale}`);
  return (Math.round((value * 1000) / scale) / 10).toFixed(1);
}
