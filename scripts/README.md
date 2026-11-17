# Tools that run outside the pages

None of these ship to a reader's browser. They run when the site is built, checked, refreshed or published.

| File | When it runs | What it does |
|---|---|---|
| `sync-data.mjs` | `npm run sync` | Copies a dataset version in and records a fingerprint of each file |
| `dataset-shape.mjs` | Used by the two scripts around it | The files, columns, forms and units the site expects. Refuses a copy that holds a claim count of 1 to 5 |
| `check-data.mjs` | `npm run check:data` | Confirms each copy (the dataset, the bills tables, the program for assistants) is byte for byte what was copied in |
| `sync-bills.mjs` | `npm run sync:bills` | Copies the bills table and the calendar table in from the `clinx-340b-bills` folder and records a fingerprint of each file |
| `bills-shape.mjs` | Used by `sync-bills.mjs` and `check-data.mjs` | The columns, roles, steps and links the site expects of the bills table, and the columns, kinds and links it expects of the calendar table |
| `sync-mcp.mjs` | `npm run sync:mcp` | Copies the program that answers AI assistants in from the `clinx-mcp` folder and records a fingerprint of each file. Refuses a file a web host could not run |
| `usage/mcp-usage.mjs` | `npm run usage:mcp` | Prints how the door for assistants is being used: counts by kind, read from the host with a read-only token. No words typed and no addresses are in them |
| `check-live-mcp.mjs` | `npm run check:live`, by hand after a publish | Asks the published door for assistants real questions through each of its tools and fails if an answer disagrees with the published tables or health centers files |
| `sitemap.mjs` | After every build | Writes the list of pages search engines may read. Writes none while the site is a private preview |
| `check-dist.mjs` | `npm run check:dist` | Reads the built site and fails if a page breaks one of the site's promises |
| `single-file.mjs` | By hand, after a build: `node scripts/single-file.mjs file-check` | Packs a tool page into one file that holds the whole tool and can open no connection. With `--version`, `--made` and `--write` it makes the saved copy in `public/` and records its fingerprint in `src/lib/saved-copies.json`. Without them it says whether the copy on record is what the build gives now. The copy is not remade by a build, so it stays the same until someone replaces it on purpose |
| `security-txt.mjs` | Used by `check-dist.mjs` | The rule for the file that says where to report a security problem: it is there, names a contact, and its end date is at least 30 days away |
| `check-drug-pages.mjs` | `npm run check:dist` | The same, for the drug pages: no small claim count, rows match the download |
| `refresh/` | Once a month | Pulls the federal registry export and the FDA directory, compares, rebuilds |
| `reference/build-fda-ndc.mjs` | Once a month, or by hand | Rebuilds the drug names file from the FDA directory |
| `deploy/publish.sh` | Only when a person publishes | Publishes `dist/` with one pinned tool |
| `brand/build.mjs` | By hand, and when the site is built | Draws the ClinX wordmark, mark and tab icon from one set of letter shapes ([how](brand/README.md)) |
| `brand/make-share-cards.mjs` (with `share-cards.json` and `share-cards.html`) | A script, by hand, when a card changes | Draws the link-preview pictures of the site's sections into `public/brand/share/` |
| `brand/repo-cards.html` | By hand | The drawing behind the three repository pictures |

The check scripts have no dependencies on purpose: a check should not rest on the thing it checks.

More: [The checks](../docs/the-checks.md), [The monthly refresh](../docs/the-monthly-refresh.md), [Publishing](../docs/publishing.md).
