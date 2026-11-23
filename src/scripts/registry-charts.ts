/**
 * The hover layer for the registry history charts (src/pages/registry/index.astro).
 * Progressive enhancement only: every figure is already in the page, in the charts and in their
 * tables. This adds a crosshair, a dot on each line and a small readout that follows the pointer
 * or the arrow keys, and the switch between the two flow maps.
 *
 * No styles are written from here: positions are SVG attributes and everything else is a class,
 * so the page's content security policy needs no exception.
 */

export {};

const SVG = 'http://www.w3.org/2000/svg';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface ChartData {
  months: string[];
  stacked: boolean;
  percent: boolean;
  series: { label: string; slot: number; values: number[] }[];
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const month = (m: string): string => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function wire(svg: SVGSVGElement, d: ChartData): void {
  const n = d.months.length;
  const num = (k: string): number => Number(svg.dataset[k]);
  const l = num('l');
  const pw = num('pw');
  const t = num('t');
  const ph = num('ph');
  const top = num('top');
  const w = num('w');
  const wide = svg.classList.contains('rx-wide');
  const fs = wide ? 13 : 11;
  const hoverEl = svg.querySelector<SVGGElement>('.rx-hover');
  const hit = svg.querySelector<SVGRectElement>('.rx-hit');
  if (!hoverEl || !hit) return;
  const hover: SVGGElement = hoverEl;
  const cross = hover.querySelector<SVGLineElement>('.rx-cross')!;
  const dots = [...hover.querySelectorAll<SVGCircleElement>('.rx-hdot')];

  // The readout: a card drawn in the SVG itself.
  const tip = el('g', { class: 'rx-tipcard' });
  const rows = d.series.length + 1;
  const cardW = wide ? 220 : 170;
  const lh = fs + 7;
  const cardH = rows * lh + 12;
  const bg = el('rect', { class: 'rx-tipbg', width: cardW, height: cardH, rx: 8 });
  tip.append(bg);
  const head = el('text', { class: 'rx-tiphead', x: 12, y: lh, 'font-size': fs });
  tip.append(head);
  const lines = d.series.map((s, i) => {
    const y = lh * (i + 2);
    tip.append(el('rect', { class: `rx-tipkey s${s.slot}`, x: 12, y: y - fs + 2, width: 10, height: 10, rx: 2 }));
    const label = el('text', { class: 'rx-tiplabel', x: 28, y, 'font-size': fs });
    label.textContent = s.label;
    const value = el('text', { class: 'rx-tipvalue', x: cardW - 12, y, 'font-size': fs, 'text-anchor': 'end' });
    tip.append(label, value);
    return value;
  });
  hover.append(tip);

  let last = -1;
  function show(i: number): void {
    if (i === last) return;
    last = i;
    const x = l + (i / (n - 1)) * pw;
    cross.setAttribute('x1', x.toFixed(1));
    cross.setAttribute('x2', x.toFixed(1));
    let run = 0;
    const total = d.series.reduce((a, s) => a + (s.values[i] ?? 0), 0);
    d.series.forEach((s, si) => {
      const v = s.values[i] ?? 0;
      run += v;
      const yv = d.stacked ? run : v;
      const y = t + ph - (yv / top) * ph;
      dots[si]?.setAttribute('cx', x.toFixed(1));
      dots[si]?.setAttribute('cy', y.toFixed(1));
      lines[si]!.textContent = d.percent ? `${(v * 100).toFixed(d.stacked || v >= 0.1 ? 0 : 1)}%` : v % 1 ? v.toFixed(1) : fmt(v);
    });
    head.textContent = month(d.months[i]!) + (d.stacked && !d.percent ? `, ${fmt(total)} in all` : '');
    const left = x + 14 + cardW > w ? x - 14 - cardW : x + 14;
    tip.setAttribute('transform', `translate(${left.toFixed(1)},${t + 4})`);
    hover.removeAttribute('hidden');
  }
  function hide(): void {
    hover.setAttribute('hidden', '');
    last = -1;
  }
  function at(evt: PointerEvent): void {
    const box = svg.getBoundingClientRect();
    const sx = ((evt.clientX - box.left) / box.width) * w;
    const i = Math.round(((sx - l) / pw) * (n - 1));
    show(Math.max(0, Math.min(n - 1, i)));
  }
  hit.addEventListener('pointermove', at);
  hit.addEventListener('pointerdown', at);
  hit.addEventListener('pointerleave', hide);

  // Keys: the chart takes focus, and the arrows step a month (with Shift, a year).
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 12 : 1;
    let i = last < 0 ? n - 1 : last;
    if (e.key === 'ArrowLeft') i -= step;
    else if (e.key === 'ArrowRight') i += step;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if (e.key === 'Escape') return hide();
    else return;
    e.preventDefault();
    last = -2;
    show(Math.max(0, Math.min(n - 1, i)));
  });
  svg.addEventListener('blur', hide);
}

for (const fig of document.querySelectorAll<HTMLElement>('[data-chart]')) {
  const json = fig.dataset.chartJson;
  if (!json) continue;
  const d = JSON.parse(json) as ChartData;
  for (const svg of fig.querySelectorAll<SVGSVGElement>('svg.rx-svg')) wire(svg, d);
}

// The two flow maps: side by side on a wide screen; on a narrow one, a switch shows one at a time.
const maps = document.querySelector<HTMLElement>('[data-maps]');
const sw = maps?.querySelector<HTMLElement>('[data-map-switch]');
if (maps && sw) {
  maps.classList.add('rx-maps-js');
  sw.removeAttribute('hidden');
  const buttons = [...sw.querySelectorAll<HTMLButtonElement>('button[data-map]')];
  const pick = (which: string): void => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.map === which));
    for (const p of maps.querySelectorAll<HTMLElement>('[data-map-panel]')) p.classList.toggle('rx-map-off', p.dataset.mapPanel !== which);
  };
  for (const b of buttons) b.addEventListener('click', () => pick(b.dataset.map!));
  pick('now');
}
