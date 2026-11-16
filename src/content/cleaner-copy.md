# Getting a clinic report ready for AI help

Most of what a clinic knows about its own operations sits in reports that also carry its patients. A scheduling export has the visit type, the provider, the location and the length of the slot. On the same row it has the patient's name, date of birth and phone number. A referral log, a claims export and a 340B report are built the same way.

The work that needs doing is usually about the operations. A report takes two hours to clean up each month. Its totals never match the other system. A manager needs it in a form that can be read at a glance. None of that work depends on who the patients are, but the patients are on every row, so the file cannot go to anyone who might help with it.

AI assistants have made this harder to ignore. An assistant is good at the dull work around a report. It can write the Excel script that tidies it, the formula that sorts visits into the right group, or the steps for a bot that downloads the report and files it. To do that well it asks to see the file. For most clinic reports the answer has to be no.

ClinX is working on ways to get the useful part out of a file like this without handing over the rest. The first is a tool called Cleaner Copy.

## What an assistant needs from the file

A script that formats a report does not care who the patients are. It needs to know which sheet the data is on, which row holds the headings, what each column contains, how the dates are written, where the blanks and odd rows are, and what the formulas point to.

Every one of those facts survives if each name is swapped for random letters of the same length, each ID for another ID in the same pattern, and each date for another date. Cleaner Copy makes that swap. It gives back the same workbook, with the same sheets, headings, formats and formulas, and randomized values in the cells.

## The job it was built for

The tool started with a plain job at ClinX: turning raw exports into finished reports. That means scripts that reshape a monthly export into something a team can read at a glance, and automation that does the clicking a person does today, often called robotic process automation, or RPA.

An assistant can write most of a script like that in a few minutes if it has a realistic file to work from. With a copy it has one. The script is written and tested against the copy. Then it is run on the real report, on the clinic's own computer, where the real data already is. It works there because the two files have the same shape.

## How it works

The tool is a web page that takes you through four steps.

The first step is a short page on what the tool does and what it does not do.

In the second step you choose a workbook or a CSV file, and the page only looks. It tells you how many sheets, columns and formulas the file has. It also lists what you would not see by scrolling through the sheets: hidden sheets, macros, saved connections, built-in queries. Nothing has been changed at this point.

In the third step you see every column on every sheet, with its heading, what it holds and how many different values it has. Each column has three choices. Every column starts as randomized: each value is replaced with a random one of the same shape. A column can be left as it is, which is how a column such as visit type or payer keeps the real words a script may depend on. A column can also be coded, which is described further down. You can give a sheet a new name as well, because a sheet's name can itself name a place or a person.

In the fourth step the page makes the copy and checks it. The same original always gets the same replacement, so an ID that appears on two sheets still matches on both, and a lookup between them still works. Formulas are kept and work from the randomized values.

All of this happens in your browser, on your computer. The page is not allowed to open a connection. The browser rule behind that is described in the article "Reading a sensitive file without receiving it". The page also shows a count of the requests it has made since you chose the file.

## A workbook holds more than its cells

Replacing the cells is not enough. A pivot table keeps its own copy of the data it was built from. A filter remembers the values that were ticked. Comments, the author's name, hidden sheets and the saved results of formulas all travel with the file.

An early version of the tool replaced every cell in a workbook and still left eight values behind. They were inside colour rules: a rule that highlights a cell containing certain text stores that text.

So the tool does two more things. It replaces or clears what it finds outside the cells, and lists what it has left alone. Then it checks its own work: it searches the finished copy for every piece of text it replaced, and tells you what it found and where.

## Coded columns and the legend

Some columns are sensitive and still have to be told apart. A provider column is the usual case. A report that counts visits by provider needs each provider kept separate, and when the work is done you will want to read the result with the real names in it.

Coding a column gives each different value a short code. One provider becomes Provider A, another Provider B, and every row for the same person carries the same code. The codes are handed out in a random order, so the letters say nothing about the order of the names in the report.

A randomized column is consistent in the same way, but the page keeps no record of which random value stood for which real one. A coded column comes with that record. Beside the copy, the page offers a second file called the legend, which lists each code next to the real value it stands for.

The legend is real data. It stays with the real report and is not sent along with the copy. With it you can read an answer that comes back in codes, or have a script put the real names back on your own computer.

## Sometimes a description is enough

Often the file does not need to go anywhere. When the copy is made, the page can also write a description of the workbook: its sheets, its headings, the kind of value in each column, the formulas, and a few randomized rows. That text can be pasted into a chat. It is often enough for an assistant to write a working script, and no file leaves your computer at all.

## Where this stops helping

A column you leave as it is keeps its real values. A notes column holds free text that can say anything about anyone, so it should be replaced.

The legend undoes the coding. Anyone who holds both the copy and the legend has the real column back, so the two files should not travel together.

The rows of the copy stay in the order they had. If the report was sorted by a name, the randomized or coded names sit in the order of the real ones.

Columns that look harmless can point to a person together. A rare visit type, on one date, at a small site, may describe one patient with no name in sight.

The check searches for text. Numbers and dates are replaced cell by cell, but the check does not search for them, because a randomized number can equal a real one by chance.

The copy is for building scripts and layouts. Its totals and trends are randomized along with everything else, so take your numbers from the real report.

It does not protect a computer that is already compromised. Malware, or a browser extension with permission to read pages, can see the file however the page is built.

This article describes how a tool works. Whether a copy may be given to an AI assistant, or to any outside service, is a decision for whoever is responsible for that at your organization. The tool reports what it replaced, what it listed and what it could not check, so that person has something to decide with.
