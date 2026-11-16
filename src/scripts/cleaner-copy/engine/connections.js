// Replaces what a workbook's saved connections say about places, people and secrets.
//
// In plain words: a workbook that pulls its data from a database, a web page or another file keeps
// a note of where it looks: the server's name, the database, the sign-in name, sometimes a password,
// a folder on someone's machine. The note stays in the copy, so the workbook still opens and each
// saved query still points at its connection, but every one of those values is replaced with a
// plain placeholder ("server", "database", "user"). The words that say what kind of setting each
// one is are kept. The text of a saved query is kept too, with the values written inside it replaced.

import { attr, decodeXml, encodeAttr } from './xml.js';

/** The placeholders written into a connection. The check knows them, so that one found again is not taken for a leftover. */
export const PLACEHOLDERS = ['server', 'database', 'user', 'dsn', 'value', 'location', 'workstation', 'description', 'table', 'folder', 'C:\\folder\\file', '[file', 'https://example.invalid/', 'Connection ', 'Parameter ', 'ExternalData_'];

/** A setting's name without regard to capitals, spaces or underscores: "User ID", "user_id" and "USERID" are one. */
const plain = (name) => name.toLowerCase().replace(/[\s_]+/g, '');

// Settings that name a place, a person or a secret, and the placeholder each one gets.
const NAMES_SOMETHING = new Map([
  ...['server', 'servername', 'srvr', 'host', 'hostname', 'address', 'addr', 'networkaddress', 'datasource', 'failoverpartner', 'serverspn', 'failoverpartnerspn'].map((k) => [k, 'server']),
  ...['dsn', 'sourcedsn'].map((k) => [k, 'dsn']),
  ...['uid', 'userid', 'user', 'username', 'usr'].map((k) => [k, 'user']),
  ...['initialcatalog', 'database', 'db', 'catalog', 'dbname', 'databasename', 'dbq'].map((k) => [k, 'database']),
  ['defaultdir', 'folder'],
  ['location', 'location'],
  ...['workstationid', 'wsid'].map((k) => [k, 'workstation']),
  ['description', 'description'],
  ...['filedsn', 'attachdbfilename', 'initialfilename', 'systemdb'].map((k) => [k, 'C:\\folder\\file']),
]);
// Settings that say how to connect, not where or as whom. Their words are the same in every workbook.
const HARMLESS = new Set(['provider', 'driver', 'mode', 'fil', 'fmt', 'network', 'networklibrary', 'net', 'library', 'language', 'currentlanguage', 'dataprovider', 'characterset', 'charset', 'collatingsequence', 'collseq', 'integratedsecurity', 'trustedconnection', 'extensions', 'extendedproperties', 'authentication', 'encrypt']);
// The same, told by how the setting's name ends: "MDX Missing Member Mode", "Jet OLEDB:Engine Type", "Connect Timeout".
const HARMLESS_ENDING = /(?:mode|type|level|options|compatibility|timeout|size|securityinfo|encryption|setting|protocol|version|intent)$/;
// The words that open an old-style connection and say only what kind it is.
const KIND_WORD = /^(?:ODBC|OLEDB|URL|TEXT|FINDER|WORKSHEET|Data Model Connection)$/i;
// The words that say what kind of file a connection reads ("Excel 12.0 Xml", "dBASE IV", "text"), and plain numbers.
const FORMAT_WORD = /^(?:(?:Excel|dBASE|Paradox|Lotus|FoxPro|HTML|Text|Outlook|Exchange)\b[A-Za-z0-9. ]{0,24}|-?\d+(?:\.\d+)?|true|false|yes|no)$/i;

const isPath = (value) => /^(?:[A-Za-z]:[\\/]|\\\\|(?:\.{1,2}|~)?[\\/][^\\/])/.test(value) || /^file:/i.test(value);
const isUrl = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^mailto:/i.test(value);
/** True for a value that is plainly a place, whatever setting holds it: a file, a shared folder, a web address. */
const isPlace = (value) => isPath(value) || isUrl(value) || /^\[[^\]]+\]/.test(value);

/** The placeholder for a place. A file keeps its ending (.accdb, .csv), since that says what kind of file it is. */
function placeFor(value) {
  if (isUrl(value) && !/^file:/i.test(value)) return 'https://example.invalid/';
  const book = /^\[[^\]]*?(\.[A-Za-z0-9]{1,5})?\](.*)$/.exec(value);
  if (book) return `[file${book[1] ?? ''}]${book[2]}`;
  const ending = /\.[A-Za-z0-9]{1,5}$/.exec(value)?.[0];
  return ending ? `C:\\folder\\file${ending}` : 'C:\\folder';
}

