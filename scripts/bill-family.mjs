// Builds the bill family tree: which state contract pharmacy bills and laws share wording, word for word.
// Usage: node scripts/bill-family.mjs [bills-folder] [laws-folder]
// Defaults: the sibling folders ../clinx-340b-bills and ../clinx-340b (beside this repository).
//
// In plain words: the bills table lists every state bill that names 340B, and the bills folder keeps
// the official text of each one, as the legislature published it. The laws dataset keeps the text of
// every state 340B law. This reads the texts of the bills and laws about contract pharmacies, finds
// every passage two of them share word for word, and writes down each pair that shares enough, with
// the evidence: how many words they share, the longest shared passage in the bill's own words, and
// the facts from the tables that tie them (the same number, the same sponsor, the law a bill became).
// It never says which text came first or who wrote it: only that the words are the same.
//
// Output: src/data/bill-family/340b-bill-family.json. The page is built from it, and the site serves
// its links as /data/340b-bill-links.csv (src/pages/data/340b-bill-links.csv.ts).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './hc/records.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const billsDir = resolve(process.argv[2] ?? join(root, '..', 'clinx-340b-bills'));
const lawsDir = resolve(process.argv[3] ?? join(root, '..', 'clinx-340b'));
const outJson = join(root, 'src', 'data', 'bill-family', '340b-bill-family.json');

/** The kind of bill and law the tree is about. */
const KIND = 'contract-pharmacy';
/** A shared run shorter than this many words is not counted (phrases like "the united states department of"). */
const MIN_RUN = 12;
/** Two texts are linked when the passages they share, counted in words, reach this many. */
const MIN_SHARED = 40;
/** A passage counts only if it holds one of these words: the rest is the common frame of any bill (severability, dates, definitions of health information). */
const SUBJECT = new Set(['340b', 'pharmacy', 'pharmacies', 'manufacturer', 'manufacturers', 'drug', 'drugs', 'covered', '256b']);
/** ... and one of those passages runs at least this many words: a whole sentence, not a few phrases in common. */
const MIN_LONGEST = 20;
/** Twins: two bills in one session whose shared words are at least this share of the shorter text. */
const TWIN = 0.6;
/** Filed again: a bill in a later session whose shared words are at least this share of the shorter text. */
const AGAIN = 0.5;
/** The longest passage is shown up to this many words. */
const SHOW = 70;

function fail(message) {
  console.error(`bill-family: ${message}`);
  process.exit(1);
}

const sha = (text) => createHash('sha256').update(text).digest('hex');
const commitOf = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

/** The words of a text, lower case, with where each one sits in the original, so a passage can be shown as printed. */
function wordsOf(text) {
  const words = [];
  const starts = [];
  const ends = [];
  for (const m of text.matchAll(/[A-Za-z0-9]+/g)) {
    words.push(m[0].toLowerCase());
    starts.push(m.index);
    ends.push(m.index + m[0].length);
  }
  return { text, words, starts, ends };
}

// ---------- The members: bills and laws about contract pharmacies ----------

const billsPath = join(billsDir, 'data', '340b-bills.json');
if (!existsSync(billsPath)) fail(`no data/340b-bills.json in ${billsDir}`);
const billsDoc = JSON.parse(readFileSync(billsPath, 'utf8'));
const lawsPath = join(lawsDir, 'laws', 'laws.csv');
if (!existsSync(lawsPath)) fail(`no laws/laws.csv in ${lawsDir}`);
const laws = parseCsv(readFileSync(lawsPath, 'utf8')).records;

/**
 * A bill number reduced to its chamber and its digits, so the two tables' spellings meet:
 * "SB 114", "S 0114 Substitute A" and "S. 114" are S114; "E2SSB 5981" is S5981; "H.266" is H266; "LB 168" is LB168.
 */
function numberKey(s) {
  // The last letters-then-digits group: "E2SSB 5981" is SSB 5981, not E 2.
  const m = [...s.toUpperCase().matchAll(/([A-Z][A-Z.]*)\s*(\d[\d-]*)/g)].at(-1);
  if (!m) return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const letters = m[1].replace(/[^A-Z]/g, '');
  const chamber = /S[BF]?$/.test(letters) ? 'S' : /(H[BF]?|AB?)$/.test(letters) ? 'H' : letters;
  return chamber + m[2].replace(/-/g, '').replace(/^0+/, '');
}
const yearOf = (iso) => (iso ? Number(iso.slice(0, 4)) : null);

const bills = billsDoc.bills.filter((b) => b.jurisdiction !== 'US' && (b.kinds ?? []).includes(KIND));
const cpLaws = laws.filter((l) => l.kinds.split(/[;|,\s]+/).includes(KIND));

/**
 * The bills of a law that the bills table also lists: same state, same number (a law may name two, one from each
 * chamber), introduced in the law's year or the year before. A bill listed under two sessions: the listing whose
 * session holds the law's year, else the later one.
 */
