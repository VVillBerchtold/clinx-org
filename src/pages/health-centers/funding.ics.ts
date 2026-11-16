import type { APIRoute } from 'astro';
import { fundingCalendarFile, getFunding } from '../../lib/hc-funding';

/** Every dated event of the funding calendar as one file a calendar app can open or subscribe to. */
export const GET: APIRoute = () => new Response(fundingCalendarFile(getFunding()), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
