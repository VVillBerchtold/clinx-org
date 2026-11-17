import { describe, expect, it } from 'vitest';
import { EXAMPLE_CENTERS, EXAMPLE_YEAR, assistantExample, reportLinesNaming340b } from '../src/lib/assistant-example';
import { compareNames, getDataset } from '../src/lib/data';
import { headerRows } from '../src/lib/hc-records';
import page from '../src/pages/data/assistants/index.astro?raw';

/**
 * The worked example on the page for AI assistants: two public records about one health center, read
 * with three questions. Its figures come from the same files as the two records' own pages. These
 * tests hold the example to those files and to what the page says about it.
 */
const dollars = (text: string): number => Number(text.replace(/[$,]/g, ''));

describe('the worked example for AI assistants', () => {
  const example = assistantExample();

  it('shows two health centers, in the order of their names, each under the name HRSA prints', () => {
    expect(example.length).toBe(2);
    expect(compareNames(example[0]!.name, example[1]!.name)).toBeLessThan(0);
    for (const c of EXAMPLE_CENTERS) {
      const header = headerRows().find((h) => h.key === c.key && h.year === EXAMPLE_YEAR);
      expect(header, c.key).toBeDefined();
      expect(header!.state).toBe('OH');
      expect(header!.name.toLowerCase().startsWith(c.name.toLowerCase()), `${c.name} / ${header!.name}`).toBe(true);
    }
  });

  it('joins each filing to its health center by the 340B ID', () => {
    const data = getDataset();
    for (const c of example) {
      expect(c.id340b).toBe(`CH${c.key}`);
      expect(data.filings.some((f) => f.path === c.filingPath && f.state === 'OH' && f.reportingYear === String(EXAMPLE_YEAR))).toBe(true);
      expect(c.reportPath).toBe(`/health-centers/records/${c.key}/`);
    }
  });

  it('gives every figure as a dollar amount, with the place it was read from', () => {
    for (const c of example) {
      expect(c.filed.length).toBe(3);
      expect(c.reported.length).toBe(2);
      for (const f of [...c.filed, ...c.reported]) expect(f.text, `${c.name}: ${f.label}`).toMatch(/^\$\d{1,3}(,\d{3})*(\.\d{2})?$/);
      for (const f of c.filed) expect(f.where).toMatch(/^cell [A-Z]+\d+$/);
      expect(c.reported.map((f) => f.where)).toEqual(['Table 9E, line 1g', 'Table 8A, line 8b']);
    }
  });

  it('does not lean one way: the filed payments are the larger figures at one health center and the grant is at the other', () => {
    const sides = example.map((c) => {
      const paid = c.filed.reduce((sum, f) => sum + dollars(f.text), 0);
      return paid > dollars(c.reported[0]!.text);
    });
    expect(sides.filter(Boolean).length).toBe(1);
  });

  it('is right to say that no line of the HRSA report names 340B', () => {
    expect(reportLinesNaming340b()).toBe(0);
    expect(page).toContain("HRSA's report has no line that names 340B.");
  });

  it('types no figure into the page and draws no conclusion', () => {
    const section = page.slice(page.indexOf('<h2 id="example">'), page.indexOf('<h2 id="keep-in-mind">'));
    expect(section).not.toMatch(/\$\d/);
    expect(section).toContain('ClinX draws no conclusion from them.');
    expect(section).not.toMatch(/\b(best|highest|lowest|worst|more than|less than|larger|smaller|exceeds?)\b|\btop /i);
  });
});
