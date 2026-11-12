// Copies the dataset into this site and records where it came from.
// Usage: node scripts/sync-data.mjs [path-to-dataset-repository]
// Default source: the sibling folder ../clinx-340b
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskSmallClaimCounts, shapeProblems, valueProblems } from './dataset-shape.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? join(root, '..', 'clinx-340b'));
const target = join(root, 'src', 'data', 'dataset');
const publicTarget = join(root, 'public', 'data');

/** Documents copied from the top of the dataset repository, next to the data. */
const DOCS = ['METHODS.md', 'DATA_DICTIONARY.md'];
/** Files offered as downloads on /data/ (same-origin copies). */
const DOWNLOAD = /\.(csv|json)$/;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(message) {
  console.error(`sync-data: ${message}`);
  process.exit(1);
}

if (!existsSync(join(source, 'data'))) fail(`no data/ folder in ${source}`);

const pyproject = readFileSync(join(source, 'pyproject.toml'), 'utf8');
const versionMatch = /^version\s*=\s*"([^"]+)"/m.exec(pyproject);
if (!versionMatch) fail('no version in pyproject.toml');

const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'data', ...DOCS, 'pyproject.toml') !== '';

// Check the source before anything is replaced: a copy with an unexpected file, column, form or unit is refused.
const sourceNames = readdirSync(join(source, 'data')).filter((n) => !n.startsWith('.'));
const rawTexts = Object.fromEntries(sourceNames.map((n) => [n, readFileSync(join(source, 'data', n), 'utf8')]));
const shape = [...shapeProblems(rawTexts)];
// The small-number rule is applied on the way in. A row with a claim count of 1 to 5 is kept and its
// count is left out, with a warning; the data is not refused for it.
const { files: sourceTexts, changed: masked } = shape.length === 0 ? maskSmallClaimCounts(rawTexts) : { files: rawTexts, changed: [] };
if (masked.length > 0) {
  console.warn(`sync-data: WARNING: ${masked.length} claim count(s) of 1 to 5 were in the source files. Each row is kept; its count is left out and marked fewer_than_6 in this copy. The dataset's own rule should have done this: check it.`);
  for (const line of masked.slice(0, 20)) console.warn(`  ${line}`);
  if (masked.length > 20) console.warn(`  ... and ${masked.length - 20} more`);
}
if (shape.length === 0) shape.push(...valueProblems(sourceTexts));
if (shape.length > 0) fail(`the dataset is not what this site expects:\n  ${shape.join('\n  ')}`);

rmSync(target, { recursive: true, force: true });
rmSync(publicTarget, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
mkdirSync(publicTarget, { recursive: true });

const names = readdirSync(join(source, 'data'))
  .filter((n) => !n.startsWith('.'))
  .sort();
const files = {};
for (const name of names) {
  // A file the rule changed is written from its changed text; every other file is copied byte for byte.
  if (sourceTexts[name] !== rawTexts[name]) writeFileSync(join(target, name), sourceTexts[name]);
  else copyFileSync(join(source, 'data', name), join(target, name));
  files[name] = sha256(join(target, name));
  if (DOWNLOAD.test(name)) copyFileSync(join(target, name), join(publicTarget, name));
}
for (const name of DOCS) {
  copyFileSync(join(source, name), join(target, name));
  files[name] = sha256(join(target, name));
}

const record = {
  dataset_version: versionMatch[1],
  dataset_commit: commit,
  dataset_commit_had_uncommitted_changes: dirty,
  small_claim_counts_left_out_by_this_site: masked.length,
  files,
};
writeFileSync(join(target, 'SOURCE.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`sync-data: ${Object.keys(files).length} files from ${source} (version ${record.dataset_version}, ${commit.slice(0, 10)}${dirty ? ', uncommitted changes in source' : ''})`);
