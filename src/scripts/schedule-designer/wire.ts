// The line under the steps that counts the requests this page has made. The other ClinX tools
// count from the moment a file is chosen. This tool starts with no file, so it counts from the
// moment the page finished loading. Until then the line keeps its first words.
//
// The count comes from the browser's own record of what the page has asked for. Reading that
// record opens nothing. The same code runs in the copy of the tool that is opened from a disk.
//
// One request is left out, and only that one. A browser fetches the icon of the tab for itself,
// a moment after the page has loaded. It is part of opening the page, so it is not counted as
// something the page did while it worked. Every other request is counted.
import { byId, plural } from './dom';

/** The words of the line: the promise until the page has loaded, then the count. */
export function wireSay(count: number | null): string {
  return count === null ? 'No connection can be opened from this page' : `${plural(count, 'request')} since this page loaded`;
}

/**
 * How many of these records began at or after the mark. While the mark is not set, none do.
 * A record whose address is one of the tab's own icons is not counted.
 */
export function requestsSince(entries: readonly { startTime: number; name?: string }[], mark: number, icons: readonly string[] = []): number {
  let count = 0;
  for (const entry of entries) if (entry.startTime >= mark && !(entry.name !== undefined && icons.includes(entry.name))) count++;
  return count;
}

let loadedAt = Infinity;
let requests = 0;
let watching = false;

function showWire(): void {
  const wire = byId('sd-wire');
  const counting = watching && loadedAt !== Infinity;
  byId('sd-wire-say').textContent = wireSay(counting ? requests : null);
  wire.classList.toggle('is-counting', counting);
  wire.classList.toggle('is-warn', counting && requests > 0);
}

/** Starts the count. A browser without this record still runs the tool, and the line keeps its first words. */
export function watchRequests(): void {
  if (typeof PerformanceObserver !== 'function') return;
  // The whole address of each icon the page names for its tab.
  const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((link) => link.href);
  try {
    new PerformanceObserver((list) => {
      requests += requestsSince(list.getEntries(), loadedAt, icons);
      showWire();
    }).observe({ type: 'resource', buffered: true });
    watching = true;
  } catch {
    return;
  }
  const loaded = (): void => {
    loadedAt = performance.now();
    showWire();
  };
  if (document.readyState === 'complete') loaded();
  else window.addEventListener('load', loaded, { once: true });
}
