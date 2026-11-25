/**
 * The pictures of the bill family tree page (src/pages/bills/family/index.astro), drawn at build time so the
 * page holds them without JavaScript:
 *
 * - The family on the site's 340B tile map (src/lib/state-map.ts). A state is filled when one of its texts
 *   is law, outlined when it holds only bills. An arc runs to each text from its closest earlier text in
 *   another state, curved by d3-shape, thicker the longer the passage they share.
 * - The family as a tree, laid out by d3-hierarchy (src/lib/family-layout.ts): a tidy tree for a wide
 *   screen and an indented tree with full names for a phone.
 *
 * src/scripts/bill-family.ts steps the map through time, fills its readout card and folds the tree.
 */
import { curveNatural, line } from 'd3-shape';
import { LINK_LABEL, childrenOf, edgeWidth, esc, fmt, fullName, isLaw, memberHref, parentLink, shortName, statusOf, yearOf, type Family, type FamilyData, type Member } from './bill-family';
import { LAYOUT, layFamily, type LayoutKind } from './family-layout';
import { STATES, TILE, stateMapSvg } from './state-map';
import { stateName } from './states';

// ---------- Shared words ----------

const norm = (w: string): string => w.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A passage cut around the words to mark in it: before, the marked words, after. Nothing marked if absent. */
export function markPassage(passage: string, words: string): [string, string, string] {
  const toks = passage.split(/\s+/).filter(Boolean);
  const want = words.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return [passage, '', ''];
  const at = toks.findIndex((_, k) => want.every((w, j) => norm(toks[k + j] ?? '') === w));
  if (at < 0) return [passage, '', ''];
  return [toks.slice(0, at).join(' '), toks.slice(at, at + want.length).join(' '), toks.slice(at + want.length).join(' ')];
}

// ---------- The map ----------

/** The month a text joins the map: "2025-02". */
export const monthOf = (m: Member): string => m.order.slice(0, 7);

/** The month a text is law: a law's own day, or for a bill that became law, the day of the law it became. */
function lawMonth(data: FamilyData, m: Member): string {
  if (!isLaw(m)) return '';
  if (m.type === 'law') return monthOf(m);
  const law = [...data.members.values()].find((x) => x.type === 'law' && x.lawId === m.lawId);
  return law ? monthOf(law) : monthOf(m);
}

/** Every month from the first to the last, "2023-08" to "2026-10". */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, mo] = first.split('-').map(Number) as [number, number];
  for (let at = first; at <= last; ) {
    out.push(at);
    mo += 1;
    if (mo > 12) [y, mo] = [y + 1, 1];
    at = `${y}-${String(mo).padStart(2, '0')}`;
  }
  return out;
}

/** The room around the tile grid in src/lib/state-map.ts, so an arc meets the middle of a tile. */
const MAP_PAD = 10;
const centre = (code: string): [number, number] => {
  const t = STATES.find((s) => s.code === code)!;
  const step = TILE.size + TILE.gap;
  return [MAP_PAD + t.col * step + TILE.size / 2, MAP_PAD + t.row * step + TILE.size / 2];
};
const arcLine = line<[number, number]>().curve(curveNatural);

export interface MapStateCard {
  code: string;
  name: string;
  first: string;
  law: string;
  texts: {
    id: string;
    name: string;
    year: string;
    month: string;
    status: string;
    law: boolean;
    href: string;
    parent: string;
    across: boolean;
    kind: string;
    shared: string;
    longest: string;
    passage: [string, string, string];
  }[];
}

export interface FamilyMap {
  svg: string;
  /** The months the scrubber steps through. */
  months: string[];
  /** Each state's card and the months its tile turns on, for the script. */
  cards: Record<string, MapStateCard>;
  /** How many arcs are drawn. */
  arcs: number;
}

export interface MapOptions {
  id: string;
  title: string;
  desc: string;
  /** Only these texts: their states, and arcs into them. */
  only?: ReadonlySet<string>;
  /** Words to mark in each shared passage. */
  mark?: string;
  /** Extra class names on the picture. */
  class?: string;
}

