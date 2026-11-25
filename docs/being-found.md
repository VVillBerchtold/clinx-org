# Being found

**In short:** a public dataset helps nobody who cannot find it. Each page tells search engines plainly what it is, in a small block of data they are built to read. The block repeats what is on the page and nothing more. No tracker, no outside script and no advertising tool is involved.

## What each page says about itself

| Page | What it tells a search engine | Why |
|---|---|---|
| Home | This is the site ClinX, published by the organization ClinX, founded by Will Berchtold; the organization's mark, and its public code as `sameAs` | So a search for "clinx" finds ClinX by name, with the right mark and the right person |
| About | This is the page about the organization ClinX (its main subject), and here is the person who founded it, with his other public pages | So About is the page that answers who ClinX is, and a search engine knows the Will Berchtold here is the same person as on those pages |
| Data | These are datasets: the 340B state filings with its name, version, licence, the states and years it covers, and every file; and one for each part of the health centers files (the records, the funding calendar, the shortage areas) with its name, licence and files. Each names who made it: Will Berchtold, with the About page as his address | So each dataset can be listed by dataset search engines, such as Google's Dataset Search |
| The article | This is an article, with its title, author and date | So it can be shown as an article |
| Every page but the home page | The trail from the home page to this page (ClinX, Scorecard, Rhode Island, …) | So a search result can show the trail in place of a bare address |

Pages a search engine may not list ("Page not found" and the contact form's two answer pages) carry no block.

## Where it lives

- `src/lib/structured-data.ts` builds each block. The dataset's block is made from the dataset itself: its version, its states, its years and the files on the Data page. It cannot drift from what the page shows. The three health centers blocks are made from the same list of files the Data page shows. They give years for the records only, and no size, version or date that the files do not state.
- `src/layouts/Base.astro` writes the block into the page. A page passes `crumbs` (its trail) and `about` (what else it is).
- The vocabulary is [schema.org](https://schema.org), the one search engines share.

## Titles

A page's title is the line a search result shows. Each one says what the page holds in the words a person would type.

- A state's 340B report page in the Scorecard: "<State> 340B hospital report" in the title and in the heading, then the year ("Minnesota 340B hospital report: 2024 data by entity"). `stateReportTitle` in `src/lib/state-pages.ts` writes it for every layout, so a state added later gets it too, and `npm run check:dist` fails a `/scorecard/<st>/` page without it.
- A state's other pages: "Rhode Island 340B laws: contract pharmacy, PBMs and reporting" (the kinds of law it has), "Rhode Island 340B legislation: 4 bills", "Rhode Island 340B calendar: bill steps, hearings and session dates", "Rhode Island shortage areas (HPSA, MUA) and health center sites", "Rhode Island health center UDS reports, 2021 to 2025". Each is built from the page's data.
- A state page's side panel (or its foot, where it has no panel) lists that state's pages in the other sections ("Rhode Island on ClinX"), from `statePages` in the same file.

## The block is data, not a program

The site allows no inline script: its security policy has no `unsafe-inline`. This block is not a script in that sense. Its type tells the browser it is data, so the browser never runs it, and the security policy does not apply to it.

It is still checked on every build. `npm run check:dist` fails if a block:

- is not well-formed, or holds a raw `<`, `>` or `&` (so no name in the data can ever break out of it);
- names a page or a file on this site that the build did not produce;
- sits on a page search engines may not list;
- gives a trail that does not run from the home page to the page it is on;
- describes the dataset without a name, a licence or its files.

`tests/structured-data.test.ts` checks the same things at the source, including that each dataset's block lists exactly its downloads on the Data page.

## The page list and IndexNow

- `sitemap.xml` is written after every build from the pages built (`scripts/sitemap.mjs`), and `robots.txt` names it.
- IndexNow tells Bing and the other engines that use it (Yandex, Seznam, Naver) about new pages. The site proves it is clinx.org with a key served at its root, `public/<key>.txt`, whose text is the key itself. The key is public by design: it opens nothing and only lets someone ask a search engine to re-read a page of this site. To replace it, put a new key file in `public/` and delete the old one.
- `scripts/indexnow.mjs` does the asking. `scripts/deploy/publish.sh` runs it around every publish: before, it lists the pages in the new sitemap that the live one lacks; after, it sends them. A failure is reported and never stops a publish. After a change that touches many existing pages, send them all once by hand: `node scripts/indexnow.mjs send --all`.

## What is not done here

Signing the site up with a search engine (Google Search Console, Bing Webmaster Tools) and submitting `https://clinx.org/sitemap.xml` there is done by the owner in those tools.
