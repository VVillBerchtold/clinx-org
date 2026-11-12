# Being found

**In short:** a public dataset helps nobody who cannot find it. Each page tells search engines plainly what it is, in a small block of data they are built to read. The block repeats what is on the page and nothing more. No tracker, no outside script and no advertising tool is involved.

## What each page says about itself

| Page | What it tells a search engine | Why |
|---|---|---|
| Home | This is the site ClinX, built by Will Berchtold | So a search for the site's name shows the right name and the right person |
| About | This is the page about ClinX, and here is the person who builds it, with his other public pages | So a search engine knows the Will Berchtold here is the same person as on those pages |
| Data | This is a dataset: its name, version, licence, the states and years it covers, and every file | So the dataset can be listed by dataset search engines, such as Google's Dataset Search |
| The article | This is an article, with its title, author and date | So it can be shown as an article |
| Every page but the home page | The trail from the home page to this page (ClinX, Scorecard, Rhode Island, …) | So a search result can show the trail in place of a bare address |

Pages a search engine may not list ("Page not found" and the contact form's two answer pages) carry no block.

## Where it lives

- `src/lib/structured-data.ts` builds each block. The dataset's block is made from the dataset itself: its version, its states, its years and the files on the Data page. It cannot drift from what the page shows.
- `src/layouts/Base.astro` writes the block into the page. A page passes `crumbs` (its trail) and `about` (what else it is).
- The vocabulary is [schema.org](https://schema.org), the one search engines share.

## Titles

A page's title is the line a search result shows. Each one says what the page holds in the words a person would type: "Rhode Island 340B filings, 2025", "Thundermist Health Center: 340B filing, 2025". The heading on the page itself stays short.

## The block is data, not a program

The site allows no inline script: its security policy has no `unsafe-inline`. This block is not a script in that sense. Its type tells the browser it is data, so the browser never runs it, and the security policy does not apply to it.

It is still checked on every build. `npm run check:dist` fails if a block:

- is not well-formed, or holds a raw `<`, `>` or `&` (so no name in the data can ever break out of it);
- names a page or a file on this site that the build did not produce;
- sits on a page search engines may not list;
- gives a trail that does not run from the home page to the page it is on;
- describes the dataset without a name, a licence or its files.

`tests/structured-data.test.ts` checks the same things at the source, including that the dataset's block lists exactly the downloads on the Data page.

## What is not done here

Signing the site up with a search engine (Google Search Console, Bing Webmaster Tools) is done by the owner in those tools. It needs one line added to the domain's records and nothing in this repository.
