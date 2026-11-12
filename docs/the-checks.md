# The checks

**In short:** five checks run before anything is published. The last one reads the finished site, file by file, and fails if a page breaks one of the site's promises. A rule that is only written down gets forgotten; a rule that fails the build does not.

## The five checks, in order

| Command | What it confirms |
|---|---|
| `npm run check:data` | The copied dataset is byte for byte what was copied in (each file's fingerprint matches `SOURCE.json`), and it has the files, columns, forms and units the site expects |
| `npm run check` | The types in every page and script are sound. A figure drawn without a source link fails here |
| `npm test` | The tests pass. Many read the whole dataset, not a sample |
| `npm run build` | Every page builds. A form the site does not know, or a drug code with no line in the FDA names file, stops it here |
| `npm run check:dist` | The built site keeps its promises (below) |

## What the scan of the built site fails on

`scripts/check-dist.mjs` reads every file in `dist/`. It has no dependencies and reads HTML with its own careful tag scanner.

**Anything from outside the site**
- A script, image, stylesheet or font loaded from another address.
- A script that opens a network connection. The one exception is the article's demo, whose single call goes to an address that cannot exist, to show that nothing leaves the browser.

**Anything that weakens the page security policy**
- An inline script or style, a `style` attribute, or an `onclick`-style attribute.
- A page without the policy tag, or with one that differs from `public/_headers`.
- A `form` anywhere but the contact page, or an `iframe`, `object`, `embed` or `base` element.

**Anything that breaks the site's voice**
- The ranking words `highest`, `lowest`, `worst`, `best` or `top` in page text.
- An email address other than the contact address.

**Anything a reader would trip on**
- A link or `#anchor` that leads nowhere.
- A page without exactly one main heading, a title, a description or a language.
- A table without a caption.
- A linked figure touching the word beside it.

**Search engines told two different stories**
- `robots.txt`, each page's own "do not list" tag and `sitemap.xml` must agree: either the private preview (nothing listed) or the public site (everything listed except "page not found" and the contact form's answer pages).
- A "Draft wording" tag on a public build.
- A page whose canonical address is not its own, or a missing link-preview picture.

## The drug pages get their own scan

`scripts/check-drug-pages.mjs` reads every built drug page. It fails if a page shows a claim count of 1 to 5, if its rows do not match its download, or if the search tools are not hidden for readers without scripts.

## Checks that are run by hand

Before a release the pages are also put through Lighthouse and axe-core (accessibility and speed, light and dark, phone and desktop), walked through with a keyboard, and opened in Firefox and in Safari's engine. These need a browser, so they are not part of the build.
