# Publishing and the contact form

**In short:** the site is a folder of files served from clinx.org. Publishing is a deliberate act by a person. One small program runs on the host, for the contact form only, and it keeps nothing.

## The host

The site is served by Cloudflare. `wrangler.jsonc` is the whole configuration, and it is short enough to read in a minute:

- the files in `dist/` are served as they are;
- one address, `clinx.org`, and no spare or preview addresses;
- one program, `worker/index.ts`, which runs only for paths under `/api/`.

The security headers come from `public/_headers`, which the build copies into `dist/`. The page security policy is also repeated in a tag on every page, so it holds on any host.

## Nothing is published by accident

There are two ways the site can be published, and each has a lock.

| Way | The lock |
|---|---|
| By hand: `.github/workflows/publish.yml` | A person starts it and types `publish clinx.org`. Every check runs first |
| The monthly refresh | Only after a full pass, and only when the repository variable `PUBLISH_ENABLED` is `true` |

Both end in the same script, `scripts/deploy/publish.sh`. It installs one pinned publishing tool from the lock file in `deploy/`, kept apart from the site's own dependencies, and publishes `dist/`.

To rehearse without publishing:

```bash
DRY_RUN=true scripts/deploy/publish.sh
```

Two secrets are needed, and they live in the repository's secret store and nowhere else: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. No secret is ever committed.

## The go-live switch

One setting decides whether the site is a private preview or public: `PREVIEW` in `src/lib/site.ts`.

| | `PREVIEW = true` | `PREVIEW = false` |
|---|---|---|
| `robots.txt` | turns every crawler away | opens the pages (not `/api/`) |
| Each page | asks search engines not to list it | may be listed |
| `sitemap.xml` | not written | written from the pages that were built |
| Wording that waits for approval | carries a "Draft wording" tag | no tags |

"Page not found" and the contact form's two answer pages stay unlisted either way.

Because one setting drives all four, they cannot drift apart. `npm run check:dist` still checks: it fails if `robots.txt`, the pages and the sitemap disagree, or if a Draft tag is on a public build.

## Link previews

Every page names its own public address and carries what a link preview needs: a title, a description and one picture, `public/brand/share-card.png` (1200 by 630). The picture is drawn from `scripts/brand/share-card.html`. The note at the top of that file says how to redraw it.

## Before the first publish

- `clinx.org` must not be attached to another program on the host or hold a CNAME record.
- The host's own visitor measurement must be off for the domain. The site promises no trackers, and its security policy would block the script anyway.
- After the first publish, the response headers and each claim on the Privacy page are checked against the real address.

## The contact form

`/contact/` is an ordinary HTML form. It works with scripts turned off.

What happens to a message:

1. The form posts to `/api/contact`.
2. `worker/contact.ts` checks the post and turns it into an email, using the host's own mail service.
3. The reader is sent to `/contact/sent/`, or to the part of `/contact/problem/` that says what went wrong.

What the program will not do:

- **It stores nothing** and logs nothing a visitor typed.
- **It can write to one address only.** That address is fixed in `wrangler.jsonc`, not taken from the form.
- **It refuses a post** that does not come from this site or is not a plain form post.
- **It drops automated posts quietly.** Two tests: a hidden box no person would fill, and a form sent the moment it opened. Such a post gets the same answer as a real one and is not sent.
- **It sets limits and says so.** A post over 16 KB, or more than 5 posts a minute from one visitor, is not sent, and the reader is told why.
- **It stops text shaped like a patient's details**, such as a Social Security number, and says why. Nobody should send those to a public data site. This is a safety net, not a guarantee.

Only `/contact/` may post a form. Its security policy allows a form to post to the site itself; every other page allows no form at all. `npm run check:dist` confirms this on each build.

To try the form on your own computer, build the site and start the local host. The mail is written to a file under `.wrangler/`, not sent.

```bash
deploy/node_modules/.bin/wrangler dev --config wrangler.jsonc
```

Before the form can send for real, clinx.org must be set up for sending in the host's mail service, and the mailbox must be a verified destination there. Until then the form answers "could not be delivered" and shows the address to write to.
