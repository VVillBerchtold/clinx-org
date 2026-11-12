# Reading a sensitive file without receiving it

Your clinic has a complex pharmacy claims CSV export and needs simple questions answered: how much was paid each month, ratios by payer, etc. Many tools exist that can solve this problem in real time. Nearly all of those tools start by asking for access to your files.

A claims export carries a patient ID and a date of birth on every row. Once the file is handed over, a copy sits on another company's servers and in its backups, and your clinic depends on that company's word for what happens to it next.

The questions do not need most of the file. Monthly totals by payer need a fill date, a payer type and a few dollar amounts. The patient ID and the date of birth are never used.

A web page can do this work on your own computer, with the file never leaving it, and it can be built so your clinic can confirm that for itself. This article explains how. A working demo is published alongside it.

## The page does the work on your computer

A website's code runs in your browser, on your machine, once the page has loaded. When you choose a file, the page can open it and calculate totals without contacting a server again.

The demo reads the file in pieces: it takes a chunk, splits it into rows, adds each row to the running totals and moves to the next chunk. Claims exports can run to hundreds of megabytes, and loading one whole can freeze a browser tab. Reading in pieces prevents that. It also means a file from your disk is never held in the page's memory whole.

## Only five columns are used

The demo's sample file has thirteen columns, including a patient ID, a date of birth and a prescriber number. The code that keeps the totals receives five: fill date, payer type, amount paid, acquisition cost and dispensing fee. The other eight are discarded before that code runs, and it has no way to request them.

Errors are handled the same way, because error messages are a common place for data to leak. When a row has a date or an amount the page cannot read, the page adds one to a count for that type of problem. The row itself is never displayed.

## The browser stops the page from sending anything

Most vendors say they do not keep your data. Your clinic usually has no way to confirm it.

Browsers offer a control that can be confirmed, called a Content-Security-Policy. The site sends it with the page, and it tells the browser what the page may load and where it may connect. The demo's policy includes `connect-src 'none'`, which instructs the browser to refuse every connection the page's code tries to open. Code running in the page cannot turn that off. The demo includes a button that attempts a request anyway, so you can watch your browser block it.

The demo also runs no outside code: no analytics, and no fonts or scripts from other companies. Everything that runs is in four short files, and all four are public.

## How to check it yourself

Before loading a file, open your browser's developer tools (F12 in most browsers, or right-click the page and choose Inspect) and select the Network panel. No new entries should appear while the file is read. The demo also displays its own count of requests, taken from the browser's record of what the page has loaded. That count should stay at zero.

A second test: load the page, turn off your Wi-Fi, then choose a file. The demo works the same offline, which it could not do if the file were being sent anywhere.

The source code is public for anyone who wants to read it.

## Where this stops helping

This approach does not protect a computer that is already compromised. Malware, or a browser extension with permission to read pages, can see the file on that machine however the page is built.

The connection rule blocks requests made in the background. It does not block every method. Code could, for example, redirect the whole tab to another website with data attached to the address. This is why the demo runs no outside code: everything that does run can be read.

A site can change. The page your clinic checks today may not be the page served next month. Publishing the code and numbering each release means a change can be detected.

Totals are not automatically safe. If three patients filled a prescription for one drug in one month, a total for that drug and month describes those three people. Any real tool built this way must still decide how small a group is too small to show.

This article describes how software can be built. Whether a tool like this meets a privacy law, a contract or your organization's policy is a decision for whoever is responsible for that at your organization.
