// The line that counts the requests the page has made since it finished loading. The words and
// the counting are tested here with no page in hand. The scan at the end holds the wiring: the
// page has the line, the main script starts the count, and the count reads the browser's record.
import { describe, expect, it } from 'vitest';
import { requestsSince, wireSay } from '../../src/scripts/schedule-designer/wire';
import page from '../../src/pages/tools/schedule-designer/index.astro?raw';
import main from '../../src/scripts/schedule-designer/main.ts?raw';
import wire from '../../src/scripts/schedule-designer/wire.ts?raw';
import fileCheck from '../../src/scripts/file-check/main.ts?raw';
import cleanerCopy from '../../src/scripts/cleaner-copy/main.ts?raw';

describe('Schedule Designer: the count of requests', () => {
  it('keeps the first words until the page has loaded', () => {
    expect(wireSay(null)).toBe('No connection can be opened from this page');
  });

  it('then says the count, in the words the other tools use', () => {
    expect(wireSay(0)).toBe('0 requests since this page loaded');
    expect(wireSay(1)).toBe('1 request since this page loaded');
    expect(wireSay(12)).toBe('12 requests since this page loaded');
  });

  it('counts a record that began at or after the end of loading, and no earlier one', () => {
    const records = [{ startTime: 10 }, { startTime: 250 }, { startTime: 250.5 }, { startTime: 900 }];
    expect(requestsSince(records, 250)).toBe(3);
    expect(requestsSince(records, 251)).toBe(1);
    expect(requestsSince(records, 0)).toBe(4);
    expect(requestsSince([], 0)).toBe(0);
  });

  it('counts nothing while the page is still loading', () => {
    expect(requestsSince([{ startTime: 10 }, { startTime: 5000 }], Infinity)).toBe(0);
  });

  it('leaves out the icon of the tab, which the browser fetches for itself, and nothing else', () => {
    const icon = 'https://clinx.org/favicon.svg';
    const records = [
      { startTime: 300, name: icon },
      { startTime: 400, name: 'https://clinx.org/favicon.svg?x=1' },
      { startTime: 500, name: 'https://example.org/favicon.svg' },
      { startTime: 600 },
    ];
    expect(requestsSince(records, 250, [icon])).toBe(3);
    expect(requestsSince(records, 250)).toBe(4);
    expect(requestsSince([{ startTime: 300, name: icon }], 250, [icon])).toBe(0);
    // The page reads the icons from its own head, and from nowhere else.
    expect(wire).toContain(`document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')`);
  });

  it('the first words are the same on all three tools, and so is the shape of the count', () => {
    const first = "'No connection can be opened from this page'";
    for (const text of [wire, fileCheck, cleanerCopy]) expect(text.includes(first)).toBe(true);
    expect(fileCheck).toContain("${plural(requestsSince, 'request')} since you chose a file");
    expect(cleanerCopy).toContain("${plural(requestsSince, 'request')} since you chose a file");
    expect(wire).toContain("${plural(count, 'request')} since this page loaded");
  });

  it('the page has the line, and the main script starts the count', () => {
    expect(page).toContain('<div id="sd-wire" class="cc-wire sd-wire">');
    expect(page).toContain('<span id="sd-wire-say">No connection can be opened from this page</span>');
    expect(page.split('No connection can be opened from this page').length - 1).toBe(1);
    expect(main).toContain("import { watchRequests } from './wire';");
    expect(main.split('watchRequests()').length - 1).toBe(1);
  });

  it('the count reads the record of what the page loaded, the way the other tools do', () => {
    const observe = "observe({ type: 'resource', buffered: true })";
    for (const text of [wire, fileCheck, cleanerCopy]) expect(text.includes(observe)).toBe(true);
    // The line turns to the count only when the browser keeps that record.
    expect(wire).toContain("if (typeof PerformanceObserver !== 'function') return;");
  });
});
