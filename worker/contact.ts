/**
 * The contact form's one piece of server code. It takes a form post, checks it, and sends it on as
 * an email. It keeps nothing: no database, no file, no log of what was written.
 */
import { CONTACT_LIMITS, CONTACT_TOPICS, type ContactTopic } from '../src/lib/contact-topics';

/** What the program is given by the host. */
export interface ContactEnv {
  /** Sends one email. Provided by the host's email binding. */
  EMAIL: { send(message: OutgoingMail): Promise<unknown> };
  /** Counts posts per visitor address. Optional: the form works without it. */
  CONTACT_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Where messages go, and the address they are sent from. */
  CONTACT_TO: string;
  CONTACT_FROM: string;
  /** The site's own address, for example https://clinx.org. */
  SITE_ORIGIN: string;
}

export interface OutgoingMail {
  to: string;
  from: { email: string; name: string };
  replyTo: string;
  subject: string;
  text: string;
}

export interface ContactMessage {
  name: string;
  email: string;
  organization: string;
  topic: ContactTopic;
  message: string;
}

/** Why a post was not sent. Each one is a section of the page /contact/problem/. */
export type Problem = 'missing' | 'email' | 'too-long' | 'patient-details' | 'too-many' | 'not-sent';

/** The largest post the program reads, in bytes. A full form is well under this. */
export const MAX_BODY_BYTES = 16 * 1024;
/** A form sent sooner than this after it opened was not filled in by a person. */
export const MIN_OPEN_MS = 2500;

const SENT_PAGE = '/contact/sent/';
const PROBLEM_PAGE = '/contact/problem/';

const topicLabel = (topic: ContactTopic): string => CONTACT_TOPICS.find((t) => t.value === topic)!.label;
const isTopic = (value: string): value is ContactTopic => CONTACT_TOPICS.some((t) => t.value === value);

/** One line of text: control characters become spaces, so nothing typed can start a new mail header. */
export function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
}

/** Several lines of text: line ends are kept, every other control character is dropped. */
export function manyLines(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim();
}

export function looksLikeEmail(value: string): boolean {
  return value.length <= CONTACT_LIMITS.email && /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\.]{2,}$/.test(value);
}

/**
 * True when text looks like it carries a patient's details: a Social Security number, or a date of
 * birth or record number written out. The site asks for none; this is a safety net, not a guarantee.
 */
export function looksLikePatientDetails(text: string): boolean {
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true;
  if (/\b(?:d\.?o\.?b\.?|date of birth|born on)\b[^\n]{0,20}\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/i.test(text)) return true;
  if (/\b(?:mrn|medical record (?:number|no\.?|#))\b[^\n]{0,10}\d{4,}/i.test(text)) return true;
  return false;
}

/** Reads the fields of a post. Returns the message, or the reason it cannot be sent. */
export function readMessage(fields: URLSearchParams): ContactMessage | Problem {
  const name = oneLine(fields.get('name') ?? '');
  const email = oneLine(fields.get('email') ?? '');
  const organization = oneLine(fields.get('organization') ?? '');
  const topic = fields.get('topic') ?? '';
  const message = manyLines(fields.get('message') ?? '');

  if (name === '' || email === '' || message === '' || !isTopic(topic)) return 'missing';
  if (name.length > CONTACT_LIMITS.name || organization.length > CONTACT_LIMITS.organization || message.length > CONTACT_LIMITS.message || email.length > CONTACT_LIMITS.email) return 'too-long';
  if (!looksLikeEmail(email)) return 'email';
  if (looksLikePatientDetails(`${name}\n${organization}\n${message}`)) return 'patient-details';
  return { name, email, organization, topic, message };
}

/** The email that carries a message. What the visitor typed goes in the body only, never in a header. */
export function composeMail(message: ContactMessage, env: Pick<ContactEnv, 'CONTACT_TO' | 'CONTACT_FROM'>): OutgoingMail {
  const lines = [`Topic: ${topicLabel(message.topic)}`, `Name: ${message.name}`, `Email: ${message.email}`];
  if (message.organization !== '') lines.push(`Organization: ${message.organization}`);
  lines.push('', message.message, '', '--', 'Sent from the contact form on clinx.org.');
  return {
    to: env.CONTACT_TO,
    from: { email: env.CONTACT_FROM, name: 'ClinX contact form' },
    replyTo: message.email,
    subject: `ClinX contact form: ${topicLabel(message.topic)}`,
    text: lines.join('\n'),
  };
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const goTo = (path: string): Response => new Response(null, { status: 303, headers: { ...HEADERS, Location: path } });
const refuse = (status: number, text: string, extra: Record<string, string> = {}): Response =>
  new Response(text + '\n', { status, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });

/** True when the browser says the post came from this site's own page (or says nothing at all). */
export function fromThisSite(request: Request, siteOrigin: string): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site !== 'same-origin') return false;
  // With this site's no-referrer policy a browser sends "Origin: null" on a form post, so null is accepted.
  const origin = request.headers.get('Origin');
  return origin === null || origin === 'null' || origin === siteOrigin;
}

/** Handles one request to /api/contact. */
export async function handleContact(request: Request, env: ContactEnv): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'This address takes the contact form only.', { Allow: 'POST' });
  if (!fromThisSite(request, env.SITE_ORIGIN)) return refuse(403, 'The form can only be sent from clinx.org.');
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return refuse(415, 'The form was not sent in the expected way.');
  const declared = Number(request.headers.get('Content-Length') ?? 'NaN');
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return goTo(`${PROBLEM_PAGE}#too-long`);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return goTo(`${PROBLEM_PAGE}#too-long`);

  const fields = new URLSearchParams(body);
  // Two quiet tests for automated posts: a field people cannot see, and a form sent the moment it opened.
  // Such a post gets the same answer as a real one and is not sent.
  const openFor = fields.get('open_ms');
  if ((fields.get('website') ?? '') !== '' || (openFor !== null && openFor !== '' && !(Number(openFor) >= MIN_OPEN_MS))) return goTo(SENT_PAGE);

  const message = readMessage(fields);
  if (typeof message === 'string') return goTo(`${PROBLEM_PAGE}#${message}`);

  if (env.CONTACT_LIMIT) {
    const visitor = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.CONTACT_LIMIT.limit({ key: visitor });
    if (!success) return goTo(`${PROBLEM_PAGE}#too-many`);
  }

  try {
    await env.EMAIL.send(composeMail(message, env));
  } catch (error) {
    // Only the kind of failure is logged, never anything the visitor wrote.
    console.error('contact: the message could not be sent', error instanceof Error ? error.name : 'error');
    return goTo(`${PROBLEM_PAGE}#not-sent`);
  }
  return goTo(SENT_PAGE);
}
