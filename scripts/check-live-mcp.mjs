// Asks the live door for assistants real questions and compares the answers with the published tables.
// Usage: node scripts/check-live-mcp.mjs [site address]     (default https://clinx.org)
//
// In plain words: the tests in tests/ prove the program on a developer's computer. This proves
// the published one. It downloads the open tables as any reader can (the filed reports as their index, which is how the server reads them), asks clinx.org/mcp the
// same things through each of its seventeen tools, and fails if an answer and a table disagree. It
// also sends a few mistaken and oversized requests and checks each is turned away politely.
// The health center questions pass only once the health center files are published too.
// It only reads, it sends about sixty-five requests, and it is run by hand after a publish.
const SITE = (process.argv[2] ?? 'https://clinx.org').replace(/\/$/, '');
const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', 'User-Agent': 'clinx-check' };
let id = 0; const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
async function rpc(method, params, extra = {}) {
  const r = await fetch(`${SITE}/mcp`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}
const call = async (name, args = {}) => { const { body } = await rpc('tools/call', { name, arguments: args }); return body?.result; };
// A tool's answer as an object. The reply carries it as JSON in one block of text; this reads that
// text, which every version of the server sends.
const answer = async (name, args = {}) => JSON.parse((await call(name, args)).content[0].text);
const table = async (name) => (await fetch(`${SITE}/data/${name}`, { headers: { 'User-Agent': 'clinx-check' } })).json();

const [laws, bills, notices, events, filed] = await Promise.all(['340b-state-laws.json', '340b-bills.json', '340b-notices.json', '340b-events.json', '340b-filings-index.json'].map(table));
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'clinx-check', version: '1' } });
ok('initialize (older handshake)', init.status === 200 && init.body?.result?.serverInfo?.name === 'clinx-340b');
const disc = await rpc('server/discover', {}, { 'MCP-Protocol-Version': '2026-07-28' });
ok('server/discover (newer protocol)', disc.status === 200 && !!disc.body?.result, JSON.stringify(disc.body?.result ?? disc.body).slice(0, 110));
const list = await rpc('tools/list', {});
const names = list.body?.result?.tools?.map((t) => t.name) ?? [];
ok('tools/list has seventeen tools', names.length === 17, names.join(', '));

const about = await answer('about_the_data');
ok('about_the_data counts match the published files', about.counts.laws === laws.laws.length && about.counts.bills === bills.bills.length && about.counts.notices === notices.notices.length && about.counts.calendar_dates === events.events.length, JSON.stringify(about.counts));

