import { parseCsv } from './csv';
import { ndcKey } from './drug-groups';
import { tidyForm, tidyIngredient, tidyLabeler, tidyProductName, tidyStrength } from './fda-display';

/**
 * The names the FDA's National Drug Code Directory lists for the drug codes in the filings.
 *
 * The file `reference/fda-ndc/names.csv` is built by `scripts/reference/build-fda-ndc.mjs` from the FDA's
 * public directory; that script says how a filed code is matched. It has one line for every code that was
 * looked up, matched or not, so a code that is missing from it was never looked up, and the build stops
 * rather than say it is "not listed".
 *
 * These names are the FDA's, not a filer's. They are shown beside what was filed and never in place of it.
 *
 * The directory drops a product when it leaves the market. A name it once listed is kept, with the day of the
 * copy that listed it (`listedOn`), and the pages say so beside such a name.
 */

export type FdaMatch = 'package' | 'product';

export interface FdaName {
  ndc11: string;
  /** `package`: the directory lists this package code. `product`: it lists the product, not this package. */
  match: FdaMatch;
  /** The product code as the directory writes it, for example `0169-4130`. */
  productNdc: string;
  proprietaryName: string;
  proprietaryNameSuffix: string;
  nonproprietaryName: string;
  dosageForm: string;
  /** Each active ingredient's strength with its unit, as listed: `50 mg/1; 200 mg/1; 25 mg/1`. */
  strength: string;
  labeler: string;
  /** The day of the copy of the directory that listed this name, YYYY-MM-DD. */
  listedOn: string;
  /** True when a later copy of the directory no longer lists the code: the name is kept from `listedOn`. */
  kept: boolean;
}

export interface FdaSource {
  name: string;
  publisher: string;
  /** The file that was downloaded. */
  url: string;
  /** The FDA's page about the directory. */
  page: string;
  /** The day the directory was downloaded, YYYY-MM-DD. */
  retrieved: string;
  zipSha256: string;
}

export interface FdaNames {
  source: FdaSource;
  /** Every code that was looked up: its listed name, or null when the directory gives none. */
  byCode: ReadonlyMap<string, FdaName | null>;
}

export function buildFdaNames(csvText: string, sourceJson: string): FdaNames {
  const raw = JSON.parse(sourceJson) as Record<string, unknown>;
  const text = (key: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value === '') throw new Error(`reference/fda-ndc/SOURCE.json: "${key}" is missing`);
    return value;
  };
  const source: FdaSource = { name: text('name'), publisher: text('publisher'), url: text('url'), page: text('page'), retrieved: text('retrieved'), zipSha256: text('zip_sha256') };
  for (const link of [source.url, source.page]) if (!link.startsWith('https://')) throw new Error(`reference/fda-ndc/SOURCE.json: not an https address: ${link}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.retrieved)) throw new Error(`reference/fda-ndc/SOURCE.json: "retrieved" is not a date: ${source.retrieved}`);

  const byCode = new Map<string, FdaName | null>();
  for (const r of parseCsv(csvText)) {
    const ndc11 = r['ndc_11'] ?? '';
    const where = `reference/fda-ndc/names.csv ${ndc11}`;
    if (!/^[0-9]{11}$/.test(ndc11)) throw new Error(`${where}: not an 11-digit code`);
    if (byCode.has(ndc11)) throw new Error(`${where}: listed twice`);
    const match = r['match'];
    if (match === 'none' || match === 'unclear') {
      byCode.set(ndc11, null);
      continue;
    }
    if (match !== 'package' && match !== 'product') throw new Error(`${where}: unknown match "${match}"`);
    const proprietaryName = r['proprietary_name'] ?? '';
    if (proprietaryName === '') throw new Error(`${where}: matched, but no name`);
    const listedOn = r['listed_on'] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(listedOn) || listedOn > source.retrieved) throw new Error(`${where}: "listed_on" is not a day on or before ${source.retrieved}: "${listedOn}"`);
    byCode.set(ndc11, {
      ndc11,
      match,
      productNdc: r['fda_product_ndc'] ?? '',
      proprietaryName,
      proprietaryNameSuffix: r['proprietary_name_suffix'] ?? '',
      nonproprietaryName: r['nonproprietary_name'] ?? '',
      dosageForm: r['dosage_form'] ?? '',
      strength: r['strength'] ?? '',
      labeler: r['labeler_name'] ?? '',
      listedOn,
      kept: listedOn < source.retrieved,
    });
  }
  return { source, byCode };
}

let cached: FdaNames | null = null;

export function getFdaNames(): FdaNames {
  if (cached) return cached;
  const files = import.meta.glob(['../../reference/fda-ndc/names.csv', '../../reference/fda-ndc/SOURCE.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const find = (name: string): string => {
    const key = Object.keys(files).find((k) => k.endsWith(`/${name}`));
    if (!key) throw new Error(`reference/fda-ndc/${name} is missing. Build it with scripts/reference/build-fda-ndc.mjs`);
    return files[key]!;
  };
  cached = buildFdaNames(find('names.csv'), find('SOURCE.json'));
  return cached;
}

/**
 * The listed name for a code. A code that was never looked up stops the build: the page must not call a
 * drug "not listed" when nobody checked.
 */
export function fdaNameFor(names: FdaNames, ndc11: string): FdaName | null {
  const found = names.byCode.get(ndc11);
  if (found === undefined) throw new Error(`Drug code ${ndc11} is not in reference/fda-ndc/names.csv. Rebuild it with scripts/reference/build-fda-ndc.mjs`);
  return found;
}

/**
 * The listed name for one row's code cell as filed. Null when the cell is not one 11-digit code (nothing is
 * looked up for it) or when the directory does not list the code.
 */
export function fdaNameForCell(names: FdaNames, ndcAsFiled: string): FdaName | null {
  const key = ndcKey(ndcAsFiled);
  return key === null ? null : fdaNameFor(names, key);
}

/**
 * The directory's text as a page draws it: capitals, strengths and unit names written one way
 * (`fda-display.ts` has each rule). The fields of an `FdaName` stay as listed, and the download
 * gives those.
 */
export interface FdaShown {
  /** The name with its suffix: `Ozempic`, `Humalog KwikPen`. */
  title: string;
  /** The ingredient name, or blank when it only repeats the name already shown. */
  generic: string;
  strength: string;
  form: string;
  labeler: string;
}

const fold = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** The name with its suffix, as a page draws it: `Ozempic`, `Humalog KwikPen`. */
export function fdaTitle(name: FdaName): string {
  const product = tidyProductName(name.proprietaryName);
  const suffix = name.proprietaryNameSuffix.trim().replace(/\s+/g, ' ');
  return suffix === '' ? product : `${product} ${suffix}`;
}

/** The ingredient name as a page draws it, unless it only repeats the name already shown. */
export function fdaGenericShown(name: FdaName): string {
  const repeats = fold(name.nonproprietaryName) === fold(name.proprietaryName) || fold(name.nonproprietaryName) === fold(`${name.proprietaryName} ${name.proprietaryNameSuffix}`);
  return repeats ? '' : tidyIngredient(name.nonproprietaryName);
}

export function fdaShown(name: FdaName): FdaShown {
  return {
    title: fdaTitle(name),
    generic: fdaGenericShown(name),
    strength: tidyStrength(name.strength),
    form: tidyForm(name.dosageForm),
    labeler: tidyLabeler(name.labeler),
  };
}
