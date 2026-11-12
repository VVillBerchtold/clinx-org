# The ClinX brand

A two-minute read. It covers how the name is written, the two drawings, the colours and the typefaces, so that everything carrying the ClinX name looks like it came from one place.

## The name

Write **ClinX**: capital C, capital X, one word. Not Clinx, CLINX, Clin-X or Clin X. The site is **clinx.org**, in lower case.

## The wordmark and the mark

| | What it is | Files |
|---|---|---|
| **Wordmark** | The name in the site's heavy lettering, in one colour, with the dot of the i in purple | `public/brand/clinx-wordmark-on-light.svg`, `clinx-wordmark-on-dark.svg` |
| **Mark** | That same dot by itself, with nothing behind it | `public/brand/clinx-mark.svg`, `clinx-mark-on-dark.svg`, PNG at 512 and 1024 |

The dot is the typeface's own dot. It is a little wider than it is tall, so it is not a plain circle. Use the files; do not redraw it.

- **Which one.** Use the wordmark wherever the name fits. Use the mark only where it cannot: a browser tab, an app icon, a profile picture.
- **Not side by side.** The wordmark already holds the dot, so the mark is never placed next to it.
- **Clear space.** Keep a gap as wide as the dot on every side of the wordmark, and half the mark's width around the mark.
- **Smallest size.** Wordmark: 16 pixels tall. Mark: 16 pixels.
- **Where a square is needed** (a picture that is cut to a circle, or cannot show through), use `clinx-mark-square.svg`: the dot on the light page colour.

## Colours

| | Light pages | Dark pages |
|---|---|---|
| Purple (the dot, links, buttons) | `#3437e6` | `#8f96ff` |
| Ink (the name, text) | `#0b0d24` | `#f1f2fb` |
| Page | `#f4f5fc` | `#080a1a` |

Purple is the brand colour. The full set the site uses lives in `src/styles/tokens.css`.

## Typefaces

- **Bricolage Grotesque** for headings and the wordmark (weight 800).
- **Instrument Sans** for everything else.

Both are open typefaces and are served from the site itself.

## ClinX and ReferralFinderX

They are separate brands by the same founder, Will Berchtold. Each keeps its own name, logo and colours. When one mentions the other it is in plain words or with the other's own logo, as on the Products page. Never blend the two logos, and always write ReferralFinderX in full.

## What not to do

- Do not colour the X, or any letter. The only purple in the name is the dot.
- Do not use an X, in a square or otherwise, as the mark.
- Do not put the dot on a purple square, stretch it, tilt it or make it a perfect circle.
- Do not set the name in another typeface or weight and call it the wordmark.
- Do not build a logo from one tool's picture, such as the Scorecard's tile map. The map can illustrate that tool; it is not the brand.
- Do not place either drawing on a busy photograph or on a colour where the dot is hard to see.

## The name and the drawings are not open-licensed

The code and the data are open, under the licences named in each repository. The ClinX name, the wordmark and the mark are not covered by those licences. Using them to point at ClinX is fine; using them to suggest that ClinX made or approves something else is not. The About page says the same.

## Redrawing

Everything comes from one script. See [`scripts/brand/README.md`](../scripts/brand/README.md).
