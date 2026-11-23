/**
 * The registry's history: contract pharmacy arrangements and covered entities, month by month
 * since January 2010, as today's 340B registry records them.
 *
 * In plain words: HRSA's registry export lists every contract pharmacy arrangement with the day it
 * began and, once it ended, the day it ended. Counting the arrangements whose dates cover a day
 * gives that day's count, as the registry records it now. The counting is done in the registry
 * history repository (tools/backfill.py); src/data/registry/history.json holds its tables, packed.
 * This file draws the charts as inline SVG when the site is built, so every figure is there with
 * scripts off. src/scripts/registry-charts.ts adds the hover layer on top.
 *
 * Every chart is drawn twice, wide and narrow; the stylesheet shows one by the screen's width.
 */
import raw from '../data/registry/history.json';
import cohortsRaw from '../data/registry/cohorts.json';
import { STATES } from './state-map';

export interface Law {
  law_id: string;
  state: string;
  title: string;
  bill: string;
  act: string;
  signed: string;
  effective: string;
  effective_basis: string;
  kinds: string[];
}

export interface FederalEvent {
  date: string;
  label: string;
  text: string;
  url: string;
}

interface History {
  months: string[];
  national: Record<'entities' | 'parents' | 'child_sites' | 'arrangements' | 'pharmacies' | 'out_of_state', number[]>;
  chains: {
    groups: string[];
    arrangements: Record<string, number[]>;
    pharmacies: Record<string, number[]>;
    mail_detail: Record<string, { arrangements: number; pharmacies: number }>;
  };
  types: { groups: string[]; entities: Record<string, number[]>; arrangements: Record<string, number[]>; detail: Record<string, { entities: number; arrangements: number }> };
  states: Record<string, { entities: number[]; arrangements: number[]; pharmacies: number[] }>;
  flows: Record<string, [string, string, number][]>;
  out_of_state: Record<string, Record<string, [number, number]>>;
  ended_listed: { year: number; ended_arrangements_listed: number; ended_entities_listed: number }[];
  laws: Law[];
}

export const H = raw as unknown as History;
export const REGISTRY_HOME = '/registry/';
export const REGISTRY_REPO = 'https://github.com/VVillBerchtold/clinx-340b-registry';

