# Tools that run outside the pages

None of these ship to a reader's browser. They run when the site is built, checked, refreshed or published.

| File | When it runs | What it does |
|---|---|---|
| `sync-data.mjs` | `npm run sync` | Copies a dataset version in and records a fingerprint of each file |
| `dataset-shape.mjs` | Used by the two scripts around it | The files, columns, forms and units the site expects. Refuses a copy that holds a claim count of 1 to 5 |
| `check-data.mjs` | `npm run check:data` | Confirms the copy is byte for byte what was copied in |
| `sitemap.mjs` | After every build | Writes the list of pages search engines may read. Writes none while the site is a private preview |
| `check-dist.mjs` | `npm run check:dist` | Reads the built site and fails if a page breaks one of the site's promises |
| `check-drug-pages.mjs` | `npm run check:dist` | The same, for the drug pages: no small claim count, rows match the download |
| `refresh/` | Once a month | Pulls the federal registry export and the FDA directory, compares, rebuilds |
| `reference/build-fda-ndc.mjs` | Once a month, or by hand | Rebuilds the drug names file from the FDA directory |
| `deploy/publish.sh` | Only when a person publishes | Publishes `dist/` with one pinned tool |
| `brand/build.mjs` | By hand, and when the site is built | Draws the ClinX wordmark, mark and tab icon from one set of letter shapes ([how](brand/README.md)) |
| `brand/share-card.html`, `brand/repo-cards.html` | By hand | The drawings behind the link-preview pictures |

The check scripts have no dependencies on purpose: a check should not rest on the thing it checks.

More: [The checks](../docs/the-checks.md), [The monthly refresh](../docs/the-monthly-refresh.md), [Publishing](../docs/publishing.md).
