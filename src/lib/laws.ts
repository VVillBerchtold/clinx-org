/**
 * State laws about 340B, read from the dataset's own file (340b-state-laws.json).
 *
 * In plain words: the dataset keeps a hand-checked table of enacted state laws whose text names the
 * 340B program. This file reads that table for the site: the laws of one state, the laws of one kind,
 * and a map of which states have one. Nothing here adds to
 * or changes what the table says.
 */
import { REPOSITORIES } from './site';
import { STATES, TILE, stateName, type StateTile } from './states';

/** The kinds a law may have, in the order the dataset lists them. Must match KNOWN_LAW_KINDS in scripts/dataset-shape.mjs. */
export const LAW_KINDS = ['contract-pharmacy', 'payer-nondiscrimination', 'reporting', 'medicaid', 'use-of-savings', 'study', 'other'] as const;
export type LawKind = (typeof LAW_KINDS)[number];

export interface KindInfo {
  kind: LawKind;
  label: string;
  description: string;
}

export interface Law {
  lawId: string;
  state: string;
  kinds: readonly LawKind[];
  title: string;
  citation: string;
  bill: string;
  sessionYear: string;
  act: string;
  /** ISO dates. Empty where the official page does not print the date. */
  signedDate: string;
  effectiveDate: string;
  binds: string;
  summary: string;
  limits: string;
  enforcement: string;
  /** The passage of the law that names the program, as the saved text has it. */
  quote: string;
  sourceUrl: string;
  sourceForm: string;
  /** Path of the saved text inside the dataset repository. */
  sourceText: string;
  moreUrl: string;
  moreText: string;
  retrieved: string;
}

export interface NotListed {
  state: string;
  name: string;
  reason: string;
  sourceUrl: string;
}

export interface LawsData {
  version: string;
  kinds: readonly KindInfo[];
  laws: readonly Law[];
  notListed: readonly NotListed[];
  /** Who publishes each official site, by state and host. */
  owners: ReadonlyMap<string, string>;
}

type Raw = Record<string, unknown>;

