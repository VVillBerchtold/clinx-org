import { describe, expect, it } from 'vitest';
import { inspect, makeCopy, sampleBytes } from '../../src/scripts/cleaner-copy/engine/index.js';
import { allText, cellsOf, encode, formulaOf, part, partsOf, workbook } from './fixtures/workbooks';

// Saved connections: the note a workbook keeps of where its data comes from. The note stays in the copy,
// with every server, database, sign-in name, password, file and web address replaced with a placeholder.
// Every server, person and file named in these tests is invented.

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const LINE = { what: 'Saved connections', where: 'xl/connections.xml', action: 'server, database, user and file names replaced with placeholders' };

/** The settings of every tag of one kind in a part, as written. */
const tags = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<${name}\\b([^>]*?)/?>`, 'g'))].map((m) => m[1] ?? '');
/** One setting of a tag, with the XML marks read back. */
const setting = (attrs: string | undefined, name: string): string | undefined => {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs ?? '')?.[1];
  return found === undefined ? undefined : found.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
};

describe('Cleaner Copy engine: the saved connection of the sample report', () => {
  it('is reported when the file is only looked at', async () => {
    const report = await inspect(sampleBytes(), 'workbook');
    expect(report.outsideTheCells.filter((item) => item.where === 'xl/connections.xml')).toEqual([{ ...LINE, count: 1 }]);
    expect(report.worthKnowing.filter((found) => found.what === 'A saved connection to a database or a web address').length).toBe(1);
    expect(report.worthKnowing.find((found) => found.what === 'The request a saved connection sends (a query)')?.detail).toBe('SELECT * FROM claims');
  });

  it('keeps its settings and loses the user, the server and the data source, in every part of the copy', async () => {
    const before = await partsOf(sampleBytes());
    expect(part(before, 'xl/connections.xml')).toContain('connection="DSN=ClaimsDB;UID=dwhitlock;SERVER=hsc-sql01;"');
    const copy = await makeCopy(sampleBytes(), 'workbook', {});
    const after = await partsOf(copy.bytes);
    const connection = tags(part(after, 'xl/connections.xml'), 'connection')[0];
    expect(setting(connection, 'id')).toBe('1');
    expect(setting(connection, 'name')).toBe('Connection 1');
    expect(setting(connection, 'type')).toBe('1');
    const details = tags(part(after, 'xl/connections.xml'), 'dbPr')[0];
    expect(setting(details, 'connection')).toBe('DSN=dsn;UID=user;SERVER=server;');
    expect(setting(details, 'command')).toBe('SELECT * FROM claims');
    const everything = allText(after);
    for (const gone of ['dwhitlock', 'hsc-sql01', 'ClaimsDB']) expect(everything.includes(gone), gone).toBe(false);
    expect(copy.report.outsideTheCells.filter((item) => item.where === 'xl/connections.xml')).toEqual([{ ...LINE, count: 1 }]);
    expect(copy.check.ran).toBe(true);
    expect(copy.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
    expect(copy.check.items.filter((item) => item.part === 'xl/connections.xml')).toEqual([]);
  });
});

describe('Cleaner Copy engine: saved connections of every kind', () => {
  const odbc = 'ODBC;DRIVER={SQL Server};SERVER=mercy-sql04\\PROD,1433;UID=tbrannigan;PWD=Winter;2026!;APP=Microsoft Office 2016;WSID=MERCY-LT-0412;DATABASE=VisitsWarehouse;Trusted_Connection=Yes';
  const oledb = 'Provider=SQLOLEDB.1;Integrated Security=SSPI;Persist Security Info=True;Initial Catalog=VisitsWarehouse;Data Source=mercy-sql04;Use Procedure for Prepare=1;Auto Translate=True;Packet Size=4096;Workstation ID=MERCY-LT-0412;Use Encryption for Data=False';
  const access = 'Provider=Microsoft.ACE.OLEDB.12.0;User ID=Admin;Data Source=C:\\Users\\tbrannigan\\Documents\\panel 2026.accdb;Mode=Share Deny Write;Extended Properties="";Jet OLEDB:Database Password="quartz;7";Jet OLEDB:Engine Type=6';
  const sheetFile = 'Provider=Microsoft.ACE.OLEDB.12.0;Data Source=\\\\mercy-fs02\\finance\\roster.xlsx;Extended Properties="Excel 12.0 Xml;HDR=YES;IMEX=1"';
  const query = 'Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Visits;Extended Properties=""';
  const sql = "SELECT v.id, v.paid FROM VisitsWarehouse.dbo.visits v WHERE v.payer = 'Harbor Mutual' AND v.member = 100482233 AND v.note LIKE 'O''Brannigan%' AND v.seen > #1/15/2026#";
  const connections =
    `${HEAD}<connections xmlns="${MAIN}">` +
    `<connection id="1" name="mercy-sql04 VisitsWarehouse visits" description="Nightly pull kept by Tessa Brannigan" type="1" refreshedVersion="6" saveData="1" odcFile="C:\\Users\\tbrannigan\\Documents\\My Data Sources\\visits.odc"><dbPr connection="${encode(odbc)}" command="${encode(sql)}"/><parameters count="1"><parameter name="Member number" sqlType="4" parameterType="cell" cell="Visits!$D$1" prompt="Which member, Tessa?" string="Corwin Ashdale"/></parameters></connection>` +
    `<connection id="2" name="Warehouse (OLE DB)" type="5" refreshedVersion="6"><dbPr connection="${encode(oledb)}" command="visits" commandType="3"/></connection>` +
    `<connection id="3" name="Panel from Access" type="5" refreshedVersion="6" sourceFile="C:\\Users\\tbrannigan\\Documents\\panel 2026.accdb"><dbPr connection="${encode(access)}" command="SELECT * FROM \`panel\`"/></connection>` +
    `<connection id="4" name="Roster on the share" type="5" refreshedVersion="6"><dbPr connection="${encode(sheetFile)}" command="Sheet1$" commandType="3"/></connection>` +
    `<connection id="5" name="County figures" type="4" refreshedVersion="6"><webPr sourceData="1" url="https://intranet.mercy.example/reports/panel?site=4&amp;user=tbrannigan" post="token=9f31c2aa" htmlTables="1"><tables count="2"><s v="Brannigan weekly panel"/><x v="3"/></tables></webPr></connection>` +
    `<connection id="6" name="panel export" type="6" refreshedVersion="6"><textPr prompt="0" codePage="437" sourceFile="C:\\Users\\tbrannigan\\Downloads\\panel export.csv" comma="1"><textFields count="2"><textField/><textField/></textFields></textPr></connection>` +
    `<connection id="7" name="Query - Visits" description="Connection to the 'Visits' query in the workbook." type="5" refreshedVersion="6"><dbPr connection="${encode(query)}" command="SELECT * FROM [Visits]"/></connection>` +
    `<connection id="8" name="Connection8" type="5" refreshedVersion="6"><dbPr connection="Provider=MSOLAP.8;Integrated Security=SSPI;Initial Catalog=FinanceCube;Data Source=https://olap.mercy.example/olap/msmdpump.dll;MDX Compatibility=1;MDX Missing Member Mode=Error" command="Finance" commandType="1"/><olapPr sendLocale="1" rowDrillCount="1000"/></connection>` +
    `</connections>`;
  const queryTable = (name: string, connectionId: number): string => `${HEAD}<queryTable xmlns="${MAIN}" name="${name}" connectionId="${connectionId}" autoFormatId="16" applyNumberFormats="0"><queryTableRefresh nextId="3"><queryTableFields count="2"><queryTableField id="1" name="Person" tableColumnId="1"/><queryTableField id="2" name="Count" tableColumnId="2"/></queryTableFields></queryTableRefresh></queryTable>`;
  const cache = `${HEAD}<pivotCacheDefinition xmlns="${MAIN}" recordCount="0"><cacheSource type="external" connectionId="2"/><cacheFields count="1"><cacheField name="Person"><sharedItems/></cacheField></cacheFields></pivotCacheDefinition>`;
  const build = (): Promise<Uint8Array> =>
    workbook({
      sheets: [
        {
          name: 'Visits',
          rows: [
            ['Person', 'Count', 'From the cube', 'Asked for'],
            ['Corwin Ashdale', 12, { f: 'CUBEVALUE("Warehouse (OLE DB)","[Measures].[Paid]")', v: '0' }, null],
            ['Odalys Brenner', 7, null, null],
          ],
        },
      ],
      definedNames: '<definedName name="ExternalData_1" localSheetId="0">Visits!$A$1:$B$3</definedName>',
      workbookAfter: '<extLst><ext uri="{FCE2AD5D-F65C-4FA6-A056-5C36A1767C68}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:dataModel><x15:modelTables><x15:modelTable id="Visits_1" name="Visits" connection="Query - Visits"/></x15:modelTables></x15:dataModel></ext></extLst>',
      parts: {
        'xl/connections.xml': connections,
        'xl/queryTables/queryTable1.xml': queryTable('mercy-sql04 VisitsWarehouse visits', 1),
        'xl/queryTables/queryTable2.xml': queryTable('ExternalData_1', 3),
        'xl/pivotCache/pivotCacheDefinition1.xml': cache,
      },
      overrides:
        '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/><Override PartName="/xl/queryTables/queryTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/><Override PartName="/xl/queryTables/queryTable2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>',
      workbookRels: `<Relationship Id="rId70" Type="${REL}/connections" Target="connections.xml"/>`,
    });

  it('keeps each setting and replaces what it says about a place, a person or a secret', async () => {
    const copy = await makeCopy(await build(), 'workbook', {});
    const after = await partsOf(copy.bytes);
    const xml = part(after, 'xl/connections.xml');
    const strings = tags(xml, 'dbPr').map((attrs) => setting(attrs, 'connection'));
    expect(strings).toEqual([
      // ODBC: the driver and the yes-or-no settings stay; the password is emptied, and so is the half of it that sat after a semicolon.
      'ODBC;DRIVER={SQL Server};SERVER=server;UID=user;PWD=;value;APP=Microsoft Office 2016;WSID=workstation;DATABASE=database;Trusted_Connection=Yes',
      // OLE DB.
      'Provider=SQLOLEDB.1;Integrated Security=SSPI;Persist Security Info=True;Initial Catalog=database;Data Source=server;Use Procedure for Prepare=1;Auto Translate=True;Packet Size=4096;Workstation ID=workstation;Use Encryption for Data=False',
      // A file on someone's machine keeps only its ending. A password in quotation marks is emptied, semicolon and all.
      'Provider=Microsoft.ACE.OLEDB.12.0;User ID=user;Data Source=C:\\folder\\file.accdb;Mode=Share Deny Write;Extended Properties="";Jet OLEDB:Database Password="";Jet OLEDB:Engine Type=6',
      // A file on a shared folder; the settings inside "Extended Properties" stay.
      'Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\\folder\\file.xlsx;Extended Properties="Excel 12.0 Xml;HDR=YES;IMEX=1"',
      // A connection to a query held in the workbook itself points at nothing outside it, and is left to go on working.
      'Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Visits;Extended Properties=""',
      // A cube reached over the web.
      'Provider=MSOLAP.8;Integrated Security=SSPI;Initial Catalog=database;Data Source=https://example.invalid/;MDX Compatibility=1;MDX Missing Member Mode=Error',
    ]);

    // The query keeps its shape. What is written in quotation marks, between # marks or as a long number is replaced, and the database's name follows the connection.
    expect(tags(xml, 'dbPr').map((attrs) => setting(attrs, 'command'))).toEqual([
      "SELECT v.id, v.paid FROM database.dbo.visits v WHERE v.payer = 'value' AND v.member = 0 AND v.note LIKE 'value' AND v.seen > #1/1/2000#",
      'visits',
      'SELECT * FROM `panel`',
      'Sheet1$',
      'SELECT * FROM [Visits]',
      'Finance',
    ]);

    // The connections themselves: numbers as they were, plain names, no descriptions, no files.
    const list = tags(xml, 'connection');
    expect(list.map((attrs) => setting(attrs, 'id'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(list.map((attrs) => setting(attrs, 'name'))).toEqual(['Connection 1', 'Connection 2', 'Connection 3', 'Connection 4', 'Connection 5', 'Connection 6', 'Connection 7', 'Connection8']);
    expect(list.map((attrs) => setting(attrs, 'description'))).toEqual(list.map(() => undefined));
    expect(setting(list[0], 'odcFile')).toBe('C:\\folder\\file.odc');
    expect(setting(list[2], 'sourceFile')).toBe('C:\\folder\\file.accdb');
    expect(list.map((attrs) => setting(attrs, 'type'))).toEqual(['1', '5', '5', '5', '4', '6', '5', '5']);

    // A web connection, a text file, and a value the query asks for.
    const web = tags(xml, 'webPr')[0];
    expect(setting(web, 'url')).toBe('https://example.invalid/');
    expect(setting(web, 'post')).toBeUndefined();
    expect(setting(web, 'htmlTables')).toBe('1');
    expect(xml).toContain('<tables count="2"><s v="table"/><x v="3"/></tables>');
    const file = tags(xml, 'textPr')[0];
    expect(setting(file, 'sourceFile')).toBe('C:\\folder\\file.csv');
    expect(setting(file, 'prompt')).toBe('0');
    expect(setting(file, 'codePage')).toBe('437');
    const asked = tags(xml, 'parameter')[0];
    expect(setting(asked, 'name')).toBe('Parameter 1');
    expect(setting(asked, 'string')).toBe('value');
    expect(setting(asked, 'prompt')).toBeUndefined();
    expect(setting(asked, 'cell')).toBe('Visits!$D$1');
    expect(setting(asked, 'sqlType')).toBe('4');

    // Nothing of what was replaced is left in any part of the copy.
    const everything = allText(after);
    for (const gone of ['mercy-sql04', 'tbrannigan', 'Winter', '2026!', 'MERCY-LT-0412', 'VisitsWarehouse', 'mercy-fs02', 'roster.xlsx', 'panel 2026', 'quartz', 'intranet.mercy', '9f31c2aa', 'Brannigan', 'Harbor Mutual', '100482233', '1/15/2026', 'panel export', 'FinanceCube', 'olap.mercy', 'Tessa', 'Nightly pull', 'Warehouse (OLE DB)', 'Roster on the share', 'County figures', 'Query - Visits', 'Corwin Ashdale']) {
      expect(everything.includes(gone), gone).toBe(false);
    }
    expect(copy.report.outsideTheCells.filter((item) => item.where === 'xl/connections.xml')).toEqual([{ ...LINE, count: 8 }]);
    expect(copy.check.ran).toBe(true);
    expect(copy.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
  });

  it('keeps every saved query and pivot table pointing at its connection', async () => {
    const copy = await makeCopy(await build(), 'workbook', {});
    const after = await partsOf(copy.bytes);
    const ids = new Set(tags(part(after, 'xl/connections.xml'), 'connection').map((attrs) => setting(attrs, 'id')));
    const first = tags(part(after, 'xl/queryTables/queryTable1.xml'), 'queryTable')[0];
    const second = tags(part(after, 'xl/queryTables/queryTable2.xml'), 'queryTable')[0];
    // A saved query finds its connection by number, and the numbers are as they were.
    expect(setting(first, 'connectionId')).toBe('1');
    expect(setting(second, 'connectionId')).toBe('3');
    expect(ids.has(setting(first, 'connectionId'))).toBe(true);
    expect(ids.has(setting(second, 'connectionId'))).toBe(true);
    // Its own name repeated the server and the database: it gets a plain one. The other shares its name with a named range, and both stay.
    expect(setting(first, 'name')).toBe('ExternalData_1');
    expect(setting(second, 'name')).toBe('ExternalData_1');
    expect(part(after, 'xl/workbook.xml')).toContain('<definedName name="ExternalData_1"');
    expect(part(after, 'xl/queryTables/queryTable1.xml')).toContain('<queryTableField id="1" name="Person" tableColumnId="1"/>');
    expect(setting(tags(part(after, 'xl/pivotCache/pivotCacheDefinition1.xml'), 'cacheSource')[0], 'connectionId')).toBe('2');
    // What names a connection by its name follows the new name: a table of the data model, and a formula that asks a cube.
    expect(setting(tags(part(after, 'xl/workbook.xml'), 'x15:modelTable')[0], 'connection')).toBe('Connection 7');
    expect(formulaOf(cellsOf(after, 'Visits'), 'C2')).toBe('CUBEVALUE("Connection 2","[Measures].[Paid]")');
    expect(copy.report.forALook.map((found) => found.text)).not.toContain('Warehouse (OLE DB)');
  });

  it('lists each connection and the text of each query for the person to read', async () => {
    const report = await inspect(await build(), 'workbook');
    const found = report.worthKnowing.filter((item) => item.what === 'A saved connection to a database or a web address');
    expect(found.length).toBe(8);
    expect(found.every((item) => item.detail === 'it stays in the copy, with server, database, user and file names replaced with placeholders')).toBe(true);
    const queries = report.worthKnowing.filter((item) => item.what === 'The request a saved connection sends (a query)').map((item) => item.detail);
    expect(queries.length).toBe(6);
    expect(queries[0]).toBe("SELECT v.id, v.paid FROM database.dbo.visits v WHERE v.payer = 'value' AND v.member = 0 AND v.note LIKE 'value' AND v.seen > #1/1/2000#");
    for (const text of queries) expect(text).not.toMatch(/Harbor|100482233|VisitsWarehouse/);
  });

  it('carries a renamed sheet into the cell a query reads its value from', async () => {
    const copy = await makeCopy(await build(), 'workbook', { rename: { Visits: 'Sheet one' } });
    const xml = part(await partsOf(copy.bytes), 'xl/connections.xml');
    expect(setting(tags(xml, 'parameter')[0], 'cell')).toBe("'Sheet one'!$D$1");
  });
});

describe('Cleaner Copy engine: saved connections and the check', () => {
  const connection = (attrs: string, details: string): string => `${HEAD}<connections xmlns="${MAIN}"><connection id="1" ${attrs} type="1" refreshedVersion="6">${details}</connection></connections>`;
  const book = (connections: string, rows: (string | number)[][], extra: { definedNames?: string; parts?: Record<string, string> } = {}): Promise<Uint8Array> =>
    workbook({ sheets: [{ name: 'Visits', rows }], parts: { 'xl/connections.xml': connections, ...extra.parts }, ...(extra.definedNames ? { definedNames: extra.definedNames } : {}) });

  it('searches the copy for what a connection said, and reports a place it could not change', async () => {
    // An older workbook finds a saved query's cells through a named range of the same name. Both are left to match,
    // so the server's name is still in the copy, and the check says so.
    const copy = await makeCopy(
      await book(connection('name="Query from mercy-sql04"', '<dbPr connection="DSN=Visits;SERVER=mercy-sql04;UID=tbrannigan;" command="SELECT * FROM visits"/>'), [['Person', 'Count'], ['Corwin Ashdale', 12]], {
        definedNames: '<definedName name="Query_from_mercy_sql04_1">Visits!$A$1:$B$2</definedName><definedName name="mercy-sql04_range">Visits!$A$1:$B$2</definedName>',
        parts: { 'xl/queryTables/queryTable1.xml': `${HEAD}<queryTable xmlns="${MAIN}" name="mercy-sql04_range" connectionId="1"/>` },
      }),
      'workbook',
      {},
    );
    const after = await partsOf(copy.bytes);
    expect(part(after, 'xl/connections.xml')).toContain('connection="DSN=dsn;SERVER=server;UID=user;"');
    expect(part(after, 'xl/queryTables/queryTable1.xml')).toContain('name="mercy-sql04_range"');
    const left = copy.check.items.filter((item) => item.value === 'mercy-sql04');
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((item) => item.how === 'inside')).toBe(true);
    // In the saved query it has no explanation; in the named range it is one of the names the person is shown.
    expect(left.map((item) => `${item.part}: ${item.kind}`).sort()).toEqual(['xl/queryTables/queryTable1.xml: unexplained', 'xl/workbook.xml: name']);
    expect(copy.check.items.filter((item) => item.value === 'tbrannigan')).toEqual([]);
  });

  it('does not take a placeholder for a leftover when a cell held the same word', async () => {
    const copy = await makeCopy(
      await book(connection('name="Connection"', '<dbPr connection="SERVER=mercy-sql04;DATABASE=VisitsWarehouse;" command="SELECT * FROM visits WHERE kind = \'follow up visit\'"/>'), [['Person', 'Kept on'], ['Corwin Ashdale', 'database'], ['Odalys Brenner', 'server'], ['follow up visit', 'visits']]),
      'workbook',
      {},
    );
    const after = await partsOf(copy.bytes);
    expect(part(after, 'xl/connections.xml')).toContain('connection="SERVER=server;DATABASE=database;" command="SELECT * FROM visits WHERE kind = \'value\'"');
    expect(part(after, 'xl/connections.xml')).toContain('name="Connection"');
    const kinds = new Map(copy.check.items.map((item) => [item.value, item.kind]));
    // The cells that held "database" and "server" were replaced; the same words in the connection are the placeholders.
    expect(kinds.get('database')).toBe('chance');
    expect(kinds.get('server')).toBe('chance');
    // "visits" is a cell's value and also a table the query names: the query's text is listed for the person to read.
    expect(kinds.get('visits')).toBe('listed');
    expect(copy.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
    expect(allText(after)).not.toContain('follow up visit');
  });

  it('says nothing about connections for a workbook that has none', async () => {
    const report = await inspect(await workbook({ sheets: [{ name: 'Visits', rows: [['Person'], ['Corwin Ashdale']] }] }), 'workbook');
    expect(report.outsideTheCells.some((item) => /connection/i.test(item.what))).toBe(false);
  });
});
