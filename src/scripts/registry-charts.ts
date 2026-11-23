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
  /** Stacked bands under the total, oldest first (the opening chart). */
  layers?: { label: string; values: number[] }[];
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
  const layers = d.layers ?? [];
  const polys = [...svg.querySelectorAll<SVGPolygonElement>('.rx-layer')];
  const rows = d.series.length + 1 + (layers.length ? 1 : 0);
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
  // With bands: one more row, naming the band under the pointer.
  const bandLabel = el('text', { class: 'rx-tiplabel', x: 12, y: lh * (d.series.length + 2), 'font-size': fs });
  const bandValue = el('text', { class: 'rx-tipvalue', x: cardW - 12, y: lh * (d.series.length + 2), 'font-size': fs, 'text-anchor': 'end' });
  if (layers.length) tip.append(bandLabel, bandValue);
  hover.append(tip);
  let hot = -1;
  function band(i: number, v: number | null): void {
    let j = -1;
    if (v !== null && v >= 0) {
      let run = 0;
      for (let k = 0; k < layers.length; k++) {
        run += layers[k]!.values[i] ?? 0;
        if (v <= run) {
          j = k;
          break;
        }
      }
    }
    if (j !== hot) {
      polys[hot]?.classList.remove('is-hot');
      polys[j]?.classList.add('is-hot');
      svg.classList.toggle('rx-layers-hot', j >= 0);
      hot = j;
    }
    const lab = j >= 0 ? layers[j]!.label : '';
    const val = j >= 0 ? (layers[j]!.values[i] ?? 0) : 0;
    bandLabel.textContent = lab.charAt(0).toUpperCase() + lab.slice(1);
    bandValue.textContent = j < 0 ? '' : d.percent ? `${(val * 100).toFixed(val < 0.1 ? 1 : 0)}%` : fmt(val);
  }

  let last = -1;
  function show(i: number, v: number | null = null): void {
    if (layers.length) band(i, v);
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
    if (layers.length) band(0, null);
  }
  function at(evt: PointerEvent): void {
    const box = svg.getBoundingClientRect();
    const sx = ((evt.clientX - box.left) / box.width) * w;
    const sy = ((evt.clientY - box.top) / box.height) * num('h');
    const i = Math.round(((sx - l) / pw) * (n - 1));
    show(Math.max(0, Math.min(n - 1, i)), ((t + ph - sy) / ph) * top);
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

// The time-lapse: the left map and the earlier bars follow a year slider, or play from 2010.
interface Lapse {
  months: string[];
  bands: number[];
  share: Record<string, (number | null)[]>;
  inbound: Record<string, number[]>;
}
const cmp = document.querySelector<HTMLElement>('[data-compare]');
const controls = cmp?.querySelector<HTMLElement>('[data-lapse-controls]');
const range = cmp?.querySelector<HTMLInputElement>('[data-year-range]');
if (cmp && controls && range && cmp.dataset.lapse) {
  const L = JSON.parse(cmp.dataset.lapse) as Lapse;
  const panel = cmp.querySelector<HTMLElement>('[data-map-panel="then"]')!;
  const yearEl = cmp.querySelector<HTMLElement>('[data-then-year]')!;
  const labelEl = cmp.querySelector<HTMLElement>('[data-then-label]');
  const note = cmp.querySelector<HTMLElement>('[data-lapse-note]')!;
  const play = cmp.querySelector<HTMLButtonElement>('[data-play]')!;
  const playLabel = play.querySelector<HTMLElement>('[data-play-label]')!;
  const tiles = new Map<string, SVGGElement>();
  for (const g of panel.querySelectorAll<SVGGElement>('.sh-tile[data-code]')) tiles.set(g.dataset.code!, g);
  const nowMax = Math.max(1, ...[...cmp.querySelectorAll<HTMLElement>('.rx-pbar-values strong')].map((e) => Number(e.textContent!.replace(/,/g, ''))));
  const last = L.months.length - 1;
  range.max = String(last);
  const start = Math.max(0, L.months.indexOf('2017-01'));
  range.value = String(start);
  controls.removeAttribute('hidden');
  cmp.classList.add('rx-lapse-on');

  const show = (i: number): void => {
    const m = L.months[i]!;
    yearEl.textContent = m.slice(0, 4);
    if (labelEl) labelEl.textContent = `Jan ${m.slice(0, 4)}`;
    range.setAttribute('aria-valuetext', `January ${m.slice(0, 4)}`);
    note.textContent = m < '2017-01' ? 'Before 2017 the registry no longer lists every ended arrangement: shares are a lower bound.' : '';
    for (const [code, g] of tiles) {
      const v = L.share[code]?.[i] ?? null;
      const band = v === null ? 'few' : `b${L.bands.filter((t) => v >= t).length}`;
      g.setAttribute('class', `sh-tile ${band}`);
      const sub = g.querySelector('[data-sub]');
      if (sub) sub.textContent = v === null ? '' : `${Math.round(v * 100)}%`;
    }
    for (const [code, vals] of Object.entries(L.inbound)) {
      const v = vals[i] ?? 0;
      const bar = cmp.querySelector<HTMLElement>(`[data-then-bar="${code}"]`);
      const val = cmp.querySelector<HTMLElement>(`[data-then-value="${code}"]`);
      if (bar) bar.className = `rx-pbar-fill then w${v > 0 ? Math.max(1, Math.round((v / nowMax) * 100)) : 0}`;
      if (val) val.textContent = fmt(v);
    }
  };
  show(start);
  range.addEventListener('input', () => {
    stop();
    show(Number(range.value));
  });

  let timer = 0;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stop(): void {
    if (!timer) return;
    window.clearInterval(timer);
    timer = 0;
    play.classList.remove('is-playing');
    playLabel.textContent = 'Play';
  }
  play.addEventListener('click', () => {
    if (timer) return stop();
    let i = Number(range.value) >= last ? 0 : Number(range.value);
    if (i === start) i = 0;
    range.value = String(i);
    show(i);
    play.classList.add('is-playing');
    playLabel.textContent = 'Pause';
    timer = window.setInterval(() => {
      i += 1;
      range.value = String(i);
      show(i);
      if (i >= last) stop();
    }, still ? 1400 : 750);
  });
}
