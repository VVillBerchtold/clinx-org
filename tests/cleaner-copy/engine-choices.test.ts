import { describe, expect, it } from 'vitest';
import { inspect, makeCopy } from '../../src/scripts/cleaner-copy/engine/index.js';
import { allText, cellsOf, formulaOf, part, partsOf, sameShape, shown, workbook } from './fixtures/workbooks';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

describe('Cleaner Copy engine: data another program stored in the file', () => {
  const props = (id: string): string => `${HEAD}<ds:datastoreItem ds:itemID="{${id}}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>`;
  const itemRels = (n: number): string => `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/customXmlProps" Target="itemProps${n}.xml"/></Relationships>`;
  const build = (): Promise<Uint8Array> =>
    workbook({
      sheets: [{ name: 'Visits', rows: [['Person', 'Count'], ['Corwin Ashdale', 12], ['Odalys Brenner', 7]] }],
      parts: {
        // A document library's label, which repeats a person's name from the cells.
        'customXml/item1.xml': `${HEAD}<p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><documentManagement><Reviewer>Corwin Ashdale</Reviewer></documentManagement></p:properties>`,
        'customXml/itemProps1.xml': props('11111111-2222-3333-4444-555555555555'),
        'customXml/_rels/item1.xml.rels': itemRels(1),
        // A Power Query.
        'customXml/item2.xml': `${HEAD}<DataMashup xmlns="http://schemas.microsoft.com/DataMashup">AAAAAA==</DataMashup>`,
        'customXml/itemProps2.xml': props('66666666-7777-8888-9999-000000000000'),
        'customXml/_rels/item2.xml.rels': itemRels(2),
        'docProps/custom.xml': `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Checked by"><vt:lpwstr>Odalys Brenner</vt:lpwstr></property></Properties>`,
      },
      overrides:
        '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override PartName="/customXml/itemProps2.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>',
      rootRels: `<Relationship Id="rId2" Type="${REL}/custom-properties" Target="docProps/custom.xml"/>`,
      workbookRels: `<Relationship Id="rId80" Type="${REL}/customXml" Target="../customXml/item1.xml"/><Relationship Id="rId81" Type="${REL}/customXml" Target="../customXml/item2.xml"/>`,
    });

  it('reports them when it looks', async () => {
    const report = await inspect(await build(), 'workbook');
    expect(report.extras).toEqual({ parts: 3, queries: true });
  });

  it('takes them out, with every mention of them, unless told otherwise', async () => {
    const copy = await makeCopy(await build(), 'workbook', {});
    const after = await partsOf(copy.bytes);
    for (const gone of ['customXml/item1.xml', 'customXml/itemProps1.xml', 'customXml/_rels/item1.xml.rels', 'docProps/custom.xml']) expect(after.has(gone), gone).toBe(false);
    const types = part(after, '[Content_Types].xml');
    expect(types).not.toContain('itemProps1.xml');
    expect(types).not.toContain('custom.xml');
    expect(types).toContain('/xl/workbook.xml');
    expect(part(after, '_rels/.rels')).not.toContain('custom');
    expect(part(after, '_rels/.rels')).toContain('Target="xl/workbook.xml"');
    const links = part(after, 'xl/_rels/workbook.xml.rels');
    expect(links).not.toContain('item1.xml');
    expect(links).toContain('worksheets/sheet1.xml');
    expect(allText(after)).not.toContain('Corwin Ashdale');
    expect(allText(after)).not.toContain('Odalys Brenner');
    expect(copy.report.extras).toEqual({ parts: 3, queries: true });
    expect(copy.report.outsideTheCells.filter((item) => item.action === 'taken out').map((item) => item.where).sort()).toEqual(['customXml/item1.xml', 'docProps/custom.xml']);
    expect(copy.check.items).toEqual([]);
  });

  it('keeps a Power Query, with the parts it needs', async () => {
    const after = await partsOf((await makeCopy(await build(), 'workbook', {})).bytes);
    expect(part(after, 'customXml/item2.xml')).toContain('<DataMashup');
    expect(after.has('customXml/itemProps2.xml')).toBe(true);
    expect(after.has('customXml/_rels/item2.xml.rels')).toBe(true);
    expect(part(after, '[Content_Types].xml')).toContain('/customXml/itemProps2.xml');
    expect(part(after, 'xl/_rels/workbook.xml.rels')).toContain('Target="../customXml/item2.xml"');
  });

  it('keeps them when the person says so, and the check then says what it found in them', async () => {
    const copy = await makeCopy(await build(), 'workbook', { dropExtras: false });
    const after = await partsOf(copy.bytes);
    expect(after.has('customXml/item1.xml')).toBe(true);
    expect(after.has('docProps/custom.xml')).toBe(true);
    expect(part(after, '[Content_Types].xml')).toContain('/docProps/custom.xml');
    expect(copy.check.items.map((item) => [item.value, item.kind, item.part]).sort()).toEqual([
      ['Corwin Ashdale', 'untouched', 'customXml/item1.xml'],
      ['Odalys Brenner', 'untouched', 'docProps/custom.xml'],
    ]);
  });
});

