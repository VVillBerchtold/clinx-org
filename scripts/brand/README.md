# The brand drawings and how to redraw them

The rules for using them are in [`docs/brand.md`](../../docs/brand.md). This page is about making the files.

| File here | What it is |
|---|---|
| `outlines.mjs` | The shapes of the five letters of "ClinX", read once from Bricolage Grotesque at weight 800. Data only |
| `build.mjs` | Draws the wordmark, the mark and the tab icon from those shapes. The site's header uses it too (`src/components/Wordmark.astro`) |
| `share-card.html` | The picture a link to clinx.org shows when shared |
| `repo-cards.html` | The pictures the three repositories show when shared |

## The drawings (SVG)

```bash
node scripts/brand/build.mjs
```

It needs nothing installed and writes `public/favicon.svg` and, in `public/brand/`, the two wordmarks, the two marks and the square mark. Change a colour or a shape in `build.mjs`, run it again, and every drawing follows.

## The pictures (PNG)

These are made from the drawings by hand, with any tool that turns an SVG into a PNG. With `rsvg-convert`:

```bash
cd public/brand
rsvg-convert -w 512  clinx-mark.svg        -o clinx-mark-512.png
rsvg-convert -w 1024 clinx-mark.svg        -o clinx-mark-1024.png
rsvg-convert -w 1024 clinx-mark-square.svg -o clinx-mark-square-1024.png
rsvg-convert -w 180  clinx-mark-square.svg -o ../apple-touch-icon.png
rsvg-convert -w 32   clinx-mark.svg        -o ../favicon-32.png
```

`public/favicon.ico` holds the mark at 16, 32 and 48 pixels for older browsers; ImageMagick joins three PNGs into one: `magick 16.png 32.png 48.png favicon.ico`.

## The cards

Run `npm install` first, because the cards load the typefaces from `node_modules`. Then open the file in a browser window of the stated size and save a picture of it.

- `share-card.html` at 1200 by 630 becomes `public/brand/share-card.png`.
- `repo-cards.html#clinx-340b`, `#clinx-radar` and `#clinx-org` at 1280 by 640 become `public/brand/card-clinx-340b.png` and so on. Each is then uploaded by hand in that repository's settings on GitHub, under Social preview.

## Check by looking

After any change, look at the mark at 16, 32 and 64 pixels on a light and a dark background, and at the header on a phone and a desktop in both themes. A drawing that passes every check can still look wrong.