/** The record of endings starts here: ended arrangements are listed from 2016, ended entities from 2017. */
export const FULL_RECORD_FROM = '2017-01';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
export const pct = (n: number, d = 0): string => `${(n * 100).toFixed(d)}%`;
export const monthLong = (m: string): string => `1 ${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m: string): string => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const stateName = (code: string): string => STATES.find((s) => s.code === code)?.name ?? code;
export const lastMonth = (): string => H.months[H.months.length - 1]!;
export const at = (series: number[], month: string): number => series[H.months.indexOf(month)] ?? 0;

// ---------- Chart geometry ----------

export type Size = 'wide' | 'narrow';
interface Frame {
  w: number;
  h: number;
  l: number;
  r: number;
  t: number;
  b: number;
}
const FRAMES: Record<string, Record<Size, Frame>> = {
  hero: { wide: { w: 1040, h: 440, l: 64, r: 150, t: 34, b: 36 }, narrow: { w: 360, h: 300, l: 44, r: 14, t: 24, b: 30 } },
  half: { wide: { w: 520, h: 280, l: 56, r: 24, t: 24, b: 32 }, narrow: { w: 360, h: 240, l: 44, r: 14, t: 20, b: 30 } },
  full: { wide: { w: 1040, h: 360, l: 64, r: 190, t: 24, b: 36 }, narrow: { w: 360, h: 280, l: 44, r: 14, t: 20, b: 30 } },
};

/** Clean axis ticks: up to `count` round steps from 0 to at least max. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const tickText = (v: number, top: number, percent: boolean): string => {
  if (percent) return `${Math.round(v * 100)}%`;
  if (top >= 10000) return v === 0 ? '0' : `${Math.round(v / 1000)}K`;
  return fmt(v);
};

export interface Series {
  key: string;
  label: string;
  values: number[];
  /** Index of the categorical slot (1 to 5), or 0 for the neutral "other". */
  slot: number;
}

export interface Marker {
  month: string;
  label: string;
  /** Up or down in the label stack, to keep neighbours apart. */
  level?: number;
}

export interface LineOptions {
  id: string;
  frame: keyof typeof FRAMES;
  series: Series[];
  /** First month drawn (default: the first in the data). */
  from?: string;
  area?: boolean;
  stacked?: boolean;
  percent?: boolean;
  markers?: Marker[];
  /** Stacked layers drawn under the first series (which should be their total), oldest first. */
  layers?: { label: string; values: number[]; labelled?: boolean }[];
  /** Shade the months before this one as "the record of endings is incomplete". */
  shadeBefore?: string;
  title: string;
  desc: string;
}

/** One chart, drawn for one size. Returns the SVG markup. */
function lineSvg(o: LineOptions, size: Size): string {
  const f = FRAMES[o.frame]![size];
  const start = H.months.indexOf(o.from ?? H.months[0]!);
  const months = H.months.slice(start);
  const n = months.length;
  const pw = f.w - f.l - f.r;
  const ph = f.h - f.t - f.b;
  const x = (i: number): number => f.l + (i / (n - 1)) * pw;
  const vals = o.series.map((s) => s.values.slice(start));
  const stackTops: number[][] = [];
  if (o.stacked) {
    const run = new Array<number>(n).fill(0);
    for (const v of vals) {
      for (let i = 0; i < n; i++) run[i]! += v[i]!;
      stackTops.push([...run]);
    }
  }
  const max = o.percent ? 1 : Math.max(...(o.stacked ? stackTops[stackTops.length - 1]! : vals.flat()));
  const ticks = o.percent ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(max, size === 'wide' ? 5 : 4);
  const top = ticks[ticks.length - 1]!;
  const y = (v: number): number => f.t + ph - (v / top) * ph;
  const fs = size === 'wide' ? 13 : 11;
  const parts: string[] = [];

  // Shaded months: the record of endings is incomplete.
  if (o.shadeBefore) {
    const si = months.indexOf(o.shadeBefore);
    if (si > 0) {
      parts.push(`<rect class="rx-shade" x="${f.l}" y="${f.t}" width="${(x(si) - f.l).toFixed(1)}" height="${ph}"/>`);
      if (size === 'wide') parts.push(`<text class="rx-shade-text" x="${f.l + 10}" y="${(f.t + ph * 0.42).toFixed(1)}" font-size="${fs - 1}">Endings before 2017 not fully listed</text>`);
    }
  }
  // Grid and y ticks.
  for (const t of ticks) {
    parts.push(`<line class="rx-grid" x1="${f.l}" x2="${f.w - f.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    parts.push(`<text class="rx-tick" x="${f.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" font-size="${fs}">${tickText(t, top, !!o.percent)}</text>`);
  }
  // X ticks: years.
  const every = size === 'wide' ? (n > 120 ? 2 : 1) : n > 120 ? 4 : 2;
  months.forEach((m, i) => {
    if (m.endsWith('-01') && Number(m.slice(0, 4)) % every === 0) {
      parts.push(`<text class="rx-tick" x="${x(i).toFixed(1)}" y="${f.h - f.b + 20}" text-anchor="middle" font-size="${fs}">${m.slice(0, 4)}</text>`);
    }
  });
  parts.push(`<line class="rx-axis" x1="${f.l}" x2="${f.w - f.r}" y1="${f.t + ph}" y2="${f.t + ph}"/>`);

  // Event markers (over the marks when the chart is stacked, where fills would hide them).
  const markerParts: string[] = [];
  for (const mk of o.markers ?? []) {
    const i = months.indexOf(mk.month);
    if (i < 0) continue;
    const lv = mk.level ?? 0;
    const ly = f.t + 4 + lv * (fs + 6);
    markerParts.push(`<line class="rx-marker" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${ly + 4}" y2="${f.t + ph}"/>`);
    // The label sits left of its line, or right of it when there is no room on the left.
    const room = x(i) - f.l > mk.label.length * (fs - 1) * 0.56 + 10;
    if (size === 'wide') markerParts.push(`<text class="rx-marker-text" x="${(x(i) + (room ? -6 : 6)).toFixed(1)}" y="${ly + 10}" text-anchor="${room ? 'end' : 'start'}" font-size="${fs - 1}">${mk.label}</text>`);
    else markerParts.push(`<circle class="rx-marker-dot" cx="${x(i).toFixed(1)}" cy="${ly + 4}" r="3"/>`);
  }

  // Layers: stacked fills, oldest at the bottom, each a step darker than the one below.
  const layerEnds: { y: number; value: string; label: string }[] = [];
  if (o.layers) {
    const run = new Array<number>(n).fill(0);
    o.layers.forEach((ly, j) => {
      const v = ly.values.slice(start);
      const lower = run.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).reverse();
      for (let i = 0; i < n; i++) run[i]! += v[i] ?? 0;
      const upper = run.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`);
      parts.push(`<polygon class="rx-layer ck${j}" points="${[...upper, ...lower].join(' ')}"/>`);
      if (ly.labelled && size === 'wide') layerEnds.push({ y: y(run[n - 1]! - (v[n - 1] ?? 0) / 2) + 4, value: fmt(v[n - 1] ?? 0), label: ly.label });
    });
  }
  if (!o.stacked) parts.push(...markerParts);
  // Marks.
  const ends: { y: number; value: string; label: string }[] = [];
  vals.forEach((v, si) => {
    const s = o.series[si]!;
    const topLine = o.stacked ? stackTops[si]! : v;
    const base = o.stacked && si > 0 ? stackTops[si - 1]! : null;
    const toY = (val: number): number => y(o.percent ? val : val);
    const pts = topLine.map((val, i) => `${x(i).toFixed(1)},${toY(val).toFixed(1)}`);
    if ((o.area && !o.layers) || o.stacked) {
      const lower = base ? base.map((val, i) => `${x(i).toFixed(1)},${toY(val).toFixed(1)}`).reverse() : [`${x(n - 1).toFixed(1)},${y(0).toFixed(1)}`, `${x(0).toFixed(1)},${y(0).toFixed(1)}`];
      parts.push(`<polygon class="rx-fill s${s.slot}${o.stacked ? ' rx-stack' : ''}" points="${[...pts, ...lower].join(' ')}"/>`);
    }
    if (!o.stacked) parts.push(`<polyline class="rx-line s${s.slot}" points="${pts.join(' ')}"/>`);
    // End dot and direct label.
    const endY = toY(o.stacked ? (topLine[n - 1]! + (base ? base[n - 1]! : 0)) / 2 : topLine[n - 1]!);
    if (!o.stacked) parts.push(`<circle class="rx-end s${s.slot}" cx="${x(n - 1).toFixed(1)}" cy="${endY.toFixed(1)}" r="4.5"/>`);
    if (size === 'wide' && f.r > 100) {
      const value = o.percent ? pct(v[n - 1]! / (stackTops[stackTops.length - 1]?.[n - 1] ?? 1)) : fmt(v[n - 1]!);
      ends.push({ y: endY - 2, value, label: s.label });
    }
  });
  if (o.stacked) parts.push(...markerParts);
  // Direct labels at the right edge, pushed apart so none overlap.
  ends.push(...layerEnds);
  const gap = 2 * fs + 13;
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + gap);
  const over = ends.length ? ends[ends.length - 1]!.y - (f.t + ph - fs) : 0;
  if (over > 0) for (const e of ends) e.y -= over;
  const lx = x(n - 1) + 12;
  for (const e of ends) {
    parts.push(`<text class="rx-end-label" x="${lx}" y="${e.y.toFixed(1)}" font-size="${fs}"><tspan class="rx-end-value" x="${lx}" dy="0">${e.value}</tspan><tspan x="${lx}" dy="${fs + 3}">${e.label}</tspan></text>`);
  }

  // Hover layer (filled by the script): crosshair, dots, and the hit area.
  parts.push(`<g class="rx-hover" hidden><line class="rx-cross" x1="0" x2="0" y1="${f.t}" y2="${f.t + ph}"/>${o.series.map((s) => `<circle class="rx-hdot s${s.slot}" r="5" cx="0" cy="0"/>`).join('')}</g>`);
  parts.push(`<rect class="rx-hit" x="${f.l}" y="${f.t}" width="${pw}" height="${ph}"/>`);

  return `<svg class="rx-svg rx-${size}" viewBox="0 0 ${f.w} ${f.h}" role="img" aria-labelledby="${o.id}-${size}-t ${o.id}-${size}-d" data-l="${f.l}" data-pw="${pw}" data-t="${f.t}" data-ph="${ph}" data-top="${top}" data-w="${f.w}" data-h="${f.h}"><title id="${o.id}-${size}-t">${o.title}</title><desc id="${o.id}-${size}-d">${o.desc}</desc>${parts.join('')}</svg>`;
}

/** Both sizes of a chart, and the numbers the hover layer reads. */
export function lineChart(o: LineOptions): { wide: string; narrow: string; data: string } {
  const start = H.months.indexOf(o.from ?? H.months[0]!);
  const data = JSON.stringify({
    months: H.months.slice(start),
    stacked: !!o.stacked,
    percent: !!o.percent,
    series: o.series.map((s) => ({ label: s.label, slot: s.slot, values: s.values.slice(start) })),
  });
  return { wide: lineSvg(o, 'wide'), narrow: lineSvg(o, 'narrow'), data };
}

// ---------- Across state lines: one tile map per month, on one scale ----------

const TILE_W = 60;
const TILE_GAP = 8;
const center = (code: string): [number, number] | null => {
  const s = STATES.find((t) => t.code === code);
  if (!s) return null;
  return [s.col * (TILE_W + TILE_GAP) + TILE_W / 2 + 4, s.row * (TILE_W + TILE_GAP) + TILE_W / 2 + 4];
};

/** Out-of-state share bands, the same for every map so two years compare directly. */
export const SHARE_BANDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
/** States with fewer arrangements than this are drawn plain: a share of a handful says little. */
const FEW = 50;

/**
 * A tile map of the states for one month. Each tile is shaded by the share of the arrangements held
 * by the state's entities whose pharmacy is in another state, on one fixed scale (SHARE_BANDS).
 */
export function shareMap(month: string): string {
  const held = H.out_of_state[month] ?? {};
  const w = 11 * (TILE_W + TILE_GAP) + 8;
  const h = 8 * (TILE_W + TILE_GAP) + 8;
  const tiles = STATES.map((s) => {
    const [cx, cy] = center(s.code)!;
    const [all, out] = held[s.code] ?? [0, 0];
    const share = all ? out / all : 0;
    const band = all < FEW ? 'few' : `b${SHARE_BANDS.filter((t) => share >= t).length}`;
    const sub = all < FEW ? (all ? 'few' : '') : pct(share);
    const label = all < FEW ? `${s.name}: ${fmt(all)} arrangements, too few to show a share` : `${s.name}: ${pct(share)} of ${fmt(all)} arrangements with a pharmacy in another state`;
    return `<g class="sh-tile ${band}" data-code="${s.code}"><rect class="sh-rect" x="${cx - TILE_W / 2}" y="${cy - TILE_W / 2}" width="${TILE_W}" height="${TILE_W}" rx="6"/><text class="sh-code" x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="15">${s.code}</text><text class="sh-sub" data-sub x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="12">${sub}</text><title>${label}</title></g>`;
  });
  return `<svg class="sh-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Map of the states on ${monthLong(month)}, each shaded by the share of its entities' contract pharmacy arrangements with a pharmacy in another state.">${tiles.join('')}</svg>`;
}

/** Median of the states' out-of-state shares (states with at least FEW arrangements). */
export function medianShare(month: string): number {
  const v = Object.values(H.out_of_state[month] ?? {}).filter(([a]) => a >= FEW).map(([a, o]) => o / a).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)]! : 0;
}

/** Arrangements reaching each state's pharmacies from entities in other states, for two months. */
export function inbound(then: string, now: string, keep = 10): { code: string; state: string; then: number; now: number }[] {
  const count = (m: string): Map<string, number> => {
    const c = new Map<string, number>();
    for (const [a, b, k] of H.flows[m] ?? []) if (a !== b) c.set(b, (c.get(b) ?? 0) + k);
    return c;
  };
  const t = count(then);
  const n = count(now);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, keep).map(([s, v]) => ({ code: s, state: stateName(s), then: t.get(s) ?? 0, now: v }));
}

/** The pairs of states behind a flow map, for its table. */
export function flowRows(month: string, keep = 15): { from: string; to: string; n: number }[] {
  return (H.flows[month] ?? []).slice(0, keep).map(([a, b, n]) => ({ from: stateName(a), to: stateName(b), n }));
}

// ---------- The laws: a tile map by year, and one small chart per state ----------

export function lawMap(): string {
  const byState = new Map<string, Law>();
  for (const l of H.laws) if (l.effective && !byState.has(l.state)) byState.set(l.state, l);
  const pending = new Set(H.laws.filter((l) => !l.effective).map((l) => l.state));
  const w = 11 * (TILE_W + TILE_GAP) + 8;
  const h = 8 * (TILE_W + TILE_GAP) + 8;
  const tiles = STATES.map((s) => {
    const [cx, cy] = center(s.code)!;
    const l = byState.get(s.code);
    const year = l ? Number(l.effective.slice(0, 4)) : 0;
    const cls = l ? `ly${Math.min(Math.max(year, 2021), 2026)}` : pending.has(s.code) ? 'lpend' : 'lnone';
    const sub = l ? String(year) : pending.has(s.code) ? 'date?' : '';
    const label = l ? `${s.name}: contract pharmacy law in effect from ${l.effective}` : pending.has(s.code) ? `${s.name}: contract pharmacy law, effective date not printed in the saved text` : `${s.name}: no contract pharmacy law in the ClinX table`;
    return `<g class="lm-tile"><rect class="lm-rect ${cls}" x="${cx - TILE_W / 2}" y="${cy - TILE_W / 2}" width="${TILE_W}" height="${TILE_W}" rx="8"/><text class="lm-code" x="${cx}" y="${cy + 1}" text-anchor="middle" font-size="15">${s.code}</text><text class="lm-sub" x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="10.5">${sub}</text><title>${label}</title></g>`;
  });
  return `<svg class="lm-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Map of the states, shaded by the year a state's 340B contract pharmacy law took effect.">${tiles.join('')}</svg>`;
}

/** The first law with an effective date for each state, in date order. */
export function lawStates(): Law[] {
  const seen = new Set<string>();
  return H.laws.filter((l) => l.effective && !seen.has(l.state) && seen.add(l.state));
}

/**
 * One small chart: a state's arrangements by month from 2018, with the day its law took effect.
 * Each chart has its own scale (the number at its top), so the shape, not the height, compares.
 */
export function smallMultiple(code: string, effective: string): string {
  const w = 240;
  const h = 110;
  const l = 6;
  const r = 6;
  const t = 22;
  const b = 18;
  const start = H.months.indexOf('2018-01');
  const v = H.states[code]?.arrangements.slice(start) ?? [];
  const months = H.months.slice(start);
  const n = v.length;
  const max = Math.max(...v, 1);
  const x = (i: number): number => l + (i / (n - 1)) * (w - l - r);
  const y = (val: number): number => t + (h - t - b) - (val / max) * (h - t - b);
  const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  const ei = months.indexOf(effective.slice(0, 7));
  const law = ei >= 0 ? `<line class="sm-law" x1="${x(ei).toFixed(1)}" x2="${x(ei).toFixed(1)}" y1="${t - 4}" y2="${h - b}"/><circle class="sm-law-dot" cx="${x(ei).toFixed(1)}" cy="${t - 4}" r="3.5"/>` : '';
  const area = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${pts} ${x(n - 1).toFixed(1)},${y(0).toFixed(1)}`;
  return `<svg class="sm-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${stateName(code)}: contract pharmacy arrangements held by its entities, January 2018 to ${monthShort(months[n - 1]!)}, from ${fmt(v[0] ?? 0)} to ${fmt(v[n - 1] ?? 0)}; the law took effect ${effective}."><line class="sm-base" x1="${l}" x2="${w - r}" y1="${y(0)}" y2="${y(0)}"/><polygon class="sm-fill" points="${area}"/><polyline class="sm-line" points="${pts}"/>${law}<text class="sm-tick" x="${l}" y="${h - 3}" font-size="10">2018</text><text class="sm-tick" x="${w - r}" y="${h - 3}" font-size="10" text-anchor="end">${months[n - 1]!.slice(0, 4)}</text><text class="sm-max" x="${w - r}" y="12" font-size="10.5" text-anchor="end">${fmt(max)}</text></svg>`;
}

/** Arrangements held by a state's entities a year before and a year after its law took effect. */
export function aroundLaw(code: string, effective: string): { before: number; at: number; after: number | null } {
  const m = effective.slice(0, 7);
  const i = H.months.indexOf(m);
  const s = H.states[code]?.arrangements ?? [];
  return { before: s[i - 12] ?? 0, at: s[i] ?? 0, after: i + 12 < s.length ? s[i + 12]! : null };
}

/**
 * The numbers the time-lapse needs (src/scripts/registry-charts.ts): for each January with a flow
 * table, every state's band and share, and the arrangements reaching the given pharmacy states.
 */
export function timeLapse(states: { code: string }[]): string {
  const months = Object.keys(H.out_of_state).filter((m) => m.endsWith('-01')).sort();
  const share: Record<string, (number | null)[]> = {};
  for (const s of STATES) {
    share[s.code] = months.map((m) => {
      const [all, out] = H.out_of_state[m]?.[s.code] ?? [0, 0];
      return all < FEW ? null : Math.round((out / all) * 1000) / 1000;
    });
  }
  const inb: Record<string, number[]> = {};
  for (const { code } of states) {
    inb[code] = months.map((m) => (H.flows[m] ?? []).reduce((a, [x, y, k]) => (y === code && x !== code ? a + k : a), 0));
  }
  return JSON.stringify({ months, bands: SHARE_BANDS, share, inbound: inb });
}

/** Median of the numbers given (none: null). */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface AlignedRow {
  code: string;
  state: string;
  effective: string;
  /** Index (law month = 100) at each offset from -SPAN to +SPAN; null outside the record. */
  index: (number | null)[];
}

const SPAN = 24;
export const MIN_STATES = 5;

/**
 * Every law state's arrangements, indexed to 100 in the month its law took effect, two years
 * either side; with the median state and the nation over the same months as the reference.
 */
export function lawAligned(): { rows: AlignedRow[]; median: (number | null)[]; nation: (number | null)[] } {
  const nat = H.national.arrangements;
  const rows: AlignedRow[] = [];
  const natRows: (number | null)[][] = [];
  for (const l of lawStates()) {
    const i = H.months.indexOf(l.effective.slice(0, 7));
    const s = H.states[l.state]?.arrangements ?? [];
    if (i < 0 || !s[i]) continue;
    const pick = (arr: number[]): (number | null)[] =>
      Array.from({ length: 2 * SPAN + 1 }, (_, k) => {
        const j = i - SPAN + k;
        return j >= 0 && j < arr.length ? Math.round((arr[j]! / arr[i]!) * 1000) / 10 : null;
      });
    rows.push({ code: l.state, state: stateName(l.state), effective: l.effective, index: pick(s) });
    natRows.push(pick(nat));
  }
  // The median and the country are drawn only where at least five states have the month.
  const col = (rs: (number | null)[][], k: number): number[] => rs.map((r) => r[k]).filter((v): v is number => v !== null);
  const enough = (k: number): boolean => col(rows.map((r) => r.index), k).length >= MIN_STATES;
  const med = Array.from({ length: 2 * SPAN + 1 }, (_, k) => (enough(k) ? median(col(rows.map((r) => r.index), k)) : null));
  const nation = Array.from({ length: 2 * SPAN + 1 }, (_, k) => (enough(k) ? median(col(natRows, k)) : null));
  return { rows, median: med, nation };
}

function alignedSvg(size: Size): string {
  const { rows, median: med, nation } = lawAligned();
  const wide = size === 'wide';
  const f = wide ? { w: 1040, h: 420, l: 56, r: 170, t: 30, b: 40 } : { w: 360, h: 300, l: 40, r: 14, t: 24, b: 34 };
  const fs = wide ? 13 : 11;
  const pw = f.w - f.l - f.r;
  const ph = f.h - f.t - f.b;
  const lo = 40;
  const hi = 200;
  const x = (k: number): number => f.l + (k / (2 * SPAN)) * pw;
  const y = (v: number): number => f.t + ph - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * ph;
  const path = (vals: (number | null)[]): string => {
    let d = '';
    let pen = false;
    vals.forEach((v, k) => {
      if (v === null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const parts: string[] = [];
  parts.push(`<rect class="la-after" x="${x(SPAN).toFixed(1)}" y="${f.t}" width="${(pw / 2).toFixed(1)}" height="${ph}"/>`);
  for (const t of [50, 100, 150, 200]) {
    parts.push(`<line class="${t === 100 ? 'la-base' : 'rx-grid'}" x1="${f.l}" x2="${f.l + pw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    parts.push(`<text class="rx-tick" x="${f.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" font-size="${fs}">${t}</text>`);
  }
  for (const k of wide ? [-24, -12, 0, 12, 24] : [-24, 0, 24]) {
    const label = k === 0 ? 'Law in effect' : `${k > 0 ? '+' : ''}${k / 12} yr`;
    parts.push(`<text class="rx-tick${k === 0 ? ' la-zero-text' : ''}" x="${x(k + SPAN).toFixed(1)}" y="${f.h - f.b + 22}" text-anchor="middle" font-size="${fs}">${label}</text>`);
  }
  parts.push(`<line class="la-zero" x1="${x(SPAN).toFixed(1)}" x2="${x(SPAN).toFixed(1)}" y1="${f.t - 6}" y2="${f.t + ph}"/>`);
  if (wide) {
    parts.push(`<text class="la-side" x="${(x(SPAN) - 10).toFixed(1)}" y="${f.t + 14}" text-anchor="end" font-size="${fs - 1}">Before the law</text>`);
    parts.push(`<text class="la-side" x="${(x(SPAN) + 10).toFixed(1)}" y="${f.t + 14}" font-size="${fs - 1}">After</text>`);
  }
  for (const r of rows) {
    const after = r.index.filter((v, k) => k > SPAN && v !== null).length;
    parts.push(`<path class="la-state" d="${path(r.index)}"><title>${r.state}, law in effect ${r.effective}: ${r.index[0] ?? '?'} two years before, ${r.index[SPAN + Math.min(after, 12)] ?? '?'} ${after >= 12 ? 'a year after' : `${after} months after`}</title></path>`);
  }
  parts.push(`<path class="la-nation" d="${path(nation)}"/>`);
  parts.push(`<path class="la-median" d="${path(med)}"/>`);
  parts.push(`<circle class="la-dot" cx="${x(SPAN).toFixed(1)}" cy="${y(100).toFixed(1)}" r="5"/>`);
  if (wide) {
    const lastK = (vals: (number | null)[]): number => vals.reduce<number>((a, v, k) => (v !== null ? k : a), 0);
    const ends = [
      { k: lastK(med), v: med[lastK(med)]!, a: 'Median law state', cls: 'la-end-med' },
      { k: lastK(nation), v: nation[lastK(nation)]!, a: 'The nation, same months', cls: 'la-end-nat' },
    ].sort((p, q) => y(p.v) - y(q.v));
    let prev = -Infinity;
    for (const e of ends) {
      const ty = Math.max(y(e.v) + 4, prev + 2 * fs + 8);
      prev = ty;
      parts.push(`<text class="rx-end-label ${e.cls}" x="${x(2 * SPAN) + 12}" y="${ty.toFixed(1)}" font-size="${fs}"><tspan class="rx-end-value" x="${x(2 * SPAN) + 12}">${Math.round(e.v)}</tspan><tspan x="${x(2 * SPAN) + 12}" dy="${fs + 3}">${e.a}</tspan></text>`);
    }
  }
  return `<svg class="rx-svg rx-${size} la-svg" viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="Arrangements held by each law state's entities, indexed to 100 in the month its law took effect, two years before and after, with the median law state and the nation over the same months.">${parts.join('')}</svg>`;
}

/** The aligned law chart in both sizes. */
export function lawAlignedChart(): { wide: string; narrow: string } {
  return { wide: alignedSvg('wide'), narrow: alignedSvg('narrow') };
}


/** Arrangements in force each month by the year they began (tools/cohorts.py). */
export const COHORTS = cohortsRaw as { months: string[]; years: number[]; layers: Record<string, number[]> };
