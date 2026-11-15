import type { APIRoute } from 'astro';
import { calendarFile, calendarPlaceName, calendarSlug, fileEvents, getCalendar, placesWithEvents } from '../../../lib/calendar';

/** One place's calendar file: its dates from the last year and everything ahead. */
export function getStaticPaths() {
  return placesWithEvents(getCalendar()).map((place) => ({ params: { slug: calendarSlug(place) }, props: { place } }));
}

export const GET: APIRoute = ({ props }) => {
  const data = getCalendar();
  const place = props['place'] as string;
  return new Response(calendarFile(data, fileEvents(data, place), `ClinX 340B calendar: ${calendarPlaceName(place)}`), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
