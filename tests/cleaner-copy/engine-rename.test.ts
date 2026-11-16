import { describe, expect, it } from 'vitest';
import { makeCopy, nameProblem } from '../../src/scripts/cleaner-copy/engine/index.js';
import { allText, cellsOf, formulaOf, part, partsOf, workbook } from './fixtures/workbooks';

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

// Three sheets whose names are written all over the workbook: plain, with a space, and with an apostrophe.
const bytes = await workbook({
  sheets: [
    {
      name: 'Visits',
      rows: [
        ['Person', 'Clinic', 'Count'],
        ['Corwin Ashdale', 'Harbour Street', 12],
        ['Odalys Brenner', 'Mill Lane', 7],
        ['Tavish Mcallen', 'Harbour Street', 31],
      ],
      sheetPr: 'codeName="Visits"',
      after:
        '<conditionalFormatting sqref="C2:C4"><cfRule type="expression" priority="1"><formula>Visits!$C$2&gt;5</formula></cfRule></conditionalFormatting>' +
        `<dataValidations count="1"><dataValidation type="list" sqref="E2"><formula1>'People list'!$A$2:$A$4</formula1></dataValidation></dataValidations>` +
        `<hyperlinks><hyperlink ref="A2" location="'People list'!A1"/><hyperlink ref="A3" location="Visits!C4"/></hyperlinks>` +
        `<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"><x14:dataValidation type="list"><x14:formula1><xm:f>'Dr O''Neil'!$A$2:$A$3</xm:f></x14:formula1><xm:sqref>F2</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst>`,
    },
    {
      name: 'People list',
      rows: [
        ['Person', 'Room'],
        ['Corwin Ashdale', 'North 4'],
        ['Odalys Brenner', 'South 2'],
        ['Tavish Mcallen', 'North 9'],
      ],
    },
    {
      name: "Dr O'Neil",
      rows: [
        ['Day', 'Seen'],
        ['Monday', 14],
        ['Friday', 9],
      ],
    },
    {
      name: 'Totals',
      rows: [
        ['What', 'Value'],
        ['All visits', { f: 'SUM(Visits!C2:C4)', v: '50' }],
        ['First person', { f: "'People list'!A2", v: 'Corwin Ashdale' }],
        ['Seen on Monday', { f: "'Dr O''Neil'!B2", v: '14' }],
        ['Room', { f: "VLOOKUP(Visits!A2,'People list'!A:B,2,FALSE)", v: 'North 4' }],
        ['Written as text', { f: 'INDIRECT("Visits!C2")', v: '12' }],
        ['Two sheets', { f: "SUM(Visits!C2,'Dr O''Neil'!B3)+COUNTA('People list'!A:A)", v: '25' }],
      ],
    },
  ],
  definedNames: `<definedName name="AllCounted">Visits!$A$1:$C$4</definedName><definedName name="Rooms">'People list'!$B$2:$B$4</definedName><definedName name="_xlnm.Print_Area" localSheetId="2">'Dr O''Neil'!$A$1:$B$3</definedName>`,
  parts: {
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><TitlesOfParts><vt:vector size="6" baseType="lpstr"><vt:lpstr>Visits</vt:lpstr><vt:lpstr>People list</vt:lpstr><vt:lpstr>Dr O'Neil</vt:lpstr><vt:lpstr>Totals</vt:lpstr><vt:lpstr>AllCounted</vt:lpstr><vt:lpstr>'Dr O''Neil'!Print_Area</vt:lpstr></vt:vector></TitlesOfParts></Properties>`,
    'xl/pivotCache/pivotCacheDefinition1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition xmlns="${MAIN}" refreshedBy="Odalys Brenner" recordCount="3"><cacheSource type="worksheet"><worksheetSource ref="A1:C4" sheet="Visits"/></cacheSource><cacheFields count="1"><cacheField name="Person" numFmtId="0"><sharedItems count="2"><s v="Corwin Ashdale"/><s v="Odalys Brenner"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`,
    'xl/charts/chart1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:f>Visits!$C$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Count</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>'People list'!$A$2:$A$4</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Corwin Ashdale</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Visits!$C$2:$C$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>12</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
  },
  overrides: '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>',
});

const rename = { Visits: 'Sheet A', 'People list': 'Roster', "Dr O'Neil": "Team's days" };
const copy = await makeCopy(bytes, 'workbook', { rename });
const after = await partsOf(copy.bytes);