/** What a value of a connection is replaced with, or undefined when it stays. `inside` is true for a connection to a query held in the workbook itself. */
function placeholderFor(setting, value, inside) {
  const name = plain(setting);
  if (value === '') return undefined;
  if (/password|pwd/.test(name)) return '';
  // A value written between dollar signs ($Workbook$) points inside the workbook, not at a place.
  if (/^\$.+\$$/.test(value)) return undefined;
  if (isPlace(value)) return placeFor(value);
  if (inside && name === 'location') return undefined;
  const word = NAMES_SOMETHING.get(name);
  if (word !== undefined) return word.startsWith('C:') ? placeFor(`C:\\x${/\.[A-Za-z0-9]{1,5}$/.exec(value)?.[0] ?? ''}`) : word;
  if (HARMLESS.has(name) || HARMLESS_ENDING.test(name)) return undefined;
  if ((name === 'app' || name === 'applicationname') && /^(?:Microsoft|MS)\b/i.test(value)) return undefined;
  // A setting this tool does not know stays only when its value is a number or a yes or no.
  return /^(?:true|false|yes|no|-?\d+(?:\.\d+)?)$/i.test(value) ? undefined : 'value';
}

/**
 * A connection string ("DSN=Claims;UID=someone;SERVER=db01;") with its telling values replaced.
 * Every setting's name, every separator and every space stays as it was. `record` is told each
 * value that was replaced and what replaced it.
 */