const text = (row: Raw, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Laws file: "${key}" is not text`);
  return value;
};

function toKind(value: unknown): LawKind {
  if (typeof value !== 'string' || !(LAW_KINDS as readonly string[]).includes(value)) throw new Error(`Laws file: unknown kind "${String(value)}"`);
  return value as LawKind;
}

/** Reads the dataset's laws document. Throws on anything it does not expect, so a changed file stops the build. */
export function parseLaws(json: string): LawsData {
  const document = JSON.parse(json) as Raw;
  const list = (key: string): Raw[] => {
    const value = document[key];
    if (!Array.isArray(value)) throw new Error(`Laws file: "${key}" is not a list`);
    return value as Raw[];
  };
  const kinds = list('kinds').map((k) => ({ kind: toKind(k['kind']), label: text(k, 'label'), description: text(k, 'description') }));
  const laws = list('laws').map((r): Law => {
    const state = text(r, 'state');
    stateName(state);
    const lawKinds = r['kinds'];
    if (!Array.isArray(lawKinds) || lawKinds.length === 0) throw new Error(`Laws file: ${text(r, 'law_id')} has no kind`);
    return {
      lawId: text(r, 'law_id'),
      state,
      kinds: lawKinds.map(toKind),
      title: text(r, 'title'),
      citation: text(r, 'citation'),
      bill: text(r, 'bill'),
      sessionYear: text(r, 'session_year'),
      act: text(r, 'act'),
      signedDate: text(r, 'signed_date'),
      effectiveDate: text(r, 'effective_date'),
      binds: text(r, 'binds'),
      summary: text(r, 'summary'),
      limits: text(r, 'limits'),
      enforcement: text(r, 'enforcement'),
      quote: text(r, 'quote'),
      sourceUrl: text(r, 'source_url'),
      sourceForm: text(r, 'source_form'),
      sourceText: text(r, 'source_text'),
      moreUrl: text(r, 'more_url'),
      moreText: text(r, 'more_text'),
      retrieved: text(r, 'retrieved'),
    };
  });
  const notListed = list('not_listed').map((r) => {
    const state = text(r, 'state');
    stateName(state);
    return { state, name: text(r, 'name'), reason: text(r, 'reason'), sourceUrl: text(r, 'source_url') };
  });
  const owners = new Map(list('sites').map((s) => [`${text(s, 'state')} ${text(s, 'host')}`, text(s, 'owner')]));
  for (const law of laws) {
    for (const url of [law.sourceUrl, law.moreUrl]) {
      if (url !== '' && !url.startsWith('https://')) throw new Error(`Laws file: ${law.lawId} has a link that is not https`);
    }
  }
  return { version: text(document, 'dataset_version'), kinds, laws, notListed, owners };
}

let cached: LawsData | undefined;

/** The laws table of the copy of the dataset this site was built from. */
export function getLaws(): LawsData {
  if (cached) return cached;
  const modules = import.meta.glob('../data/dataset/340b-state-laws.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const json = Object.values(modules)[0];
  if (json === undefined) throw new Error('src/data/dataset/340b-state-laws.json is missing. Run: npm run sync');
  cached = parseLaws(json);
  return cached;
}

/** The address of the page of all state laws. */
export const LAWS_HOME = '/laws/';

/** The address of a state's laws page. Only a state with a listed law has one. */
export function lawsPath(code: string): string {
  return `${LAWS_HOME}${code.toLowerCase()}/`;
}

/** The address of the page that lists every law of one kind. */
export function kindPath(kind: LawKind): string {
  return `${LAWS_HOME}${kind}/`;
}

/** What a kind's own page is called, and its opening line where the dataset's wording does not stand alone. */
export const KIND_PAGES: Record<LawKind, { heading: string; opening?: string }> = {
  'contract-pharmacy': { heading: 'Contract pharmacy laws' },
  'payer-nondiscrimination': { heading: 'Payer and PBM laws' },
  reporting: { heading: 'Reporting laws' },
  medicaid: { heading: 'Medicaid laws' },
  'use-of-savings': { heading: 'Use-of-savings laws' },
  study: { heading: 'Study and task force laws' },
  other: { heading: 'Other 340B laws', opening: 'These laws name 340B and do something the other kinds do not cover.' },
};

/** The line that opens a kind's page: what a law of that kind does. */
export function kindOpening(info: KindInfo): string {
  return KIND_PAGES[info.kind].opening ?? `A law of this kind ${info.description.charAt(0).toLowerCase()}${info.description.slice(1)}`;
}

/** What to call a law in a heading or a list: its short title, else its place in the code, else its bill or act. */
export function lawName(law: Law): string {
  return law.title || law.citation || law.bill || law.act;
}

/** A state's laws, oldest session first (the order of the table). */
export function lawsOf(data: LawsData, code: string): Law[] {
  return data.laws.filter((l) => l.state === code);
}

/** The laws of one kind, by state name A to Z, then oldest session first. */
export function lawsOfKind(data: LawsData, kind: LawKind): Law[] {
  return data.laws
    .filter((l) => l.kinds.includes(kind))
    .sort((a, b) => stateName(a.state).localeCompare(stateName(b.state), 'en') || a.sessionYear.localeCompare(b.sessionYear) || a.lawId.localeCompare(b.lawId));
}

/** States with at least one listed law, and states with none, each A to Z by name. */
export function statesByLaws(data: LawsData): { withLaws: StateTile[]; without: StateTile[] } {
  const has = new Set(data.laws.map((l) => l.state));
  const byName = [...STATES].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { withLaws: byName.filter((s) => has.has(s.code)), without: byName.filter((s) => !has.has(s.code)) };
}

/** The office that publishes the page a link goes to, for example "Arkansas General Assembly". */
export function ownerOf(data: LawsData, state: string, url: string): string {
  const host = new URL(url).hostname;
  const owner = data.owners.get(`${state} ${host}`);
  if (!owner) throw new Error(`No owner is recorded for ${host} (${state})`);
  return owner;
}

/** Where the saved text of a page can be read: the dataset's public repository, at this version. */
export function savedTextUrl(data: LawsData, path: string): string {
  return `${REPOSITORIES.dataset}/blob/v${data.version}/${path}`;
}

const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The map of states as inline SVG, for the laws pages. A state with a listed law is drawn filled
 * and is a link to its page; a state with none is a plain tile. With `kind`, only states with a
 * law of that kind are filled. `current` marks the state whose page the map is on.
 */
export function lawsMapSvg(data: LawsData, id: string, options: { current?: string; kind?: LawKind } = {}): string {
  const { current, kind } = options;
  const step = TILE.size + TILE.gap;
  const pad = 10;
  const width = TILE.cols * step - TILE.gap + pad * 2;
  const height = TILE.rows * step - TILE.gap + pad * 2;
  const counts = new Map<string, number>();
  for (const law of data.laws) {
    if (kind === undefined || law.kinds.includes(kind)) counts.set(law.state, (counts.get(law.state) ?? 0) + 1);
  }
  const filled = [...STATES].filter((s) => counts.has(s.code)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const what = kind === undefined ? 'a 340B law' : 'a law of this kind';
  const parts: string[] = [
    `<svg class="tilemap lawmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">States with ${what}</title>`,
    `<desc id="${id}-d">${esc(`A grid of the 50 states and the District of Columbia. With ${what}: ${filled.map((s) => s.name).join(', ')}.`)}</desc>`,
  ];
  for (const s of STATES) {
    const x = pad + s.col * step;
    const y = pad + s.row * step;
    const n = counts.get(s.code) ?? 0;
    const rect = `<rect class="tile" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>`;
    const abbr = `<text class="abbr" x="${x + TILE.size / 2}" y="${y + TILE.size / 2 + 4.5}" text-anchor="middle">${s.code}</text>`;
    if (n === 0) {
      parts.push(`<g class="tile-g none r${s.row}">${rect}${abbr}</g>`);
      continue;
    }
    const here = s.code === current ? ' here' : '';
    const now = s.code === current ? ' aria-current="page"' : '';
    const label = `${n} ${n === 1 ? 'law' : 'laws'}${kind === undefined ? '' : ' of this kind'}`;
    parts.push(`<a class="tile-g has${here} r${s.row}" href="${lawsPath(s.code)}" aria-label="${s.code}, ${esc(s.name)}: ${label}"${now}>${rect}${abbr}</a>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
