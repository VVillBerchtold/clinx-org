/**
 * Where each text of a bill family sits in its tree, laid out by d3-hierarchy. The page draws the tree at
 * build time from this (src/lib/bill-family-pictures.ts), and the browser calls the same function again
 * when a branch is folded or opened (src/scripts/bill-family.ts), so both always agree.
 *
 * Two layouts: `tidy`, the Reingold-Tilford tidy tree on its side (the earliest text on the left, each
 * generation one column to the right), for a wide screen; and `indent`, one row per text with each text
 * indented under its parent, for a phone.
 */
import { stratify, tree, type HierarchyNode } from 'd3-hierarchy';
import { linkHorizontal } from 'd3-shape';

/** A text as the layout needs it: its id, its parent's id (blank for the root), and where it sorts in time. */
export interface LayoutRow {
  id: string;
  parent: string;
  order: string;
}

export type LayoutKind = 'tidy' | 'indent';

export interface Placed {
  id: string;
  /** Across, in SVG units. */
  x: number;
  /** Down, in SVG units. */
  y: number;
  depth: number;
  /** How many texts sit under it in the whole tree, folded or not. */
  under: number;
}

export interface Laid {
  /** The texts shown, in drawing order. Texts under a folded branch are left out. */
  nodes: Placed[];
  /** One line per text shown, other than the root, from its parent: the child's id and the path. */
  edges: { id: string; d: string }[];
  /** The top and height of the drawing, in SVG units. */
  top: number;
  height: number;
}

/** Spacing, in SVG units. */
export const LAYOUT = {
  tidy: { row: 24, col: 214, pad: 14 },
  indent: { row: 40, step: 18, pad: 10 },
} as const;

const tidyLink = linkHorizontal<{ source: [number, number]; target: [number, number] }, [number, number]>()
  .source((l) => l.source)
  .target((l) => l.target);

/**
 * Lay the tree out, with the texts under each id in `folded` hidden. In the tidy tree each label sits right of
 * its dot, so a branch's lines leave from the end of its label: `lead` is how far that is, for each id.
 */
export function layFamily(rows: readonly LayoutRow[], kind: LayoutKind, folded: ReadonlySet<string> = new Set(), lead: ReadonlyMap<string, number> = new Map()): Laid {
  const root = stratify<LayoutRow>()
    .id((r) => r.id)
    .parentId((r) => r.parent || null)([...rows]);
  root.sort((a, b) => a.data.order.localeCompare(b.data.order) || a.data.id.localeCompare(b.data.id));
  const under = new Map<string, number>();
  root.each((n) => under.set(n.data.id, n.descendants().length - 1));
  // A folded branch is laid out as a leaf: d3 leaves a node with no children where a leaf goes.
  root.each((n) => {
    if (folded.has(n.data.id)) delete (n as { children?: HierarchyNode<LayoutRow>[] }).children;
  });

  if (kind === 'tidy') {
    const { row, col, pad } = LAYOUT.tidy;
    const laid = tree<LayoutRow>().nodeSize([row, col])(root);
    const all = laid.descendants();
    const lo = Math.min(...all.map((n) => n.x));
    const hi = Math.max(...all.map((n) => n.x));
    return {
      nodes: all.map((n) => ({ id: n.data.id, x: n.y, y: n.x, depth: n.depth, under: under.get(n.data.id) ?? 0 })),
      edges: laid.links().map((l) => ({ id: l.target.data.id, d: tidyLink({ source: [l.source.y + (lead.get(l.source.data.id) ?? 0), l.source.x], target: [l.target.y - 6, l.target.x] }) ?? '' })),
      top: lo - row / 2 - pad,
      height: hi - lo + row + pad * 2,
    };
  }

  const { row, step, pad } = LAYOUT.indent;
  const nodes: Placed[] = [];
  const at = new Map<string, Placed>();
  root.eachBefore((n) => {
    const p = { id: n.data.id, x: pad + 6 + n.depth * step, y: pad + row / 2 + nodes.length * row, depth: n.depth, under: under.get(n.data.id) ?? 0 };
    nodes.push(p);
    at.set(p.id, p);
  });
  const edges: Laid['edges'] = [];
  root.each((n) => {
    if (!n.parent) return;
    const a = at.get(n.parent.data.id)!;
    const b = at.get(n.data.id)!;
    edges.push({ id: b.id, d: `M${a.x},${a.y + 6}V${b.y - 4}Q${a.x},${b.y} ${a.x + 4},${b.y}H${b.x - 6}` });
  });
  return { nodes, edges, top: 0, height: nodes.length * row + pad * 2 };
}
