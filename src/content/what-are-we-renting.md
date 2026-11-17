# What are we renting?

A clinic pays for a long list of software subscriptions. Each one holds a part of the clinic's own information behind its own sign-in. A good share of the working day goes to carrying that information from one of them to the next: export a report from one system, tidy it in Excel, type or load it into another. Anyone who has worked in a health center knows the routine.

The renewals come round each year, and for a long time there was no other way to get the work done. This article asks what each subscription is for now, and which parts of the answer have changed.

## Why software became something to rent

Three things made renting the sensible arrangement.

Software was expensive to write. A program took a team and many months, so its cost had to be spread over thousands of customers, and every customer got the same screens whether they fitted the job or not.

The work had to be done on the company's computers. An office computer could show a page, and the heavy work happened somewhere else. So the file had to go there.

Getting a program onto every desk was slow. Each install needed someone from IT. Keeping the program on the company's side and reaching it through a web page solved that.

## What has changed

Each of those three has changed, and one more thing is new.

A small tool is now cheap to write. An AI assistant can write a tool for one narrow job in an afternoon: reshape this export, compare these two lists, total this column by month. Someone still has to test the result against a file they know. The months of work are gone.

The browser can do the work. The browser already on an office computer can open a large workbook, read every cell, total it, compare it with another file and write a new one. None of that needs a server.

A web address is the install. A page that works this way needs nothing added to the computer. It is opened, used and closed.

The new thing is that much of what a clinic looks up is public record. Program rules, filings and federal reports are published by the agencies that hold them. Once they are gathered in the open, a person or an assistant can read them directly, with a link to the official source beside every figure.

## The tool goes to the file

In the rented arrangement the file travels to the software. A report full of patients is uploaded, a copy sits on another company's computers and in its backups, and the clinic depends on that company's word for what happens next.

That trip is the reason for much of the paperwork around buying software in health care: the agreement about patient information, the security questionnaire, the review, the months of waiting. Most of it exists because the data leaves the building.

A tool that works in the browser turns the trip around. The page comes to the computer where the file already is and does its work there, and the file stays where it was. No copy is made anywhere else. There is less to review because less has left. What still needs review is a decision for whoever is responsible for that at the clinic.

This does not cover every job. It covers the ones that start with a file and end with a file: a report comes out of a system, something is done to it, and a finished file goes to whoever needs it. For a job like that, the tool should come to the file.

## Anyone can check it

A clinic cannot see what happens on a vendor's computers, so it relies on the contract. A page that works in the browser can be tested from the desk it is used at. Turn the network off and see whether the tool still works. Open the browser's list of requests and watch it stay empty while the file is read. Neither check needs an engineer, and both take a few minutes. The guide "How to check that a page sends nothing" walks through them.

These checks show where the file went. They do not show that the totals are right. That takes a test file, which comes up below.

A check also counts only for the version that was checked. A page that is fetched fresh on every visit can change between visits. A tool kept as one fixed file can be checked once, by one person, and everyone else then uses that same copy.

That changes who can try a tool. The person who does the work can run it on a file that does not matter and show the result to the person who decides. Someone still has to decide. Who may run a new tool on a file that holds patients, and who signs off on it, is a matter of policy, and for many clinics that change is as large as the technical one.

## What is still worth paying for

Some things a small browser tool does not do, and they are worth real money.

- A record that many people share and change at the same time. The patient record, the schedule and the billing system need one place, sign-ins, backups and a history of who changed what.
- Upkeep. Information goes out of date, and keeping it current is steady work that someone has to be paid for.
- Someone answerable. When a system fails at two in the morning, a clinic needs a number to call and a company that has to pick up.
- Anything a regulator requires to be certified.

A tool made on request has costs of its own. It is cheap to make and takes real work to trust. It needs a test file with a known answer, run again whenever the tool changes. It needs an owner by name, so that someone is answerable when a total is wrong. It needs a plan for the day it is retired. None of that work goes away. It moves inside the clinic, where the tool and its results can be looked at.

It has limits as well. It cannot protect a computer that is already compromised. A very large file, or a job that joins many tables, can be too much for an older office computer, so a tool should say what size of file it has been tested with. And once a tool has to stay in step with the record system day by day, it has become a small system of its own and needs to be treated as one.

So part of the answer to the title is plain: a shared record, upkeep and someone answerable. The other part is a fixed set of screens over the clinic's own information, and the chore of carrying that information between them. That second part is the one that has changed.

## Three things to try this year

- Pick one report that is cleaned up by hand each month. Try the job with a browser tool on a made-up file, or have a script written from a copy that holds no patients.
- Ask of every tool that opens a file: does my file leave my computer? Then run the two checks above.
- At the next renewal, write down what the subscription does that needs a shared record, upkeep or someone answerable. Anything it does beyond that list is worth a second look, and it is fair to ask what else could do that job.

## One working example

ClinX is one working example of this arrangement, built in public by one person. It publishes public records on the 340B program and on federally funded health centers, each figure with its official link, where a person or an AI assistant can read them. Beside the records are tools that each do one narrow job on a clinic's own file while the file stays on the clinic's computer. It costs nothing to use, and the code is public.