function billsOfLaw(law) {
  const year = Number(law.session_year);
  const out = [];
  for (const one of law.bill.split(';').map((x) => x.trim()).filter(Boolean)) {
    const key = numberKey(one);
    const found = bills.filter((b) => b.jurisdiction === law.state && numberKey(b.bill) === key && [year - 1, year].includes(yearOf(b.introduced_date)));
    if (found.length === 0) continue;
    out.push(found.find((b) => b.session.includes(String(year))) ?? found.sort((p, q) => q.bill_id.localeCompare(p.bill_id))[0]);
  }
  return out;
}

const members = [];
const lawOfBill = new Map();
const lawsAsBills = new Set();
for (const law of cpLaws) {
  for (const bill of billsOfLaw(law)) {
    lawOfBill.set(bill.bill_id, law);
    lawsAsBills.add(law.law_id);
  }
}
const lawName = (law) => law.act || law.citation;
for (const b of bills) {
  const law = lawOfBill.get(b.bill_id);
  members.push({
    id: b.bill_id,
    type: 'bill',
    state: b.jurisdiction,
    number: b.bill,
    session: b.session,
    date: b.introduced_date || '',
    // Where the bills table has no day, the bill sits at the start of its session's first year.
    order: b.introduced_date || `${b.session.match(/\d{4}/)?.[0] ?? '9999'}-01-01`,
    sponsor: b.sponsor,
    title: b.title,
    stage: b.stage,
    law_id: law ? law.law_id : '',
    law_name: law ? lawName(law) : '',
    text_url: b.text_url,
    text_version: b.text_version,
    textFile: join(billsDir, 'raw', 'state-texts', `${b.bill_id}.txt`),
  });
}
for (const law of cpLaws) {
  if (lawsAsBills.has(law.law_id)) continue;
  const day = law.signed_date || law.effective_date;
  members.push({
    id: law.law_id,
    type: 'law',
    state: law.state,
    number: law.bill,
    session: law.session_year,
    date: day,
    // A law with no day on record sits at the end of its year: it passed after the year's bills were filed.
    order: day || `${law.session_year}-12-31`,
    sponsor: '',
    title: law.title,
    stage: 'Law',
    law_id: law.law_id,
    law_name: lawName(law),
    text_url: law.source_url,
    text_version: lawName(law),
    textFile: law.source_text ? join(lawsDir, law.source_text) : '',
  });
}

const texts = new Map();
const notCompared = [];
for (const m of members) {
  if (m.textFile && existsSync(m.textFile)) {
    texts.set(m.id, wordsOf(readFileSync(m.textFile, 'utf8')));
  } else {
    notCompared.push(m.id);
  }
}
if (texts.size < members.length / 2) fail(`only ${texts.size} of ${members.length} texts found: is ${join(billsDir, 'raw', 'state-texts')} there?`);

// ---------- Shared passages ----------

const K = MIN_RUN;
function gramsOf(words) {
  const index = new Map();
  for (let i = 0; i + K <= words.length; i++) {
    const key = words.slice(i, i + K).join(' ');
    const list = index.get(key);
    if (list) list.push(i);
    else index.set(key, [i]);
  }
  return index;
}
const grams = new Map([...texts].map(([id, t]) => [id, gramsOf(t.words)]));

/** Runs of words in A that also stand, in the same order, in B. Greedy: each word of A is in at most one run. */
function sharedRuns(a, b, bGrams) {
  const A = a.words;
  const B = b.words;
  const runs = [];
  let i = 0;
  while (i + K <= A.length) {
    const at = bGrams.get(A.slice(i, i + K).join(' '));
    if (!at) {
      i++;
      continue;
    }
    let bestLen = 0;
    let bestJ = 0;
    for (const j of at.slice(0, 50)) {
      let n = K;
      while (i + n < A.length && j + n < B.length && A[i + n] === B[j + n]) n++;
      if (n > bestLen) {
        bestLen = n;
        bestJ = j;
      }
    }
    runs.push({ i, j: bestJ, n: bestLen });
    i += bestLen;
  }
  return runs.filter((r) => A.slice(r.i, r.i + r.n).some((w) => SUBJECT.has(w)));
}

const passage = (t, start, n) => {
  const shown = Math.min(n, SHOW);
  const raw = t.text.slice(t.starts[start], t.ends[start + shown - 1]).replace(/\s+/g, ' ').trim();
  return shown < n ? `${raw} …` : raw;
};

