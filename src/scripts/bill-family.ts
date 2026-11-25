/**
 * The pointer layer for the bill family tree (src/pages/bills/family/index.astro).
 * Progressive enhancement only: every link and its shared words are printed in the list under the
 * picture. This lights a row's line back to the earliest text and fills the panel beside the picture.
 * It writes text and classes only, so the content security policy needs no exception.
 */

export {};

interface Row {
  name: string;
  year: string;
  status: string;
  title: string;
  parent: string;
  kind: string;
  shared: string;
  longest: string;
  passage: string;
  sponsor: string;
  chain: string[];
}

for (const box of document.querySelectorAll<HTMLElement>('[data-bf]')) {
  let rows: Record<string, Row>;
  try {
    rows = JSON.parse(box.dataset['bfJson'] ?? '{}') as Record<string, Row>;
  } catch {
    continue;
  }
  const svg = box.querySelector<SVGSVGElement>('.bf-tree');
  const panel = box.querySelector<HTMLElement>('[data-bf-panel]');
  if (!svg || !panel) continue;
  panel.hidden = false;
  const rest = panel.querySelector<HTMLElement>('[data-bf-rest]')!;
  const card = panel.querySelector<HTMLElement>('[data-bf-card]')!;
  const linkPart = panel.querySelector<HTMLElement>('[data-bf-link]')!;
  const rootPart = panel.querySelector<HTMLElement>('[data-bf-root]')!;
  const field = (name: string): HTMLElement => panel.querySelector<HTMLElement>(`[data-f="${name}"]`)!;
  const rowEls = [...svg.querySelectorAll<SVGAElement>('.bf-row')];
  const edgeEls = [...svg.querySelectorAll<SVGPathElement>('.bf-edge')];

  const show = (id: string | null): void => {
    const row = id ? rows[id] : undefined;
    svg.classList.toggle('tracing', Boolean(row));
    const on = new Set(row?.chain ?? []);
    for (const r of rowEls) r.classList.toggle('on', on.has(r.dataset['id'] ?? ''));
    // An edge belongs to its child: it is lit when the child is on the chain and is not the root.
    for (const e of edgeEls) e.classList.toggle('on', on.has(e.dataset['edge'] ?? ''));
    rest.hidden = Boolean(row);
    card.hidden = !row;
    if (!row) return;
    field('year').textContent = row.year;
    field('status').textContent = row.status;
    field('name').textContent = row.name;
    field('title').textContent = row.title;
    linkPart.hidden = !row.parent;
    rootPart.hidden = Boolean(row.parent);
    if (row.parent) {
      field('kind').textContent = row.sponsor ? `${row.kind}, same sponsor` : row.kind;
      field('shared').textContent = row.shared;
      field('longest').textContent = row.longest;
      field('parent').textContent = row.parent;
      field('passage').textContent = row.passage;
    }
  };

  for (const r of rowEls) {
    const id = r.dataset['id'] ?? null;
    r.addEventListener('pointerenter', () => show(id));
    r.addEventListener('focus', () => show(id));
  }
  svg.addEventListener('pointerleave', () => show(null));
  svg.addEventListener('focusout', (e) => {
    if (!svg.contains(e.relatedTarget as Node | null)) show(null);
  });
}