/** The family on the tile map, as it stands today; the script winds it back to any month. */
export function familyMap(data: FamilyData, family: Family, o: MapOptions): FamilyMap {
  const texts = family.members.map((id) => data.members.get(id)!).filter((m) => !o.only || o.only.has(m.id));
  const cards: Record<string, MapStateCard> = {};
  for (const m of texts) {
    const c = (cards[m.state] ??= { code: m.state, name: stateName(m.state), first: monthOf(m), law: '', texts: [] });
    if (monthOf(m) < c.first) c.first = monthOf(m);
    const lm = lawMonth(data, m);
    if (lm && (!c.law || lm < c.law)) c.law = lm;
    const link = parentLink(data, m.id);
    const p = m.parent ? data.members.get(m.parent) : undefined;
    c.texts.push({
      id: m.id,
      name: fullName(m),
      year: yearOf(m),
      month: monthOf(m),
      status: statusOf(m),
      law: isLaw(m),
      href: memberHref(m),
      parent: p ? fullName(p) : '',
      across: Boolean(p && p.state !== m.state),
      kind: link ? LINK_LABEL[link.kind] : '',
      shared: link ? fmt(link.sharedWords) : '',
      longest: link ? fmt(link.longestWords) : '',
      passage: link ? markPassage(link.longestPassage, o.mark ?? '') : ['', '', ''],
    });
  }
  for (const c of Object.values(cards)) c.texts.sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));

  const label = (c: MapStateCard): string => {
    const laws = c.texts.filter((t) => t.law).length;
    return `${c.texts.length} ${c.texts.length === 1 ? 'text' : 'texts'} in the family${laws ? `, ${laws} law` : ''}`;
  };
  let svg = stateMapSvg({
    id: o.id,
    title: o.title,
    desc: o.desc,
    class: ['fm', o.class].filter(Boolean).join(' '),
    tile: (place) => {
      const c = cards[place.code];
      if (!c) return { tone: 'none' };
      return { tone: c.law ? 'has' : 'next', href: `#o-${c.texts[0]!.id}`, label: label(c), card: true };
    },
  });

  // The arcs: one to each text from its parent in another state, in the order they were filed.
  const arcs = texts
    .map((m) => ({ m, p: m.parent ? data.members.get(m.parent) : undefined }))
    .filter((x): x is { m: Member; p: Member } => Boolean(x.p && x.p.state !== x.m.state))
    .sort((a, b) => a.m.order.localeCompare(b.m.order));
  const seen = new Map<string, number>();
  const parts = arcs.map(({ m, p }) => {
    const [ax, ay] = centre(p.state);
    const [bx, by] = centre(m.state);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    // Several texts between the same two states fan out, each a little rounder than the last.
    const pair = [p.state, m.state].sort().join('-');
    const k = seen.get(pair) ?? 0;
    seen.set(pair, k + 1);
    const bend = len * (0.18 + 0.09 * k);
    const mid: [number, number] = [ax + dx / 2 - (dy / len) * bend, ay + dy / 2 + (dx / len) * bend];
    // Start and end a little inside each tile's edge, so the state's letters stay clear.
    const trim = (x: number, y: number): [number, number] => {
      const tx = mid[0] - x;
      const ty = mid[1] - y;
      const t = Math.hypot(tx, ty);
      return [x + (tx / t) * 15, y + (ty / t) * 15];
    };
    const a = trim(ax, ay);
    const b = trim(bx, by);
    const link = parentLink(data, m.id)!;
    const w = edgeWidth(link.longestWords).toFixed(2);
    const attrs = `data-id="${m.id}" data-from="${p.id}" data-states="${p.state} ${m.state}" data-when="${monthOf(m)}"`;
    const d = arcLine([a, mid, b]) ?? '';
    return `<path class="fm-arc" d="${d}" stroke-width="${w}" pathLength="1" ${attrs}/><circle class="fm-end" cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="3.4" ${attrs}/>`;
  });
  svg = svg.replace(/<\/svg>$/, `<g class="fm-arcs" aria-hidden="true">${parts.join('')}</g></svg>`);

  const firsts = texts.map(monthOf).sort();
  return { svg, months: monthsBetween(firsts[0]!, firsts.at(-1)!), cards, arcs: arcs.length };
}

// ---------- The tree ----------

export interface TreeOptions {
  id: string;
  title: string;
  desc: string;
  layout: LayoutKind;
  /** True to give each branch a button that folds it. */
  fold?: boolean;
  /** Texts to draw lit; the rest are drawn faint. */
  hot?: ReadonlySet<string>;
}

/** The label beside a dot in the tidy tree: "LA Act 358 of 2023", "MA H 1296". */
const tag = (m: Member): string => `${m.state} ${shortName(m)}`;
/** The whole label in the tidy tree, year and all. */
const tidyLabel = (m: Member): string => (tag(m).includes(yearOf(m)) ? tag(m) : `${tag(m)} ${yearOf(m)}`);
/** Room a label needs, in SVG units, at the tree's type size (an estimate; the browser measures). */
const textWidth = (s: string): number => s.length * 6.4;

