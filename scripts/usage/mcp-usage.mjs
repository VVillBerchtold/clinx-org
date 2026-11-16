// Shows how the door for assistants (clinx.org/mcp) is being used.
// Usage: node scripts/usage/mcp-usage.mjs [--days 30] [--json]
//
// In plain words: every question an assistant sends to clinx.org/mcp adds one row to a set of
// counts kept by the site's host. A row says what kind of question it was (which tool, which
// state, which filters, found or not) and never the words someone typed or who asked
// (worker/assistants.ts writes the rows; the privacy page says the same to readers). This reads
// those counts back and prints them as short tables, so the work can go where the use is.
//
// It only reads. It needs two things, which stay on the keeper's own computer and are never
// printed, committed or sent anywhere but to the host:
//
//   the account's id        CLOUDFLARE_ACCOUNT_ID, or the file  ~/.config/clinx/cloudflare-account-id
//   a read-only token       CLINX_USAGE_TOKEN,     or the file  ~/.config/clinx/cloudflare-usage.token
//
// The token needs one permission and no more: Account Analytics, Read. It cannot change the site.
// The host keeps these counts for three months, so --days goes up to 90.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The host's name for the set of counts (wrangler.jsonc, "analytics_engine_datasets"). */
export const DATASET = 'clinx_mcp_usage';

/** The columns of a count, in the order worker/assistants.ts writes them (COUNT_COLUMNS). A test keeps the two in step. */
export const COLUMNS = ['method', 'tool', 'outcome', 'place', 'filters', 'looked_up', 'client', 'version'];

/** The host stores the columns as blob1, blob2, and so on. */
const blob = (column) => `blob${COLUMNS.indexOf(column) + 1}`;

export const MOST_DAYS = 90;