describe('Cleaner Copy engine: a heading that is also a value', () => {
  // "Status" is a heading, and also what one cell of that column says. "Person" is a heading, and a note in another column.
  const build = (): Promise<Uint8Array> =>
    workbook({
      sheets: [
        { name: 'Cases', rows: [['Person', 'Status', 'Note'], ['Corwin Ashdale', 'Opened', 'Person'], ['Odalys Brenner', 'Status', 'Called twice'], ['Tavish Mcallen', 'Closed', 'Status']] },
        { name: 'Other', rows: [['Code', 'Seen'], ['Status', 4]] },
      ],
    });

  it('is counted, column by column', async () => {
    const report = await inspect(await build(), 'workbook');
    expect(report.sheets[0]?.columns.map((column) => [column.heading, column.headingAlsoValue])).toEqual([['Person', 0], ['Status', 1], ['Note', 2]]);
    expect(report.sheets[1]?.columns.map((column) => column.headingAlsoValue)).toEqual([1, 0]);
  });

  it('keeps the heading and gives the cells a stand-in', async () => {
    const copy = await makeCopy(await build(), 'workbook', {});
    const after = await partsOf(copy.bytes);
    const cases = cellsOf(after, 'Cases');
    expect([shown(cases, 'A1'), shown(cases, 'B1'), shown(cases, 'C1')]).toEqual(['Person', 'Status', 'Note']);
    const made = shown(cases, 'B3');
    expect(made).not.toBe('Status');
    expect(sameShape('Status', made)).toBe(true);
    // The same text gets the same stand-in wherever it is a value.
    expect(shown(cases, 'C4')).toBe(made);
    expect(shown(cellsOf(after, 'Other'), 'A2')).toBe(made);
    expect(shown(cases, 'C2')).not.toBe('Person');
    expect(sameShape('Person', shown(cases, 'C2'))).toBe(true);
    // The list of text now holds the heading once, as it was, and the stand-in beside it.
    const strings = part(after, 'xl/sharedStrings.xml');
    expect(strings.split('>Status<').length - 1).toBe(1);
    expect(strings.split('>Person<').length - 1).toBe(1);
    expect(copy.report.sheets[0]?.columns[1]?.headingAlsoValue).toBe(1);
  });

  it('leaves the cell as it is in a column the person kept', async () => {
    const copy = await makeCopy(await build(), 'workbook', { keep: { Cases: ['B'] } });
    const after = await partsOf(copy.bytes);
    const cases = cellsOf(after, 'Cases');
    expect([shown(cases, 'B2'), shown(cases, 'B3'), shown(cases, 'B4')]).toEqual(['Opened', 'Status', 'Closed']);
    expect(shown(cases, 'C4')).not.toBe('Status');
    expect(shown(cellsOf(after, 'Other'), 'A2')).toBe(shown(cases, 'C4'));
    expect(shown(cases, 'A2')).not.toBe('Corwin Ashdale');
  });
});

