import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DAYS_OF_NOTICE, SECURITY_TXT_PATH, SECURITY_TXT_SOURCE, securityTxtFields, securityTxtProblems, securityTxtSiteLinks } from '../scripts/security-txt.mjs';
import { CONTACT_EMAIL, SITE_URL } from '../src/lib/site';
import checkDist from '../scripts/check-dist.mjs?raw';
import privacyPage from '../src/pages/privacy/index.astro?raw';

/**
 * The file that says where to report a security problem with the site, and the rule the built-site check
 * holds it to: it is there, it names a contact, and its end date is at least 30 days away.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = readFileSync(join(root, SECURITY_TXT_SOURCE), 'utf8');
const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');

/** A file like the site's, with one end date. */
const withExpires = (date: string): string => `Contact: mailto:someone@example.org\nExpires: ${date}\n`;
const NOW = new Date('2026-11-17T12:00:00Z');

describe('the site\'s own security.txt', () => {
  const fields = securityTxtFields(file);
  const values = (name: string): string[] => fields.filter((f) => f.name === name).map((f) => f.value);

  it('names the site\'s contact address and its contact page, and no other address', () => {
    expect(values('contact')).toEqual([`mailto:${CONTACT_EMAIL}`, `${SITE_URL}/contact/`]);
    expect(file.match(/[\w.+-]+@[\w.-]+/g)).toEqual([CONTACT_EMAIL]);
  });

  it('carries one end date in the standard\'s form, less than a year from the day it was written', () => {
    expect(values('expires')).toHaveLength(1);
    expect(values('expires')[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const days = (new Date(values('expires')[0]!).getTime() - NOW.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(300);
    expect(days).toBeLessThan(366);
  });

  it('gives its own address, its language, and the part of the Privacy page on reporting a problem', () => {
    expect(values('canonical')).toEqual([`${SITE_URL}${SECURITY_TXT_PATH}`]);
    expect(values('preferred-languages')).toEqual(['en']);
    expect(values('policy')).toEqual([`${SITE_URL}/privacy/#report`]);
    expect(privacyPage).toContain('<h2 id="report">Report a problem</h2>');
    expect(securityTxtSiteLinks(file, SITE_URL)).toEqual(['/contact/', '/privacy/#report']);
  });

  it('passes the rule today', () => {
    expect(securityTxtProblems(file, SITE_URL)).toEqual([]);
  });

  it('is served as plain text', () => {
    expect(headers).toContain(`${SECURITY_TXT_PATH}\n  Content-Type: text/plain; charset=utf-8\n`);
  });
});

describe('the rule for security.txt in the built-site check', () => {
  it('is read from one place, shared with the check', () => {
    expect(checkDist).toContain("from './security-txt.mjs'");
    expect(checkDist).toContain('securityTxtProblems(text, SITE)');
  });

  it('fails when the file is missing, and says where it belongs', () => {
    const problems = securityTxtProblems(null, SITE_URL, NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('missing from the build');
    expect(problems[0]).toContain(SECURITY_TXT_SOURCE);
  });

  it('fails when no contact is named, or a contact is not an address a reader can use', () => {
    expect(securityTxtProblems('Expires: 2027-10-17T00:00:00Z\n', SITE_URL, NOW).join(' ')).toContain('no "Contact:" line');
    expect(securityTxtProblems('Contact: someone@example.org\nExpires: 2027-10-17T00:00:00Z\n', SITE_URL, NOW).join(' ')).toContain('neither a mailto: address nor an https:// address');
    expect(securityTxtProblems('Contact: https://example.org/report\nExpires: 2027-10-17T00:00:00Z\n', SITE_URL, NOW)).toEqual([]);
  });

  it('fails when there is no end date, more than one, or one that is not a date', () => {
    expect(securityTxtProblems('Contact: mailto:someone@example.org\n', SITE_URL, NOW).join(' ')).toContain('no "Expires:" line');
    expect(securityTxtProblems(withExpires('2027-10-17T00:00:00Z') + 'Expires: 2027-11-17T00:00:00Z\n', SITE_URL, NOW).join(' ')).toContain('2 "Expires:" lines');
    for (const bad of ['17 October 2027', '2027-10-17', '2027-13-45T00:00:00Z', '']) {
      expect(securityTxtProblems(withExpires(bad), SITE_URL, NOW).join(' '), bad).toContain('not a date in the form the standard asks for');
    }
  });

  it(`fails when the end date is fewer than ${DAYS_OF_NOTICE} days away, and passes at ${DAYS_OF_NOTICE}`, () => {
    expect(securityTxtProblems(withExpires('2026-12-17T12:00:00Z'), SITE_URL, NOW)).toEqual([]); // 30 days
    const near = securityTxtProblems(withExpires('2026-12-17T11:59:59Z'), SITE_URL, NOW); // a second short of 30 days
    expect(near).toHaveLength(1);
    expect(near[0]).toContain('17 December 2026');
    expect(near[0]).toContain('29 days away');
    expect(securityTxtProblems(withExpires('2026-11-01T00:00:00Z'), SITE_URL, NOW).join(' ')).toContain('has passed');
  });

  it('tells a person what to do: the file to open and a line to write', () => {
    const [problem] = securityTxtProblems(withExpires('2026-11-20T00:00:00Z'), SITE_URL, NOW);
    expect(problem).toContain(`Open ${SECURITY_TXT_SOURCE}`);
    expect(problem).toContain('"Expires: 2027-10-17T00:00:00Z"');
    expect(problem).toContain('build again');
  });

  it('reads a date with an offset, and skips remarks', () => {
    expect(securityTxtProblems(withExpires('2027-10-17T00:00:00-04:00'), SITE_URL, NOW)).toEqual([]);
    expect(securityTxtFields('# Contact: mailto:hidden@example.org\nContact: https://example.org/\n')).toEqual([{ name: 'contact', value: 'https://example.org/' }]);
  });

  it('wants the file\'s own address where a Canonical line is given', () => {
    expect(securityTxtProblems(withExpires('2027-10-17T00:00:00Z') + 'Canonical: https://example.org/.well-known/security.txt\n', SITE_URL, NOW).join(' ')).toContain('"Canonical:" line should be');
  });
});
