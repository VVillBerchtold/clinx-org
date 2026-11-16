# Publishing and the contact form

**In short:** the site is a folder of files served from clinx.org. Publishing is a deliberate act by a person. One small program runs on the host, for the contact form and for AI assistants that look things up in the open tables. It keeps no message and no question.

## The host

The site is served by Cloudflare. `wrangler.jsonc` is the whole configuration, and it is short enough to read in a minute:

- the files in `dist/` are served as they are;
- one address, `clinx.org`, and no spare or preview addresses;
- one program, `worker/index.ts`, which runs only for paths under `/api/` and for `/mcp`.

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
| `robots.txt` | turns every crawler away | opens the pages (not `/api/` or `/mcp`) |
| Each page | asks search engines not to list it | may be listed |
| `sitemap.xml` | not written | written from the pages that were built |
| Wording that waits for approval | carries a "Draft wording" tag | no tags |

"Page not found" and the contact form's two answer pages stay unlisted either way.

Because one setting drives all four, they cannot drift apart. `npm run check:dist` still checks: it fails if `robots.txt`, the pages and the sitemap disagree, or if a Draft tag is on a public build.

## Link previews

Every page names its own public address and carries what a link preview needs: a title, a description and one picture, the card of the page's section, from `public/brand/share/` (1200 by 630). The cards are drawn by `scripts/brand/make-share-cards.mjs` from `scripts/brand/share-cards.json`; the note at the top of the script says how to redraw them. `npm run check:dist` fails if a page has no picture or two, names one that is not a known card, or the file is not a 1200 by 630 PNG.

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

The form sends through the host's mail service, which clinx.org is set up for. If a message cannot be sent, the form answers "could not be delivered" and shows the address to write to.

## The door for assistants

`https://clinx.org/mcp` lets an AI assistant look things up in the open data: the 340B tables (filed reports, state laws, bills, federal notices and the calendar) and the health centers files (the records, the funding calendar and the shortage areas). It speaks the Model Context Protocol (MCP), which is how assistants are given outside sources to read. It only reads.

What happens to a question:

1. The assistant posts a small request to `/mcp`, for example "find the bills in Rhode Island".
2. `worker/assistants.ts` hands it to the program in `worker/mcp/`, which reads the tables from the site's own files in `/data/`, the same ones anyone can download. Nothing is fetched from anywhere else. A health centers file is read only when a health center question is asked; if one cannot be read, that question is answered with a plain sentence saying so and every other question is answered as usual.
3. The rows go back to the assistant, each with its official link.

What the program will not do:

- **It changes nothing.** There is nothing to sign in to and nothing to write to.
- **It keeps no question.** No words searched for, no dates typed, and no internet address are stored or logged.
- **It sets a limit and says so.** About 200 questions a minute from one address (an assistant service sends many people's questions from a few shared addresses); past that it answers "too many requests" and a time to try again. The host does this count, approximately ([how approximately](#checking-the-published-door)), and the site keeps none of it.
- **It sends a person who opens the address in a browser** to the part of the Data page that explains it.

The program that answers lives in its own repository, [clinx-mcp](https://github.com/VVillBerchtold/clinx-mcp), with its own tests. `npm run sync:mcp` copies it into `worker/mcp/` and records a fingerprint of each file and the commit it came from. `npm run check:data` fails if a copy was changed here, or was made from work that was not committed.

To try it on your own computer, build the site, start the local host and ask it something:

```bash
deploy/node_modules/.bin/wrangler dev --config wrangler.jsonc --port 8799
```

```bash
curl -s http://127.0.0.1:8799/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## The counts for the door for assistants

The site counts what assistants ask for by kind, so the work can go to the tables that are used. Each question adds one row with eight plain values and nothing else:

| Value | Example | Never |
|---|---|---|
| The kind of request | `tools/call` | |
| The tool | `find_bills` | |
| How it went | `answered`, `mistake`, `limited` | |
| The place asked about | `RI`, `US`, `FED` | |
| The filters set | `kind=contract-pharmacy text` | the words searched for, or a date typed |
| The public row opened | `ri-2025-hb5634` | an id that was typed and not found |
| The name the assistant program gives itself | a chat app's or an editor's name | a person, an address, a device |
| The protocol version | `2025-06-18` | |

The rows go to the host's counting service (Workers Analytics Engine, the set named `clinx_mcp_usage` in `wrangler.jsonc`), which keeps them for three months. The Privacy page says the same to readers. A change to what is counted is a change to that page too.

### Reading the counts

Reading them needs two things from the host, Cloudflare: a read-only token and the account's id. Both stay on the reader's own computer, in two small files that are never committed. The token can read usage figures and nothing else; it cannot change the site.

**Make the token** (once):

1. Sign in to Cloudflare and open [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). By the menus: the person icon, **My Profile**, then **API Tokens**.
2. Select **Create Token**.
3. Give it a name that says what it is for, such as `ClinX usage counts, read only`.
4. Under **Policies**, choose **Start from scratch**. The ready-made sets beside it, such as "Read analytics and logs", grant more than is needed.
5. For the kind of policy choose **Account**, and for the account choose the one that holds clinx.org.
6. For the permission choose **Account Analytics**, **Read**. Add nothing else. An expiry date is optional.
7. Select **Continue to summary**, check that the summary lists Account Analytics: Read and nothing more, then select **Create Token**.
8. The token is shown once, as one long word beginning `cfut_`. Copy that word only. The page also offers a ready-made test command with its own copy button; that is not the token, though the token is inside it.

**Save the token.** With the token copied, run this in Terminal. It writes whatever was last copied into the file, so run it straight after copying:

```bash
pbpaste > "$HOME/.config/clinx/cloudflare-usage.token"
```

**Save the account's id.** In the Cloudflare dashboard open **Workers & Pages**, find **Account Details**, and select the copy button next to **Account ID**. Then:

```bash
pbpaste > "$HOME/.config/clinx/cloudflare-account-id"
```

**Keep both files private to this user:**

```bash
chmod 600 "$HOME/.config/clinx/cloudflare-usage.token" "$HOME/.config/clinx/cloudflare-account-id"
```

**Read the counts:**

```bash
npm run usage:mcp -- --days 30
```

It prints short tables: requests a day, which tools were used and how each went, which states were asked about, which filters, which rows were opened most, and which assistant programs connected. If it says the token may be wrong, make a new token and save it again; the old one can be deleted on the same Cloudflare page.

## Checking the published door

After a publish, one command asks the live address real questions through each of its tools and compares every answer with the published tables and health centers files:

```bash
npm run check:live
```

About the limit: the host counts requests per address approximately, and separately on each of its machines. A steady stream from one connection is told to wait after roughly 200 requests in a minute. A burst spread over many connections can get several hundred through before the limit takes hold. It is a brake on a runaway program, not a wall.

If a publish is refused with a message about Analytics Engine, the counting service needs switching on once for the account, in the host's dashboard.
