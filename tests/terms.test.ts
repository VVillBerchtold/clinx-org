import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TERMS_CHANGED } from '../src/lib/site';
import base from '../src/layouts/Base.astro?raw';
import termsPage from '../src/pages/terms/index.astro?raw';

/**
 * The Terms of use page (/terms/). Its wording is a legal text, so these tests do not restate it. They
 * hold it to the facts it names elsewhere in the site: the request limit, the day it last changed, the
 * pages it points to, and its place at the foot of every page.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');

describe('the Terms of use page', () => {
  it('names the request limit the site really sets for the connector', () => {
    const limit = /"name":\s*"MCP_LIMIT"[^}]*"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)/.exec(wrangler);
    expect(limit).not.toBeNull();
    expect(limit?.[2]).toBe('60');
    expect(termsPage).toContain(`up to ${limit?.[1]} requests a minute from one address`);
  });

  it('shows the day its wording last changed, written as a day', () => {
    expect(TERMS_CHANGED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(termsPage).toContain('Last changed {formatDate(TERMS_CHANGED)}.');
  });

  it('has each part a reader would look for, under its own heading', () => {
    for (const id of ['who', 'agreeing', 'data', 'advice', 'accuracy', 'tools', 'connector', 'fair-use', 'links', 'send', 'copyright', 'warranty', 'liability', 'claims', 'changes', 'law', 'rest']) {
      expect(termsPage, id).toContain(`<h2 id="${id}">`);
    }
  });

  it('sets the two disclaimers in bold, so they stand out from the text around them', () => {
    expect(termsPage).toMatch(/<h2 id="warranty">[\s\S]*?<p><strong>ClinX is provided "as is" and "as available"/);
    expect(termsPage).toMatch(/<h2 id="liability">[\s\S]*?<p><strong>To the fullest extent the law allows, ClinX is not liable/);
  });

  it('never calls a file safe, and names no pricing beyond saying the site costs nothing', () => {
    expect(termsPage).not.toMatch(/\bsafe\b/i);
    expect(termsPage).not.toMatch(/anonymi[sz]ed|de-identified|HIPAA/i);
  });

  it('is linked from the foot of every page, after Privacy and security', () => {
    expect(base).toContain("{ href: '/privacy/', label: 'Privacy and security' }, { href: '/terms/', label: 'Terms of use' }];");
  });
});