/** The family as a tree, laid out by d3-hierarchy. */
export function familyTreeSvg(data: FamilyData, family: Family, o: TreeOptions): string {
  const rows = family.members.map((id) => data.members.get(id)!);
  const M = (id: string): Member => data.members.get(id)!;
  const fold = o.fold ? 22 : 0;
  // Each label sits right of its dot; in the tidy tree a branch's lines leave from the end of its label
  // (the browser measures the labels and lays the tree out again, so this estimate never shows for long).
  const words = (m: Member): string => (o.layout === 'tidy' ? tidyLabel(m) : fullName(m));
  const lead = new Map(rows.map((m) => [m.id, 10 + textWidth(words(m)) + (o.fold && childrenOf(data, m.id).length ? 23 : 6)]));
  const laid = layFamily(
    rows.map((m) => ({ id: m.id, parent: m.parent, order: m.order })),
    o.layout,
    new Set(),
    lead,
  );
  let right = 0;
  for (const n of laid.nodes) right = Math.max(right, n.x + 12 + textWidth(words(M(n.id))) + fold);
  const x0 = -LAYOUT.tidy.pad;
  const width = Math.ceil(right - x0 + LAYOUT.tidy.pad);
  const top = Math.floor(laid.top);
  const height = Math.ceil(laid.height);

  const hot = o.hot;
  const edges = laid.edges.map((e) => {
    const m = M(e.id);
    const p = M(m.parent);
    const link = parentLink(data, m.id);
    const cls = ['ft-e', p.state !== m.state ? 'across' : 'home', hot && !hot.has(m.id) ? 'faint' : ''].filter(Boolean).join(' ');
    return `<path class="${cls}" data-edge="${m.id}" d="${e.d}" stroke-width="${edgeWidth(link?.longestWords ?? 0).toFixed(2)}"/>`;
  });

  const nodes = laid.nodes.map((n) => {
    const m = M(n.id);
    const cls = ['ft-n', isLaw(m) ? 'law' : 'bill', hot && !hot.has(m.id) ? 'faint' : ''].filter(Boolean).join(' ');
    const said = `${fullName(m)}, ${yearOf(m)}, ${statusOf(m)}${m.parent ? `, under ${fullName(M(m.parent))}` : ', the earliest text'}`;
    let text: string;
    let fx = 0;
    let fy = -7;
    if (o.layout === 'tidy') {
      const t = tag(m);
      text = `<text x="10" dy="0.33em">${esc(t)}${t.includes(yearOf(m)) ? '' : ` <tspan class="ft-y">${yearOf(m)}</tspan>`}</text>`;
      fx = 10 + textWidth(tidyLabel(m)) + 4;
      fy = -7.5;
    } else {
      const name = fullName(m);
      text = `<text x="12" y="-3">${esc(name)}</text><text class="ft-sub" x="12" y="12">${yearOf(m)} · ${esc(statusOf(m))}</text>`;
      fx = 12 + textWidth(name) + 6;
      fy = -15;
    }
    const button =
      o.fold && n.under
        ? `<g class="ft-fold" role="button" tabindex="0" aria-expanded="true" aria-label="Fold the ${n.under} ${n.under === 1 ? 'text' : 'texts'} under ${esc(fullName(m))}" data-fold="${m.id}" transform="translate(${fx.toFixed(1)},${fy})"><rect width="15" height="15" rx="3"/><path d="M4 7.5h7"/><path class="ft-v" d="M7.5 4v7"/><text class="ft-count" x="19" y="11.5"></text></g>`
        : '';
    return `<g class="ft-g" data-id="${m.id}" data-parent="${m.parent}" data-order="${m.order}" transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})"><g class="ft-in"><a class="${cls}" href="#o-${m.id}" data-id="${m.id}" aria-label="${esc(said)}"><rect class="ft-hit" x="-8" y="-12" width="${Math.ceil(20 + textWidth(words(m)))}" height="24"/><circle r="${o.layout === 'tidy' ? 5.5 : 5}"/>${text}</a>${button}</g></g>`;
  });

  const classes = ['ft', `ft-${o.layout}`, hot ? 'ft-hot' : ''].filter(Boolean).join(' ');
  const meta = esc(JSON.stringify({ layout: o.layout, x0, width }));
  return [
    `<svg class="${classes}" id="${o.id}" viewBox="${x0} ${top} ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="${o.id}-t ${o.id}-d" data-ft="${meta}">`,
    `<title id="${o.id}-t">${esc(o.title)}</title><desc id="${o.id}-d">${esc(o.desc)}</desc>`,
    `<g class="ft-edges">${edges.join('')}</g><g class="ft-nodes">${nodes.join('')}</g>`,
    '</svg>',
  ].join('');
}

