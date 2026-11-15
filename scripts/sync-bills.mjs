// Copies the bills table into this site and records where it came from.
// Usage: node scripts/sync-bills.mjs [path-to-the-bills-folder]
// Default source: the sibling folder ../clinx-340b-bills
//
// In plain words: the bills table (bills in Congress and the states that name 340B) and the
// calendar made from it are made in their own folder. This copies their four files into
// src/data/bills/ (what the pages are built from) and
// into public/data/ (what people download), after checking they are what the site expects, and
// writes down each file's fingerprint so a later change to a copy is caught.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILL_FILES, billsProblems } from './bills-shape.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? join(root, '..', 'clinx-340b-bills'));
const target = join(root, 'src', 'data', 'bills');
const publicTarget = join(root, 'public', 'data');

function fail(message) {
  console.error(`sync-bills: ${message}`);
  process.exit(1);
}

for (const name of BILL_FILES) {
  if (!existsSync(join(source, 'data', name))) fail(`no data/${name} in ${source}`);
}
const texts = Object.fromEntries(BILL_FILES.map((name) => [name, readFileSync(join(source, 'data', name), 'utf8')]));
const problems = billsProblems(texts);
if (problems.length > 0) fail(`the bills table is not what this site expects:\n  ${problems.join('\n  ')}`);

// The commit the table was copied from; a folder with no commit yet has none.
let commit = null;
let dirty = false;
try {
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  commit = git('rev-parse', 'HEAD');
  dirty = git('status', '--porcelain', '--', 'data') !== '';
} catch {
  commit = null;
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
mkdirSync(publicTarget, { recursive: true });
const files = {};
for (const name of BILL_FILES) {
  copyFileSync(join(source, 'data', name), join(target, name));
  copyFileSync(join(target, name), join(publicTarget, name));
  files[name] = createHash('sha256').update(readFileSync(join(target, name))).digest('hex');
}
const document = JSON.parse(texts['340b-bills.json']);
const record = {
  retrieved: document.retrieved,
  bills: document.bills.length,
  events: JSON.parse(texts['340b-events.json']).events.length,
  source_commit: commit,
  source_commit_had_uncommitted_changes: dirty,
  files,
};
writeFileSync(join(target, 'SOURCE.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`sync-bills: ${record.bills} bills and ${record.events} events from ${source} (retrieved ${record.retrieved}${commit ? `, ${commit.slice(0, 10)}` : ', no commit yet'})`);
