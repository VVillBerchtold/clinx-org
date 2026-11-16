// Copies the server for assistants into this site and records where it came from.
// Usage: node scripts/sync-mcp.mjs [path-to-the-server-folder]
// Default source: the sibling folder ../clinx-mcp
//
// In plain words: the program that answers assistants' questions about the 340B tables is written
// and tested in its own folder. The site only hosts it, at clinx.org/mcp. This copies the files
// the host needs into worker/mcp/ and writes down each file's fingerprint and the commit it came
// from, so a later change to a copy is caught (scripts/check-data.mjs).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files a web host needs: the server, its tools, the table reader, the web door, the counter, the cut of the filed reports file and the page-address rule. */
export const MCP_FILES = ['core.js', 'tools.js', 'tables.js', 'tables.d.ts', 'http.js', 'http.d.ts', 'usage.js', 'usage.d.ts', 'index.d.ts', 'split.js', 'split.d.ts', 'pages.js', 'pages.d.ts'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MCP_DIR = join(root, 'worker', 'mcp');

function fail(message) {
  console.error(`sync-mcp: ${message}`);
  process.exit(1);
}

function main() {
  const source = resolve(process.argv[2] ?? join(root, '..', 'clinx-mcp'));
  for (const name of MCP_FILES) {
    if (!existsSync(join(source, 'src', name))) fail(`no src/${name} in ${source}`);
  }
  // A copied file must not reach for anything a web host does not have.
  for (const name of MCP_FILES) {
    const text = readFileSync(join(source, 'src', name), 'utf8');
    if (/from\s+['"]node:|import\(\s*['"]node:|\brequire\(/.test(text)) fail(`src/${name} uses something only Node has; the host cannot run it`);
    for (const [, path] of text.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) {
      const wanted = path.slice(2);
      if (!MCP_FILES.includes(wanted) && !MCP_FILES.includes(wanted.replace(/\.js$/, '.d.ts'))) fail(`src/${name} imports ${path}, which is not one of the copied files`);
    }
  }

  let commit = null;
  let dirty = false;
  try {
    const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    commit = git('rev-parse', 'HEAD');
    dirty = git('status', '--porcelain', '--', 'src') !== '';
  } catch {
    commit = null;
  }

  rmSync(MCP_DIR, { recursive: true, force: true });
  mkdirSync(MCP_DIR, { recursive: true });
  const files = {};
  for (const name of MCP_FILES) {
    copyFileSync(join(source, 'src', name), join(MCP_DIR, name));
    files[name] = createHash('sha256').update(readFileSync(join(MCP_DIR, name))).digest('hex');
  }
  const version = /version:\s*'([^']+)'/.exec(readFileSync(join(MCP_DIR, 'core.js'), 'utf8'))?.[1] ?? null;
  const record = { server_version: version, source_commit: commit, source_commit_had_uncommitted_changes: dirty, files };
  writeFileSync(join(MCP_DIR, 'SOURCE.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`sync-mcp: copied ${MCP_FILES.length} files from ${source}${commit ? ` at ${commit.slice(0, 7)}` : ''}${dirty ? ' (with uncommitted changes)' : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
