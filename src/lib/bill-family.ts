/**
 * The bill family tree: state contract pharmacy bills and laws, each placed under the earlier text it shares
 * the most words with, word for word. Read from src/data/bill-family/340b-bill-family.json, which
 * scripts/bill-family.mjs builds from the bills folder's saved texts and the laws dataset's saved texts.
 *
 * In plain words: nothing here judges who copied whom. A link says two official texts hold the same
 * passage, and how long it is; the parent of a text is only the earlier one it shares the most with.
 * This file reads the tree for the page and draws its picture; it adds nothing to what the file says.
 */
import { billsPath } from './bills';
import { lawsPath } from './laws';
import { stateName } from './states';

export const FAMILY_HOME = '/bills/family/';

export const LINK_KINDS = ['carried-over', 'twins', 'filed-again', 'same-state', 'across-states'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** How each kind of link reads on the page. */
export const LINK_LABEL: Record<LinkKind, string> = {
  'carried-over': 'Same bill, listed again the next year',
  twins: 'Companion bill',
  'filed-again': 'Filed again in a later session',
  'same-state': 'Shares text, same state',
  'across-states': 'Shares text, another state',
};

export interface Member {
  id: string;
  type: 'bill' | 'law';
  state: string;
  /** The bill's number, as the table writes it. Blank for a law that names none. */
  number: string;
  session: string;
  /** The day it was introduced (a bill) or signed or took effect (a law); blank where none is on record. */
  date: string;
  /** Where it sorts in time: the date, or a stand-in day of its year. */
  order: string;
  sponsor: string;
  title: string;
  stage: string;
  /** The law it is, or became; blank for a bill that did not. */
  lawId: string;
  lawName: string;
  textUrl: string;
  textVersion: string;
  words: number;
  /** The earlier text it sits under; blank for a root. */
  parent: string;
  /** How many other texts it shares a counted passage with. */
  relatives: number;
}

export interface Link {
  a: string;
  b: string;
  kind: LinkKind;
  sharedWords: number;
  shareA: number;
  shareB: number;
  longestWords: number;
  /** The longest shared passage, in the earlier text's own words (cut at 70 words). */
  longestPassage: string;
  sameNumber: boolean;
  sameSponsor: string;
  sameLaw: boolean;
}

export interface Family {
  family: number;
  root: string;
  /** Root first, then each text before its own children (the order rows are drawn in). */
  members: readonly string[];
  states: readonly string[];
}

export interface FamilyData {
  built: string;
  rules: { minRun: number; minShared: number; minLongest: number };
  billsRetrieved: string;
  members: ReadonlyMap<string, Member>;
  links: readonly Link[];
  families: readonly Family[];
  alone: readonly string[];
  notCompared: readonly string[];
}

type Raw = Record<string, unknown>;
const str = (r: Raw, k: string): string => {
  const v = r[k];
  if (typeof v !== 'string') throw new Error(`Bill family file: "${k}" is not text`);
  return v;
};
const num = (r: Raw, k: string): number => {
  const v = r[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Bill family file: "${k}" is not a number`);
  return v;
};
const strs = (r: Raw, k: string): string[] => {
  const v = r[k];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`Bill family file: "${k}" is not a list of text`);
  return v as string[];
};

/** Reads the family document. Throws on anything unexpected, so a changed file stops the build. */
export function parseFamily(json: string): FamilyData {
  const d = JSON.parse(json) as Raw;
  const rules = d['rules'] as Raw;
  const sources = d['sources'] as Raw;
  const members = new Map<string, Member>();
  for (const r of d['members'] as Raw[]) {
    const type = str(r, 'type');
    if (type !== 'bill' && type !== 'law') throw new Error(`Bill family file: unknown member type "${type}"`);
    const state = str(r, 'state');
    stateName(state);
    members.set(str(r, 'id'), {
      id: str(r, 'id'),
      type,
      state,
      number: str(r, 'number'),
      session: str(r, 'session'),
      date: str(r, 'date'),
      order: str(r, 'order'),
      sponsor: str(r, 'sponsor'),
      title: str(r, 'title'),
      stage: str(r, 'stage'),
      lawId: str(r, 'law_id'),
      lawName: str(r, 'law_name'),
      textUrl: str(r, 'text_url'),
      textVersion: str(r, 'text_version'),
      words: num(r, 'words'),
      parent: str(r, 'parent'),
      relatives: num(r, 'relatives'),
    });
  }
  const known = (id: string): string => {
    if (!members.has(id)) throw new Error(`Bill family file: "${id}" is not a member`);
    return id;
  };
  const links = (d['links'] as Raw[]).map((r): Link => {
    const kind = str(r, 'kind');
    if (!(LINK_KINDS as readonly string[]).includes(kind)) throw new Error(`Bill family file: unknown link kind "${kind}"`);
    return {
      a: known(str(r, 'a')),
      b: known(str(r, 'b')),
      kind: kind as LinkKind,
      sharedWords: num(r, 'shared_words'),
      shareA: num(r, 'share_a'),
      shareB: num(r, 'share_b'),
      longestWords: num(r, 'longest_words'),
      longestPassage: str(r, 'longest_passage'),
      sameNumber: r['same_number'] === true,
      sameSponsor: str(r, 'same_sponsor'),
      sameLaw: r['same_law'] === true,
    };
  });
  for (const m of members.values()) if (m.parent) known(m.parent);
  const families = (d['families'] as Raw[]).map((r) => ({
    family: num(r, 'family'),
    root: known(str(r, 'root')),
    members: strs(r, 'members').map(known),
    states: strs(r, 'states'),
  }));
  return {
    built: str(d, 'built'),
    rules: { minRun: num(rules, 'min_run'), minShared: num(rules, 'min_shared'), minLongest: num(rules, 'min_longest') },
    billsRetrieved: str(sources['bills'] as Raw, 'retrieved'),
    members,
    links,
    families,
    alone: strs(d, 'alone').map(known),
    notCompared: strs(d, 'not_compared').map(known),
  };
}

let cached: FamilyData | undefined;
function rawFamily(): string {
  const modules = import.meta.glob('../data/bill-family/340b-bill-family.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const json = Object.values(modules)[0];
  if (json === undefined) throw new Error('src/data/bill-family/340b-bill-family.json is missing. Run: node scripts/bill-family.mjs');
  return json;
}
export function getFamily(): FamilyData {
  cached ??= parseFamily(rawFamily());
  return cached;
}

/** The columns of the links download, in order: the file's own names. */
export const LINK_COLUMNS = ['a', 'b', 'kind', 'shared_words', 'share_a', 'share_b', 'longest_words', 'longest_passage', 'same_number', 'same_sponsor', 'same_law'] as const;

/** Every link as CSV, one row each, written from the file as it is: served as /data/340b-bill-links.csv. */
export function linksCsv(json: string = rawFamily()): string {
  const d = JSON.parse(json) as { links: Record<string, unknown>[] };
  const cell = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [LINK_COLUMNS.join(','), ...d.links.map((l) => LINK_COLUMNS.map((c) => cell(l[c])).join(','))].join('\n') + '\n';
}

/** The link that puts a text under its parent. */
export function parentLink(data: FamilyData, id: string): Link | undefined {
  const m = data.members.get(id);
  if (!m?.parent) return undefined;
  return data.links.find((l) => l.a === m.parent && l.b === id);
}

/** The children of a text, earliest first. */
export function childrenOf(data: FamilyData, id: string): Member[] {
  return [...data.members.values()].filter((m) => m.parent === id).sort((p, q) => `${p.order}|${p.id}`.localeCompare(`${q.order}|${q.id}`));
}

/** "HB 2048" for a bill; the law's name ("Act 358 of 2023") for a law the bills table does not list. */
export function shortName(m: Member): string {
  return m.type === 'bill' ? m.number : m.lawName;
}

/** "Oklahoma HB 2048". */
export function fullName(m: Member): string {
  return `${stateName(m.state)} ${shortName(m)}`;
}

/** The year it was introduced, or the law's year. */
export function yearOf(m: Member): string {
  return (m.date || m.order).slice(0, 4);
}

/** Where it is on this site: a bill's card, or the law's card on its state's laws page. */
export function memberHref(m: Member): string {
  return m.type === 'bill' ? `${billsPath(m.state)}#${m.id}` : `${lawsPath(m.state)}#${m.lawId}`;
}

/** "Law", "Became law", or the bill's stage. */
export function statusOf(m: Member): string {
  if (m.type === 'law') return 'Law';
  if (m.lawId) return 'Became law';
  return m.stage || 'No step recorded';
}

export const isLaw = (m: Member): boolean => m.type === 'law' || m.lawId !== '';

/** A whole number with thousands marks. */
export const fmt = (n: number): string => n.toLocaleString('en-US');

/** States with a compared text, and how each one's texts sit: in the big family, in another family, or alone. */
export function stateRoles(data: FamilyData): Map<string, { big: number; other: number; alone: number; first: string }> {
  const big = new Set(data.families[0]?.members ?? []);
  const out = new Map<string, { big: number; other: number; alone: number; first: string }>();
  const ordered = [...data.members.values()].sort((p, q) => `${p.order}|${p.id}`.localeCompare(`${q.order}|${q.id}`));
  const alone = new Set(data.alone);
  for (const m of ordered) {
    const row = out.get(m.state) ?? { big: 0, other: 0, alone: 0, first: m.id };
    if (big.has(m.id)) row.big++;
    else if (alone.has(m.id)) row.alone++;
    else row.other++;
    out.set(m.state, row);
  }
  return out;
}

// ---------- The picture of one family ----------

const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Geometry of the tree picture, in SVG units. Text is 13 units, so it reads at about 12 px on a laptop. */
const G = { width: 880, nameW: 176, evidenceW: 96, pad: 16, top: 34, row: 26 } as const;

const dayNumber = (iso: string): number => {
  const [y, mo, d] = iso.split('-').map(Number);
  return Date.UTC(y!, (mo ?? 1) - 1, d ?? 1) / 86_400_000;
};

/**
 * One family as a time tree: a row for each text (root first, each text before its children), a dot at the
 * day it was introduced or signed, and an elbow from its parent's dot. Each row is a link to the text's place
 * in the list below, where the shared words are printed.
 */
export function familySvg(data: FamilyData, family: Family, id: string): string {
  const rows = family.members.map((mid) => data.members.get(mid)!);
  const years = rows.map((m) => Number(m.order.slice(0, 4)));
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  const start = dayNumber(`${y0}-01-01`);
  const end = dayNumber(`${y1 + 1}-01-01`);
  const gx0 = G.pad + G.nameW + 14;
  const gx1 = G.width - G.pad - G.evidenceW - 18;
  const xOf = (m: Member): number => gx0 + ((dayNumber(m.order) - start) / (end - start)) * (gx1 - gx0);
  const yOf = (i: number): number => G.top + i * G.row + G.row / 2;
  const height = G.top + rows.length * G.row + 8;
  const index = new Map(rows.map((m, i) => [m.id, i]));
  const parts: string[] = [
    `<svg class="bf-tree" viewBox="0 0 ${G.width} ${height}" width="${G.width}" height="${height}" role="group" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">Family ${family.family}: ${rows.length} bills and laws in ${family.states.length} ${family.states.length === 1 ? 'state' : 'states'}</title>`,
    `<desc id="${id}-d">Each row is one bill or law, placed by the day it was introduced or became law, ${y0} to ${y1}. A line joins it to the earlier text it shares the most words with. The list after the picture gives the same links with the shared words.</desc>`,
  ];
  // Year bands and labels.
  for (let y = y0; y <= y1; y++) {
    const a = gx0 + ((dayNumber(`${y}-01-01`) - start) / (end - start)) * (gx1 - gx0);
    const b = gx0 + ((dayNumber(`${y + 1}-01-01`) - start) / (end - start)) * (gx1 - gx0);
    if ((y - y0) % 2 === 1) parts.push(`<rect class="bf-band" x="${a.toFixed(1)}" y="${G.top - 6}" width="${(b - a).toFixed(1)}" height="${(height - G.top).toFixed(1)}"/>`);
    parts.push(`<text class="bf-year" x="${((a + b) / 2).toFixed(1)}" y="${G.top - 14}" text-anchor="middle">${y}</text>`);
  }
  parts.push(`<text class="bf-colhead" x="${G.pad}" y="${G.top - 14}">Bill or law</text>`);
  parts.push(`<text class="bf-colhead" x="${G.width - G.pad}" y="${G.top - 14}" text-anchor="end">Words shared</text>`);
  // Edges first, so dots sit on top.
  const edges: string[] = [];
  rows.forEach((m, i) => {
    if (!m.parent || !index.has(m.parent)) return;
    const p = data.members.get(m.parent)!;
    const link = parentLink(data, m.id);
    const px = xOf(p);
    const py = yOf(index.get(p.id)!);
    const cx = xOf(m);
    const cy = yOf(i);
    const r = Math.min(7, Math.max(0, cx - px));
    const d = r > 0 ? `M${px.toFixed(1)} ${py.toFixed(1)}V${(cy - r).toFixed(1)}Q${px.toFixed(1)} ${cy.toFixed(1)} ${(px + r).toFixed(1)} ${cy.toFixed(1)}H${cx.toFixed(1)}` : `M${px.toFixed(1)} ${py.toFixed(1)}V${cy.toFixed(1)}`;
    edges.push(`<path class="bf-edge k-${link?.kind ?? 'same-state'}" data-edge="${esc(m.id)}" d="${d}"/>`);
  });
  parts.push(`<g class="bf-edges">${edges.join('')}</g>`);
  rows.forEach((m, i) => {
    const y = yOf(i);
    const x = xOf(m);
    const link = parentLink(data, m.id);
    const top = i * G.row + G.top;
    const label = `${fullName(m)}, ${yearOf(m)}. ${statusOf(m)}.${link ? ` Shares ${fmt(link.sharedWords)} words with ${fullName(data.members.get(m.parent)!)}.` : ' The earliest text in this family.'}`;
    const dot = isLaw(m) ? `<circle class="bf-dot law" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5"/>` : `<circle class="bf-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/>`;
    parts.push(
      `<a class="bf-row" href="#o-${esc(m.id)}" data-id="${esc(m.id)}" aria-label="${esc(label)}">` +
        `<rect class="bf-hit" x="0" y="${top}" width="${G.width}" height="${G.row}"/>` +
        `<text class="bf-name" x="${G.pad}" y="${(y + 4.5).toFixed(1)}"><tspan class="bf-st">${m.state}</tspan> ${esc(shortName(m))}</text>` +
        dot +
        `<text class="bf-ev" x="${G.width - G.pad}" y="${(y + 4.5).toFixed(1)}" text-anchor="end">${link ? fmt(link.sharedWords) : 'Earliest'}</text>` +
        `</a>`,
    );
  });
  parts.push('</svg>');
  return parts.join('');
}

/** What the panel beside the picture shows for each row: the same facts as the list, for the pointer. */
export function panelData(data: FamilyData, family: Family): string {
  const out: Record<string, unknown> = {};
  for (const id of family.members) {
    const m = data.members.get(id)!;
    const link = parentLink(data, id);
    const p = m.parent ? data.members.get(m.parent) : undefined;
    out[id] = {
      name: fullName(m),
      year: yearOf(m),
      status: statusOf(m),
      title: m.title,
      parent: p ? fullName(p) : '',
      kind: link ? LINK_LABEL[link.kind] : '',
      shared: link ? fmt(link.sharedWords) : '',
      longest: link ? fmt(link.longestWords) : '',
      passage: link?.longestPassage ?? '',
      sponsor: link?.sameSponsor ?? '',
      chain: chainOf(data, id),
    };
  }
  return JSON.stringify(out);
}

/** The text, its parent, its parent's parent, up to the root. */
export function chainOf(data: FamilyData, id: string): string[] {
  const chain: string[] = [];
  let at: string | undefined = id;
  while (at) {
    chain.push(at);
    at = data.members.get(at)?.parent || undefined;
  }
  return chain;
}
