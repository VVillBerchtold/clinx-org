import { describe, expect, it } from 'vitest';
import * as engine from '../../src/scripts/schedule-designer/engine/index';

// Schedule Designer promises that it runs in the browser, opens no connection and keeps nothing.
// This scan reads the engine's own source as text and looks for anything that could break that.
const loaded = import.meta.glob<string>('../../src/scripts/schedule-designer/engine/*.ts', { query: '?raw', import: 'default', eager: true });
const sources = new Map<string, string>();
for (const [path, text] of Object.entries(loaded)) sources.set(path.replace('../../src/scripts/schedule-designer/engine/', ''), text);
const files = [...sources.keys()].sort();

describe('Schedule Designer: source scan of the engine', () => {
  it('finds the engine files', () => {
    expect(files).toEqual(['check.ts', 'edit.ts', 'find.ts', 'index.ts', 'overview.ts', 'rooms.ts', 'sample.ts', 'tally.ts', 'team.ts', 'time.ts', 'types.ts', 'validate.ts', 'work.ts', 'workbook.ts']);
  });

  // No connection, no storage, no page: the engine only works things out.
  const never = ['fetch' + '(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts', 'import(', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'innerHTML', 'eval(', 'new Function', 'postMessage', 'new Worker'];
  for (const word of never) {
    it(`no file contains ${word}`, () => {
      for (const [file, text] of sources) expect(text.includes(word), `${file} contains ${word}`).toBe(false);
    });
  }

  it('no file reaches for the page or the browser around it', () => {
    for (const [file, text] of sources) expect(/\b(?:document|window|navigator|location|globalThis|self)\./.exec(text)?.[0], file).toBeUndefined();
  });

  it('nothing depends on chance or on the clock, but for new ids', () => {
    for (const [file, text] of sources) {
      expect(text.includes('Math.random'), file).toBe(false);
      expect(/\bDate\b|performance\.|setTimeout|setInterval/.test(text), file).toBe(false);
      // Ids come from the computer's own source of randomness, in edit.ts and nowhere else.
      expect(text.includes('crypto.'), file).toBe(file === 'edit.ts');
    }
    expect(sources.get('edit.ts')).toContain('crypto.getRandomValues');
  });

  it('takes code only from its own folder and from the zip reader the site already has', () => {
    for (const [file, text] of sources) {
      const from = [...text.matchAll(/\bfrom\s+'([^']+)'/g)].map((found) => found[1] ?? '');
      for (const path of from) {
        const allowed = /^\.\/[a-z]+$/.test(path) || (file === 'workbook.ts' && path === '../../cleaner-copy/engine/zip.js');
        expect(allowed, `${file} imports ${path}`).toBe(true);
      }
      expect(/\brequire\(/.test(text), file).toBe(false);
    }
  });

  it('names no address but the ones the workbook format gives its own parts', () => {
    for (const [file, text] of sources) {
      const addresses = text.match(/\b[a-z]+:\/\/[^\s'"`<]+/g) ?? [];
      if (file !== 'workbook.ts') expect(addresses, file).toEqual([]);
      for (const address of addresses) expect(address.startsWith('http://schemas.openxmlformats.org/'), `${file}: ${address}`).toBe(true);
    }
  });

  it('holds no colour value outside the workbook writer: a schedule only ever names a swatch', () => {
    for (const [file, text] of sources) {
      if (file === 'workbook.ts') continue;
      expect(/#[0-9a-fA-F]{6}\b|\brgba?\(|\bhsla?\(/.test(text), file).toBe(false);
    }
    expect(sources.get('workbook.ts')).toContain('SWATCHES');
  });

  it('uses no word the site does not allow, and no dash as punctuation, anywhere in the engine', () => {
    for (const [file, text] of sources) {
      expect(/\b(?:highest|lowest|worst|best)\b|\btop\s/i.exec(text)?.[0], file).toBeUndefined();
      expect(/[—–]/.test(text), file).toBe(false);
      // In words kept in quotes, a hyphen with a space each side would be a dash.
      for (const found of text.matchAll(/'(?:[^'\\\n]|\\.)*'/g)) expect(found[0].includes(' - '), `${file}: ${found[0].slice(0, 80)}`).toBe(false);
    }
  });

  it('gives the page everything through index.ts', () => {
    const names = Object.keys(engine);
    for (const name of [
      'ALL_DAYS', 'ALL_COLOURS', 'COLOUR_NAMES', 'LIMITS',
      'clock', 'clockRange', 'lengthText', 'hoursOf', 'hoursText', 'gridLines', 'onGrid', 'snapDown', 'snapUp', 'snapNear', 'snapRange', 'dayName', 'dayShort',
      'personOf', 'departmentOf', 'visitTypeOf', 'activityOf', 'siteOf', 'roomOf', 'blocksOn', 'blocksOf', 'factsOf', 'whereText', 'whereShort',
      'newId', 'newSchedule', 'fromSetup', 'paint', 'erase', 'setPlace', 'copyDay', 'clearDay', 'setStep', 'setDetails', 'setHours', 'setDays',
      'addSite', 'renameSite', 'removeSite', 'addRoom', 'renameRoom', 'removeRoom',
      'addDepartment', 'renameDepartment', 'setDepartmentStep', 'removeDepartment', 'addVisitType', 'setVisitType', 'removeVisitType',
      'addActivity', 'setActivity', 'removeActivity', 'addPerson', 'setPerson', 'setAsideHours', 'removeSetAside', 'removePerson', 'duplicatePerson',
      'careTarget', 'tallyPerson', 'tallyClinic',
      'personColour', 'initialsOf',
      'hasWork', 'workOn', 'isDayOff', 'workMinutesOn', 'workMinutes', 'insideWork', 'outsideWork', 'offHours', 'blocksOutsideWork', 'openSpans', 'unpaidInsideWork', 'workText',
      'dayExtent', 'weekExtent', 'workOutsideHours', 'setWork', 'copyWork', 'clearWork', 'spansLess', 'spansInside', 'spanMinutes',
      'TEAM_GAP', 'providersIn', 'supportStaffIn', 'supportFor', 'patientTime', 'patientStretches', 'teamOf', 'teamHours', 'coverage', 'planWith', 'fillWith',
      'addWorksWith', 'removeWorksWith', 'kindChange', 'setKind',
      'roomUse', 'roomsFree', 'freeRooms', 'roomHours', 'allClashes',
      'overview', 'check', 'VERSION', 'validate', 'sampleSchedule', 'toWorkbook', 'fromWorkbook',
    ]) {
      expect(names, name).toContain(name);
      expect(typeof (engine as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
  });
});
