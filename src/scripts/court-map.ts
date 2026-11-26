/**
 * The draft story at /preview/court-map-dy1tfv40/ (unlisted). Progressive enhancement only; no styles are written from here.
 * - The patient field: the page draws it in its final state. This gathers the dots into one field and parts them
 *   as the story's steps pass (registry-charts.ts sets data-upto on the figure), using the page's own layout.
 *   With reduced motion it does nothing, and the field stays as drawn. While the field is still one, it also
 *   drops and grows, with the scroll, from just under the 21 words on the first screen to fill the middle of the
 *   pinned stage.
 * - The court map: the words of the step in view are shown beside the map.
 * - Both stories play their steps one at a time. registry-charts.ts sets data-upto to the step in view; this walks
 *   data-step (which the CSS draws from) towards it a step at a time, each step a short timed transition that runs
 *   to its end before the next begins. So a fast flick or a fling still shows every step's end state, briefly,
 *   and never a half-drawn mix. With reduced motion, data-step simply follows data-upto.
 * - The state list beside the small map. Without a script, each tile is a link to its state's card, and the card
 *   shows because it is the page's target (CSS :target). This shows the list and makes picking from it do the same.
 * - The circuit cards: the circuit of the state picked (its card is the page's target) is marked.
 * - The notes fold away, and open when a note's number is followed. Without a script they stay open.
 */
import { WIDE, NARROW, layout, type Counts, type FieldLayout, type Pt } from '../pages/preview/court-map-dy1tfv40/_field';

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Steps, one at a time ----------
/** Walks fig's data-step towards its data-upto one step at a time. show(s, last) draws step s and returns how long
 *  its transition takes (ms); the next step starts only once that has run. last is true when s is the step in view,
 *  false when it is only being passed through on the way there. */
const walk = (fig: HTMLElement, first: number, show: (s: number, last: boolean, now: boolean) => number): void => {
  const want = (): number => (fig.dataset.upto === undefined ? first : Number(fig.dataset.upto));
  let at = want();
  let busy = 0;
  const next = (): void => {
    busy = 0;
    const w = want();
    if (w === at) return;
    at += w > at ? 1 : -1;
    fig.dataset.step = String(at);
    const ms = show(at, at === w, false);
    if (ms > 0) busy = window.setTimeout(next, ms);
    else next();
  };
  // Until the story sets a step, there is none: the figure is drawn as it is without a script.
  let set = fig.dataset.upto !== undefined;
  if (set) fig.dataset.step = String(at);
  show(at, true, true);
  new MutationObserver(() => {
    // The first step the story sets is where the reader is: draw it at once, without walking to it.
    if (still || !set) {
      set = true;
      window.clearTimeout(busy);
      busy = 0;
      at = want();
      fig.dataset.step = String(at);
      const ms = show(at, true, true);
      if (!still && ms > 0) busy = window.setTimeout(next, ms); // it still holds for a step's time
    } else if (!busy) next();
  }).observe(fig, { attributes: true, attributeFilter: ['data-upto'] });
};

