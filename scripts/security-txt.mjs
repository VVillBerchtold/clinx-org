// The rules for the file that says where to report a security problem (public/.well-known/security.txt).
//
// In plain words: a site can keep one small text file at a fixed address, /.well-known/security.txt, that
// tells a person who has found a security problem whom to write to. The format is a public standard
// (RFC 9116). The file carries an end date, the "Expires" line, so that a file nobody looks after stops
// being trusted. This check fails the build while there is still a month to spare, so the date is moved
// on before it runs out. scripts/check-dist.mjs runs it on the built site; tests/security-txt.test.ts tests it.

/** The file's address on the site, and the file it is built from. */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';
export const SECURITY_TXT_SOURCE = 'public/.well-known/security.txt';

/** The build fails when the end date is fewer than this many days away. */
export const DAYS_OF_NOTICE = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A day the way the site writes one: 17 October 2027. */
const plainDay = (date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

/** The lines of the file as name and value pairs. A line that starts with # is a remark and is left out. */
export function securityTxtFields(text) {
  const fields = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Za-z-]+):\s*(.*?)\s*$/.exec(line);
    if (m && !line.startsWith('#')) fields.push({ name: String(m[1]).toLowerCase(), value: String(m[2]) });
  }
  return fields;
}

/**
 * What is wrong with the file, as sentences a person can act on. An empty list means nothing is wrong.
 * `text` is the file's text, or null when the build has no such file. `site` is the site's address
 * (https://clinx.org). `now` is the moment of the check.
 */
export function securityTxtProblems(text, site, now = new Date()) {
  if (text === null || text === undefined) {
    return [`the file is missing from the build. It belongs at ${SECURITY_TXT_SOURCE}: put it back (the last commit that had it has its text) and build again.`];
  }
  const problems = [];
  const all = (name) => securityTxtFields(text).filter((f) => f.name === name).map((f) => f.value);
  // A date about eleven months from the day of the check, to offer as the new end date.
  const later = new Date(now.getTime());
  later.setUTCMonth(later.getUTCMonth() + 11);
  const offer = `Expires: ${later.toISOString().slice(0, 10)}T00:00:00Z`;
  const fix = `Open ${SECURITY_TXT_SOURCE}, write the line with a day about eleven months from today, for example "${offer}", and build again.`;

  const contacts = all('contact');
  if (contacts.length === 0) problems.push(`there is no "Contact:" line, so a reader is not told whom to write to. Add one to ${SECURITY_TXT_SOURCE}, for example "Contact: ${site}/contact/".`);
  for (const contact of contacts) {
    if (!/^(?:mailto:\S+@\S+|https:\/\/\S+)$/.test(contact)) problems.push(`the line "Contact: ${contact}" is neither a mailto: address nor an https:// address. Correct it in ${SECURITY_TXT_SOURCE}.`);
  }

  const expires = all('expires');
  if (expires.length === 0) problems.push(`there is no "Expires:" line. The standard requires one. ${fix}`);
  else if (expires.length > 1) problems.push(`there are ${expires.length} "Expires:" lines and the standard allows one. Keep one in ${SECURITY_TXT_SOURCE}.`);
  else {
    const written = expires[0];
    const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(written) ? new Date(written) : null;
    if (date === null || Number.isNaN(date.getTime())) problems.push(`the line "Expires: ${written}" is not a date in the form the standard asks for, such as 2027-10-17T00:00:00Z. ${fix}`);
    else {
      const daysLeft = Math.floor((date.getTime() - now.getTime()) / DAY_MS);
      if (daysLeft < 0) problems.push(`its end date (${plainDay(date)}) has passed, so readers will no longer trust the file. ${fix}`);
      else if (daysLeft < DAYS_OF_NOTICE) problems.push(`its end date (${plainDay(date)}) is ${daysLeft} day${daysLeft === 1 ? '' : 's'} away, fewer than the ${DAYS_OF_NOTICE} this check allows. ${fix}`);
    }
  }

  const canonical = all('canonical');
  if (canonical.length > 0 && !canonical.includes(site + SECURITY_TXT_PATH)) problems.push(`the "Canonical:" line should be the file's own address, ${site + SECURITY_TXT_PATH}. Correct it in ${SECURITY_TXT_SOURCE}.`);
  return problems;
}

/** The addresses on this site that the file names (a contact page, a policy page), each as a path such as /privacy/#report. */
export function securityTxtSiteLinks(text, site) {
  return securityTxtFields(text)
    .filter((f) => ['contact', 'policy', 'acknowledgments', 'hiring'].includes(f.name) && f.value.startsWith(site + '/'))
    .map((f) => f.value.slice(site.length));
}
