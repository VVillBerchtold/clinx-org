/**
 * The pointer and scroll layer for the bill family tree (src/pages/bills/family/index.astro).
 * Progressive enhancement only: the pictures are drawn at build time and every link with its shared words is
 * printed in the list in part 3. This steps the story picture as its cards pass, fills the readout card, and
 * lights a state's texts with their line back to the earliest text. It writes text, attributes and classes
 * only, so the content security policy needs no exception.
 */

export {};

// ---------- The scroll story (the same rule as the registry page's) ----------
for (const story of document.querySelectorAll<HTMLElement>('[data-story]')) {
  const fig = story.querySelector<HTMLElement>('[data-tt-story]');
  const pin = story.querySelector<HTMLElement>('.rx-story-pin');
  const steps = [...story.querySelectorAll<HTMLElement>('.rx-story-step')];
  if (!fig || !pin || !steps.length) continue;
  story.classList.add('rx-story-on');
  let cur: HTMLElement | undefined;
  let queued = false;
  const pick = (): void => {
    queued = false;
    const box = story.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) return;
    const under = Math.max(0, pin.getBoundingClientRect().bottom);
    const line = under + (window.innerHeight - under) / 2;
    let on = steps[0]!;
    for (const s of steps) if (s.getBoundingClientRect().top <= line) on = s;
    if (on === cur) return;
    cur = on;
    for (const s of steps) s.classList.toggle('is-on', s === on);
    fig.dataset['upto'] = on.dataset['upto'] ?? String(steps.length - 1);
  };
  const ask = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(pick);
    }
  };
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', ask, { passive: true });
  pick();
}

// ---------- The whole family: readout card and state chips ----------
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
  const svgs = [...box.querySelectorAll<SVGSVGElement>('svg.tt')];
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
  const nodes = svgs.flatMap((s) => [...s.querySelectorAll<SVGAElement>('.tt-n')]);
  const edges = svgs.flatMap((s) => [...s.querySelectorAll<SVGPathElement>('.tt-e')]);
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
