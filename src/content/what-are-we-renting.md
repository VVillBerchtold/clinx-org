# What are we renting?

The list of software subscriptions a clinic pays for never ends. Each subscription keeps a piece of that clinic's data, locked behind its own sign-in. Most working days consist of guiding data from one of them to the next: export a report from the EHR system, clean it in Excel, load it into another platform, and so on. Everyone who has worked in healthcare admin knows the routine.

## Why software became something to rent

Three things made renting the market it is today.

Software was expensive to write. A program took a team many months to build, so the cost was shared by every customer, and each customer got the same product whether they were first or last.

The work had to be done on the company's computers. An office computer showed the page, and the heavy work happened somewhere else. The file had to go where the work happened.

Getting a program installed on every computer was labor intensive. Each install needed someone from IT. Keeping the program on the company's computers and accessing it through a web page solved that problem.

## What has changed

Each one of these has changed.

Tools are now cheap to write. AI assistants can write tools for narrow jobs in an afternoon: flatten this workbook, compare these two lists, give me the totals for these columns. The output still needs to be tested by someone who knows the data, but the months of work are gone.

The browser can do most of the work. Internet browsers on every computer (Edge, Chrome, etc.) can open large workbooks, read every cell, total them, compare them with another file and write new ones. None of these tasks needs a server.

Opening the web page is the install. A page that works this way does not need anything installed or added to the computer. It is opened, used, and then closed.

Most of what clinics look up is public record. Program rules, filings and federal reports are published by government agencies. Once they are public, any person or AI assistant can read them directly, and provide a link to the source behind every figure.

## The tool goes to the file

In the legacy structure the file travels to the software. A report containing patient data is uploaded, a copy sits on another company's computers and in its backups, and the clinic relies on that company's word for what happens to its data.

The trip the file takes is the reason for most of the paperwork required when buying software in health care: agreements about patient information, security questionnaires, reviews, months of waiting. These exist primarily because patient data is leaving the clinic.

A tool that works in the browser flips the script. The page is delivered to the computer where the file is located, and the work is done there with the file staying where it is. No copies are made anywhere. Less review is required because no data is leaving. What still needs review is a decision for whoever is responsible for that data at the clinic, which is an existing function.

This premise does not cover every process. It covers processes that start with a file and end with a file: a report comes out of one system, something is done to it, then a finished file goes to whoever needs it. For jobs like that, the tool should come to the file.

## Anyone can check it

Clinics have no visibility into the processes in vendor infrastructure, so the contract governs the relationship. Pages that work in the browser can be tested on each computer they are used on. Turn the Wi-Fi or network off and see whether the tool still functions. Open the browser's list of requests to verify it stays empty while the file is read. None of these checks needs an engineer, and they only take a few minutes. My guide "How to check that a page sends nothing" walks through them.

These checks will show where a file went, but they will not show that the totals are correct. That requires a test, which comes below.

A check also counts only for the version being examined. Pages that refresh with every visit can change. Tools kept as one fixed file can be checked once, by a human, and everyone else then uses the same copy.

That changes who has access to tools. People who do the work can run a tool on files that do not matter and show the result to the leader who makes the decision. Someone still has to verify and decide. Each clinic's policy will decide who can run new tools and who signs off on them, and for most clinics this change is as large as the technical one.

## What is still worth paying for

There are some functions browsers cannot do, and those are worth money.

- Data that many users share and edit at the same time. The patient records, scheduling, and billing systems need defined environments, sign-ins, backups and a history of what was changed by whom.
- Upkeep. Information goes out of date, and keeping it current is consistent work someone needs to be doing.
- Accountability. When a system fails at two in the morning, a clinic needs someone answerable to pick up the phone.
- Anything requiring certification by regulators.

Tools made on request have their own costs. While they are cheap to make, they take real work and expertise to trust. Test files with known answers need to be run with each change. Owners and maintainers need to be named, by role, so someone is answerable when numbers are wrong. Retirement and replacement plans need to be made and maintained. None of this work goes away. It moves inside the clinic, where the tool and results can be governed internally.

These have limits as well. Computers already compromised are not protected. Very large, complex files or jobs that join many tables can overwhelm older office computers. Tools should say the size of a file that has been tested to work on each machine. Once a tool needs to stay in step with the record system, it has become a small system of its own and should be managed as one.

Part of the answer to the title is obvious: shared records, upkeep and accountability. The rest is a fixed set of screens over the clinic's own data, and the labor of guiding information between them. The rest is what has changed.

## Three things to try this year

- Pick one report that is manually cleaned each month. Try performing the job with a browser tool on a file with synthetic data, or craft a script from a copy with no sensitive information.
- Consider every tool that opens or accesses files: does this file leave the computer? Run the checks discussed above to verify.
- Identify each subscription that needs a shared record, upkeep, or someone accountable. Anything beyond this list is worth considering for replacement, and you should ask what else could do the same work.

## One working example

ClinX is one example of this theory, built publicly by a single person. It publishes public records on the 340B program and on federally funded health centers, with each figure attached to its official link so a person (or AI assistant) can read them. In addition to open data, there are tools that each do one narrow job on a clinic's own files while all the data remains on the clinic's computer. These cost nothing to use, and all code is public.
