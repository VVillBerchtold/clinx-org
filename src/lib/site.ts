/** The site is ClinX. The 340B Scorecard was its first project; the main menu below lists everything it holds now. */
export const SITE_NAME = 'ClinX';

/** The site's public address, with no slash at the end. */
export const SITE_URL = 'https://clinx.org';

export const PROJECT_NAME = '340B Scorecard';

/**
 * The Content-Security-Policy. The same string is in public/_headers and in a meta tag on every page.
 * scripts/check-dist.mjs fails if the two differ. There is no 'unsafe-inline' anywhere.
 */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The meta-tag copy. Browsers ignore frame-ancestors in a meta tag (and log an error), so only the header carries it. */
export const CSP_META = CSP.replace("; frame-ancestors 'none'", '');

/**
 * The contact page alone may post its form, and only to this site. Every other page keeps form-action 'none'.
 * public/_headers carries the same policy for /contact/; scripts/check-dist.mjs fails if they differ.
 */
export const CSP_FORM = CSP.replace("form-action 'none'", "form-action 'self'");
export const CSP_FORM_META = CSP_FORM.replace("; frame-ancestors 'none'", '');

/** Where the contact form's mail goes, and the address shown beside it. */
export const CONTACT_EMAIL = 'will@clinx.org';

/** Who builds and maintains ClinX, as the pages name him, and as the first words of a citation. */
export const MAKER_NAME = 'Will Berchtold';
export const MAKER_CITED_AS = 'Berchtold, W.';

/**
 * One line a reader can copy to cite a page of this site. `what` is what is cited (the site, or its
 * open data) and `path` is that page's address on the site. The day is left for the reader to put in.
 * The address comes last with no full stop after it, so a copied address still opens.
 */
export function citeLine(what: string, path: string): string {
  return `${MAKER_CITED_AS} ${what}. clinx.org. Read [day month year]. ${SITE_URL}${path}`;
}
/** What the two citations name: the site as a whole, and the open data on the Data page. */
export const CITE_SITE = 'ClinX: open healthcare data and tools for clinics';
export const CITE_DATA = 'ClinX open data: 340B and health centers';

/** The day the wording of the Terms of use page (/terms/) last changed. Move it on with every change to that page's text. */
export const TERMS_CHANGED = '2026-11-16';

export interface NavLink {
  href: string;
  label: string;
  /** One line under the label, shown where the link sits inside a group. */
  note?: string;
}
/** A menu entry that opens a short list of pages instead of going to one. */
export interface NavGroup {
  label: string;
  items: readonly NavLink[];
  /** A page of the group that is not one of its items (a section's front page): the group shows as the current one there too. */
  home?: string;
}

