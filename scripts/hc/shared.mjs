// What the three health center parts share when they copy their tables into this site.
//
// In plain words: the tables about health centers (public records, the funding calendar, shortage
// areas) are made in their own folder, clinx-health-centers. Each part copies the files it needs
// into src/data/health-centers/<part>/ (what the pages are built from) and writes a SOURCE.json
// beside them with each file's fingerprint and the commit it came from, so a later change to a
// copy is caught by `npm run check:data`.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The folder a part's copies live in. */
export const partDir = (siteRoot, part) => join(siteRoot, 'src', 'data', 'health-centers', part);

/** Every file under a folder, as paths relative to it, sorted. */
export function filesUnder(dir) {
  const found = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(dir, path).split('\\').join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
}

/** The commit of the folder the tables come from, and whether the copied folder had changes not yet committed. */
export function sourceCommit(engineRoot, folder) {
  try {
    const git = (...args) => execFileSync('git', ['-C', engineRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', folder) !== '' };
  } catch {
    return { commit: null, dirty: false };
  }
}

/**
 * Copies the named files (paths relative to `from`) into a part's folder, emptying it first, and
 * writes SOURCE.json. `facts` are a few plain facts the pages and checks read (a day, some counts).
 */
export function copyPart({ siteRoot, engineRoot, part, from, names, facts }) {
  const target = partDir(siteRoot, part);
  rmSync(target, { recursive: true, force: true });
  const files = {};
  for (const name of names) {
    const source = join(engineRoot, from, name);
    if (!existsSync(source)) throw new Error(`no ${from}/${name} in ${engineRoot}`);
    const copy = join(target, name);
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(source, copy);
    files[name] = sha256(copy);
  }
  const { commit, dirty } = sourceCommit(engineRoot, from);
  const record = { part, ...facts, source_commit: commit, source_commit_had_uncommitted_changes: dirty, files };
  writeFileSync(join(target, 'SOURCE.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** What is wrong with a part's copies, as plain sentences: a missing file, a changed file, a file nobody listed. */
export function copyProblems(siteRoot, part) {
  const target = partDir(siteRoot, part);
  const recordPath = join(target, 'SOURCE.json');
  if (!existsSync(recordPath)) return [`src/data/health-centers/${part}/SOURCE.json is missing. Run: node scripts/sync-health-centers.mjs ${part}`];
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const problems = [];
  for (const [name, hash] of Object.entries(record.files)) {
    const path = join(target, name);
    if (!existsSync(path)) problems.push(`health-centers/${part}/${name}: listed in SOURCE.json but missing`);
    else if (sha256(path) !== hash) problems.push(`health-centers/${part}/${name}: hash differs from SOURCE.json`);
  }
  for (const name of filesUnder(target)) {
    if (name !== 'SOURCE.json' && !(name in record.files)) problems.push(`health-centers/${part}/${name}: present but not listed in SOURCE.json`);
  }
  return problems;
}

/** A part's SOURCE.json, or null before the first copy. */
export function readRecord(siteRoot, part) {
  const path = join(partDir(siteRoot, part), 'SOURCE.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