describe('Cleaner Copy engine: texts the person asks to have replaced', () => {
  const build = (): Promise<Uint8Array> =>
    workbook({
      sheets: [
        {
          name: 'Cases',
          rows: [
            ['Person', 'Handled by', 'Flag'],
            ['Corwin Ashdale', 'Tavish Mcallen', { f: 'IF(A2="Corwin Ashdale","Call Tavish Mcallen today","")', v: 'Call Tavish Mcallen today' }],
            ['Odalys Brenner', 'Tavish Mcallen', { f: 'IF(A3="Corwin Ashdale","Call Tavish Mcallen today","")', v: '' }],
          ],
          after:
            '<conditionalFormatting sqref="A2:A3"><cfRule type="containsText" priority="1" operator="containsText" text="Ward Pelham"><formula>NOT(ISERROR(SEARCH("Ward Pelham",A2)))</formula></cfRule></conditionalFormatting>' +
            '<dataValidations count="1"><dataValidation type="list" sqref="B2:B3" showInputMessage="1" promptTitle="Who" prompt="Ask Tavish Mcallen before changing this"><formula1>"Tavish Mcallen,Ines Okonjo"</formula1></dataValidation></dataValidations>',
        },
      ],
    });

  it('are listed first, each one once', async () => {
    const report = await inspect(await build(), 'workbook');
    expect(report.forALook.map((item) => [item.text, item.times]).sort()).toEqual([
      ['Ask Tavish Mcallen before changing this', 1],
      ['Call Tavish Mcallen today', 2],
      ['Ines Okonjo', 1],
      ['Ward Pelham', 2],
      ['Who', 1],
    ]);
  });

  it('stay where they are until asked for, and the check says so', async () => {
    const copy = await makeCopy(await build(), 'workbook', {});
    const said = allText(await partsOf(copy.bytes));
    expect(said).toContain('Call Tavish Mcallen today');
    expect(said).toContain('Ask Tavish Mcallen before changing this');
    // A text that is also a cell value is replaced inside a formula and in a list without being asked.
    expect(said).not.toContain('"Corwin Ashdale"');
    expect(said).not.toContain('"Tavish Mcallen,');
    const found = copy.check.items.filter((item) => item.value === 'Tavish Mcallen');
    expect(found.length).toBeGreaterThan(0);
    expect(copy.check.items.every((item) => item.kind === 'listed')).toBe(true);
  });

  it('are replaced wherever they are written once asked for', async () => {
    const swapText = ['Call Tavish Mcallen today', 'Ask Tavish Mcallen before changing this', 'Ward Pelham', 'Ines Okonjo'];
    const copy = await makeCopy(await build(), 'workbook', { swapText });
    const after = await partsOf(copy.bytes);
    const said = allText(after);
    for (const original of [...swapText, 'Tavish Mcallen', 'Corwin Ashdale']) expect(said, original).not.toContain(original);
    const cases = cellsOf(after, 'Cases');
    // The formula still agrees with the cells, and both rows say the same made-up thing.
    expect(formulaOf(cases, 'C2')).toContain(`A2="${shown(cases, 'A2')}"`);
    const flag = /,"([^"]+)",""\)$/.exec(formulaOf(cases, 'C2'))?.[1] ?? '';
    expect(sameShape('Call Tavish Mcallen today', flag)).toBe(true);
    expect(formulaOf(cases, 'C3')).toContain(`"${flag}"`);
    // The colour rule holds its text twice, and both get the one stand-in.
    const rule = /<cfRule\b[^>]*\stext="([^"]*)"/.exec(part(after, 'xl/worksheets/sheet1.xml'))?.[1] ?? '';
    expect(sameShape('Ward Pelham', rule)).toBe(true);
    expect(part(after, 'xl/worksheets/sheet1.xml')).toContain(`SEARCH("${rule}",A2)`);
    // The list offers the stand-in the cells hold.
    expect(part(after, 'xl/worksheets/sheet1.xml')).toContain(`<formula1>"${shown(cases, 'B2')},`);
    expect(copy.report.forALook.map((item) => item.text)).toEqual(['Who']);
    expect(copy.check.items).toEqual([]);
  });
});

