<p>
  <a href="https://clinx.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/brand/clinx-wordmark-on-dark.svg">
      <img src="public/brand/clinx-wordmark-on-light.svg" alt="ClinX" height="28">
    </picture>
  </a>
</p>

# clinx-org

This is the code for [clinx.org](https://clinx.org), a free website of open healthcare data and small tools for clinics. So far the data covers the federal 340B drug program (what hospitals and health centers report to their states, the state laws, the bills, the federal notices and their dates) and the federally funded health centers (their yearly reports to HRSA, funding dates and shortage areas). The tools work on a report in your browser and keep the file on your computer.

You do not need to be a programmer to find your way around here. This page explains what the site is, where its numbers come from and where each part lives. The deeper notes are in [`docs/`](docs/), one topic to a page.

## What the site does

- It shows the figures each filer reported: what it paid for 340B drugs, what it was paid, and what went to outside vendors.
- Every figure is a link. It opens the filing's own PDF at the page the figure was read from.
- It gives no opinions. It does not grade a filer or say why a figure is what it is.

It also lists the state laws that name 340B, state by state and by kind, each with a plain summary and a link to the state's own page.

And it lists the bills in Congress and the state legislatures that name 340B: what each one is, how far it has got, and where to read it on the legislature's own site. A calendar shows the dated steps of those bills and the days each session starts and ends, with a file to add them to your own calendar.

It lists the federal rules and notices that name 340B too: what each one does about 340B in a sentence, the day comments close and the day it takes effect, all on the same calendar. One page sets out the 340B rebate pilot, from the federal notice that opened it.

An AI assistant can read the laws, bills, notices and calendar as well, and the health centers files, at `clinx.org/mcp`. It only reads, and the site keeps no question it is asked.

Six states are in the scorecard today: Rhode Island, Vermont, Minnesota (two years of its report), Idaho, Maine and Ohio (241 Excel workbooks, one for each covered entity). Each state has its own form, so the site never adds two states together or sets them side by side as if they were alike.

## Where the numbers come from

The site is the last of three steps. Each step is its own repository, and each can be used without the others.

```mermaid
flowchart LR
  filings["State filings<br>(public PDFs)"] --> dataset["clinx-340b<br>the dataset"]
  dataset --> site["clinx-org<br>this site"]
  registry["Federal 340B registry<br>(daily export)"] --> radar["clinx-radar<br>what changed"]
  radar --> site
  fda["FDA drug directory"] --> site
```

| Repository | What it is |
|---|---|
| [clinx-340b](https://github.com/VVillBerchtold/clinx-340b) | The dataset. Every figure read from the filings, checked against a second, separate read, and kept with its page number. Corrections are reported there. |
| [clinx-radar](https://github.com/VVillBerchtold/clinx-radar) | A small tool that keeps dated copies of the federal 340B registry and reports what changed between two dates. |
| [clinx-340b-registry](https://github.com/VVillBerchtold/clinx-340b-registry) | The registry history. A copy of the federal 340B registry for every day since 23 November 2026, kept as a daily delta, and the code that rebuilds its history since 2010 for the [registry history page](https://clinx.org/registry/). |
| clinx-org (you are here) | The website. It reads the dataset and draws the pages. It never changes a figure. |

## What the site promises, and how the code keeps each promise

A promise on a web page is easy to make. Each one below is kept by something that runs on every build, so it cannot quietly stop being true.

| The promise | How it is kept | Where to look |
|---|---|---|
| Every figure links to its source | One component draws every cited figure, and it cannot be used without a source link: the type check fails | `src/components/Cited.astro` |
| The data is the dataset's, unchanged | The dataset is copied in with a fingerprint of each file. The build stops if a copied file differs | `scripts/sync-data.mjs`, `scripts/check-data.mjs` |
| No trackers, cookies or outside scripts | The page security policy allows nothing from outside the site. A scan of the built site fails if anything slips in | `public/_headers`, `scripts/check-dist.mjs` |
| A claim count of 1 to 5 is never shown | The dataset leaves it out and the pages say "fewer than 6". The site refuses a dataset copy that holds one | `scripts/dataset-shape.mjs`, `scripts/check-drug-pages.mjs` |
| The pages work with scripts turned off | Tables, charts and the contact form are plain HTML. Scripts only add sorting, search and menus | `src/scripts/` |
| Money never picks up a rounding error | Amounts are whole cents, never decimal fractions | `src/lib/money.ts` |
| Nothing is published by accident | Publishing needs a person to start it and type a confirmation. Every check runs first | `.github/workflows/publish.yml` |

## A map of the folders

| Folder | What is in it |
|---|---|
| `src/pages/` | One file for each page or kind of page. The folder names match the site's addresses. |
| `src/components/` | Pieces the pages share: a cited figure, a table of measures, a meter, the section menu. |
| `src/lib/` | The logic, kept apart from the pages: reading the dataset, money, each state's form, how names are written. |
| `src/data/dataset/` | A copy of the dataset, made by `npm run sync`. Never edited by hand. |
| `src/styles/` | The look. Every colour, typeface and spacing value is in `tokens.css`. |
| `src/scripts/` | The small scripts that run in the browser: sorting, the drug search, menus, the article's demo. |
| `public/` | Files served as they are: the downloads, the security headers, the pictures. |
| `worker/` | The one program that runs on the host. It sends the contact form's message on as an email, and it answers AI assistants that look things up in the open tables. It keeps no message and no question. |
| `scripts/` | Tools that run at build time or once a month: the copy step, the checks, the refresh, publishing. |
| `reference/` | Drug names from the FDA's public directory, with a record of the day they were read. |
| `refresh/` | Dated copies of the federal registry for the monthly comparison. They hold no person's name. |
| `tests/` | The tests. Many of them read the whole dataset, not a sample. |
| `docs/` | Longer notes on how things work and why. |

## Run it on your computer

You need Node 22.23.4 or later (the exact version is in `.nvmrc`).

Install what the site needs. Every version is pinned, so you get the same files we do.

```bash
npm ci
```

Then run the checks and build the site into `dist/`.

```bash
npm run check:data && npm run check && npm test && npm run build && npm run check:dist
```

| Command | What it does |
|---|---|
| `npm run check:data` | Confirms the copied dataset is byte for byte what was copied in, and has the shape the site expects |
| `npm run check` | Checks the types in every page and script |
| `npm test` | Runs the tests |
| `npm run build` | Builds every page into `dist/` |
| `npm run check:dist` | Scans the built site for anything that would break a promise above |
| `npm run sync` | Copies a new version of the dataset in. Only needed when the dataset changes |

To see the built site in a browser, with the contact form working (mail is written to a file, not sent):

```bash
deploy/node_modules/.bin/wrangler dev --config wrangler.jsonc
```

## Read more

- [How the site is built](docs/how-the-site-is-built.md): the rules every page follows, and why.
- [How figures and names are written](docs/how-figures-and-names-are-written.md): tidy on the page, untouched in the data.
- [The checks](docs/the-checks.md): what the scan of the built site looks for.
- [Being found](docs/being-found.md): what each page tells search engines, and how that is kept honest.
- [The monthly refresh](docs/the-monthly-refresh.md): how the federal registry and the FDA names are brought up to date.
- [Publishing and the contact form](docs/publishing.md): the host, the go-live switch and the one program that runs there.
- [Changelog](CHANGELOG.md) and [how to contribute](CONTRIBUTING.md).

## Found something wrong?

A wrong figure is a correction to the dataset, not to this site. Please open an issue in [clinx-340b](https://github.com/VVillBerchtold/clinx-340b) that names the filing, the schedule and the line. The PDF governs.

For anything about the pages themselves, open an issue here or write to will@clinx.org.

## Licences

The code is under the MIT licence ([LICENSE](LICENSE)). The data is under Creative Commons Attribution 4.0. The names "ClinX" and "ReferralFinderX", their logos, the fonts and the founder's photograph have their own terms: see [NOTICE.md](NOTICE.md).
