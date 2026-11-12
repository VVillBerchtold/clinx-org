/** The site is ClinX; the 340B Scorecard is its first project. */
export const SITE_NAME = 'ClinX';

/** The site's public address, with no slash at the end. */
export const SITE_URL = 'https://clinx.org';

/** The picture a link to the site shows when it is shared (1200 by 630). */
export const SHARE_CARD = { path: '/brand/share-card.png', width: 1200, height: 630, alt: 'ClinX. 340B filings, state by state.' };
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

export const NAV: readonly { href: string; label: string }[] = [
  { href: '/scorecard/', label: 'Scorecard' },
  { href: '/data/', label: 'Data' },
  { href: '/methods/', label: 'Methods' },
  { href: '/writing/', label: 'Writing' },
  { href: '/about/', label: 'About' },
  { href: '/products/', label: 'Products' },
  { href: '/contact/', label: 'Contact' },
];

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
export const PREVIEW = true;

/** The three public repositories. The pages link to them only once the site is public (PREVIEW false). */
export const REPOSITORIES = {
  dataset: 'https://github.com/VVillBerchtold/clinx-340b',
  tracker: 'https://github.com/VVillBerchtold/clinx-radar',
  site: 'https://github.com/VVillBerchtold/clinx-org',
} as const;

/** Where ReferralFinderX lives. */
export const REFERRALFINDERX_URL = 'https://referralfinderx.com';

/** The founder's public profiles. */
export const LINKEDIN_URL = 'https://www.linkedin.com/in/will-berchtold';
export const X_URL = 'https://x.com/willberch';
