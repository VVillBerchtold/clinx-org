/**
 * The patient field at the top of /preview/court-map-dy1tfv40/: one dot per 10,000 health center patients (2025) in the
 * 22 states with a contract-pharmacy law. The page draws the field on the server in its final state. On wide
 * screens the page's script (src/scripts/court-map.ts) calls the same layout to gather the dots into one field and
 * part them again as the reader scrolls; on a phone the field is drawn parted and simply scrolls.
 *
 * Every cluster is packed as a Vogel spiral (r = c·√i, θ = i·137.508°): a round silhouette whose area is true to
 * the count, with no ragged last row and nothing random, so the layout is the same on every load.
 *
 * Final state, wide: upheld (the 5th and 8th Circuits) to the left of a hairline axis; the 4th Circuit and the
 * district rulings (North Dakota, Oklahoma) to the right; the six circuits that have not ruled on the axis.
 * Phone: every cluster on the axis, top to bottom in reading order, names to the left and figures to the right;
 * Oklahoma's dots sit beside the Tenth Circuit's.
 *
 * The layout places things and names them by key; the page writes the words for each key.
 */

export type Kind = 'up' | 'none' | 'dist' | 'vac';
export interface Counts {
  /** Upheld, by circuit: the 5th, then the 8th. */
  up: number[];
  /** The no-ruling dots, one count per circuit, in the order the clusters are drawn. */
  clusters: number[];
  /** Index into clusters of the Tenth Circuit, whose leader points at the Oklahoma dots. */
  tenth: number;
  /** District rulings against the laws, by state: Oklahoma (10th Circuit), then North Dakota (8th). */
  dist: number[];
  vac: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Disc extends Pt {
  R: number;
}
export interface Spec {
  name: 'wide' | 'narrow';
  w: number;
  /** Dot radius. */
  r: number;
  /** Spiral constant: neighbours sit about 1.8c apart. */
  c: number;
  /** The one field's spiral constant (wide only). */
  cu: number;
  /** Type: label size, line step, group figure size, display figure size. */
  t: { lab: number; lh: number; fig: number; big: number };
}
/** A block of words: its key (the page writes the words), the group it fades in with, where its first baseline
 *  sits, and how many lines it may take. */
export interface Lab {
  key: string;
  g: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  lines: number;
}
/** A 1px leader: a polyline in the label tone, with an optional 3px tick at its end. */
export interface Lead {
  g: string;
  pts: Pt[];
  tick: boolean;
}
export interface FieldLayout {
  h: number;
  kinds: Kind[];
  /** The cluster of each dot within its group: the circuit for none and up, the state for dist. */
  cl: number[];
  uni: Pt[];
  fin: Pt[];
  /** Each dot's place at each step, 0 to 3: at[0] is uni and at[3] is fin. */
  at: Pt[][];
  /** How far each dot sits from the middle of its cluster, 0 to 1: the inner dots land first. */
  depth: number[];
  axis: { x: number; y1: number; y2: number };
  all: Disc;
  labs: Lab[];
  leads: Lead[];
}

export const WIDE: Spec = { name: 'wide', w: 1100, r: 3, c: 4.6, cu: 4.6, t: { lab: 11.5, lh: 16, fig: 22, big: 40 } };
export const NARROW: Spec = { name: 'narrow', w: 358, r: 2, c: 3.1, cu: 3.1, t: { lab: 13, lh: 16, fig: 18, big: 30 } };

const GOLDEN = (137.508 * Math.PI) / 180;
function spiral(n: number, x: number, y: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const r = c * Math.sqrt(i + 0.5);
    out.push({ x: x + r * Math.cos(i * GOLDEN), y: y + r * Math.sin(i * GOLDEN) });
  }
  return out;
}
const radius = (n: number, c: number): number => c * Math.sqrt(n);
const byY = (a: Pt, b: Pt): number => a.y - b.y || a.x - b.x;
const byX = (a: Pt, b: Pt): number => a.x - b.x || a.y - b.y;
const sum = (a: number[]): number => a.reduce((s, n) => s + n, 0);

/** Two-line labels sit centred on the middle of their cluster: this is the first baseline. */
const twoLine = (S: Spec, y: number): number => y - S.t.lh / 2 + S.t.lab * 0.36;