// ---------- The patient field ----------
const pf = document.querySelector<HTMLElement>('.pf-fig[data-story-fig]');
if (pf && !still) {
  type Field = { svg: SVGSVGElement; F: FieldLayout; dots: SVGCircleElement[]; cur: Pt[]; raf: number; lift: number; grow: number; moving: boolean };
  const fields: Field[] = [...pf.querySelectorAll<SVGSVGElement>('svg[data-field]')].map((svg) => {
    const [up = '', cl = '', tenth = '0', dist = '', vac = '0'] = (svg.dataset.counts ?? '').split('|');
    const list = (t: string): number[] => t.split(',').map(Number);
    const counts: Counts = { up: list(up), clusters: list(cl), tenth: +tenth, dist: list(dist), vac: +vac };
    const F = layout(svg.dataset.field === 'narrow' ? NARROW : WIDE, counts);
    return { svg, F, dots: [...svg.querySelectorAll<SVGCircleElement>('circle.pf-d')], cur: F.fin.map((p) => ({ ...p })), raf: 0, lift: 0, grow: 1, moving: false };
  });
  let step = 3;
  /** Where a dot goes at a step. At the start the one field also grows about its middle and drops by the lift
   *  (below); while it parts, the dots still gathered on the axis keep the same drop, so they stay mid-stage. */
  const target = (f: Field, s: number, i: number): Pt => {
    const k = Math.max(0, Math.min(3, s));
    const p = f.F.at[k]![i]!;
    if (k === 0) {
      const c = f.F.all;
      return { x: c.x + (p.x - c.x) * f.grow, y: c.y + (p.y - c.y) * f.grow + f.lift };
    }
    const q = f.F.fin[i]!;
    return k < 3 && (p.x !== q.x || p.y !== q.y) ? { x: p.x, y: p.y + f.lift } : p;
  };
  /** How long the dots take: a step being passed through is quicker than the step the reader stops at. */
  const DUR = 460;
  const DUR_PASS = 320;
  // cubic-bezier(0.65, 0, 0.35, 1), solved for x by bisection: a slow start, a long glide, a soft landing.
  const bez = (a: number, b: number, k: number): number => 3 * a * k * (1 - k) ** 2 + 3 * b * k * k * (1 - k) + k ** 3;
  const ease = (x: number): number => {
    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 18; n++) {
      const m = (lo + hi) / 2;
      if (bez(0.65, 0.35, m) < x) lo = m;
      else hi = m;
    }
    return bez(0, 1, (lo + hi) / 2);
  };
  const put = (f: Field, i: number): void => {
    f.dots[i]!.setAttribute('cx', f.cur[i]!.x.toFixed(1));
    f.dots[i]!.setAttribute('cy', f.cur[i]!.y.toFixed(1));
  };
  /** The beats: upheld first, then the side against about 150ms later, then the courts one by one, 60ms apart.
   *  Within a group the inner dots set off first (up to 120ms), so it flows rather than slides as a block. */
  const beat = (f: Field, i: number, moving: Set<string>): number => {
    const k = f.F.kinds[i]!;
    const lead = k === 'up' ? 0 : k === 'vac' || k === 'dist' ? (moving.has('up') ? 150 : 0) : (moving.size > 1 ? 300 : 0) + f.F.cl[i]! * 60;
    return lead + f.F.depth[i]! * 120;
  };
  /** Moves the dots to the current step and returns how long that takes (ms), beats included. The beats shrink
   *  with the move, so the whole step stays well under a second. */
  const go = (now: boolean, dur = DUR): number => {
    let total = 0;
    const scale = dur / 800;
    for (const f of fields) {
      cancelAnimationFrame(f.raf);
      f.moving = false;
      const to = f.F.at[0]!.map((_, i) => target(f, step, i));
      if (now || f.svg.getBoundingClientRect().width === 0) {
        f.cur = to.map((p) => ({ ...p }));
        f.dots.forEach((_, i) => put(f, i));
        continue;
      }
      const from = f.cur.map((p) => ({ ...p }));
      const moving = to.flatMap((p, i) => (Math.abs(p.x - from[i]!.x) + Math.abs(p.y - from[i]!.y) > 0.05 ? [i] : []));
      const groups = new Set(moving.map((i) => f.F.kinds[i]!));
      // Each dot travels a shallow arc, not a straight slide: the bend is a tenth of the trip, to one side.
      const plan = moving.map((i) => {
        const a = from[i]!;
        const b = to[i]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return { i, a, b, cx: (a.x + b.x) / 2 - dy * 0.1, cy: (a.y + b.y) / 2 + dx * 0.1, wait: beat(f, i, groups) * scale };
      });
      for (const m of plan) total = Math.max(total, m.wait + dur);
      const t0 = performance.now();
      const s0 = step;
      f.moving = true;
      const tick = (t: number): void => {
        let done = true;
        for (const m of plan) {
          const k = Math.min(1, Math.max(0, (t - t0 - m.wait) / dur));
          if (k < 1) done = false;
          const e = ease(k);
          const u = 1 - e;
          const b = target(f, s0, m.i); // the lift can change while the dots travel
          f.cur[m.i] = { x: u * u * m.a.x + 2 * u * e * m.cx + e * e * b.x, y: u * u * m.a.y + 2 * u * e * m.cy + e * e * b.y };
          put(f, m.i);
        }
        if (!done) f.raf = requestAnimationFrame(tick);
        else f.moving = false;
      };
      f.raf = requestAnimationFrame(tick);
    }
    return total;
  };

  // The lift. The one field is drawn high, so the whole of it shows on the first screen, just under the 21 words.
  // Once the stage pins, it should sit midway between the words and the key. So as the reader scrolls from the
  // top of the page to the point where the stage pins, the field (and its figure) drops by a share of that
  // distance and grows by the same share, eased at both ends: tied to the scroll, never a jump. Wide screens only;
  // the phone field is static.
  const story = pf.closest<HTMLElement>('.pf-story');
  const pin = pf.closest<HTMLElement>('.rx-story-pin');
  const words = pf.querySelector<HTMLElement>('.pf-words');
  const key = pf.querySelector<HTMLElement>('.pf-key');
  /** The pinned state: how far the field drops to sit midway between the words and the key, and how much it grows:
   *  to 60% of that height, or more on a tall stage, so neither band above or below it is wider than 150px. */
  const GROW_TO = 0.6;
  const BAND = 150;
  const pinned = (f: Field): { lift: number; grow: number } => {
    const none = { lift: 0, grow: 1 };
    if (f.svg.dataset.field !== 'wide' || !story?.classList.contains('rx-story-on') || !pin || !words || !key) return none;
    const sv = f.svg.getBoundingClientRect();
    if (sv.width === 0) return none;
    const vb = f.svg.viewBox.baseVal;
    const top = pin.getBoundingClientRect().top;
    const k = Math.min(sv.width / vb.width, sv.height / vb.height); // drawn top-aligned (xMidYMin meet)
    const a = words.getBoundingClientRect().bottom - top;
    const b = key.getBoundingClientRect().top - top;
    const lift = Math.max(0, ((a + b) / 2 - (sv.top - top)) / k - f.F.all.y);
    const grow = Math.max(1, Math.max(GROW_TO * (b - a), b - a - 2 * BAND) / k / (2 * f.F.all.R));
    return { lift, grow };
  };
  const lift = (): void => {
    const start = story ? story.getBoundingClientRect().top + window.scrollY : 0;
    const p = start > 0 ? Math.min(1, Math.max(0, window.scrollY / start)) : 1;
    const e = p * p * (3 - 2 * p);
    for (const f of fields) {
      const P = pinned(f);
      const next = P.lift * e;
      const grow = 1 + (P.grow - 1) * e;
      if (Math.abs(next - f.lift) < 0.05 && Math.abs(grow - f.grow) < 0.0005) continue;
      f.lift = next;
      f.grow = grow;
      // The figure keeps its distance from the field's left edge as the field grows.
      f.svg.querySelector('.pf-lab-all')?.setAttribute('transform', `translate(${(-(grow - 1) * f.F.all.R).toFixed(1)} ${next.toFixed(1)})`);
      if (step === 0 && !f.moving) {
        f.cur = f.cur.map((_, i) => target(f, 0, i));
        f.dots.forEach((_, i) => put(f, i));
      }
    }
  };
  let queued = false;
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      lift();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  walk(pf, 3, (s, last, now) => {
    step = s;
    lift();
    const ms = go(now, last ? DUR : DUR_PASS);
    return now ? DUR : ms;
  });
}

