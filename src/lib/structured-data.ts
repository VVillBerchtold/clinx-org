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
import { stateName } from './states';
import { ARTICLE_PUBLISHED, ARTICLE_TITLE, GITHUB_URL, LINKEDIN_URL, REFERRALFINDERX_FOUNDER_URL, REFERRALFINDERX_URL, REPOSITORIES, SHARE_CARD, SITE_NAME, SITE_URL, X_URL } from './site';

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
    description: 'What hospitals and health centers reported to their states about the 340B drug program, as open data. Every figure links to the page of the filing it came from.',
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
    name: 'Will Berchtold',
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
      `This version covers ${stateList}. Every figure is kept as filed or as the state printed it, and cites the page of the public PDF it was read from. ` +
      `The files hold the filings, the entities, every printed row, the calculated measures with their formulas, each place where two figures of one filing differ, vendor names as filed, and attachments. ` +
      `Nothing is corrected or estimated.`,
    url: `${SITE_URL}/data/`,
    sameAs: REPOSITORIES.dataset,
    identifier: REPOSITORIES.dataset,
    version: data.version,
    license: DATA_LICENCE,
    isAccessibleForFree: true,
    inLanguage: 'en-US',
    creator: { '@id': FOUNDER_ID },
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

/** The article on reading a sensitive file in the browser. */
export function articleNode(description: string): Node {
  return {
    '@type': 'Article',
    '@id': `${SITE_URL}/writing/no-phi/#article`,
    headline: ARTICLE_TITLE,
    description,
    url: `${SITE_URL}/writing/no-phi/`,
    mainEntityOfPage: `${SITE_URL}/writing/no-phi/`,
    datePublished: ARTICLE_PUBLISHED,
    inLanguage: 'en-US',
    image: SITE_URL + SHARE_CARD.path,
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
