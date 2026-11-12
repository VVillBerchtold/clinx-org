// Fails if a copied dataset file no longer matches the hash in SOURCE.json.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeProblems, valueProblems } from './dataset-shape.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src', 'data', 'dataset');
const publicDir = join(root, 'public', 'data');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const problems = [];
const recordPath = join(dir, 'SOURCE.json');
if (!existsSync(recordPath)) {
  console.error('check-data: src/data/dataset/SOURCE.json is missing. Run: npm run sync');
  process.exit(1);
}
const record = JSON.parse(readFileSync(recordPath, 'utf8'));

for (const [name, hash] of Object.entries(record.files)) {
  const path = join(dir, name);
  if (!existsSync(path)) problems.push(`${name}: listed in SOURCE.json but missing`);
  else if (sha256(path) !== hash) problems.push(`${name}: hash differs from SOURCE.json`);
}
for (const name of readdirSync(dir)) {
  if (name !== 'SOURCE.json' && !(name in record.files)) problems.push(`${name}: present but not listed in SOURCE.json`);
}
// Downloads must be byte for byte the same files.
for (const name of existsSync(publicDir) ? readdirSync(publicDir) : []) {
  if (!(name in record.files)) problems.push(`public/data/${name}: not listed in SOURCE.json`);
  else if (sha256(join(publicDir, name)) !== record.files[name]) problems.push(`public/data/${name}: hash differs from SOURCE.json`);
}
for (const name of Object.keys(record.files)) {
  if (/\.(csv|json)$/.test(name) && !existsSync(join(publicDir, name))) problems.push(`public/data/${name}: missing`);
}

// The shape of the copy: the files, the columns, the forms and the units.
const dataTexts = {};
for (const name of Object.keys(record.files)) {
  if (/\.(csv|json|svg)$/.test(name) && existsSync(join(dir, name))) dataTexts[name] = readFileSync(join(dir, name), 'utf8');
}
const shape = shapeProblems(dataTexts);
if (shape.length === 0) shape.push(...valueProblems(dataTexts));
problems.push(...shape);

if (problems.length > 0) {
  for (const p of problems) console.error(`check-data: ${p}`);
  process.exit(1);
}
console.log(`check-data: ${Object.keys(record.files).length} files match SOURCE.json (dataset version ${record.dataset_version}).`);