/** The questions asked of the counts. Each becomes one table. */
export function questions(days) {
  if (!Number.isInteger(days) || days < 1 || days > MOST_DAYS) throw new Error(`days must be a whole number from 1 to ${MOST_DAYS}`);
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  // Each row can stand for more than one request when the host samples; SUM(_sample_interval) is the true count.
  const count = 'SUM(_sample_interval) AS requests';
  const from = `FROM ${DATASET} WHERE ${since}`;
  const called = `${from} AND ${blob('method')} = 'tools/call'`;
  return [
    {
      title: 'Requests a day',
      columns: ['day', 'requests'],
      sql: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ${count} ${from} GROUP BY day ORDER BY day`,
    },
    {
      title: 'What was asked for, and how it went',
      note: 'answered: rows came back. mistake: the question could not be answered as put (an unknown state, a row that does not exist). tables unreachable: the site could not read its own files.',
      columns: ['tool', 'outcome', 'requests'],
      sql: `SELECT ${blob('tool')} AS tool, ${blob('outcome')} AS outcome, ${count} ${called} GROUP BY tool, outcome ORDER BY requests DESC`,
    },
    {
      title: 'Which places were asked about',
      note: 'Two letters are a state. US is Congress. FED is the federal agencies.',
      columns: ['place', 'requests'],
      sql: `SELECT ${blob('place')} AS place, ${count} ${called} AND ${blob('place')} != '' GROUP BY place ORDER BY requests DESC LIMIT 60`,
    },
    {
      title: 'Which filters were used',
      note: 'A filter is shown with its value only when the value is one of the tool\'s own listed choices. "text" means words were searched for; the words are never kept.',
      columns: ['tool', 'filters', 'requests'],
      sql: `SELECT ${blob('tool')} AS tool, ${blob('filters')} AS filters, ${count} ${called} AND ${blob('filters')} != '' GROUP BY tool, filters ORDER BY requests DESC LIMIT 40`,
    },
    {
      title: 'Which rows were opened most',
      note: 'The id of a public law, bill or notice that was found and given back.',
      columns: ['tool', 'looked_up', 'requests'],
      sql: `SELECT ${blob('tool')} AS tool, ${blob('looked_up')} AS looked_up, ${count} ${called} AND ${blob('looked_up')} != '' GROUP BY tool, looked_up ORDER BY requests DESC LIMIT 25`,
    },
    {
      title: 'Which assistant programs connected',
      note: 'The name a program gives itself when it connects, for example a chat app or a code editor. Not a person.',
      columns: ['client', 'requests'],
      sql: `SELECT ${blob('client')} AS client, ${count} ${from} AND ${blob('client')} != '' GROUP BY client ORDER BY requests DESC LIMIT 25`,
    },
    {
      title: 'Every kind of request',
      note: 'limited: an address that asked more than 60 times in a minute was told to wait. refused: not a question the door understands.',
      columns: ['method', 'outcome', 'requests'],
      sql: `SELECT ${blob('method')} AS method, ${blob('outcome')} AS outcome, ${count} ${from} GROUP BY method, outcome ORDER BY requests DESC`,
    },
  ];
}

const cell = (value) => (value === null || value === undefined || value === '' ? '-' : String(value));

/** One table as plain text, columns lined up. */
export function table(columns, rows) {
  if (rows.length === 0) return '  (none in this period)';
  const shown = rows.map((row) => columns.map((column) => (column === 'requests' ? Number(row[column]).toLocaleString('en-US') : column === 'day' ? cell(row[column]).slice(0, 10) : cell(row[column]))));
  const widths = columns.map((column, i) => Math.max(column.length, ...shown.map((row) => row[i].length)));
  const line = (cells) => '  ' + cells.map((text, i) => (columns[i] === 'requests' ? text.padStart(widths[i]) : text.padEnd(widths[i]))).join('  ').trimEnd();
  return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...shown.map(line)].join('\n');
}

/** The whole report as plain text. `answers` is one list of rows per question, in order. */
export function report(days, asked, answers) {
  const total = (answers[0] ?? []).reduce((sum, row) => sum + Number(row.requests), 0);
  const out = [`How clinx.org/mcp was used in the last ${days} day${days === 1 ? '' : 's'}`, `${total.toLocaleString('en-US')} request${total === 1 ? '' : 's'} in all. Counted by kind: never the words typed, never who asked.`];
  asked.forEach((question, i) => {
    out.push('', question.title);
    if (question.note) out.push(`  ${question.note}`);
    out.push(table(question.columns, answers[i] ?? []));
  });
  return out.join('\n') + '\n';
}

function fail(message) {
  console.error(`mcp-usage: ${message}`);
  process.exit(1);
}

/** A value from the environment, else from a small file in the keeper's own settings folder. */
function kept(variable, file) {
  const fromEnv = process.env[variable]?.trim();
  if (fromEnv) return fromEnv;
  const path = join(homedir(), '.config', 'clinx', file);
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  return fail(`needs ${variable}, or the file ${path}. See docs/publishing.md, "Reading the counts".`);
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--days');
  const days = at === -1 ? 30 : Number(args[at + 1]);
  let asked;
  try {
    asked = questions(days);
  } catch (error) {
    fail(error.message);
  }
  const account = kept('CLOUDFLARE_ACCOUNT_ID', 'cloudflare-account-id');
  const token = kept('CLINX_USAGE_TOKEN', 'cloudflare-usage.token');
  if (!/^[0-9a-f]{32}$/.test(account)) fail('the account id should be 32 letters and digits');
  // A token is one unbroken word. Anything else (a whole command copied by mistake, say) is caught here, before it is sent anywhere.
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) fail('the token file should hold the token and nothing else: one long word, no spaces or line breaks. See docs/publishing.md, "Reading the counts".');

  const answers = [];
  for (const question of asked) {
    let response;
    try {
      response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: question.sql });
    } catch {
      fail('could not reach the host. Is this computer online?');
    }
    const text = await response.text();
    if (!response.ok) {
      // Before the first question is ever asked of the live door, the host has no set of counts yet.
      const hint = response.status === 401 || response.status === 403 ? ' The token may be wrong, expired, or missing the permission Account Analytics: Read.' : ' If the door has not been published yet, or nothing has asked it anything, there are no counts to read.';
      fail(`the host answered ${response.status} to "${question.title}".${hint}\n${text.slice(0, 300)}`);
    }
    let rows;
    try {
      rows = JSON.parse(text).data;
    } catch {
      rows = undefined;
    }
    if (!Array.isArray(rows)) fail(`the host's answer to "${question.title}" was not in the form expected:\n${text.slice(0, 300)}`);
    answers.push(rows);
  }
  if (args.includes('--json')) console.log(JSON.stringify(Object.fromEntries(asked.map((question, i) => [question.title, answers[i]])), null, 2));
  else process.stdout.write(report(days, asked, answers));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