const cp = await answer('find_laws', { kind: 'contract-pharmacy', limit: 100 });
const cpTable = laws.laws.filter((l) => (l.kinds ?? []).includes('contract-pharmacy'));
ok('find_laws by kind matches the laws file', cp.matched === cpTable.length, `${cp.matched} vs ${cpTable.length}`);
const law = (await answer('get_law', { law_id: cpTable[0].law_id })).law;
ok('get_law returns the same row with its official link', law.law_id === cpTable[0].law_id && law.source_url === cpTable[0].source_url && /^https:\/\//.test(law.source_url), Object.keys(law).filter((k) => /url|page|link/.test(k)).join(','));

for (const state of ['RI', 'TX', 'US']) {
  const got = await answer('find_bills', { state, limit: 100 });
  const want = bills.bills.filter((b) => b.jurisdiction === state).length;
  ok(`find_bills ${state} matches the bills file`, got.matched === want, `${got.matched} vs ${want}`);
}
const oneBill = bills.bills[0];
const gotBill = await answer('get_bill', { bill_id: oneBill.bill_id });
const stepsWant = events.events.filter((e) => e.bill_id === oneBill.bill_id).length;
ok('get_bill returns the row, its official link and its dated steps', gotBill.bill.bill_id === oneBill.bill_id && gotBill.bill.bill_url === oneBill.bill_url && gotBill.dated_steps.length === stepsWant, `${oneBill.bill_id}: ${gotBill.dated_steps.length} steps vs ${stepsWant}`);

const fn = await answer('find_notices', { limit: 100 });
ok('find_notices matches the notices file', fn.matched === notices.notices.length, `${fn.matched} vs ${notices.notices.length}`);
const open = await answer('find_notices', { open_for_comment: true });
ok('find_notices open for comment answers', typeof open.matched === 'number', `${open.matched} open today`);
const pilot = (await answer('get_notice', { notice_id: 'fr-2026-15633' })).notice;
ok('get_notice for the rebate pilot points to its page', pilot.explained_at === 'https://clinx.org/rebate-pilot/');

const cal = await answer('calendar', { state: 'MN', from: '2027-01-01', to: '2027-01-31' });
const calWant = events.events.filter((e) => e.jurisdiction === 'MN' && e.day >= '2027-01-01' && e.day <= '2027-01-31').length;
ok('calendar for Minnesota in January matches the calendar file', cal.matched === calWant, `${cal.matched} vs ${calWant}`);
const next = await answer('calendar', { limit: 5 });
ok('calendar with no dates starts from today', next.from === about.today && next.events.every((e) => e.day >= about.today), `from ${next.from}`);
// The filings: the states the server says are on ClinX are the states the open file holds records for,
// a state's count of records matches the file, and one record comes back with every line it has.
const filedStates = [...new Set(filed.filings.map((f) => f.state))].sort();
const groups = await answer('reporting_states');
const onClinx = groups.groups.flatMap((g) => g.states).filter((s) => s.on_clinx).map((s) => s.state).sort();
ok('reporting_states marks the states the filings file holds', onClinx.join() === filedStates.join(), `${onClinx.join(', ')} against ${filedStates.join(', ')}`);
for (const state of filedStates) {
  const found = await answer('find_filings', { state });
  ok(`find_filings ${state} matches the filings file`, found.matched === filed.filings.filter((f) => f.state === state).length, `${found.matched} records`);
}
const firstFiling = filed.filings[0];
const one = await answer('get_filing', { filing_id: firstFiling.filing_id });
ok('get_filing returns the record asked for', one.filing?.filing_id === firstFiling.filing_id && one.lines_total > 0 && one.official_file?.sha256 === firstFiling.pdf_sha256, `${firstFiling.filing_id}: ${one.lines_total} lines`);
// An Ohio record is an Excel workbook: its lines come from that record's own file, and its official file is the workbook.
const workbook = filed.filings.find((f) => /\.xlsx$/i.test(f.source_file ?? ''));
const wb = await answer('get_filing', { filing_id: workbook.filing_id });
ok('get_filing for an Ohio record answers with lines and a workbook file', wb.filing?.filing_id === workbook.filing_id && wb.lines_total > 0 && wb.lines?.length > 0 && /\.xlsx/i.test(wb.official_file?.url ?? '') && wb.official_file?.sha256 === workbook.pdf_sha256, `${workbook.filing_id}: ${wb.lines_total} lines`);
const mn = await answer('state_overview', { state: 'MN' });
ok('state_overview MN matches the laws file', mn.laws.count === laws.laws.filter((l) => l.state === 'MN').length, `${mn.laws.count} laws`);
const fed = await answer('state_overview', { state: 'FED' });
ok('state_overview FED counts the notices', fed.notices?.count === notices.notices.length || fed.notices === notices.notices.length, JSON.stringify(fed.notices?.count ?? fed.notices));

// The health center tools, against the health center files as any reader can download them.
const [hcSets, hcIndex, hcOpps, hcDates, hcAreas] = await Promise.all(['health-centers/index.json', 'health-centers/records/index.json', 'health-centers/funding/opportunities.json', 'health-centers/funding/deadlines.json', 'health-centers/areas/states.json'].map(table));
ok('about_the_data describes the three health center sets', about.health_centers?.records?.health_centers === hcIndex.health_centers.length && about.health_centers?.funding?.read_on === hcSets.funding.read_on && about.health_centers?.shortage_areas?.read_on === hcSets.areas.read_on, JSON.stringify(about.health_centers?.unavailable ?? about.health_centers?.records?.health_centers));
const hcState = hcIndex.states[0];
const hcFound = await answer('find_health_centers', { state: hcState, limit: 100 });
ok(`find_health_centers ${hcState} matches the list of health centers`, hcFound.matched === hcIndex.health_centers.filter((c) => c.state === hcState).length, `${hcFound.matched} health centers`);
const hcOne = hcIndex.health_centers[0];
const hcFile = await table(hcOne.file.replace(/^\/data\//, ''));
const hcReport = await answer('get_health_center_report', { health_center: hcOne.key, year: hcOne.years.at(-1) });
ok('get_health_center_report lists the tables of the health center\'s latest year', hcReport.year === hcOne.years.at(-1) && hcReport.tables.length > 0 && hcReport.health_center.name === hcOne.name, `${hcOne.key}: ${hcReport.tables.length} tables for ${hcReport.year}`);
const hcTableName = hcReport.tables.find((t) => t.status === 'present').table;
const hcTable = await answer('get_health_center_report', { health_center: hcOne.key, year: hcOne.years.at(-1), table: hcTableName, limit: 200 });
const hcPublished = new Set(Object.values(hcFile.years[String(hcReport.year)].values));
const hcCells = hcTable.lines.flatMap((l) => l.cells ?? []);
ok('get_health_center_report gives each value and each mark as the health center\'s file holds it', hcCells.length > 0 && hcCells.every((c) => (c.value !== undefined ? hcPublished.has(c.value) : c.mark !== undefined ? hcPublished.has(c.mark) && !!c.means : !!c.no_value)), `${hcTableName}: ${hcCells.length} cells`);
const hcFunding = await answer('find_funding_opportunities', { limit: 100 });
ok('find_funding_opportunities matches the opportunities file', hcFunding.matched === hcOpps.length && hcFunding.read_on === hcSets.funding.read_on, `${hcFunding.matched} vs ${hcOpps.length}`);
const hcOpp = (await answer('find_funding_opportunities', { opportunity: hcOpps[0].id })).opportunity;
ok('find_funding_opportunities gives one in full, without the agency\'s contact line', hcOpp.id === hcOpps[0].id && hcOpp.title === hcOpps[0].title && hcOpp.more_information_text === undefined && hcOpp.more_information_url === undefined);
const hcCal = await answer('health_center_calendar', { from: '2000-01-01', limit: 100 });
ok('health_center_calendar matches the file of dated lines', hcCal.matched === hcDates.length, `${hcCal.matched} vs ${hcDates.length}`);
const hcNation = await answer('shortage_area_changes');
ok('shortage_area_changes with no state gives the national counts as published', JSON.stringify(hcNation.national_counts) === JSON.stringify(hcSets.areas.national_counts) && hcNation.states_and_territories.length === Object.keys(hcAreas.states).length, `${hcNation.states_and_territories.length} states and territories`);
const hcRi = await answer('shortage_area_changes', { state: 'RI' });
ok('shortage_area_changes for a state gives that state\'s counts as published', JSON.stringify(hcRi.counts) === JSON.stringify(hcAreas.states.RI));
const hcRiFile = await table('health-centers/areas/states/ri.json');
const hcProposed = await answer('shortage_area_changes', { state: 'RI', show: 'proposed', limit: 100 });
ok('shortage_area_changes lists the designations proposed for withdrawal', hcProposed.matched === hcRiFile.proposed.length, `${hcProposed.matched} vs ${hcRiFile.proposed.length}`);

for (const [name, args] of [['find_laws', { state: 'ZZ' }], ['get_health_center_report', { health_center: 'no-such-key' }], ['shortage_area_changes', { state: 'ZZ' }], ['get_bill', { bill_id: 'no-such-bill' }], ['calendar', { from: 'next week' }], ['find_bills', { state: 'FED' }], ['no_such_tool', {}]]) {
  const r = await rpc('tools/call', { name, arguments: args });
  const said = r.body?.result?.isError ? r.body.result.content[0].text : r.body?.error?.message;
  ok(`mistake is explained: ${name} ${JSON.stringify(args)}`, !!said, (said ?? '').slice(0, 90));
}
const junk = await fetch(`${SITE}/mcp`, { method: 'POST', headers, body: 'not json' });
ok('a request that is not JSON is refused cleanly', junk.status >= 400 && junk.status < 500, String(junk.status));
const big = await fetch(`${SITE}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70000) } }) });
ok('a request over 64 KB is refused', big.status === 413, String(big.status));
const pre = await fetch(`${SITE}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'POST', 'User-Agent': 'clinx-check' } });
ok('a web app on another site may ask (CORS)', pre.headers.get('access-control-allow-origin') === '*', String(pre.status));
const page = await fetch(`${SITE}/mcp`, { headers: { Accept: 'text/html', 'User-Agent': 'clinx-check' }, redirect: 'manual' });
ok('a browser is sent to the page for assistants', page.status === 303 && page.headers.get('location') === '/data/assistants/');
const times = [];
for (let i = 0; i < 5; i++) { const t = performance.now(); await call('state_overview', { state: 'RI' }); times.push(Math.round(performance.now() - t)); }
ok('answers come back quickly', Math.max(...times) < 2000, `${times.join(', ')} ms`);
console.log(`\n${results.filter(Boolean).length} of ${results.length} passed`);
if (results.includes(false)) process.exit(1);