describe('Cleaner Copy engine: the values a chart saves', () => {
  const chart = `${HEAD}<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Corwin Ashdale</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:f>Visits!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Paid</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Visits!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Corwin Ashdale</c:v></c:pt><c:pt idx="1"><c:v>Odalys Brenner</c:v></c:pt><c:pt idx="2"><c:v>Tavish Mcallen</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Visits!$B$2:$B$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>1204.55</c:v></c:pt><c:pt idx="1"><c:v>7310.08</c:v></c:pt><c:pt idx="2"><c:v>3188.41</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
  const build = (): Promise<Uint8Array> =>
    workbook({
      sheets: [{ name: 'Visits', rows: [['Person', 'Paid'], ['Corwin Ashdale', 1204.55], ['Odalys Brenner', 7310.08], ['Tavish Mcallen', 3188.41]] }],
      parts: { 'xl/charts/chart1.xml': chart },
      overrides: '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>',
    });

  it('get the stand-ins the cells have', async () => {
    const copy = await makeCopy(await build(), 'workbook', {});
    const after = await partsOf(copy.bytes);
    const visits = cellsOf(after, 'Visits');
    const drawn = part(after, 'xl/charts/chart1.xml');
    const values = [...drawn.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1] ?? '');
    // The series is named by a heading, which stays. The people get the stand-ins their cells have.
    expect(values.slice(0, 4)).toEqual(['Paid', shown(visits, 'A2'), shown(visits, 'A3'), shown(visits, 'A4')]);
    expect(shown(visits, 'A2')).not.toBe('Corwin Ashdale');
    // The numbers are replaced with numbers.
    expect(values.slice(4).length).toBe(3);
    expect(values.slice(4).every((value) => /^\d+\.\d\d$/.test(value))).toBe(true);
    expect(values.slice(4).join(' ')).not.toBe('1204.55 7310.08 3188.41');
    for (const original of ['Corwin Ashdale', 'Odalys Brenner', 'Tavish Mcallen', '1204.55', '7310.08', '3188.41']) expect(drawn, original).not.toContain(original);
    // A title typed onto the chart that repeats a cell value gets that value's stand-in.
    expect(drawn).toContain(`<a:t>${shown(visits, 'A2')}</a:t>`);
    expect(drawn).toContain('<c:f>Visits!$A$2:$A$4</c:f>');
    expect(copy.report.outsideTheCells.find((item) => item.what === "A chart's saved copy of the values it draws")).toEqual({ what: "A chart's saved copy of the values it draws", where: 'chart1.xml', count: 6, action: 'given the same replacements as the cells' });
    expect(copy.check.items).toEqual([]);
  });
});

describe('Cleaner Copy engine: a sheet with no row of headings', () => {
  it('is reported with no heading row, and every cell is replaced', async () => {
    const bytes = await workbook({ sheets: [{ name: 'Counts', rows: [[1204.55, 7310.08], [3188.41, 9902.17], [4410.63, 2087.36], [5521.94, 6634.72]] }] });
    const report = await inspect(bytes, 'workbook');
    expect(report.sheets[0]?.headingRow).toBeNull();
    expect(report.sheets[0]?.headingRows).toEqual([]);
    expect(report.sheets[0]?.headingsFrom).toBe('none');
    const copy = await makeCopy(bytes, 'workbook', {});
    expect(copy.described[0]?.headingRow).toBeNull();
    expect(copy.described[0]?.columns.map((column) => [column.column, column.heading, column.holds])).toEqual([['A', '', 'number'], ['B', '', 'number']]);
    expect(copy.described[0]?.rows.length).toBe(3);
    const cells = cellsOf(await partsOf(copy.bytes), 'Counts');
    expect(copy.described[0]?.rows[0]).toEqual([shown(cells, 'A1'), shown(cells, 'B1')]);
    expect(copy.report.replaced.number).toBe(8);
    expect(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4'].map((ref) => shown(cells, ref)).join(' ')).not.toBe('1204.55 7310.08 3188.41 9902.17 4410.63 2087.36 5521.94 6634.72');
  });
});
