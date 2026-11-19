# The workbook is the saved schedule

The Schedule Designer is a ClinX tool for laying out a clinic's template week: the sites and rooms, the kinds of time, the providers and support staff, and each person's days on a grid of 15 or 20 minutes. It holds no patients and no real appointments. Like the other ClinX tools it does its work inside your browser, and the page is not allowed to connect to anything once it has loaded.

That raises a fair question. A week for a whole clinic takes a while to lay out, and it will be revised many times after that. If the page sends nothing and ClinX has no accounts, where is the work kept between one sitting and the next?

It is kept in a file you already know how to handle. When you save, the page writes an Excel workbook, and that workbook is the schedule.

## What the page writes

The page builds the workbook itself, inside the browser. (An earlier article, "What an Excel workbook carries besides its cells", explains that a workbook is a set of small files zipped together. The page writes each of those files and zips them.) Nothing is sent anywhere to be converted.

The workbook has two parts, and they serve different readers.

The first part is for people. An Overview sheet lists everyone on the roster, with their contract hours, their working hours, the number of appointment slots each provider's contract calls for and the number the week gives them. Those columns are real formulas, so the sheet goes on working in Excel. Each person then has a sheet of their own, laid out like a paper week with the days across and the hours down. Further sheets list the care teams, the rooms and the kinds of time. Someone who has never seen the tool can open the workbook, read it and print it.

The second part is for the page. A sheet named "ClinX data" holds the whole schedule again as text, in a form the page can read back exactly. The sheet is hidden so that it stays out of the way, and it is the ordinary kind of hidden: right-click the sheet tabs, choose Unhide, and you can look at it.

## Opening it again

On the first step of the tool, choose "Open a saved schedule" and pick the workbook (or drop it on the card). The page reads the hidden sheet, and the week returns as you left it, with every block, every room and each person's working hours in place.

In Edge and Chrome, saving opens the usual Save dialog and the page writes into the file you name there. In other browsers the workbook arrives as a download.

The page can remember one thing between visits, and only if you ask it to. In browsers that allow it, a switch named "Remember this file on this computer" keeps the file's name, where it is and the date you last used it here, so that your next visit can open it with one click. The schedule itself is never stored in the browser. A link named "Forget this file" removes the record.

## What to know before you rely on it

**Changes typed in Excel are not read back.** The visible sheets are a report of the schedule. If you change a start time on someone's sheet in Excel, the page will never see it, because the page reads only the hidden sheet. The tool says so beside its Save button. To change the week, open the workbook on the page, make the change there and save again.

**The hidden sheet has to stay.** Excel's Inspect Document (under File, then Info, then Check for Issues) offers to remove hidden sheets. If it removes this one, the visible sheets remain and the page can no longer open the file. It says so in one sentence and offers a new schedule. A workbook that was never saved from the page gets the same sentence.

**One person edits at a time.** The page does not merge two people's changes. Each save is a whole schedule, so if two people work from the same workbook at once, whichever version is kept replaces the other.

**The file is the only copy.** The schedule lives in the browser tab until you save it, and after that it lives in the workbook. ClinX never receives it, so there is no copy here to recover if the file is deleted. Keep it where your other working documents are kept and backed up.

## Why a file

A schedule names the people who work at your clinic and the hours they keep. Saved as a workbook, it sits in the folder or shared drive your clinic already uses, under the permissions and backups already in place there. There is no account to create for a new scheduler and none to close when someone leaves.

A file is also easy to pass along. A colleague can read it in Excel without the tool, or open it on the page and carry on from where you stopped. Before a large revision you can save under a new name and keep the old week beside the new one. To begin a fresh week with the same set-up, the first step has "Use a saved schedule's set-up", which starts from a workbook you saved earlier.

The tool can also be downloaded as a single HTML file and opened with no network at all. That copy saves and opens the same workbooks.

## Try it with the sample

The first step offers an invented clinic with two sites, eight providers and three support staff, and its week is already filled in. Open it, add a block, and save. Then open the workbook in Excel and look at both parts: the sheets written for people, and (after Unhide) the one written for the page.
