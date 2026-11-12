# The one program that runs on the host

Every page of the site is a plain file. This folder is the single exception: the sender behind the contact form.

| File | What it does |
|---|---|
| `index.ts` | The door. Passes `/api/contact` to the sender and answers "not found" for anything else under `/api/` |
| `contact.ts` | Checks a posted form, turns it into one email to one fixed address, and sends the reader to a "sent" or "problem" page |

It stores nothing and logs nothing a visitor typed. The full list of what it refuses is in [Publishing and the contact form](../docs/publishing.md#the-contact-form). Its tests are in `tests/contact.test.ts`.
