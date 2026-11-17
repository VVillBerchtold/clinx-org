/**
 * Labels for search engines.
 *
 * A search engine reads a page's words, and it also reads one small block of data that says, in a
 * fixed vocabulary (schema.org), what the page is: a site, a person, a dataset, an article, a trail
 * of pages. This file builds those blocks. Base.astro writes them into the page.
 *
 * The block is data, not a program: the browser does not run it, and it says nothing a reader cannot
 * already see on the page. scripts/check-dist.mjs reads every block in the built site and fails the
 * build if one is malformed or names a page or file this site does not have.
 */
import type { Dataset } from './data';
import { shareCard } from './share-cards';
import { stateName } from './states';
import { ARTICLE_PUBLISHED, ARTICLE_TITLE, GITHUB_URL, LINKEDIN_URL, MAKER_NAME, REFERRALFINDERX_FOUNDER_URL, REFERRALFINDERX_URL, REPOSITORIES, SITE_NAME, SITE_URL, X_URL } from './site';

export type Node = Record<string, unknown>;

/** One name for each thing, so every page that mentions it points at the same thing. */
export const SITE_ID = `${SITE_URL}/#site`;
export const FOUNDER_ID = `${SITE_URL}/about/#will-berchtold`;
export const DATASET_ID = `${SITE_URL}/data/#dataset`;

const DATA_LICENCE = 'https://creativecommons.org/licenses/by/4.0/';

/** The site itself. Search engines take the site's name from this. */
export function siteNode(): Node {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: SITE_NAME,
    alternateName: ['ClinX.org', 'ClinX 340B Scorecard'],
    url: `${SITE_URL}/`,
    description: 'What hospitals and health centers reported to their states about the 340B drug program, as open data. Every figure links to the public file it came from.',
    inLanguage: 'en-US',
    publisher: { '@id': FOUNDER_ID },
  };
}

/**
 * The person who builds the site. `sameAs` lists the other public pages about the same person, which
 * is how a search engine learns that the Will Berchtold here and the one on those pages are one person.
 */
export function founderNode(): Node {
  return {
    '@type': 'Person',
    '@id': FOUNDER_ID,
    name: MAKER_NAME,
    givenName: 'Will',
    familyName: 'Berchtold',
    alternateName: 'Will B.',
    jobTitle: 'Founder',
    description: 'Will Berchtold is the founder of ClinX and of ReferralFinderX, a directory of specialist offices for referral teams.',
    url: `${SITE_URL}/about/`,
    image: `${SITE_URL}/founder/will-berchtold-960.jpg`,
    homeLocation: { '@type': 'Place', name: 'Rhode Island' },
    worksFor: { '@type': 'Organization', '@id': `${REFERRALFINDERX_URL}/#org`, name: 'ReferralFinderX', url: `${REFERRALFINDERX_URL}/` },
    sameAs: [REFERRALFINDERX_FOUNDER_URL, LINKEDIN_URL, X_URL, GITHUB_URL],
  };
}

/**
 * Who made a dataset: the same person as above, by name, with the About page as his address. The Data
 * page does not carry the whole description of him, so a reader of that page alone still gets a name.
 */
export function creatorNode(): Node {
  return { '@type': 'Person', '@id': FOUNDER_ID, name: MAKER_NAME, url: `${SITE_URL}/about/` };
}

/** The About page. */
export function aboutPageNode(): Node {
  return {
    '@type': 'AboutPage',
    '@id': `${SITE_URL}/about/`,
    url: `${SITE_URL}/about/`,
    name: 'About ClinX',
    inLanguage: 'en-US',
    isPartOf: { '@id': SITE_ID },
    about: { '@id': SITE_ID },
    mentions: { '@id': FOUNDER_ID },
  };
}

export interface Crumb {
  name: string;
  /** Path on this site, starting and ending with a slash. */
  path: string;
}

/** The trail from the home page to this page. A search result can show it in place of the bare address. */
export function trailNode(crumbs: readonly Crumb[]): Node {
  const all: Crumb[] = [{ name: SITE_NAME, path: '/' }, ...crumbs];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE_URL + c.path })),
  };
}

