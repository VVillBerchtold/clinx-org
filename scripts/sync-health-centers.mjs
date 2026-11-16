// Copies the health center tables into this site and records where they came from.
// Usage: node scripts/sync-health-centers.mjs [part ...] [--from path-to-clinx-health-centers]
// Parts: records, funding, areas. With no part named, every part that has a module is copied.
// Default source: the sibling folder ../clinx-health-centers
//
// In plain words: each part has its own small module in scripts/hc/ that knows which files it
// needs and what they must look like. This script runs them. A part refuses to copy a table that
// is not what the site expects, and says why.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PARTS = ['records', 'funding', 'areas'];

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');

/** The module of a part, or null when it has not been written yet. */
export async function partModule(part) {
  const path = join(here, 'hc', `${part}.mjs`);
  return existsSync(path) ? import(pathToFileURL(path).href) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--from');
  const engineRoot = resolve(at >= 0 ? args[at + 1] : join(siteRoot, '..', 'clinx-health-centers'));
  const named = args.filter((a, i) => a !== '--from' && i !== at + 1);
  for (const part of named) {
    if (!PARTS.includes(part)) {
      console.error(`sync-health-centers: "${part}" is not a part. The parts are ${PARTS.join(', ')}.`);
      process.exit(1);
    }
  }
  if (!existsSync(engineRoot)) {
    console.error(`sync-health-centers: no folder at ${engineRoot}`);
    process.exit(1);
  }
  for (const part of named.length > 0 ? named : PARTS) {
    const module = await partModule(part);
    if (!module) {
      if (named.length > 0) {
        console.error(`sync-health-centers: scripts/hc/${part}.mjs does not exist yet`);
        process.exit(1);
      }
      continue;
    }
    try {
      console.log(`sync-health-centers: ${part}: ${module.sync({ siteRoot, engineRoot })}`);
    } catch (error) {
      console.error(`sync-health-centers: ${part}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
