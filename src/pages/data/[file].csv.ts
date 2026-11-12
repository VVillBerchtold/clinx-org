import type { APIRoute } from 'astro';
import { buildStateDrugViews, getDataset, stateDrugCsv, type StateDrugView } from '../../lib/data';

/**
 * The download behind each state's page of all drug rows: `/data/drug-rows-<state>-<year>.csv`, written at
 * build time from the same groups the page shows. A plain file: the page links to it and no script fetches it.
 */
export function getStaticPaths() {
  return buildStateDrugViews(getDataset()).map((view) => ({
    params: { file: view.csvName.replace(/\.csv$/, '') },
    props: { view },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const { view } = props as { view: StateDrugView };
  return new Response(stateDrugCsv(view), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
};