const FORMAT: Record<string, string> = { csv: 'text/csv', json: 'application/json' };

export interface ExtraFile {
  name: string;
  path: string;
  sha256: string;
}

/**
 * The dataset, in the form dataset search engines read. Everything here is taken from the dataset the
 * site was built from: its version, the states and years it covers, and the files on the Data page.
 */
export function datasetNode(data: Dataset, extraFiles: readonly ExtraFile[] = []): Node {
  const states = [...new Set(data.filings.map((f) => f.state))].map(stateName).sort();
  const years = [...new Set(data.filings.map((f) => f.reportingYear))].sort();
  const span = years.length > 1 ? `${years[0]}/${years[years.length - 1]}` : years[0];
  const stateList = states.length > 1 ? `${states.slice(0, -1).join(', ')} and ${states[states.length - 1]}` : states[0];
  const files = [
    ...data.downloads.map((name) => ({ name, path: `/data/${name}`, sha256: data.hashes[name] ?? '' })),
    ...extraFiles,
  ];
  return {
    '@type': 'Dataset',
    '@id': DATASET_ID,
    name: '340B state filings',
    alternateName: ['ClinX 340B state filings dataset', 'clinx-340b'],
    description:
      `What hospitals and health centers reported to their states about the federal 340B drug program, as structured open data. ` +
      `This version covers ${stateList}. Every figure is kept as filed or as the state printed it, and cites the page of the public PDF or the cell of the public workbook it was read from. ` +
      `The files hold the filings, the entities, every printed row, the calculated measures with their formulas, each place where two figures of one filing differ, vendor names as filed, and attachments. ` +
      `Nothing is corrected or estimated.`,
    url: `${SITE_URL}/data/`,
    sameAs: REPOSITORIES.dataset,
    identifier: REPOSITORIES.dataset,
    version: data.version,
    license: DATA_LICENCE,
    isAccessibleForFree: true,
    inLanguage: 'en-US',
    creator: creatorNode(),
    publisher: { '@id': FOUNDER_ID },
    isPartOf: { '@id': SITE_ID },
    keywords: [
      '340B',
      '340B Drug Pricing Program',
      '340B covered entity',
      'contract pharmacy',
      'hospital',
      'community health center',
      'state 340B transparency report',
      ...states,
    ],
    spatialCoverage: states.map((name) => ({ '@type': 'Place', name: `${name}, United States` })),
    temporalCoverage: span,
    distribution: files.map((f) => ({
      '@type': 'DataDownload',
      name: f.name,
      contentUrl: SITE_URL + f.path,
      encodingFormat: FORMAT[f.name.split('.').pop() ?? ''] ?? 'application/octet-stream',
      ...(f.sha256 ? { sha256: f.sha256 } : {}),
    })),
  };
}

/** One group of the health centers files, as the Data page lists it. */
export interface HcDatasetGroup {
  id: 'records' | 'funding' | 'areas';
  files: readonly { name: string; href: string; what: string; sha256?: string }[];
}

/** The name of one health centers dataset, the same on every page that mentions it. */
export const hcDatasetId = (id: HcDatasetGroup['id']): string => `${SITE_URL}/data/#dataset-health-centers-${id}`;

