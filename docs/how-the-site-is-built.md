# How the site is built

**In short:** the site is plain pages made ahead of time from the dataset. Nothing is worked out while you read. The rules below are the ones every page follows.

## The pages are made ahead of time

The site is built with [Astro](https://astro.build) and TypeScript. A build reads the dataset and writes every page as an ordinary HTML file into `dist/`. The host only hands those files out. There is no database behind the pages and no sign-in.

One small program runs on the host: the contact form's sender in `worker/`. See [Publishing and the contact form](publishing.md).

## Each state has its own form

Rhode Island's filers use the state's nine-schedule form. Vermont's hospitals use a different report. Minnesota publishes its own table of entities. Idaho publishes statewide totals only, with no figure for any one entity. The forms do not ask for the same things.

`src/lib/forms.ts` is the one place that knows a form: which rows a view reads, how the three measures are worked out, and which words fit ("filing" or "report", "calendar year" or "fiscal year"). Pages follow the form, never the state's two letters. If the dataset names a form that file does not know, the build stops.

Because the forms differ, two states are never added together or set side by side as comparable. Within a state, health centers are compared only with health centers, and hospitals only with hospitals.

## State laws sit beside the Scorecard

The menu's first entry, 340B, opens two things: the Scorecard (what filers report) and State laws (what each state has passed). The laws come from the dataset's laws table and are read by `src/lib/laws.ts`.

- `/laws/` is the way in: a map and the seven kinds of law.
- A state with a law has its own page (`/laws/ri/`), with each law's summary, who it applies to, its dates, a passage from its text and a link to the state's own page. A state with no law in the table has no page; its tile on the map is not a link.
- Each kind of law has a page (`/laws/reporting/`) that lists every law of that kind.

The pages show only what a law says. Notes about the source pages, and the laws that were left out of the table, stay in the data files and in Methods.

## Bills sit beside the laws

A law is on the books. A bill is a proposal that may never pass. The third entry under 340B in the menu, Bills, lists the bills in Congress and in the state legislatures that name the 340B program.

The bills come from a table of their own, kept in a separate folder (`clinx-340b-bills`), because it changes far more often than the dataset does. `npm run sync:bills` copies that table in, checks its shape (`scripts/bills-shape.mjs`) and records a fingerprint of each file in `src/data/bills/SOURCE.json`. `npm run check:data` confirms the copy has not changed since. The pages read it through `src/lib/bills.ts`.

- `/bills/` is the way in: a map of the states with a bill, a door to Congress, the newest steps, and how the list is put together.
- Congress has a page (`/bills/congress/`) and so does each state with a bill (`/bills/ri/`). Bills are grouped by session, the newest session first.
- Each bill is a card (`src/components/BillCard.astro`): its number and title, how far it has got on five steps, its latest step in the legislature's own words, the passage that names 340B, and links to the legislature's own pages.
- Where a person has read the bill, the card also says in one sentence what it would do, and whether the bill is about 340B, has a part on it, or only mentions it. Bills that only mention it are a short list at the end of their session.

A bill is listed only if its title, its official summary or its official text names the program. The words quoted on a card are the legislature's, so the site's word check does not apply to them (`PRINTED_BILL_WORDS` in `scripts/check-dist.mjs`); it still applies to every word the site writes itself.

## The calendar is the bills' dates

The fourth entry under 340B in the menu, Calendar, shows when things happen: the dated steps of every listed bill (introduced, sent to committee, voted on, signed), hearings whose agenda names a listed bill, and the days each legislature's session starts and ends. There is one page for the whole country, one for Congress and one for each state.

- The dates come from `src/data/bills/events.csv`, copied in with the bills table by `npm run sync:bills` and checked by the same record. `src/lib/calendar.ts` reads it; the pages are in `src/pages/calendar/`.
- "Coming up" is counted from the day the table was retrieved, not from the day the page is opened, so the same table always builds the same page. A date that has passed moves to "What has happened" when the table is next brought in.
- The words on each row are the legislature's own, and each row links to the legislature's page. The page says plainly that a date can move.
- Each page offers a calendar file (`340b.ics`) that a calendar app can open or subscribe to. It is a plain text file built with the site: no script, no account.

## Every figure has a source

A figure is drawn by one component, `src/components/Cited.astro`. It links to the filing's PDF at the page the figure was read from. A sum of several filings links to the table that lists them.

## Small claim counts are not shown

A claim count of 1 to 5 is left out of the dataset. The pages say "fewer than 6" in its place. The site also guards the rule itself: `scripts/dataset-shape.mjs` refuses a copy of the dataset that holds such a count, and `scripts/check-drug-pages.mjs` scans every built drug page for one.

Details of the person who signed a filing are not in the data at all.

## It works with scripts turned off

Every table, chart and form is plain HTML. The scripts in `src/scripts/` add comforts on top: sortable columns, the drug search, the phone menu, the bar that follows you down a long page. With scripts off, the tools that need them stay hidden and everything else still reads.

Charts are SVG drawn at build time (`src/lib/meter.ts`, `src/lib/states.ts`). The numbers a chart shows are also on the page as text or in a table.

## Nothing comes from outside the site

- No third-party scripts, fonts or images. The two typefaces are served from the site's own files.
- No analytics, no cookies, nothing stored in the browser.
- A strict Content-Security-Policy with no `unsafe-inline`: no inline scripts, no inline styles, no `style` attributes. The policy is in `public/_headers` and repeated in a tag on every page. (The one block of data each page gives search engines is not a script the browser runs; see [Being found](being-found.md).)

## Money is counted in whole cents

Amounts are whole numbers of cents, or the text exactly as filed. They are never floating-point numbers, so no rounding error can creep in (`src/lib/money.ts`). Shares are whole millionths.

## The look lives in one file

Every colour, typeface, corner radius and spacing value is in `src/styles/tokens.css`. The other stylesheets use those values and nothing else. There are light and dark themes; the page follows the reader's own setting.

## The words

- Plain, short sentences.
- No adjectives about a filer or a vendor, and no ranking words.
- Names exactly as filed.
- The wording about methods comes from the dataset's `METHODS.md` and is rendered from it, not retyped.

## What it depends on

`astro` builds the site. For development there are `@astrojs/check`, `typescript`, `vitest` and the two font packages. Every version is exact and `package-lock.json` is committed. The publishing tool is kept apart, in `deploy/`, with its own lock file.
