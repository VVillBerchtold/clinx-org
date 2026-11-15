import type { APIRoute } from 'astro';
import { calendarFile, fileEvents, getCalendar } from '../../lib/calendar';

/**
 * The whole calendar as one file a calendar app can open or subscribe to: every place's dates
 * from the last two months and everything ahead.
 */
export const GET: APIRoute = () => {
  const data = getCalendar();
  return new Response(calendarFile(data, fileEvents(data), 'ClinX 340B calendar'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
