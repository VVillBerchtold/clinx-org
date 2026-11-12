import { describe, expect, it, vi } from 'vitest';
import { composeMail, fromThisSite, handleContact, looksLikeEmail, looksLikePatientDetails, manyLines, MAX_BODY_BYTES, oneLine, readMessage, type ContactEnv, type OutgoingMail } from '../worker/contact';
import worker from '../worker/index';
import { CONTACT_LIMITS, CONTACT_TOPICS } from '../src/lib/contact-topics';

const SITE = 'https://clinx.org';
const good = { name: 'Ada Example', email: 'ada@example.org', organization: 'Example Health Center', topic: 'question', message: 'How often is the data refreshed?' };

function makeEnv(overrides: Partial<ContactEnv> = {}) {
  const sent: OutgoingMail[] = [];
  const env: ContactEnv = {
    EMAIL: { send: vi.fn(async (mail: OutgoingMail) => void sent.push(mail)) },
    CONTACT_TO: 'owner@example.org',
    CONTACT_FROM: 'form@example.org',
    SITE_ORIGIN: SITE,
    ...overrides,
  };
  return { env, sent };
}

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request(`${SITE}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(new TextEncoder().encode(body).length), 'Sec-Fetch-Site': 'same-origin', Origin: 'null', ...headers },
    body,
  });
}

const where = (response: Response) => response.headers.get('Location');

describe('contact form: reading a message', () => {
  it('accepts a complete message and trims it', () => {
    expect(readMessage(new URLSearchParams({ ...good, name: '  Ada Example ' }))).toEqual(good);
  });

  it('needs a name, an email, a known topic and a message', () => {
    for (const field of ['name', 'email', 'topic', 'message'] as const) expect(readMessage(new URLSearchParams({ ...good, [field]: '' }))).toBe('missing');
    expect(readMessage(new URLSearchParams({ ...good, topic: 'made-up' }))).toBe('missing');
    const { organization: _unused, ...withoutOrganization } = good;
    expect(readMessage(new URLSearchParams(withoutOrganization))).toMatchObject({ organization: '' });
  });

  it('refuses a field over its limit', () => {
    expect(readMessage(new URLSearchParams({ ...good, message: 'x'.repeat(CONTACT_LIMITS.message + 1) }))).toBe('too-long');
    expect(readMessage(new URLSearchParams({ ...good, name: 'x'.repeat(CONTACT_LIMITS.name + 1) }))).toBe('too-long');
  });

  it('knows an email address from other text', () => {
    for (const ok of ['a@b.co', 'first.last+tag@sub.example.org']) expect(looksLikeEmail(ok)).toBe(true);
    for (const bad of ['', 'a@b', 'a b@c.org', 'a@b.org, c@d.org', 'Name <a@b.org>', 'a@b.org\nBcc: x@y.org', '@b.org']) expect(looksLikeEmail(bad)).toBe(false);
    expect(readMessage(new URLSearchParams({ ...good, email: 'not an address' }))).toBe('email');
  });

  it('turns line breaks in one-line fields into spaces, so no field can add a mail header', () => {
    expect(oneLine('Ada\r\nBcc: someone@example.org')).toBe('Ada Bcc: someone@example.org');
    expect(manyLines('one\r\ntwo\rthree\u0000')).toBe('one\ntwo\nthree');
    const mail = composeMail({ ...good, topic: 'question' }, { CONTACT_TO: 'owner@example.org', CONTACT_FROM: 'form@example.org' });
    expect(mail.subject).toBe('ClinX contact form: A question');
    expect(mail.subject).not.toContain(good.name);
    expect(mail.replyTo).toBe(good.email);
    expect(mail.to).toBe('owner@example.org');
    expect(mail.text).toContain('Organization: Example Health Center');
    expect(mail.text).toContain(good.message);
  });

  it('stops text that looks like a patient’s details', () => {
    for (const text of ['SSN 123-45-6789', 'the patient, DOB 4/12/1961, was', 'date of birth: 1961-04-12', 'MRN 00482917']) expect(looksLikePatientDetails(text)).toBe(true);
    for (const text of ['Schedule G line 12 prints 1,204 claims', 'filed on 4/1/2026', 'call 401-555-0100', 'How is the margin worked out?']) expect(looksLikePatientDetails(text)).toBe(false);
    expect(readMessage(new URLSearchParams({ ...good, message: 'Her SSN is 123-45-6789' }))).toBe('patient-details');
  });

  it('has a label for every topic', () => {
    for (const topic of CONTACT_TOPICS) expect(composeMail({ ...good, topic: topic.value }, { CONTACT_TO: 'a@b.org', CONTACT_FROM: 'c@d.org' }).subject).toContain(topic.label);
  });
});

describe('contact form: the request', () => {
  it('sends a good message once and goes to the sent page', async () => {
    const { env, sent } = makeEnv();
    const response = await handleContact(post(good), env);
    expect(response.status).toBe(303);
    expect(where(response)).toBe('/contact/sent/');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'owner@example.org', from: { email: 'form@example.org' }, replyTo: 'ada@example.org' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('answers only a form post from this site', async () => {
    const { env, sent } = makeEnv();
    expect((await handleContact(new Request(`${SITE}/api/contact`), env)).status).toBe(405);
    expect((await handleContact(post(good, { 'Sec-Fetch-Site': 'cross-site' }), env)).status).toBe(403);
    expect((await handleContact(post(good, { Origin: 'https://elsewhere.example' }), env)).status).toBe(403);
    expect((await handleContact(post(good, { 'Content-Type': 'application/json' }), env)).status).toBe(415);
    expect(sent).toHaveLength(0);
    expect(fromThisSite(new Request(SITE, { headers: { Origin: SITE } }), SITE)).toBe(true);
    expect(fromThisSite(new Request(SITE), SITE)).toBe(true);
  });

  it('does not read a post that is too large', async () => {
    const { env, sent } = makeEnv();
    const response = await handleContact(post({ ...good, message: 'x'.repeat(MAX_BODY_BYTES) }), env);
    expect(where(response)).toBe('/contact/problem/#too-long');
    expect(sent).toHaveLength(0);
  });

  it('quietly drops automated posts and gives them the usual answer', async () => {
    const { env, sent } = makeEnv();
    expect(where(await handleContact(post({ ...good, website: 'https://spam.example' }), env))).toBe('/contact/sent/');
    expect(where(await handleContact(post({ ...good, open_ms: '300' }), env))).toBe('/contact/sent/');
    expect(where(await handleContact(post({ ...good, open_ms: 'abc' }), env))).toBe('/contact/sent/');
    expect(sent).toHaveLength(0);
    expect(where(await handleContact(post({ ...good, open_ms: '9000' }), env))).toBe('/contact/sent/');
    expect(sent).toHaveLength(1);
  });

  it('sends each problem to its section of the problem page', async () => {
    const { env, sent } = makeEnv();
    expect(where(await handleContact(post({ ...good, message: '' }), env))).toBe('/contact/problem/#missing');
    expect(where(await handleContact(post({ ...good, email: 'nope' }), env))).toBe('/contact/problem/#email');
    expect(where(await handleContact(post({ ...good, message: 'DOB 4/12/1961' }), env))).toBe('/contact/problem/#patient-details');
    expect(sent).toHaveLength(0);
  });

  it('stops after too many posts from one visitor', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const { env, sent } = makeEnv({ CONTACT_LIMIT: { limit } });
    const response = await handleContact(post(good, { 'CF-Connecting-IP': '203.0.113.9' }), env);
    expect(where(response)).toBe('/contact/problem/#too-many');
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
    expect(sent).toHaveLength(0);
  });

  it('says so when the mail cannot be sent, and logs nothing the visitor wrote', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = makeEnv({ EMAIL: { send: async () => Promise.reject(Object.assign(new Error('E_SENDER_DOMAIN_NOT_AVAILABLE'), { code: 'E_SENDER_DOMAIN_NOT_AVAILABLE' })) } });
    expect(where(await handleContact(post(good), env))).toBe('/contact/problem/#not-sent');
    const logged = JSON.stringify(log.mock.calls);
    for (const typed of Object.values(good)) expect(logged).not.toContain(typed);
    log.mockRestore();
  });

  it('answers 404 for any other path under /api/', async () => {
    const { env } = makeEnv();
    expect((await worker.fetch(new Request(`${SITE}/api/other`), env)).status).toBe(404);
    expect(where(await worker.fetch(post(good), env))).toBe('/contact/sent/');
  });
});
