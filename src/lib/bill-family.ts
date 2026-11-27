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

// ---------- Drawing helpers ----------

export const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** How thick a link is drawn: by its longest shared run of words, on a log scale, 1.6 to 6 units. */
export const edgeWidth = (longest: number): number => Math.min(6, Math.max(1.6, 1.6 + 1.9 * Math.log10(Math.max(longest, 10) / 10)));

/**
 * The passage most often at the heart of the family's links: the run of words found in the most of its
 * links' longest shared passages, grown left and right as far as all of those passages still share it.
 * The links and texts it is in come with it, so the page can name and draw them.
 */
export function travellingPassage(data: FamilyData, family: Family, n = 12): { words: string; links: Link[]; texts: Set<string>; states: string[] } {
  const inFamily = new Set(family.members);
  const links = family.members.map((id) => parentLink(data, id)).filter((l): l is Link => Boolean(l) && inFamily.has(l!.a));
  const toks = (s: string): string[] => s.split(/\s+/).filter(Boolean);
  const norm = (w: string): string => w.toLowerCase().replace(/[^a-z0-9]/g, '');
  const count = new Map<string, Set<number>>();
  links.forEach((l, i) => {
    const t = toks(l.longestPassage).map(norm);
    for (let k = 0; k + n <= t.length; k++) {
      const key = t.slice(k, k + n).join(' ');
      (count.get(key) ?? count.set(key, new Set()).get(key)!).add(i);
    }
  });
  let bestKey = '';
  let best = new Set<number>();
  for (const [k, s] of count) if (s.size > best.size) [bestKey, best] = [k, s];
  if (!bestKey) return { words: '', links: [], texts: new Set(), states: [] };
  const holders = [...best].map((i) => links[i]!);
  // Grow the run while every holder still has it, then print it in the first holder's own words.
  const first = toks(holders[0]!.longestPassage);
  const firstN = first.map(norm);
  const at = Math.max(0, firstN.findIndex((_, k) => firstN.slice(k, k + n).join(' ') === bestKey));
  let lo = at;
  let hi = at + n;
  const all = (a: number, b: number): boolean => holders.every((l) => toks(l.longestPassage).map(norm).join(' ').includes(firstN.slice(a, b).join(' ')));
  while (lo > 0 && all(lo - 1, hi)) lo--;
  while (hi < first.length && all(lo, hi + 1)) hi++;
  const texts = new Set(holders.flatMap((l) => [l.a, l.b]));
  const states = [...new Set([...texts].map((id) => data.members.get(id)!.state))].sort();
  return { words: first.slice(lo, hi).join(' ').replace(/^[^A-Za-z0-9]+/, ''), links: holders, texts, states };
}

/** What the readout card shows for each text: the same facts as the list, for the pointer. */
export function panelData(data: FamilyData, family: Family): string {
  const out: Record<string, unknown> = {};
  for (const id of family.members) {
    const m = data.members.get(id)!;
    const link = parentLink(data, id);
    const p = m.parent ? data.members.get(m.parent) : undefined;
    out[id] = {
      name: fullName(m),
      state: m.state,
      year: yearOf(m),
      status: statusOf(m),
      law: isLaw(m),
      title: m.title,
      href: memberHref(m),
      parent: p ? fullName(p) : '',
      kind: link ? LINK_LABEL[link.kind] : '',
      shared: link ? fmt(link.sharedWords) : '',
      longest: link ? fmt(link.longestWords) : '',
      width: link ? Math.round((edgeWidth(link.longestWords) / 4.6) * 100) : 0,
      passage: link?.longestPassage ?? '',
      sponsor: link?.sameSponsor ?? '',
      kids: childrenOf(data, id).length,
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