/** The main menu. 340B is a group: the Scorecard, the state laws, the bills, the federal notices, the calendar and the rebate pilot sit side by side under it. Health centers is the second group: the records, the funding calendar and the shortage areas. */
export const NAV: readonly (NavLink | NavGroup)[] = [
  {
    label: '340B',
    items: [
      { href: '/scorecard/', label: 'Scorecard', note: 'The 340B figures each state publishes' },
      { href: '/laws/', label: 'State laws', note: 'The 340B laws each state has passed' },
      { href: '/bills/', label: 'Bills', note: 'The 340B bills in Congress and the states' },
      { href: '/notices/', label: 'Federal notices', note: 'Federal rules and notices that name 340B' },
      { href: '/calendar/', label: 'Calendar', note: 'Bill steps, hearings and federal deadlines' },
      { href: '/registry/', label: 'Registry history', note: 'Contract pharmacies, month by month since 2010' },
      { href: '/rebate-pilot/', label: 'Rebate pilot', note: 'What the federal rebate pilot changes' },
    ],
  },
  {
    label: 'Health centers',
    home: '/health-centers/',
    items: [
      { href: '/health-centers/records/', label: 'Records', note: 'What each health center reported to HRSA' },
      { href: '/health-centers/funding/', label: 'Funding', note: 'HRSA opportunities and Federal Register dates' },
      { href: '/health-centers/shortage-areas/', label: 'Shortage areas', note: 'What HRSA designates, proposes to withdraw and changes' },
    ],
  },
  { href: '/data/', label: 'Data' },
  { href: '/methods/', label: 'Methods' },
  { href: '/tools/', label: 'Tools' },
  { href: '/writing/', label: 'Writing' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
];

/** What ClinX's maker sells, kept out of the main menu: the foot of every page lists these under their own heading. */
export const OTHER_PRODUCTS: readonly NavLink[] = [{ href: '/products/', label: 'ReferralFinderX' }];

/** The health centers section: its name and its front page, which the trail of every page in it links to. */
export const HC_NAME = 'Health centers';
export const HC_HOME = '/health-centers/';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** 7 -> "seven"; larger numbers stay as digits. */
export function numberWord(n: number): string {
  return WORDS[n] ?? n.toLocaleString('en-US');
}

/** The same, for the start of a sentence: 7 -> "Seven". */
export function numberWordCap(n: number): string {
  const w = numberWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Element id of a group's table on a state's page. */
export function groupId(group: string): string {
  return `table-${group.replace('_', '-')}`;
}

/** Title of the article on reading a sensitive file in the browser. */
export const ARTICLE_TITLE = 'Reading a sensitive file without receiving it';

/**
 * True while the site is a private preview. This one setting is the go-live switch. While it is true:
 * wording that waits for the owner's approval carries a small "Draft" tag, every page asks search
 * engines not to list it, and robots.txt turns every crawler away. Set it to false and the tags are
 * gone, robots.txt opens the site, and the build writes sitemap.xml.
 */
export const PREVIEW = false;

/** The four public repositories. The pages link to them only once the site is public (PREVIEW false). */
export const REPOSITORIES = {
  dataset: 'https://github.com/WillBerchtold/clinx-340b',
  bills: 'https://github.com/WillBerchtold/clinx-340b-bills',
  tracker: 'https://github.com/WillBerchtold/clinx-radar',
  registry: 'https://github.com/WillBerchtold/clinx-340b-registry',
  assistants: 'https://github.com/WillBerchtold/clinx-mcp',
  site: 'https://github.com/WillBerchtold/clinx-org',
} as const;

/** Where ReferralFinderX lives. */
export const REFERRALFINDERX_URL = 'https://referralfinderx.com';

/** The founder's public profiles. */
export const LINKEDIN_URL = 'https://www.linkedin.com/in/will-berchtold';
export const X_URL = 'https://x.com/willberch';
export const GITHUB_URL = 'https://github.com/WillBerchtold';
/** The founder's page on the ReferralFinderX site. */
export const REFERRALFINDERX_FOUNDER_URL = 'https://referralfinderx.com/founder.html';

/** The day the article went public with the site. */
export const ARTICLE_PUBLISHED = '2026-11-12';

/** The file tool: its name is written here once, so every page says it the same way. */
export const CLEANER_COPY = 'Cleaner Copy';
/** The article about the file tool, and the day it goes public. */
export const CLEANER_COPY_ARTICLE_TITLE = 'Getting a clinic report ready for AI help';
export const CLEANER_COPY_ARTICLE_PUBLISHED = '2026-11-16';
/** The tool that looks through a report for what would trip up a script or a pivot table. */
export const FILE_CHECK = 'File Check';
/** The tool for designing a clinic's template week. The name is written here once. */
export const SCHEDULE_DESIGNER = 'Schedule Designer';
/** The version the standalone copy of the tool prints (scripts/standalone.mjs). Raise it when the tool changes in a way a person would notice. */
export const SCHEDULE_DESIGNER_VERSION = '1.0';
/**
 * The day that version was released, as the standalone copy prints it. It is written here, and
 * not taken from the clock at build time, so two builds of the same source give the same file
 * and the same checksum. Change it together with the version.
 */
export const SCHEDULE_DESIGNER_RELEASED = '19 November 2026';
/** The article about where the Schedule Designer keeps a schedule, and the day it goes public. */
export const SCHEDULE_DESIGNER_ARTICLE_TITLE = 'The workbook is the saved schedule';
export const SCHEDULE_DESIGNER_ARTICLE_PUBLISHED = '2026-11-19';

/**
 * The tools, each with one line on what it gives back. The About page lists them and stops the build
 * when a tool page exists that is not named here.
 */
export const TOOL_LINKS: readonly NavLink[] = [
  { href: '/tools/schedule-designer/', label: SCHEDULE_DESIGNER, note: "A clinic's template week, saved as a workbook" },
  { href: '/tools/cleaner-copy/', label: CLEANER_COPY, note: 'A copy of a report with randomized values in the columns you choose' },
  { href: '/tools/file-check/', label: FILE_CHECK, note: 'What in a report will trip up a script or a pivot table' },
];
/** The article about what a workbook holds outside its cells, and the day it goes public. */
export const WORKBOOK_ARTICLE_TITLE = 'What an Excel workbook carries besides its cells';
export const WORKBOOK_ARTICLE_PUBLISHED = '2026-11-16';
/** The guide to checking that a page sends nothing, and the day it goes public. */
export const CHECKING_ARTICLE_TITLE = 'How to check that a page sends nothing';
export const CHECKING_ARTICLE_PUBLISHED = '2026-11-16';
/** The essay on what a clinic's software subscriptions are for, and the day it goes public. */
export const RENTING_ARTICLE_TITLE = 'What are we renting?';
export const RENTING_ARTICLE_PUBLISHED = '2026-11-17';
/** The analysis of who owns the 340B contract pharmacies, and the day it goes public (set on publishing). */
export const WHOSE_ARTICLE_TITLE = 'Whose pharmacies?';
export const WHOSE_ARTICLE_PUBLISHED = '2026-11-23';
