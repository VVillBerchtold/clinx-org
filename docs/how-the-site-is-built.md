# How the site is built

**In short:** the site is plain pages made ahead of time from the dataset. Nothing is worked out while you read. The rules below are the ones every page follows.

## The pages are made ahead of time

The site is built with [Astro](https://astro.build) and TypeScript. A build reads the dataset and writes every page as an ordinary HTML file into `dist/`. The host only hands those files out. There is no database behind the pages and no sign-in.

One small program runs on the host: the contact form's sender in `worker/`. See [Publishing and the contact form](publishing.md).

## Each state has its own form

Rhode Island's filers use the state's nine-schedule form. Vermont's hospitals use a different report. Minnesota publishes its own table of entities. The forms do not ask for the same things.

`src/lib/forms.ts` is the one place that knows a form: which rows a view reads, how the three measures are worked out, and which words fit ("filing" or "report", "calendar year" or "fiscal year"). Pages follow the form, never the state's two letters. If the dataset names a form that file does not know, the build stops.

Because the forms differ, two states are never added together or set side by side as comparable. Within a state, health centers are compared only with health centers, and hospitals only with hospitals.

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