/** What each health centers dataset is, in words the pages already use. */
const HC_DATASETS: Record<HcDatasetGroup['id'], { name: string; alternateName: string; description: string; keywords: string[] }> = {
  records: {
    name: 'Health center reports to HRSA',
    alternateName: 'ClinX health centers: public records',
    description:
      'What federally funded health centers reported to HRSA in the Uniform Data System, as open files. ' +
      'One file has a row for each health center and year: its name, address, funding flags and number of sites, as HRSA published them. ' +
      'One has a row for each state or territory and year: the number of health centers HRSA’s file lists there, and whether their reports are on ClinX. ' +
      'One has the lines and columns of the reports: HRSA’s table, line and column titles, and the kind of value each holds. ' +
      'Every value is kept as HRSA published it.',
    keywords: ['health center', 'community health center', 'federally qualified health center', 'Health Center Program', 'HRSA', 'Uniform Data System', 'UDS'],
  },
  funding: {
    name: 'HRSA funding opportunities and dates for health centers',
    alternateName: 'ClinX health centers: funding and deadlines',
    description:
      'The funding opportunities HRSA lists on Grants.gov, forecast and posted, with every date, amount and text as published. ' +
      'With them, the dated events of the funding calendar: the day a notice is expected, the day applications are due, the day awards are expected, the day comments close and the day a document takes effect. ' +
      'And the Federal Register documents found for the Health Center Program. Each set is given as JSON and as a table.',
    keywords: ['health center', 'Health Center Program', 'HRSA', 'Grants.gov', 'funding opportunity', 'notice of funding opportunity', 'Federal Register'],
  },
  areas: {
    name: 'HRSA shortage areas and health center sites',
    alternateName: 'ClinX health centers: shortage areas',
    description:
      'HRSA’s shortage designations and its list of health center sites, as open files: the primary care, dental health and mental health professional shortage areas, and the medically underserved areas and populations. ' +
      'The files hold the counts for every state and territory, every designated, withdrawn and updated event of the last 365 days, every designation HRSA marks Proposed For Withdrawal, the health center sites added to scope in the last 365 days, and the changes between ClinX’s copies.',
    keywords: ['health professional shortage area', 'HPSA', 'medically underserved area', 'MUA', 'medically underserved population', 'health center site', 'HRSA'],
  },
};

/**
 * The health centers files, in the form dataset search engines read: one dataset for each part
 * (the records, the funding calendar, the shortage areas). The files are the ones the Data page
 * lists, so a file added there is added here. The years are given for the records only, because
 * only the records say which years they hold. No size and no date is stated that the files do not state.
 */
export function healthCenterDatasetNodes(groups: readonly HcDatasetGroup[], recordYears: readonly number[]): Node[] {
  const years = [...recordYears].sort((a, b) => a - b);
  const span = years.length > 1 ? `${years[0]}/${years[years.length - 1]}` : years.length === 1 ? String(years[0]) : undefined;
  return groups.map((g) => {
    const about = HC_DATASETS[g.id];
    return {
      '@type': 'Dataset',
      '@id': hcDatasetId(g.id),
      name: about.name,
      alternateName: about.alternateName,
      description: about.description,
      url: `${SITE_URL}/data/#health-centers-${g.id}`,
      license: DATA_LICENCE,
      isAccessibleForFree: true,
      inLanguage: 'en-US',
      creator: creatorNode(),
      publisher: { '@id': FOUNDER_ID },
      isPartOf: { '@id': SITE_ID },
      keywords: about.keywords,
      spatialCoverage: [{ '@type': 'Place', name: 'United States' }],
      ...(g.id === 'records' && span ? { temporalCoverage: span } : {}),
      distribution: g.files.map((f) => ({
        '@type': 'DataDownload',
        name: f.name,
        description: f.what,
        contentUrl: SITE_URL + f.href,
        encodingFormat: FORMAT[f.name.split('.').pop() ?? ''] ?? 'application/octet-stream',
        ...(f.sha256 ? { sha256: f.sha256 } : {}),
      })),
    };
  });
}

/** One article. Without a second argument it is the article on reading a sensitive file in the browser. */
export function articleNode(description: string, piece: { path: string; title: string; published: string } = { path: '/writing/no-phi/', title: ARTICLE_TITLE, published: ARTICLE_PUBLISHED }): Node {
  return {
    '@type': 'Article',
    '@id': `${SITE_URL}${piece.path}#article`,
    headline: piece.title,
    description,
    url: `${SITE_URL}${piece.path}`,
    mainEntityOfPage: `${SITE_URL}${piece.path}`,
    datePublished: piece.published,
    inLanguage: 'en-US',
    image: SITE_URL + shareCard('writing').path,
    author: { '@id': FOUNDER_ID },
    publisher: { '@id': FOUNDER_ID },
    isPartOf: { '@id': SITE_ID },
  };
}

/**
 * The block as text, ready to go inside the page. Every "<" is written as its escape, so nothing in
 * the data (a filer's name, say) can ever close the block early or open a tag.
 */
export function toBlock(nodes: readonly Node[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
