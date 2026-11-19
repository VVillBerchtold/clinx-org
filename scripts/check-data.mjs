// Fails if a copied dataset file no longer matches the hash in SOURCE.json.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeProblems, valueProblems } from './dataset-shape.mjs';
import { BILL_FILES, billsProblems } from './bills-shape.mjs';
import { MCP_DIR, MCP_FILES } from './sync-mcp.mjs';
import { PARTS, partModule } from './sync-health-centers.mjs';
import { copyProblems, readRecord } from './hc/shared.mjs';

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
// The bills table is a second copy with its own record (scripts/sync-bills.mjs).
const billsDir = join(root, 'src', 'data', 'bills');
const billsRecordPath = join(billsDir, 'SOURCE.json');
if (!existsSync(billsRecordPath)) {
  console.error('check-data: src/data/bills/SOURCE.json is missing. Run: node scripts/sync-bills.mjs');
  process.exit(1);
}
const billsRecord = JSON.parse(readFileSync(billsRecordPath, 'utf8'));
for (const name of BILL_FILES) {
  const hash = billsRecord.files[name];
  if (name in record.files) problems.push(`${name}: the dataset and the bills table both have a file of this name`);
  for (const [where, path] of [['src/data/bills', join(billsDir, name)], ['public/data', join(publicDir, name)]]) {
    if (!existsSync(path)) problems.push(`${where}/${name}: missing`);
    else if (sha256(path) !== hash) problems.push(`${where}/${name}: hash differs from src/data/bills/SOURCE.json`);
  }
}
for (const name of readdirSync(billsDir)) {
  if (name !== 'SOURCE.json' && !BILL_FILES.includes(name)) problems.push(`src/data/bills/${name}: not a file of the bills table`);
}
if (BILL_FILES.every((name) => existsSync(join(billsDir, name)))) {
  problems.push(...billsProblems(Object.fromEntries(BILL_FILES.map((name) => [name, readFileSync(join(billsDir, name), 'utf8')]))));
}

// Downloads must be byte for byte the same files.
for (const name of existsSync(publicDir) ? readdirSync(publicDir) : []) {
  if (BILL_FILES.includes(name)) continue;
  // The health center downloads have their own folder and their own records (scripts/hc/).
  if (name === 'health-centers') continue;
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

// The server for assistants is a third copy with its own record (scripts/sync-mcp.mjs).
const mcpRecordPath = join(MCP_DIR, 'SOURCE.json');
if (!existsSync(mcpRecordPath)) {
  console.error('check-data: worker/mcp/SOURCE.json is missing. Run: node scripts/sync-mcp.mjs');
  process.exit(1);
}
const mcpRecord = JSON.parse(readFileSync(mcpRecordPath, 'utf8'));
for (const name of MCP_FILES) {
  if (!existsSync(join(MCP_DIR, name))) problems.push(`worker/mcp/${name}: missing`);
  else if (sha256(join(MCP_DIR, name)) !== mcpRecord.files[name]) problems.push(`worker/mcp/${name}: hash differs from worker/mcp/SOURCE.json`);
}
for (const name of readdirSync(MCP_DIR)) {
  if (name !== 'SOURCE.json' && !MCP_FILES.includes(name)) problems.push(`worker/mcp/${name}: not a file of the server for assistants`);
}
if (mcpRecord.source_commit === null || mcpRecord.source_commit_had_uncommitted_changes) problems.push('worker/mcp: copied from a folder with changes that were not committed. Commit them there and run: node scripts/sync-mcp.mjs');

// The health center tables: one copy for each part that exists, each with its own record.
const healthCenterLines = [];
for (const part of PARTS) {
  const module = await partModule(part);
  if (!module) continue;
  const copy = copyProblems(root, part);
  problems.push(...copy);
  if (copy.length === 0) problems.push(...module.problems({ siteRoot: root }));
  const partRecord = readRecord(root, part);
  if (partRecord) {
    if (partRecord.source_commit === null || partRecord.source_commit_had_uncommitted_changes) problems.push(`health-centers/${part}: copied from a folder with changes that were not committed. Commit them there and run: node scripts/sync-health-centers.mjs ${part}`);
    healthCenterLines.push(`check-data: health centers, ${part}: ${Object.keys(partRecord.files).length} files match their record (${String(partRecord.source_commit).slice(0, 7)}).`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`check-data: ${p}`);
  process.exit(1);
}
console.log(`check-data: the server for assistants matches its record (version ${mcpRecord.server_version}, ${String(mcpRecord.source_commit).slice(0, 7)}).`);
console.log(`check-data: ${Object.keys(record.files).length} files match SOURCE.json (dataset version ${record.dataset_version}).`);
console.log(`check-data: the bills table matches its record (${billsRecord.bills} bills, retrieved ${billsRecord.retrieved}).`);
for (const line of healthCenterLines) console.log(line);
