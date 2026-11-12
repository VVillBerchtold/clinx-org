# The logic, one job to a file

Everything here is plain TypeScript with no page markup, so each file can be read and tested alone. The tests are in `tests/`.

| File | Its one job |
|---|---|
| `data.ts` | Loads the copied dataset and hands the pages typed rows |
| `csv.ts` | Reads CSV text into records |
| `forms.ts` | Knows each state's form: which rows a view reads, how the measures are worked out, which words fit |
| `states.ts` | The states, and where each stands on this site |
| `money.ts` | Money as whole cents, and how a filed figure is written on a page |
| `drugs.ts` | Reading a claims cell, splitting drug codes, searching and adding drug rows |
| `drug-groups.ts` | Puts every filer's rows for the same drug side by side |
| `fda-names.ts` | The names the FDA directory lists for the drug codes in the filings |
| `fda-display.ts` | How an FDA name is written on a page |
| `filed-drug-display.ts` | How a filer's own drug name is written on a page |
| `meter.ts` | The two marks drawn from a share, made at build time |
| `markdown.ts` | Turns the dataset's methods text into safe HTML |
| `contact-topics.ts` | The subjects on the contact form: one list, shared by the page and the sender |
| `site.ts` | The site's name, address, contact address and the go-live switch |

Two rules hold across the folder:

- **No floating-point money.** An amount is a whole number of cents or the text as filed. See `money.ts`.
- **Pages follow the form, never the state.** A page asks `forms.ts` what a filing's form means. It never checks for "RI" or "VT".

More: [How the site is built](../../docs/how-the-site-is-built.md) and [How figures and names are written](../../docs/how-figures-and-names-are-written.md).