export function layout(S: Spec, c: Counts): FieldLayout {
  const wide = S.name === 'wide';
  const total = sum(c.up) + sum(c.clusters) + sum(c.dist) + c.vac;
  const labs: Lab[] = [];
  const leads: Lead[] = [];
  const lab = (key: string, g: string, x: number, y: number, anchor: Lab['anchor'], lines: number): void => {
    labs.push({ key, g, x, y, anchor, lines });
  };
  const R = (n: number): number => radius(n, S.c);

  let ax: number;
  let h: number;
  const up: Disc[] = [];
  const none: Disc[] = [];
  const dist: Disc[] = [];
  let vac: Disc;
  let axis: FieldLayout['axis'];

  if (wide) {
    ax = S.w / 2;
    // The six courts that have not ruled, stacked on the axis, each named on one column to the left.
    const top = 64;
    let y = top;
    for (const n of c.clusters) {
      const r = R(n);
      none.push({ x: ax, y: y + r, R: r });
      y += 2 * r + 12;
    }
    const stackEnd = y - 12;
    const Rmax = Math.max(...none.map((d) => d.R));
    const colX = ax - Rmax - 24;
    none.forEach((d, i) => {
      lab(`none-${i}`, `c${i}`, colX, twoLine(S, d.y), 'end', 2);
      leads.push({ g: `c${i}`, pts: [{ x: d.x - d.R - 5, y: d.y }, { x: colX + 8, y: d.y }], tick: false });
    });
    lab('head-none', 'none', ax, stackEnd + 34, 'middle', 1);

    // Upheld: the 5th and 8th Circuits on the left, each beside the gap between two of the circuit labels, so
    // their words never meet.
    const ux = 110;
    const ru = c.up.map(R);
    up.push({ x: ux, y: (none[0]!.y + none[1]!.y) / 2, R: ru[0]! });
    up.push({ x: ux, y: (none[1]!.y + none[2]!.y) / 2, R: ru[1]! });
    const colU = ux + Math.max(...ru) + 26;
    up.forEach((d, i) => {
      lab(`up-${i}`, 'up', colU, twoLine(S, d.y), 'start', 2);
      leads.push({ g: 'up', pts: [{ x: d.x + d.R + 5, y: d.y }, { x: colU - 7, y: d.y }], tick: false });
    });
    lab('head-up', 'up', ux, up[0]!.y - up[0]!.R - 16, 'middle', 1);

    // The right column, its words left-aligned on one edge: the 4th Circuit, then the district rulings.
    const x0 = 830;
    const rv = R(c.vac);
    vac = { x: x0 + rv, y: 176, R: rv };
    lab('head-vac', 'vac', x0, vac.y - rv - 14 - S.t.lh, 'start', 2);
    // North Dakota and Oklahoma: two small clusters, one above the other, each named to its right. Oklahoma's sits
    // level with the Tenth Circuit, whose leader runs to it.
    const ten = none[c.tenth]!;
    const [nOk = 0, nNd = 0] = c.dist;
    const rOk = R(nOk);
    const rNd = R(nNd);
    dist.push({ x: x0 + rOk, y: ten.y, R: rOk });
    dist.push({ x: x0 + rOk, y: ten.y + rOk + 14 + rNd, R: rNd });
    const colD = x0 + 2 * rOk + 14;
    dist.forEach((d, i) => lab(`dist-${i}`, 'dist', colD, twoLine(S, d.y), 'start', 2));
    lab('head-dist', 'dist', x0, dist[1]!.y + rNd + 34, 'start', 2);
    leads.push({ g: 'tie', pts: [{ x: ten.x + ten.R + 6, y: ten.y }, { x: x0 - 10, y: ten.y }], tick: true });
    lab('tie', 'tie', ten.x + ten.R + 14, ten.y + 18, 'start', 2);

    axis = { x: ax, y1: 4, y2: stackEnd + 8 };
    h = stackEnd + 50;
  } else {
    // Phone: one column down the axis, in reading order. Names on the left, figures on the right.
    ax = 186;
    const all = [...c.up, ...c.clusters, c.vac, ...c.dist].map(R);
    const Rmax = Math.max(...all);
    const colL = ax - Rmax - 12;
    const colR = ax + Rmax + 12;
    let y = 0;
    /** A group's head, centred: its figure, then its words (either may be left out). */
    const head = (key: string, g: string, fig: boolean, words: boolean): void => {
      if (fig) y += S.t.fig;
      if (words) y += fig ? S.t.lh + 4 : S.t.lab;
      lab(key, g, S.w / 2, y - (words && fig ? S.t.lh + 4 : 0), 'middle', (fig ? 1 : 0) + (words ? 1 : 0));
      y += 14;
    };
    const place = (out: Disc[], n: number, key: string, g: string, lines: number, gap: number): Disc => {
      const r = R(n);
      const d = { x: ax, y: y + Math.max(r, lines === 2 ? S.t.lh - 2 : 0), R: r };
      out.push(d);
      lab(key, g, colL, lines === 2 ? twoLine(S, d.y) : d.y + S.t.lab * 0.36, 'end', lines);
      lab(`fig-${key}`, g, colR, d.y + S.t.lab * 0.36, 'start', 1);
      leads.push({ g, pts: [{ x: d.x - d.R - 5, y: d.y }, { x: colL + 6, y: d.y }], tick: false });
      y = d.y + Math.max(r, lines === 2 ? S.t.lh - 2 : 0) + gap;
      return d;
    };
    head('head-up', 'up', true, true);
    c.up.forEach((n, i) => place(up, n, `up-${i}`, 'up', 2, 12));
    y += 18;
    head('head-none', 'none', true, true);
    // The Oklahoma dots (a district ruling, in the Tenth Circuit) sit beside the Tenth Circuit's cluster, at the
    // right edge, joined to it by a short leader and named under it. North Dakota's come at the end.
    const [nOk = 0, nNd = 0] = c.dist;
    const rOk = R(nOk);
    c.clusters.forEach((n, i) => {
      if (i !== c.tenth) {
        place(none, n, `none-${i}`, `c${i}`, 1, 10);
        return;
      }
      const ten = place(none, n, `none-${i}`, `c${i}`, 2, 10);
      const ok = { x: S.w - rOk - 2, y: ten.y, R: rOk };
      dist.push(ok);
      for (const L of labs) if (L.key === `fig-none-${i}`) L.y -= 9;
      leads.push({ g: 'tie', pts: [{ x: ten.x + ten.R + 5, y: ten.y }, { x: ok.x - ok.R - 5, y: ten.y }], tick: false });
      const ly = ok.y + ok.R + 15;
      lab('ok', 'dist', S.w, ly, 'end', 2);
      y = Math.max(y, ly + S.t.lh + 14);
    });
    const stackEnd = y - 10;
    y += 18;
    head('head-vac', 'vac', false, true);
    const vacs: Disc[] = [];
    vac = place(vacs, c.vac, 'vac-0', 'vac', 2, 12);
    y += 18;
    head('head-dist', 'dist', false, true);
    place(dist, nNd, 'dist-1', 'dist', 2, 12);
    axis = { x: ax, y1: up[0]!.y - up[0]!.R - 6, y2: stackEnd + 6 };
    h = y + 4;
  }

  // ---- The dots, in a fixed order: upheld by circuit, the six courts, district by state, then the 4th ----
  const groups: { k: Kind; discs: Disc[]; counts: number[] }[] = [
    { k: 'up', discs: up, counts: c.up },
    { k: 'none', discs: none, counts: c.clusters },
    { k: 'dist', discs: dist, counts: c.dist },
    { k: 'vac', discs: [vac], counts: [c.vac] },
  ];
  const kinds: Kind[] = [];
  const cl: number[] = [];
  const fin: Pt[] = [];
  const depth: number[] = [];
  for (const G of groups) {
    G.discs.forEach((d, j) => {
      for (const p of spiral(G.counts[j]!, d.x, d.y, S.c)) {
        kinds.push(G.k);
        cl.push(j);
        fin.push(p);
        depth.push(Math.min(1, Math.hypot(p.x - d.x, p.y - d.y) / Math.max(1, d.R)));
      }
    });
  }

  // ---- Wide: the one field, a single spiral cut into the groups by where each is going ----
  const all: Disc = wide ? { x: ax, y: radius(total, S.cu) + 34, R: radius(total, S.cu) } : { x: ax, y: 0, R: 0 };
  let at: Pt[][] = [fin, fin, fin, fin];
  let uni: Pt[] = fin;
  if (wide) {
    const U = spiral(total, all.x, all.y, S.cu);
    const nUp = sum(c.up);
    const against = sum(c.dist) + c.vac;
    const sx = [...U].sort(byX);
    const pool: Record<Kind, Pt[]> = {
      up: sx.slice(0, nUp),
      none: sx.slice(nUp, total - against).sort(byY),
      dist: [],
      vac: [],
    };
    const right = sx.slice(total - against).sort(byY);
    pool.vac = right.slice(0, c.vac);
    pool.dist = right.slice(c.vac);
    // Within a group, start places are handed out top to bottom, cluster by cluster, each cluster's dots matched
    // top to bottom too, so the dots fan out rather than cross.
    uni = new Array<Pt>(total);
    for (const k of ['up', 'none', 'dist', 'vac'] as Kind[]) {
      const idx = kinds.flatMap((kk, i) => (kk === k ? [i] : []));
      const sorted = [...idx].sort((a, b) => cl[a]! - cl[b]! || byY(fin[a]!, fin[b]!));
      const from = k === 'up' || k === 'dist' ? [...pool[k]].sort(byY) : pool[k];
      sorted.forEach((i, j) => {
        uni[i] = from[j]!;
      });
    }
    // Between: the dots still to move gather on the axis, so nothing is left as a ragged remainder.
    const noneI = kinds.flatMap((k, i) => (k === 'none' ? [i] : [])).sort((a, b) => byY(uni[a]!, uni[b]!));
    const distI = kinds.flatMap((k, i) => (k === 'dist' ? [i] : [])).sort((a, b) => byY(uni[a]!, uni[b]!));
    const mid = { x: ax, y: all.y };
    const C1 = spiral(noneI.length + distI.length, mid.x, mid.y, S.c).sort(byX);
    const c1Dist = C1.slice(C1.length - distI.length).sort(byY);
    const c1None = C1.slice(0, C1.length - distI.length).sort(byY);
    const c2None = spiral(noneI.length, mid.x, mid.y, S.c).sort(byY);
    at = [uni, [...fin], [...fin], fin];
    noneI.forEach((i, j) => {
      at[1]![i] = c1None[j]!;
      at[2]![i] = c2None[j]!;
    });
    distI.forEach((i, j) => {
      at[1]![i] = c1Dist[j]!;
    });
    // The words for the one field sit to its left, centred on it.
    lab('all', 'all', all.x - all.R - 32, all.y - 6, 'end', 3);
  }

  return { h: Math.ceil(h), kinds, cl, uni, fin, at, depth, axis, all, labs, leads };
}