describe('Cleaner Copy engine: new names for sheets', () => {
  it('writes the new names on the sheets', () => {
    const book = part(after, 'xl/workbook.xml');
    expect(book).toContain('<sheet name="Sheet A" sheetId="1" r:id="rId1"/>');
    expect(book).toContain('<sheet name="Roster" sheetId="2" r:id="rId2"/>');
    expect(book).toContain('name="Team\'s days"');
    expect(book).toContain('<sheet name="Totals" sheetId="4" r:id="rId4"/>');
  });

  it('leaves the old names in no part of the copy', () => {
    const said = allText(after);
    for (const old of ['Visits', 'People list', "O'Neil", "O''Neil"]) expect(said.includes(old), `the copy still says ${old}`).toBe(false);
  });

  it('makes every formula follow', () => {
    const totals = cellsOf(after, 'Totals');
    expect(formulaOf(totals, 'B2')).toBe("SUM('Sheet A'!C2:C4)");
    expect(formulaOf(totals, 'B3')).toBe("'Roster'!A2");
    expect(formulaOf(totals, 'B4')).toBe("'Team''s days'!B2");
    expect(formulaOf(totals, 'B5')).toBe("VLOOKUP('Sheet A'!A2,'Roster'!A:B,2,FALSE)");
    expect(formulaOf(totals, 'B6')).toBe(`INDIRECT("'Sheet A'!C2")`);
    expect(formulaOf(totals, 'B7')).toBe("SUM('Sheet A'!C2,'Team''s days'!B3)+COUNTA('Roster'!A:A)");
  });

  it('makes the lists, rules, links, names, pivot table, chart and file details follow', () => {
    const sheet = part(after, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain("<formula>'Sheet A'!$C$2&gt;5</formula>");
    expect(sheet).toContain("<formula1>'Roster'!$A$2:$A$4</formula1>");
    expect(sheet).toContain("<xm:f>'Team''s days'!$A$2:$A$3</xm:f>");
    expect(sheet).toContain(`location="'Roster'!A1"`);
    expect(sheet).toContain(`location="'Sheet A'!C4"`);
    expect(sheet).not.toContain('codeName');
    const book = part(after, 'xl/workbook.xml');
    expect(book).toContain(`<definedName name="AllCounted">'Sheet A'!$A$1:$C$4</definedName>`);
    expect(book).toContain(`<definedName name="Rooms">'Roster'!$B$2:$B$4</definedName>`);
    expect(book).toContain(`'Team''s days'!$A$1:$B$3</definedName>`);
    expect(part(after, 'xl/pivotCache/pivotCacheDefinition1.xml')).toContain('sheet="Sheet A"');
    const chart = part(after, 'xl/charts/chart1.xml');
    expect(chart).toContain("<c:f>'Sheet A'!$C$1</c:f>");
    expect(chart).toContain("<c:f>'Roster'!$A$2:$A$4</c:f>");
    expect(chart).toContain("<c:f>'Sheet A'!$C$2:$C$4</c:f>");
    const details = part(after, 'docProps/app.xml');
    expect(details).toContain('<vt:lpstr>Sheet A</vt:lpstr><vt:lpstr>Roster</vt:lpstr><vt:lpstr>Team\'s days</vt:lpstr><vt:lpstr>Totals</vt:lpstr>');
    expect(details).toContain("<vt:lpstr>'Team''s days'!Print_Area</vt:lpstr>");
  });

  it('says in the report and in the description which name is which', () => {
    expect(copy.report.sheets.map((sheet) => [sheet.name, sheet.newName])).toEqual([['Visits', 'Sheet A'], ['People list', 'Roster'], ["Dr O'Neil", "Team's days"], ['Totals', undefined]]);
    expect(copy.described.map((sheet) => sheet.name)).toEqual(['Sheet A', 'Roster', "Team's days", 'Totals']);
    expect(copy.report.outsideTheCells.some((item) => item.what === 'Sheet names' && item.count === 3)).toBe(true);
  });

  it('searches the copy for the old names, and finds none', () => {
    expect(copy.check.ran).toBe(true);
    expect(copy.check.items).toEqual([]);
  });

  it('counts an old name that is left behind as a text it cannot account for', async () => {
    // A named range can carry the sheet's name inside its own name. That name is not a pointer to the sheet, so it does not follow.
    const named = await workbook({
      sheets: [{ name: 'Visits', rows: [['Person', 'Count'], ['Corwin Ashdale', 12]] }],
      definedNames: '<definedName name="VisitsRange">Visits!$A$1:$B$2</definedName>',
    });
    const left = await makeCopy(named, 'workbook', { rename: { Visits: 'Sheet A' } });
    expect(part(await partsOf(left.bytes), 'xl/workbook.xml')).toContain(`<definedName name="VisitsRange">'Sheet A'!$A$1:$B$2</definedName>`);
    const found = left.check.items.filter((item) => item.value === 'Visits');
    expect(found.map((item) => [item.kind, item.how, item.part, item.sits])).toEqual([['unexplained', 'inside', 'xl/workbook.xml', 'the setting name on <definedName>']]);
  });

  it('looks for a short old name too', async () => {
    const short = await workbook({
      sheets: [{ name: 'Q3', rows: [['Person', 'Count'], ['Corwin Ashdale', 12]] }],
      parts: { 'docProps/app.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Q3</vt:lpstr></vt:vector></TitlesOfParts></Properties>', 'xl/comments1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Odalys Brenner</author></authors><commentList/></comments>' },
      definedNames: '<definedName name="Kept">OFFSET(Q3!$A$1,0,0)</definedName>',
    });
    const clean = await makeCopy(short, 'workbook', { rename: { Q3: 'Sheet A' } });
    expect(clean.check.items).toEqual([]);
    expect(allText(await partsOf(clean.bytes))).not.toContain('Q3');
  });

  it('can swap the names of two sheets', async () => {
    const two = await workbook({
      sheets: [
        { name: 'First', rows: [['Code', 'Count'], ['ZX41Q', 3]] },
        { name: 'Second', rows: [['Code', 'Count'], ['ZX41Q', { f: 'First!B2+Second!A9', v: '3' }]] },
      ],
    });
    const swapped = await makeCopy(two, 'workbook', { rename: { First: 'Second', Second: 'First' } });
    const parts = await partsOf(swapped.bytes);
    expect(part(parts, 'xl/workbook.xml')).toContain('<sheet name="Second" sheetId="1" r:id="rId1"/><sheet name="First" sheetId="2" r:id="rId2"/>');
    expect(formulaOf(cellsOf(parts, 'First'), 'B2')).toBe("'Second'!B2+'First'!A9");
  });

  it('refuses a name a sheet cannot have, in a plain sentence', async () => {
    const refused = async (names: Record<string, string>): Promise<string> => {
      try {
        await makeCopy(bytes, 'workbook', { rename: names });
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return 'no refusal';
    };
    expect(await refused({ Visits: 'a/b' })).toBe('The sheet "Visits" cannot be given that name. A sheet name cannot contain any of these: [ ] : * ? / \\');
    expect(await refused({ Visits: 'x'.repeat(32) })).toBe('The sheet "Visits" cannot be given that name. A sheet name can be at most 31 characters.');
    expect(await refused({ Visits: 'TOTALS' })).toBe('The sheet "Visits" cannot be given that name. Another sheet already has this name. Each sheet needs its own.');
    expect(await refused({ Visits: 'Roster', 'People list': 'roster' })).toContain('Another sheet already has this name.');
    expect(await refused({ 'No such sheet': 'Sheet A' })).toBe('There is no sheet named "No such sheet" in this workbook.');
  });
});

describe('Cleaner Copy engine: nameProblem', () => {
  it('lets a good name through', () => {
    expect(nameProblem('Sheet A', ['Totals'])).toBeNull();
    expect(nameProblem('x'.repeat(31), [])).toBeNull();
    expect(nameProblem("Team's days", [])).toBeNull();
  });

  it('says what is wrong with a bad one', () => {
    expect(nameProblem('', [])).toBe('A sheet needs a name.');
    expect(nameProblem('   ', [])).toBe('A sheet needs a name.');
    expect(nameProblem('x'.repeat(32), [])).toBe('A sheet name can be at most 31 characters.');
    for (const mark of ['[', ']', ':', '*', '?', '/', '\\']) expect(nameProblem(`a${mark}b`, []), mark).toBe('A sheet name cannot contain any of these: [ ] : * ? / \\');
    expect(nameProblem("'Team", [])).toBe('A sheet name cannot start or end with an apostrophe.');
    expect(nameProblem("Team'", [])).toBe('A sheet name cannot start or end with an apostrophe.');
    expect(nameProblem('totals', ['Visits', 'Totals'])).toBe('Another sheet already has this name. Each sheet needs its own.');
  });
});