const byId = new Map(members.map((m) => [m.id, m]));
const chamber = (number) => (/^(H|A)/i.test(number) ? 'house' : /^S/i.test(number) ? 'senate' : 'other');
const sameSponsor = (a, b) => {
  const names = (s) => new Set(s.split(/;\s*/).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const x = names(a.sponsor);
  const y = names(b.sponsor);
  return [...x].filter((n) => y.has(n));
};

const links = [];
const ids = [...texts.keys()].sort();
for (let p = 0; p < ids.length; p++) {
  for (let q = p + 1; q < ids.length; q++) {
    // Order each pair by date, then id, so "a" is the earlier text in the table.
    let [x, y] = [byId.get(ids[p]), byId.get(ids[q])];
    if (`${y.order}|${y.id}` < `${x.order}|${x.id}`) [x, y] = [y, x];
    const a = texts.get(x.id);
    const b = texts.get(y.id);
    const runs = sharedRuns(a, b, grams.get(y.id));
    const shared = runs.reduce((s, r) => s + r.n, 0);
    const sameNumber = x.state === y.state && numberKey(x.number) === numberKey(y.number) && x.type === 'bill' && y.type === 'bill';
    const becameLaw = (x.type === 'bill' && x.law_id && x.law_id === y.law_id) || false;
    const longest = runs.reduce((best, r) => (r.n > best.n ? r : best), { n: 0, i: 0 });
    if ((shared < MIN_SHARED || longest.n < MIN_LONGEST) && !sameNumber) continue;
    const shareA = a.words.length ? shared / a.words.length : 0;
    const shareB = b.words.length ? shared / b.words.length : 0;
    const shareShort = Math.max(shareA, shareB);
    const sponsors = x.type === 'bill' && y.type === 'bill' && x.state === y.state ? sameSponsor(x, y) : [];
    let kind;
    if (x.state !== y.state) kind = 'across-states';
    else if (sameNumber && x.session !== y.session) kind = 'carried-over';
    else if (x.session === y.session && shareShort >= TWIN && chamber(x.number) !== chamber(y.number)) kind = 'twins';
    else if (x.session !== y.session && shareShort >= AGAIN) kind = 'filed-again';
    else kind = 'same-state';
    links.push({
      a: x.id,
      b: y.id,
      kind,
      shared_words: shared,
      share_a: Math.round(shareA * 1000) / 1000,
      share_b: Math.round(shareB * 1000) / 1000,
      longest_words: longest.n,
      longest_passage: longest.n ? passage(a, longest.i, longest.n) : '',
      same_number: sameNumber,
      same_sponsor: sponsors.length > 0 ? x.sponsor.split(/;\s*/).filter((n) => sponsors.includes(n.trim().toLowerCase())).join('; ') : '',
      same_law: becameLaw,
    });
  }
}

// ---------- The tree: each text under its closest earlier text ----------
//
// For every bill and law, its parent is the earlier text in this record that shares the most words with it
// (the same bill listed again in a later year goes under its first listing). A text that shares fewer than
// MIN_SHARED words with every earlier one is a root. This says where the closest wording stands in the record;
// it does not say the later text was copied from that one.

const parents = new Map();
for (const m of members) {
  const earlier = links.filter((l) => l.b === m.id);
  if (earlier.length === 0) continue;
  const pick = earlier.find((l) => l.kind === 'carried-over') ?? earlier.sort((p, q) => q.shared_words - p.shared_words || q.longest_words - p.longest_words || p.a.localeCompare(q.a))[0];
  if (pick) parents.set(m.id, pick);
}
const children = new Map();
for (const [child, link] of parents) {
  if (!children.has(link.a)) children.set(link.a, []);
  children.get(link.a).push(child);
}
const byOrder = (p, q) => `${byId.get(p).order}|${p}`.localeCompare(`${byId.get(q).order}|${q}`);
const sizeOf = (id) => 1 + (children.get(id) ?? []).reduce((n, c) => n + sizeOf(c), 0);
const roots = members.filter((m) => texts.has(m.id) && !parents.has(m.id)).map((m) => m.id);
const families = roots
  .filter((id) => children.has(id))
  .sort((p, q) => sizeOf(q) - sizeOf(p) || byOrder(p, q))
  .map((root, n) => {
    const ids = [];
    const walk = (id) => {
      ids.push(id);
      for (const c of (children.get(id) ?? []).sort(byOrder)) walk(c);
    };
    walk(root);
    return { family: n + 1, root, members: ids, states: [...new Set(ids.map((id) => byId.get(id).state))].sort() };
  });
const alone = roots.filter((id) => !children.has(id)).sort(byOrder);

const sources = {
  bills: { retrieved: billsDoc.retrieved, commit: commitOf(billsDir), sha256: sha(readFileSync(billsPath)) },
  laws: { commit: commitOf(lawsDir), sha256: sha(readFileSync(lawsPath)) },
};
const document = {
  built: new Date().toISOString().slice(0, 10),
  kind: KIND,
  rules: { min_run: MIN_RUN, min_shared: MIN_SHARED, min_longest: MIN_LONGEST, twin_share: TWIN, again_share: AGAIN, subject_words: [...SUBJECT] },
  sources,
  members: members.map(({ textFile, ...m }) => {
    const up = parents.get(m.id);
    return {
      ...m,
      compared: texts.has(m.id),
      words: texts.get(m.id)?.words.length ?? 0,
      parent: up ? up.a : '',
      relatives: links.filter((l) => l.a === m.id || l.b === m.id).length,
    };
  }),
  links: links.sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b)),
  families,
  alone,
  not_compared: notCompared,
};

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(document, null, 1) + '\n');
const counts = links.reduce((c, l) => ((c[l.kind] = (c[l.kind] ?? 0) + 1), c), {});
console.log(`bill-family: ${members.length} members (${texts.size} compared), ${links.length} links ${JSON.stringify(counts)}, ${families.length} families`);
