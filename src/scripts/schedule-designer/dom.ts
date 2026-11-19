// Small helpers for building the page: making elements, finding them, and writing numbers as words.
// Nothing here keeps anything in the browser or opens a connection. Every element is made with createElement,
// and positions are set through element.style, which the site's policy allows.
import { lengthText } from './engine/index';
import type { Colour } from './engine/index';

export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | boolean | undefined>;

/** Makes an element with its attributes and children. A false or missing attribute is left out. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

/** One of the page's own icons, by the last part of its id in the sprite. */
export function icon(name: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#sd-i-${name}`);
  svg.append(use);
  return svg;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

/** Empties an element and puts these children in it. */
export function fill(node: Element, ...children: Child[]): void {
  node.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
}

export const num = (n: number): string => n.toLocaleString('en-US');
export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** A length of time for a tally or a sentence, in hours and minutes: "8 h", "26 h 20 min". */
export const hrs = (minutes: number): string => lengthText(minutes);

/** A length for a narrow table cell: the number stays with its unit, so a break can only fall between the hours and the minutes. */
export const tight = (say: string): string => say.replace(/(\d) (?=(?:h|min)\b)/g, '$1\u00a0');

/** A small round dot in a swatch colour. */
export function dot(colour: Colour, extra = ''): HTMLSpanElement {
  return el('span', { class: `sd-dot sd-sw-${colour}${extra ? ` ${extra}` : ''}`, 'aria-hidden': 'true' });
}

/** A button with an icon and a name read by a screen reader. */
export function iconButton(name: string, label: string, attrs: Attrs = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: 'sd-icon-btn', 'aria-label': label, title: label, 'data-k': `ib:${label}`, ...attrs }, icon(name));
}

/**
 * A row of choices where one is on, like "15 min / 20 min". Each choice is a button with
 * aria-pressed, so a keyboard and a screen reader both work with no extra code.
 */
export function segmented<T extends string | number>(label: string, options: readonly { value: T; say: string }[], current: T, choose: (value: T) => void, extra = ''): HTMLElement {
  const group = el('div', { class: `sd-seg${extra ? ` ${extra}` : ''}`, role: 'group', 'aria-label': label });
  for (const option of options) {
    const button = el('button', { type: 'button', class: 'sd-seg-btn', 'data-k': `seg:${label}:${option.value}`, 'aria-pressed': option.value === current ? 'true' : 'false' }, option.say);
    button.addEventListener('click', () => {
      if (option.value !== current) choose(option.value);
    });
    group.append(button);
  }
  return group;
}

/**
 * Draws part of the page again and puts the keyboard back where it was. A control says which one
 * it is with `data-k`, so the new copy of it can be found after the old one is gone.
 */
export function keepFocus(root: Element, render: () => void): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && root.contains(active) ? active.dataset['k'] : undefined;
  render();
  if (key === undefined) return;
  const again = root.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`);
  if (!again) return;
  // A button that has just been switched off cannot hold the keyboard, so its neighbour takes it.
  const target = again.hasAttribute('disabled') ? neighbour(again) : again;
  target?.focus({ preventScroll: true });
}

/** The nearest button beside this one that still works: the one after it first, then the one before. */
function neighbour(node: HTMLElement): HTMLElement | null {
  for (let next = node.nextElementSibling; next; next = next.nextElementSibling) if (next instanceof HTMLButtonElement && !next.disabled) return next;
  for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) if (prev instanceof HTMLButtonElement && !prev.disabled) return prev;
  return null;
}

/** The text of the polite live region. Setting the same words twice still gets read. */
export function announce(text: string): void {
  const live = byId('sd-live');
  live.textContent = '';
  window.requestAnimationFrame(() => {
    live.textContent = text;
  });
}

/**
 * How the person points at the page: 'touch' when a finger is the main way, 'both' when there is
 * a mouse and a touch screen, and 'mouse' otherwise. The painting hint is worded to match.
 */
export function pointing(): 'touch' | 'both' | 'mouse' {
  if (window.matchMedia('(pointer: coarse)').matches) return 'touch';
  return window.matchMedia('(any-pointer: coarse)').matches ? 'both' : 'mouse';
}

/** True when the person has asked their computer for less motion. */
export function calm(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A file name made from a schedule's name: "Spring template" gives "spring-template". */
export function fileNameOf(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'schedule';
}
