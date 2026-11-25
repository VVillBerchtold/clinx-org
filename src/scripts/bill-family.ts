/**
 * The pointer and scroll layer for the bill family tree (src/pages/bills/family/index.astro).
 * Progressive enhancement only: the map and the trees are drawn at build time and every link with its shared
 * words is printed in the list in part 3. This winds the map back to any month (a scrubber, a Play button
 * and the story cards as they pass), fills the readout cards, and folds the tree's branches, laid out again
 * by the same d3-hierarchy layout the page was built with. It writes text, attributes and classes, and
 * moves things with the Web Animations API, so the content security policy needs no exception.
 */
import { layFamily, type LayoutKind, type LayoutRow } from '../lib/family-layout';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string): string => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(0, 4)}`;
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

// ---------- 1. The map, month by month ----------
interface Text {
  id: string;
  name: string;
  year: string;
  month: string;
  status: string;
  law: boolean;
  href: string;
  parent: string;
  across: boolean;
  kind: string;
  shared: string;
  longest: string;
  passage: [string, string, string];
}
interface Card {
  code: string;
  name: string;
  first: string;
  law: string;
  texts: Text[];
}

for (const box of document.querySelectorAll<HTMLElement>('[data-fm]')) {
  let F: { months: string[]; cards: Record<string, Card> };
  try {
    F = JSON.parse(box.dataset['fmJson'] ?? '') as typeof F;
  } catch {
    continue;
  }
  const svg = box.querySelector<SVGSVGElement>('svg.fm');
  const controls = box.querySelector<HTMLElement>('[data-lapse-controls]');
  const range = box.querySelector<HTMLInputElement>('[data-year-range]');
  const play = box.querySelector<HTMLButtonElement>('[data-play]');
  const card = box.querySelector<HTMLElement>('[data-fm-card]');
  if (!svg || !controls || !range || !play || !card) continue;
  const playLabel = play.querySelector<HTMLElement>('[data-play-label]')!;
  const when = box.querySelector<HTMLElement>('[data-fm-when]')!;
  const count = box.querySelector<HTMLElement>('[data-fm-count]')!;
  const arcs = [...svg.querySelectorAll<SVGElement>('.fm-arc, .fm-end')];
  const tiles = new Map<string, SVGElement>();
  for (const code of Object.keys(F.cards)) {
    const t = svg.querySelector<SVGElement>(`.t-${code.toLowerCase()}`);
    if (t) tiles.set(code, t);
  }
  const last = F.months.length - 1;
  range.max = String(last);
  range.value = String(last);
  controls.hidden = false;
  box.classList.add('fm-on');
  let at = last;
  let focus: Set<string> | null = null;

  const show = (i: number, animate = true): void => {
    at = i;
    const m = F.months[i]!;
    when.textContent = i === last ? 'Today' : monthName(m);
    range.setAttribute('aria-valuetext', monthName(m));
    let texts = 0;
    let states = 0;
    let laws = 0;
    for (const [code, c] of Object.entries(F.cards)) {
      const t = tiles.get(code);
      const tone = c.law && c.law <= m ? 'has' : c.first <= m ? 'next' : 'none';
      if (tone !== 'none') states += 1;
      if (tone === 'has') laws += 1;
      texts += c.texts.filter((x) => x.month <= m).length;
      if (!t) continue;
      t.classList.remove('has', 'next', 'none');
      t.classList.add(tone);
    }
    count.textContent = `${texts} ${texts === 1 ? 'text' : 'texts'}, ${states} ${states === 1 ? 'state' : 'states'}, ${laws} with a law`;
    for (const a of arcs) {
      const on = (a.dataset['when'] ?? '') <= m;
      const was = !a.classList.contains('later');
      a.classList.toggle('later', !on);
      a.classList.toggle('hot', Boolean(focus?.has(a.dataset['from'] ?? '')));
      // An arc that has just been filed draws itself from its parent's state to its own.
      if (on && !was && animate && !still && a.classList.contains('fm-arc')) {
        a.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, easing: 'ease-out' });
      }
    }
    svg.classList.toggle('focusing', Boolean(focus));
  };

  // The scrubber and Play, as on the registry page.
  let timer = 0;
  const stop = (): void => {
    if (!timer) return;
    window.clearInterval(timer);
    timer = 0;
    play.classList.remove('is-playing');
    playLabel.textContent = 'Play';
  };
  range.addEventListener('input', () => {
    stop();
    focus = null;
    show(Number(range.value));
  });
  play.addEventListener('click', () => {
    if (timer) return stop();
    focus = null;
    let i = at >= last ? 0 : at;
    range.value = String(i);
    show(i, false);
    play.classList.add('is-playing');
    playLabel.textContent = 'Pause';
    timer = window.setInterval(
      () => {
        i += 1;
        range.value = String(i);
        show(i);
        if (i >= last) stop();
      },
      still ? 1100 : 420,
    );
  });

  // The story: the card at the middle of the space under the pinned map sets the month.
  const pin = box.querySelector<HTMLElement>('.rx-story-pin')!;
  const steps = [...box.querySelectorAll<HTMLElement>('.rx-story-step')];
  box.classList.add('rx-story-on');
  let cur: HTMLElement | undefined;
  let queued = false;
  const pick = (): void => {
    queued = false;
    const b = box.getBoundingClientRect();
    if (b.bottom < 0 || b.top > window.innerHeight) return;
    // On a wide screen the cards run beside the map; on a phone they pass under it.
    const beside = steps[0] && steps[0].getBoundingClientRect().left > pin.getBoundingClientRect().left + 40;
    const under = beside ? 0 : Math.max(0, pin.getBoundingClientRect().bottom);
    const lineY = under + (window.innerHeight - under) / 2;
    let on = steps[0]!;
    for (const s of steps) if (s.getBoundingClientRect().top <= lineY) on = s;
    if (on === cur) return;
    cur = on;
    for (const s of steps) s.classList.toggle('is-on', s === on);
    const i = F.months.indexOf(on.dataset['month'] ?? '');
    if (i < 0) return;
    stop();
    focus = on.dataset['focus'] ? new Set(on.dataset['focus'].split(' ')) : null;
    range.value = String(i);
    show(i);
  };
  const ask = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(pick);
    }
  };
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', ask, { passive: true });
  show(last, false);
  pick();
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('fm-ready')));

  // The readout card: a state's texts, each with the earlier text it sits under and the passage they share.
  const kicker = card.querySelector<HTMLElement>('[data-fm-kicker]')!;
  const name = card.querySelector<HTMLElement>('[data-fm-name]')!;
  const list = card.querySelector<HTMLElement>('[data-fm-texts]')!;
  let pinned: string | null = null;
  const fill = (code: string | null): void => {
    const c = code ? F.cards[code] : undefined;
    for (const [k, t] of tiles) t.classList.toggle('pick', k === code);
    svg.classList.toggle('picking', Boolean(c));
    for (const a of arcs) a.classList.toggle('lit', Boolean(code && (a.dataset['states'] ?? '').split(' ').includes(code)));
    card.hidden = !c;
    if (!c) return;
    // The card sits over the side of the map away from the state, so the state stays in view.
    card.classList.toggle('on-left', Number(tiles.get(c.code)?.querySelector('.tile')?.getAttribute('x') ?? 0) > 280);
    const laws = c.texts.filter((t) => t.law).length;
    kicker.textContent = `${c.texts.length} ${c.texts.length === 1 ? 'text' : 'texts'}${laws ? ` · ${laws} law` : ''} · first ${monthName(c.first)}`;
    name.textContent = c.name;
    list.replaceChildren(
      ...c.texts.map((t) => {
        const li = el('li', t.law ? 'law' : '');
        const head = el('p', 'bf-s-head');
        const a = el('a', '', t.name);
        a.href = t.href;
        head.append(a, el('span', 'bf-s-meta', ` ${t.year} · ${t.status}`));
        li.append(head);
        if (t.parent) {
          li.append(el('p', 'bf-s-with', `Under ${t.parent}: ${t.shared} words shared, longest run ${t.longest}${t.across ? '' : ' (same state)'}`));
          const q = el('blockquote', 'bf-c-quote');
          const [pre, mark, post] = t.passage;
          q.append(document.createTextNode(`…${pre} `));
          if (mark) q.append(el('mark', '', mark));
          q.append(document.createTextNode(` ${post}…`));
          li.append(q);
        } else {
          li.append(el('p', 'bf-s-with', 'The earliest text in this family.'));
        }
        return li;
      }),
    );
  };
  for (const [code, t] of tiles) {
    t.addEventListener('pointerenter', () => {
      if (!pinned) fill(code);
    });
    t.addEventListener('focus', () => fill(code));
    t.addEventListener('click', (ev) => {
      // A click pins the card; a second click on the same state follows its link to the list.
      if (pinned === code) return;
      ev.preventDefault();
      pinned = code;
      fill(code);
    });
  }
  svg.addEventListener('pointerleave', () => fill(pinned));
  card.querySelector('[data-fm-close]')?.addEventListener('click', () => {
    pinned = null;
    fill(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinned) {
      pinned = null;
      fill(null);
    }
  });
}

// ---------- 3. The tree: folding branches ----------
for (const svg of document.querySelectorAll<SVGSVGElement>('svg.ft[data-ft]')) {
  const meta = JSON.parse(svg.dataset['ft'] ?? '{}') as { layout: LayoutKind; x0: number; width: number };
  const groups = new Map<string, SVGGElement>();
  for (const g of svg.querySelectorAll<SVGGElement>('.ft-g')) groups.set(g.dataset['id'] ?? '', g);
  const edges = new Map<string, SVGPathElement>();
  for (const e of svg.querySelectorAll<SVGPathElement>('.ft-e')) edges.set(e.dataset['edge'] ?? '', e);
  const rows: LayoutRow[] = [...groups.values()].map((g) => ({ id: g.dataset['id'] ?? '', parent: g.dataset['parent'] ?? '', order: g.dataset['order'] ?? '' }));
  const buttons = [...svg.querySelectorAll<SVGGElement>('.ft-fold')];
  if (!buttons.length) continue;
  svg.classList.add('ft-js');
  const folded = new Set<string>();
  // Measure the labels as drawn: each fold button goes just after its label, and in the tidy tree a
  // branch's lines leave from there. A tree that is hidden at this width is measured when it shows.
  const lead = new Map<string, number>();
  let measured = false;
  const measure = (): boolean => {
    const tidy = meta.layout === 'tidy';
    for (const [id, g] of groups) {
      const w = g.querySelector<SVGTextElement>('a text')?.getComputedTextLength() ?? 0;
      if (!w) return false;
      const btn = g.querySelector('.ft-fold');
      btn?.setAttribute('transform', tidy ? `translate(${(10 + w + 4).toFixed(1)},-7.5)` : `translate(${(12 + w + 6).toFixed(1)},-15)`);
      if (tidy) lead.set(id, 10 + w + (btn ? 23 : 6));
    }
    measured = true;
    return true;
  };

  const relay = (animate = true): void => {
    const laid = layFamily(rows, meta.layout, folded, lead);
    const shown = new Set(laid.nodes.map((n) => n.id));
    svg.setAttribute('viewBox', `${meta.x0} ${Math.floor(laid.top)} ${meta.width} ${Math.ceil(laid.height)}`);
    svg.setAttribute('height', String(Math.ceil(laid.height)));
    for (const [id, g] of groups) g.classList.toggle('ft-off', !shown.has(id));
    for (const [id, e] of edges) e.classList.toggle('ft-off', !shown.has(id));
    for (const n of laid.nodes) {
      const g = groups.get(n.id)!;
      const old = (g.getAttribute('transform') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [n.x, n.y];
      g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
      const dx = (old[0] ?? n.x) - n.x;
      const dy = (old[1] ?? n.y) - n.y;
      if (animate && !still && (dx || dy)) {
        g.querySelector('.ft-in')?.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
    for (const e of laid.edges) {
      const p = edges.get(e.id);
      if (!p) continue;
      const moved = p.getAttribute('d') !== e.d;
      p.setAttribute('d', e.d);
      if (animate && moved && !still) p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 120, easing: 'ease-out', fill: 'backwards' });
    }
  };

  const fit = (): void => {
    if (!measured && measure()) relay(false);
  };
  if (document.fonts?.ready) void document.fonts.ready.then(fit);
  else fit();
  window.addEventListener('resize', fit, { passive: true });

  for (const b of buttons) {
    const id = b.dataset['fold'] ?? '';
    const n = rows.filter((r) => r.parent === id).length;
    const toggle = (): void => {
      const open = folded.has(id);
      if (open) folded.delete(id);
      else folded.add(id);
      b.setAttribute('aria-expanded', String(open));
      b.setAttribute('aria-label', (b.getAttribute('aria-label') ?? '').replace(/^(Fold|Open)/, open ? 'Fold' : 'Open'));
      const c = b.querySelector('.ft-count');
      if (c) c.textContent = open ? '' : `+${b.getAttribute('aria-label')?.match(/\d+/)?.[0] ?? n}`;
      relay();
    };
    b.addEventListener('click', toggle);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }
}

// ---------- 3. The tree: readout card and state chips ----------
interface Row {
  name: string;
  state: string;
  year: string;
  status: string;
  title: string;
  href: string;
  parent: string;
  kind: string;
  shared: string;
  longest: string;
  width: number;
  passage: string;
  sponsor: string;
  kids: number;
  chain: string[];
}

for (const box of document.querySelectorAll<HTMLElement>('[data-bf]')) {
  let rows: Record<string, Row>;
  try {
    rows = JSON.parse(box.dataset['bfJson'] ?? '{}') as Record<string, Row>;
  } catch {
    continue;
  }
  const svgs = [...box.querySelectorAll<SVGSVGElement>('svg.ft')];
  const panel = box.querySelector<HTMLElement>('[data-bf-panel]');
  const chipBar = box.querySelector<HTMLElement>('[data-bf-chips]');
  if (!svgs.length || !panel) continue;
  if (chipBar) chipBar.hidden = false;
  const card = panel.querySelector<HTMLElement>('[data-bf-card]')!;
  const linkPart = panel.querySelector<HTMLElement>('[data-bf-link]')!;
  const rootPart = panel.querySelector<HTMLElement>('[data-bf-root]')!;
  const meter = panel.querySelector<SVGRectElement>('[data-f-meter]');
  const go = panel.querySelector<HTMLAnchorElement>('[data-f-href]');
  const field = (name: string): HTMLElement => panel.querySelector<HTMLElement>(`[data-f="${name}"]`)!;
  const nodes = svgs.flatMap((s) => [...s.querySelectorAll<SVGAElement>('.ft-n')]);
  const edges = svgs.flatMap((s) => [...s.querySelectorAll<SVGPathElement>('.ft-e')]);
  const chips = chipBar ? [...chipBar.querySelectorAll<HTMLButtonElement>('[data-state]')] : [];
  let pinned: string | null = null;
  let chosen: string | null = null;

  /** Light a set of texts (and the links into them); none: everything as drawn. */
  const light = (ids: Set<string> | null): void => {
    for (const s of svgs) s.classList.toggle('tracing', Boolean(ids));
    for (const n of nodes) n.classList.toggle('on', Boolean(ids?.has(n.dataset['id'] ?? '')));
    for (const e of edges) e.classList.toggle('on', Boolean(ids?.has(e.dataset['edge'] ?? '')));
  };
  const stateSet = (code: string): Set<string> => {
    const out = new Set<string>();
    for (const r of Object.values(rows)) if (r.state === code) for (const c of r.chain) out.add(c);
    return out;
  };

  const show = (id: string | null): void => {
    const row = id ? rows[id] : undefined;
    for (const n of nodes) n.classList.toggle('pin', Boolean(pinned) && n.dataset['id'] === pinned);
    if (row) light(new Set(row.chain));
    else light(chosen ? stateSet(chosen) : null);
    panel.hidden = !row;
    card.hidden = !row;
    if (!row) return;
    field('state').textContent = row.state;
    field('year').textContent = row.year;
    field('status').textContent = row.status;
    field('name').textContent = row.name;
    field('title').textContent = row.title;
    field('title').hidden = !row.title;
    linkPart.hidden = !row.parent;
    rootPart.hidden = Boolean(row.parent);
    if (row.parent) {
      field('parent').textContent = row.parent;
      field('kind').textContent = row.sponsor ? `${row.kind}, same sponsor` : row.kind;
      field('shared').textContent = row.shared;
      field('longest').textContent = `${row.longest} words`;
      field('passage').textContent = row.passage;
      meter?.setAttribute('width', String(row.width));
    }
    if (go) go.href = row.href;
    field('kids').textContent = row.kids ? `${row.kids} ${row.kids === 1 ? 'text sits' : 'texts sit'} under it` : '';
  };

  for (const n of nodes) {
    const id = n.dataset['id'] ?? null;
    n.addEventListener('pointerenter', () => {
      if (!pinned) show(id);
    });
    n.addEventListener('focus', () => show(id));
    n.addEventListener('click', (ev) => {
      // A click pins the card; a second click on the same text follows the link to the list.
      if (pinned === id) return;
      ev.preventDefault();
      pinned = id;
      show(id);
    });
  }
  for (const s of svgs) {
    s.addEventListener('pointerleave', () => show(pinned));
    s.addEventListener('focusout', (e) => {
      if (!s.contains(e.relatedTarget as Node | null)) show(pinned);
    });
  }
  panel.querySelector('[data-bf-close]')?.addEventListener('click', () => {
    pinned = null;
    show(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinned) {
      pinned = null;
      show(null);
    }
  });
  for (const c of chips) {
    c.addEventListener('click', () => {
      const code = c.dataset['state'] ?? '';
      chosen = chosen === code ? null : code;
      for (const o of chips) o.setAttribute('aria-pressed', String(o.dataset['state'] === chosen));
      pinned = null;
      show(null);
    });
  }
}
