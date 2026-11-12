# Contributing

Thank you for looking. Corrections and suggestions are welcome, from anyone. You do not need to write code to help: an issue that says "this page reads oddly" or "this link opens the wrong page" is useful.

New here? Start with the [README](README.md); the notes in [`docs/`](docs/) explain how each part works.

## The ground rules

This site shows a dataset. It does not change the dataset's figures.

- A wrong figure is a correction to the dataset repository, not to this site. Open an issue there with the filing, the schedule and the line.
- Never edit files in `src/data/dataset/` by hand. Run `npm run sync` to copy a new dataset version in; `npm run check:data` fails if a copied file differs from `SOURCE.json`.
- Colours, fonts, radii and spacing live only in `src/styles/tokens.css`.
- No third-party scripts, fonts or images, no inline scripts or `style` attributes, no cookies or storage.
- Words: short sentences, no adjectives about a filer or vendor, no ranking language, names exactly as filed.
- Before a change is merged: `npm run check:data`, `npm run check`, `npm test`, `npm run build`, `npm run check:dist` all pass.
