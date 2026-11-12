/**
 * Getting around a long page. Progressive enhancement only: without this file the contents list near the
 * top of a page is plain links and the footer carries a link back to the start of the page.
 *
 * - `[data-to-top]` (every page): a button at the bottom corner, shown once the reader is well down the page.
 * - `[data-page-bar]` (pages with a contents list, see OnPage.astro): a slim bar fixed to the top of the
 *   window, shown once the contents list has scrolled away. It names the part being read and opens a menu
 *   of all parts.
 *
 * No styles are written from here: everything is a class or an attribute, so the page's content security
 * policy needs no exception.
 */

export {};

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

function goToStart(): void {
  window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
  if (location.hash !== '') history.replaceState(null, '', location.pathname + location.search);
}

const toTop = document.querySelector<HTMLAnchorElement>('[data-to-top]');
const list = document.querySelector<HTMLElement>('[data-onpage]');
const bar = document.querySelector<HTMLElement>('[data-page-bar]');
const now = bar?.querySelector<HTMLButtonElement>('[data-page-bar-now]') ?? null;
const menu = bar?.querySelector<HTMLElement>('[data-page-bar-list]') ?? null;
const nameEl = bar?.querySelector<HTMLElement>('[data-page-bar-name]') ?? null;
const stepEl = bar?.querySelector<HTMLElement>('[data-page-bar-step]') ?? null;

interface Part {
  link: HTMLAnchorElement;
  target: HTMLElement;
  label: string;
}

const parts: Part[] = [];
if (menu) {
  for (const link of menu.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) parts.push({ link, target, label: link.textContent?.trim() ?? '' });
  }
}

const barReady = Boolean(list && bar && now && menu && nameEl && stepEl && parts.length > 1);
const idleName = nameEl?.textContent ?? '';
let current = -2;
let barOn = false;

function setMenu(open: boolean): void {
  if (!now || !menu) return;
  menu.hidden = !open;
  now.setAttribute('aria-expanded', String(open));
}

function setBar(on: boolean): void {
  if (!bar || on === barOn) return;
  barOn = on;
  bar.classList.toggle('is-on', on);
  bar.inert = !on;
  if (!on) setMenu(false);
}

function setCurrent(index: number): void {
  if (index === current || !nameEl || !stepEl) return;
  current = index;
  parts.forEach((part, i) => {
    if (i === index) part.link.setAttribute('aria-current', 'location');
    else part.link.removeAttribute('aria-current');
  });
  const part = parts[index];
  nameEl.textContent = part ? part.label : idleName;
  stepEl.textContent = part ? `${index + 1} of ${parts.length}` : '';
}

function measure(): void {
  if (toTop) toTop.classList.toggle('is-on', window.scrollY > window.innerHeight * 1.25);
  if (!barReady || !list || !bar) return;

  setBar(list.getBoundingClientRect().bottom < 0);

  // The part being read: the last one whose heading has passed under the bar.
  const line = bar.offsetHeight + 40;
  let index = -1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part && part.target.getBoundingClientRect().top <= line) index = i;
    else break;
  }
  if (window.innerHeight + window.scrollY >= root.scrollHeight - 2) index = parts.length - 1;
  setCurrent(index);
}

let queued = false;
function queue(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    measure();
  });
}

if (toTop) {
  toTop.hidden = false;
  // The button does the footer link's job: one way back is enough on screen.
  const footLink = document.querySelector<HTMLElement>('.foot-top');
  if (footLink) footLink.hidden = true;
  toTop.addEventListener('click', (event) => {
    event.preventDefault();
    goToStart();
    document.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });
  });
}

if (barReady && bar && now && menu) {
  // Fixed to the window: it belongs to the page, not to the header it was written in.
  document.body.append(bar);
  bar.inert = true;
  bar.hidden = false;
  root.classList.add('has-page-bar');

  now.addEventListener('click', () => setMenu(menu.hidden !== false));
  menu.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setMenu(false);
  });
  bar.querySelector<HTMLAnchorElement>('[data-page-bar-top]')?.addEventListener('click', (event) => {
    event.preventDefault();
    goToStart();
    document.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.hidden === false) {
      setMenu(false);
      now.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (menu.hidden === false && event.target instanceof Node && !menu.contains(event.target) && !now.contains(event.target)) setMenu(false);
  });
}

if (toTop || barReady) {
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  window.addEventListener('pageshow', queue);
  measure();
}
