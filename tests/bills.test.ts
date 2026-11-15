import { describe, expect, it } from 'vitest';
import { BILL_ROLES, CONGRESS, NAMED_IN, STEPS, billHref, billsMapSvg, billsPath, hostOf, inPageOrder, latestSteps, namedInWords, parseBills, placeName, sessionOver, sessionsOf, statesWithBills, stepOf, type Bill } from '../src/lib/bills';
import { LAW_KINDS } from '../src/lib/laws';
import { BILL_COLUMNS, BILL_FILES, BILL_ROLES as SHAPE_ROLES, NAMED_IN as SHAPE_NAMED_IN, billsProblems } from '../scripts/bills-shape.mjs';
import { STATES } from '../src/lib/states';

/** The copy of the bills table in this site, as text. */
function texts(): Record<string, string> {
  const modules = import.meta.glob('../src/data/bills/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split('/').pop()!, text]));
}

describe('bills', () => {
  const files = texts();
  const data = parseBills(files['340b-bills.json']!);

  it('knows the same roles and places-named as the check that guards the copy of the table', () => {
    expect([...BILL_ROLES]).toEqual(SHAPE_ROLES);
    expect([...NAMED_IN]).toEqual(SHAPE_NAMED_IN);
    expect([...data.roleLabels.keys()]).toEqual([...BILL_ROLES]);
    expect(JSON.parse(files['340b-bills.json']!).kinds).toEqual([...LAW_KINDS]);
  });

  it('holds a copy the shape check accepts, and the check refuses a changed one', () => {
    expect(billsProblems(files)).toEqual([]);
    expect(BILL_FILES.every((name) => name in files)).toBe(true);
    const document = JSON.parse(files['340b-bills.json']!);
    document.bills[0].role = 'sponsor';
    document.bills[1].bill_url = 'ftp://example.com/a b';
    document.bills[2].session_end = 'next year';
    const problems = billsProblems({ ...files, '340b-bills.json': JSON.stringify(document) });
    expect(problems.join('\n')).toMatch(/unknown role sponsor/);
    expect(problems.join('\n')).toMatch(/no official page/);
    expect(problems.join('\n')).toMatch(/session_end is not a date/);
    expect(billsProblems({ ...files, 'bills.csv': files['bills.csv']!.replace('bill_id,', 'id,') }).join('\n')).toMatch(/columns/);
    expect(billsProblems({ 'bills.csv': files['bills.csv']! })).toEqual(['340b-bills.json: missing', 'notices.csv: missing', '340b-notices.json: missing', 'events.csv: missing', '340b-events.json: missing']);
    expect(files['bills.csv']!.split('\n', 1)[0]).toBe(BILL_COLUMNS.join(','));
  });

  it('gives every bill a number, a title, a place, an official page and a place where it names the program', () => {
    expect(data.bills.length).toBeGreaterThan(0);
    for (const bill of data.bills) {
      expect(bill.bill).not.toBe('');
      expect(bill.title).not.toBe('');
      expect(bill.billUrl).toMatch(/^https?:\/\/\S+$/);
      expect(bill.namedIn.length).toBeGreaterThan(0);
      expect(bill.billId.slice(0, 2).toUpperCase()).toBe(bill.place);
      expect(placeName(bill.place)).not.toBe('');
      // A bill whose text was read and names the program carries the passage that does.
      if (bill.namedIn.includes('text')) expect(bill.quote).toMatch(/340\s?-?B|256b/i);
      // What a person adds comes together or not at all.
      if (bill.role === '') expect(bill.summary === '' && bill.kinds.length === 0).toBe(true);
      else expect(bill.summary).not.toBe('');
      if (bill.role === 'mention') expect(bill.kinds).toEqual([]);
      expect(namedInWords(bill)).not.toBe('');
    }
    expect(new Set(data.bills.map((b) => b.billId)).size).toBe(data.bills.length);
  });

  it('puts every bill on exactly one page, in one session, once', () => {
    const places = [CONGRESS, ...statesWithBills(data).map((s) => s.code)];
    const shown: string[] = [];
    for (const place of places) {
      const sessions = sessionsOf(data, place);
      expect(sessions.length).toBeGreaterThan(0);
      for (let i = 1; i < sessions.length; i++) expect(sessions[i - 1]!.sessionEnd >= sessions[i]!.sessionEnd).toBe(true);
      for (const session of sessions) {
        expect(session.mentions.every((b) => b.role === 'mention')).toBe(true);
        expect(session.bills.every((b) => b.role !== 'mention')).toBe(true);
        shown.push(...session.bills.map((b) => b.billId), ...session.mentions.map((b) => b.billId));
      }
    }
    expect(shown.sort()).toEqual(data.bills.map((b) => b.billId).sort());
    expect(billsPath(CONGRESS)).toBe('/bills/congress/');
    expect(billsPath('RI')).toBe('/bills/ri/');
    expect(billHref(data.bills[0]!)).toBe(`${billsPath(data.bills[0]!.place)}#${data.bills[0]!.billId}`);
  });

  it('measures how far a bill has got on five steps', () => {
    const at = (stage: string): number => stepOf({ ...data.bills[0]!, stage });
    expect(STEPS.length).toBe(5);
    expect([at(''), at('Introduced'), at('Reported by committee'), at('Passed the Senate'), at('Passed the Assembly')]).toEqual([0, 1, 2, 3, 3]);
    expect([at('Passed both chambers'), at('Passed the legislature'), at('Sent to the governor'), at('Sent to the President'), at('Vetoed'), at('Became law')]).toEqual([4, 4, 4, 4, 4, 5]);
    expect(() => at('Tabled')).toThrow();
    for (const bill of data.bills) expect(stepOf(bill)).toBeGreaterThanOrEqual(0);
  });

  it('says a session is over only for a bill that did not become law in a session that has ended', () => {
    const bill = data.bills[0]!;
    const made = (changes: Partial<Bill>): Bill => ({ ...bill, ...changes });
    expect(sessionOver(data, made({ sessionEnd: '2025-05-02', stage: 'Introduced' }))).toBe(true);
    expect(sessionOver(data, made({ sessionEnd: '2025-05-02', stage: 'Became law' }))).toBe(false);
    expect(sessionOver(data, made({ sessionEnd: '2999-01-01', stage: 'Introduced' }))).toBe(false);
  });

  it('orders a page: about 340B, then a part on it, then named in the title, then named in the text', () => {
    const bill = data.bills[0]!;
    const made = (billId: string, changes: Partial<Bill>): Bill => ({ ...bill, billId, role: '', namedIn: ['text'], stage: 'Introduced', latestActionDate: '2026-01-01', ...changes });
    const ordered = inPageOrder([
      made('text', {}),
      made('title', { namedIn: ['title', 'text'] }),
      made('part', { role: 'part' }),
      made('main-early', { role: 'main' }),
      made('main-further', { role: 'main', stage: 'Passed the Senate' }),
      made('main-newer', { role: 'main', latestActionDate: '2026-06-01' }),
    ]);
    expect(ordered.map((b) => b.billId)).toEqual(['main-further', 'main-newer', 'main-early', 'part', 'title', 'text']);
  });

  it('lists the newest steps of bills about 340B, newest first', () => {
    const newest = latestSteps(data, 6);
    expect(newest.length).toBe(6);
    for (let i = 1; i < newest.length; i++) expect(newest[i - 1]!.latestActionDate >= newest[i]!.latestActionDate).toBe(true);
    for (const bill of newest) expect(bill.role === 'main' || bill.role === 'part' || bill.namedIn.includes('title')).toBe(true);
  });

  it('draws a map that links each state with a bill to its page, and no other', () => {
    const svg = billsMapSvg(data, 'm', { current: statesWithBills(data)[0]!.code });
    const withBills = statesWithBills(data);
    expect(svg.match(/<a class="tile-g has/g)?.length).toBe(withBills.length);
    expect(svg.match(/class="tile-g none/g)?.length).toBe(STATES.length - withBills.length);
    for (const state of withBills) expect(svg).toContain(`href="${billsPath(state.code)}"`);
    expect(svg.match(/aria-current="page"/g)?.length).toBe(1);
    expect(svg).not.toContain('style=');
  });

  it('names the site a link goes to', () => {
    expect(hostOf('https://www.congress.gov/bill/119th-congress/house-bill/44')).toBe('congress.gov');
    expect(hostOf('http://webserver.rilegislature.gov/BillText25/a.pdf')).toBe('webserver.rilegislature.gov');
  });

  it('refuses a file it does not understand', () => {
    const document = JSON.parse(files['340b-bills.json']!);
    const broken = (change: (d: typeof document) => void): string => {
      const copy = structuredClone(document);
      change(copy);
      return JSON.stringify(copy);
    };
    expect(() => parseBills(broken((d) => (d.bills[0].jurisdiction = 'ZZ')))).toThrow();
    expect(() => parseBills(broken((d) => (d.bills[0].kinds = ['tax'])))).toThrow();
    expect(() => parseBills(broken((d) => (d.bills[0].bill_url = '')))).toThrow();
    expect(() => parseBills(broken((d) => (d.bills[0].text_mentions = '3')))).toThrow();
  });
});
