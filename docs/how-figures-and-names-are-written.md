# How figures and names are written

**In short:** filers type things in many ways ("982072", "48110.4", "TETRACYCLINE HCL 500MG CAPS"). The pages write them one way so they are easy to read. The stored values never change, and every download keeps them exactly as filed.

## What is tidied on the page

| What | As typed | On the page | Where the rule lives |
|---|---|---|---|
| A filed amount or count | `982072`, `48110.4` | `982,072`, `48,110.40` | `drawFigure` in `src/lib/money.ts` |
| A filer's own drug name | `TETRACYCLINE HCL 500MG CAPS` | `Tetracycline HCl 500 mg caps` | `src/lib/filed-drug-display.ts` |
| A name from the FDA directory | `DESCOVY` | `Descovy` | `src/lib/fda-display.ts` |

The rules, in plain words:

- **Figures** get commas between thousands. An amount filed with one decimal place is written with two. Anything that is not one plain number (a word, a code, a number with a leading zero) is left as filed.
- **A filer's drug name** gets steady capitals, spaces and unit names, a zero before a bare decimal point, and commas in long numbers. No word is replaced, spelled out or dropped. A short word the rules do not know stays as typed, because it may be shorthand. A name typed in mixed capitals keeps its words as typed.
- **FDA names** get the same treatment for capitals, strengths and unit names.

The name as typed rides along with each row, so the search on a drug page finds a drug by either spelling.

## What is never touched

- Vendor names.
- The dataset files and every download.
- `reference/fda-ndc/names.csv`.
- The filing PDF each figure links to.

## How we know the tidying changes nothing

A new rule needs a test in `tests/money.test.ts`, `tests/fda-display.test.ts` or `tests/filed-drug-display.test.ts`.

The last of these does not check a few examples and hope. It runs every drug name in the dataset through the rules and confirms that the words are the same words in the same order and that every number keeps its value. The FDA test reads the whole names file in the same way. A name the rules cannot handle fails the tests; it does not show up odd on a page.

## Drug names from the FDA directory

Drug pages show, beside each filer's own wording, the name the FDA's National Drug Code Directory lists for the drug code. Those names are in `reference/fda-ndc/names.csv`: one line for every code filed as one 11-digit NDC, matched or not. The build stops if a filed code has no line.

- A name once listed is kept. If the directory later drops a code, its line keeps the last name and the day it was last listed, and the page says so on that row.
- A changed name is replaced by the directory's current one.
- The directory's files are data. The script copies their text as listed and runs nothing from them. `reference/fda-ndc/SOURCE.json` records the day and a fingerprint of what was read.

The file is brought up to date once a month. See [The monthly refresh](the-monthly-refresh.md).
