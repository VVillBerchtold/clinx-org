# The one program that runs on the host

Every page of the site is a plain file. This folder is the single exception: one small program with two jobs. It sends the contact form's message on as an email, and it answers AI assistants that look things up in the open data (the 340B tables and the health centers files).

| File | What it does |
|---|---|
| `index.ts` | The door. Passes `/api/contact` to the form's sender and `/mcp` to the door for assistants, and answers "not found" for anything else that reaches it |
| `contact.ts` | Checks a posted form, turns it into one email to one fixed address, and sends the reader to a "sent" or "problem" page |
| `assistants.ts` | The host's side of the door for assistants: reads the tables from the site's own files, turns away an address that asks far too often, and counts what is asked by kind |
| `mcp/` | The program that answers assistants. It is written and tested in its own repository ([clinx-mcp](https://github.com/VVillBerchtold/clinx-mcp)) and copied in by `npm run sync:mcp`. Never edited here: `npm run check:data` fails if a copy differs from its record in `mcp/SOURCE.json` |

It stores no message and no question, and logs nothing a visitor typed. The one thing kept is a count of assistants' lookups by kind, with no words and no address in it.

More: [the contact form](../docs/publishing.md#the-contact-form) and [the door for assistants](../docs/publishing.md#the-door-for-assistants). The tests are in `tests/contact.test.ts`, `tests/assistants.test.ts` and `tests/mcp-usage.test.ts`.