export function scrubConnectionString(text, record = () => {}) {
  // Read into pieces first: a value may sit in quotation marks or braces and hold a semicolon of its own.
  const pieces = [];
  let at = 0;
  while (at < text.length) {
    if (text[at] === ';' || /\s/.test(text[at])) {
      pieces.push({ as: text[at++] });
      continue;
    }
    let end = at;
    // A web address or a file written on its own may hold an equals sign; it runs to the next semicolon.
    if (isPlace(text.slice(at))) end = text.indexOf(';', at) < 0 ? text.length : text.indexOf(';', at);
    else while (end < text.length && text[end] !== '=' && text[end] !== ';') end++;
    if (text[end] !== '=') {
      pieces.push({ bare: text.slice(at, end) });
      at = end;
      continue;
    }
    const setting = text.slice(at, end);
    let start = end + 1;
    while (start < text.length && text[start] === ' ') start++;
    const opens = text[start];
    let stop = start;
    if (opens === '"' || opens === "'") {
      stop = start + 1;
      while (stop < text.length && (text[stop] !== opens || text[stop + 1] === opens)) stop += text[stop] === opens ? 2 : 1;
      stop = Math.min(text.length, stop + 1);
    } else if (opens === '{') {
      stop = text.indexOf('}', start);
      stop = stop < 0 ? text.length : stop + 1;
    }
    while (stop < text.length && text[stop] !== ';') stop++;
    pieces.push({ setting, gap: text.slice(end, start), written: text.slice(start, stop) });
    at = stop;
  }
  const unwrap = (written) => {
    const trimmed = written.trim();
    const marks = /^"[\s\S]*"$/.test(trimmed) ? '"' : /^'[\s\S]*'$/.test(trimmed) ? "'" : /^\{[\s\S]*\}$/.test(trimmed) ? '{' : '';
    const value = marks === '{' ? trimmed.slice(1, -1) : marks ? trimmed.slice(1, -1).replaceAll(marks + marks, marks) : trimmed;
    return { value, wrap: (next) => (marks === '{' ? `{${next}}` : marks ? marks + next.replaceAll(marks, marks + marks) + marks : next) };
  };
  const inside = pieces.some((piece) => piece.setting !== undefined && plain(piece.setting) === 'datasource' && /^\$.+\$$/.test(unwrap(piece.written).value));
  return pieces
    .map((piece) => {
      if (piece.as !== undefined) return piece.as;
      if (piece.bare !== undefined) {
        const bare = piece.bare.trim();
        if (KIND_WORD.test(bare) || FORMAT_WORD.test(bare)) return piece.bare;
        // Anything else written on its own is a place, or the tail of a value that held a semicolon
        // (a password, say). Neither is kept.
        const next = isPlace(bare) ? placeFor(bare) : 'value';
        record(bare, next);
        return piece.bare.replace(bare, () => next);
      }
      const { value, wrap } = unwrap(piece.written);
      // A setting that holds settings of its own ("Extended Properties") is read the same way, one level down.
      if (plain(piece.setting) === 'extendedproperties' && /[=;]/.test(value) && !isPlace(value)) return piece.setting + piece.gap + wrap(scrubConnectionString(value, record));
      const next = placeholderFor(piece.setting, value, inside);
      if (next === undefined || next === value) return piece.setting + piece.gap + piece.written;
      record(value, next);
      return piece.setting + piece.gap + wrap(next);
    })
    .join('');
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text of a saved query (SQL) with the values written inside it replaced: every piece of text
 * in single quotation marks, every date between # marks, every run of five or more digits. The
 * statement itself stays. `swaps` are the names already replaced in the connection (the server,
 * the database, the sign-in name): where the query names one of them, it gets the same placeholder.
 */
export function scrubCommand(text, swaps = new Map(), record = () => {}) {
  let out = text.replace(/'((?:[^']|'')*)'/g, (all, inner) => {
    if (inner === '' || inner === 'value') return all;
    record(inner.replaceAll("''", "'"), 'value');
    return "'value'";
  });
  out = out.replace(/#\d{1,4}[/-]\d{1,2}[/-]\d{1,4}(?:[ T][\d:. APMapm]*)?#/g, '#1/1/2000#').replace(/\d{5,}/g, '0');
  for (const [original, next] of swaps) {
    if (original.length < 3 || !/\p{L}/u.test(original) || isPlace(original)) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(original)}(?![\\p{L}\\p{N}_])`, 'giu'), () => next);
  }
  return out;
}

/** True for a connection's name that says nothing: "Connection", "Query1", or the one name the format itself gives. */
const sayNothing = (name) => /^(?:connection|query|data|externaldata)[ _]?\d*$/i.test(name) || name === 'ThisWorkbookDataModel';

/**
 * Goes through the part that holds the saved connections (xl/connections.xml).
 *
 * Gives back the part as the copy will hold it; how many connections it has; `names`, a map from
 * each connection's old name to its new one (only the names that changed); `originals`, every value
 * that was replaced, for the check to search the copy for; and `listed`, one entry for each
 * connection with its old name and the text of its query as the copy holds it.
 * `inFormula` renames sheets in a cell's address, when the person renamed any.
 */
export function scrubConnections(xml, { inFormula = (formula) => formula } = {}) {
  const TAG = /<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")+)\s*(\/?)>/g;
  const SETTING = /(\s+)([\w:.-]+)(\s*=\s*)"([^"]*)"/g;
  const originals = new Set();
  const swaps = new Map();
  const record = (original, next) => {
    if (original !== next && original.trim() !== '') originals.add(original);
  };

  // New names first: "Connection 1", "Connection 2", passing over any number a kept name already uses.
  const present = [...xml.matchAll(/<(?:\w+:)?connection\b([^>]*)>/g)].map((m) => attr(m[1], 'name')).filter((name) => name !== undefined).map(decodeXml);
  const taken = new Set(present.filter(sayNothing).map((name) => name.toLowerCase()));
  const names = new Map();
  let number = 0;
  for (const name of present) {
    if (sayNothing(name) || names.has(name)) continue;
    do number++;
    while (taken.has(`connection ${number}`));
    names.set(name, `Connection ${number}`);
  }

  // The names of servers, databases and people, gathered from every connection before any query is read.
  for (const tag of xml.matchAll(TAG)) for (const m of tag[2].matchAll(SETTING)) if (/^(?:connection|localConnection)$/.test(m[2])) scrubConnectionString(decodeXml(m[4]), (original, next) => swaps.set(original, next));

  const listed = [];
  let current;
  let parameters = 0;
  const out = xml.replace(TAG, (all, tag, settings, slash) => {
    const local = tag.slice(tag.indexOf(':') + 1);
    const isConnection = local === 'connection' && attr(settings, 'name') !== undefined;
    if (isConnection) {
      current = { name: decodeXml(attr(settings, 'name') ?? ''), queries: [] };
      listed.push(current);
      parameters = 0;
    }
    if (local === 'parameter') parameters++;
    const next = settings.replace(SETTING, (whole, space, setting, equals, written) => {
      if (setting === 'xmlns' || setting.startsWith('xmlns:') || setting === 'mc:Ignorable' || setting === 'uri') return whole;
      const value = decodeXml(written);
      const write = (made) => `${space}${setting}${equals}"${encodeAttr(made)}"`;
      const swap = (made) => (record(value, made), write(made));
      const drop = () => (record(value, ''), '');
      if (value === '') return whole;
      if (setting === 'connection' || setting === 'localConnection') return write(scrubConnectionString(value, record));
      if (setting === 'command' || setting === 'serverCommand') {
        const query = scrubCommand(value, swaps, record);
        current?.queries.push(query);
        return write(query);
      }
      if (isConnection && setting === 'name') return names.has(value) ? swap(names.get(value)) : whole;
      if (isConnection && (setting === 'description' || setting === 'singleSignOnId')) return drop();
      if (setting === 'sourceFile' || setting === 'odcFile') return swap(placeFor(isUrl(value) ? value : `C:\\x${/\.[A-Za-z0-9]{1,5}$/.exec(value)?.[0] ?? ''}`));
      if (setting === 'url' || setting === 'editPage') return swap('https://example.invalid/');
      if (setting === 'post') return drop();
      if (local === 'parameter') {
        if (setting === 'prompt') return drop();
        if (setting === 'name') return swap(`Parameter ${parameters}`);
        if (setting === 'string') return swap('value');
        if (setting === 'integer' || setting === 'double') return write('0');
        if (setting === 'cell') return write(inFormula(value));
      }
      // The name of a table on a web page.
      if (local === 's' && setting === 'v') return swap('table');
      return isPlace(value) ? swap(placeFor(value)) : whole;
    });
    return `<${tag}${next}${slash}>`;
  });
  // What the old names are replaced with is never searched for; the old names are.
  for (const [original, next] of swaps) record(original, next);
  return { xml: out, count: present.length, names, originals: [...originals], listed };
}