// ---------- The court map: the step's words beside the map ----------
// Each map step holds for 600ms (350ms when only passed through), long enough for its colours to settle.
for (const story of document.querySelectorAll<HTMLElement>('.cm-story')) {
  const fig = story.querySelector<HTMLElement>('[data-story-fig]');
  const cap = story.querySelector<HTMLElement>('[data-cap]');
  if (!fig || !cap) continue;
  walk(fig, 5, (s, last) => {
    const step = story.querySelector<HTMLElement>(`.rx-story-step[data-upto="${s}"]`);
    if (step) {
      cap.innerHTML = step.innerHTML;
      cap.className = ['cm-cap', ...[...step.classList].filter((c) => c.startsWith('g-'))].join(' ');
      for (const a of cap.querySelectorAll('a')) a.tabIndex = -1; // the step itself keeps the working link
    }
    return last ? 600 : 350;
  });
}

// ---------- The notes ----------
const notes = document.querySelector<HTMLDetailsElement>('details[data-notes]');
if (notes) {
  const isNote = (h: string): boolean => /^#n\d+$/.test(h) && notes.querySelector(h) !== null;
  if (!isNote(location.hash) && location.hash !== '#notes') notes.open = false;
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#n"]');
    const h = a?.getAttribute('href') ?? '';
    if (isNote(h) || h === '#notes') notes.open = true; // before the browser scrolls to it
  });
  window.addEventListener('hashchange', () => {
    if (isNote(location.hash)) notes.open = true;
  });
}

const pick = document.querySelector<HTMLElement>('[data-pick]');
const select = pick?.querySelector<HTMLSelectElement>('[data-pick-select]');
if (pick && select) {
  pick.hidden = false;
  document.documentElement.classList.add('cm-js');
  const sync = (): void => {
    const id = location.hash.slice(1);
    select.value = [...select.options].some((o) => o.value === id) ? id : '';
  };
  select.addEventListener('change', () => {
    if (select.value) location.hash = select.value;
  });
  window.addEventListener('hashchange', sync);
  sync();
}

// The circuit of the state in the readout: the picked state's card, or Maryland's, which shows when none is picked.
const circs = document.querySelectorAll<HTMLElement>('.cm-cc[data-circuit], .cm-cq-row[data-circuit]');
if (circs.length) {
  const mark = (): void => {
    const id = location.hash.slice(1);
    const card = (id && document.getElementById(id)?.closest<HTMLElement>('.cm-card')) || document.querySelector<HTMLElement>('.cm-card.is-default');
    const c = card?.dataset.circuit ?? '';
    for (const k of circs) k.classList.toggle('is-on', k.dataset.circuit === c);
  };
  window.addEventListener('hashchange', mark);
  mark();
}

// Each stalled bill's path draws its line once the bill is in view (the CSS holds it undrawn until then).
const stalls = document.querySelectorAll<HTMLElement>('.cm-stall');
if (stalls.length && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('cm-js');
  const io = new IntersectionObserver(
    (seen) => {
      for (const e of seen) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -20% 0px' },
  );
  for (const s of stalls) io.observe(s);
}

// While the map is pinned, or the circuit table is in view, the site's back-to-top link would sit over it: mark the page so CSS can
// tuck the link away until the map has scrolled past.
const pinned = document.querySelectorAll<HTMLElement>('.cm-story, .pf-story, .cm-look, .cm-circ');
if (pinned.length && 'IntersectionObserver' in window) {
  const root = document.documentElement;
  const on = new Set<Element>();
  const io = new IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting) on.add(e.target); else on.delete(e.target);
    root.classList.toggle('cm-pinned', on.size > 0);
  });
  for (const s of pinned) io.observe(s);
}
