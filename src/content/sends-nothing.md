# How to check that a page sends nothing

Some web tools say your file never leaves your computer. ClinX says it about its own tools. You should not have to take a claim like that on trust, and you do not need to be an engineer to test it. Here are three checks, starting with the quickest. They work on any site.

Use a file that does not matter for all three. A workbook with a few invented rows is enough.

## What you are checking

A web page can do its work in two places. It can send your file to the company's computers and work on it there, or it can work on the file inside your browser. On the screen the two look the same.

Loading any page involves requests: the page itself, its styles, its scripts. Those are expected. The requests that matter are the ones made after you choose your file.

## Check 1: turn the network off

Open the page and wait until it has finished loading. Turn off Wi-Fi, or unplug the network cable. Then choose your test file and use the tool to the end.

If the tool still does its work, the work is happening on your computer. If it stops, or shows an error, it needed a server.

This check has a limit. It shows where the work is done. A page could still hold on to what it read and send it once the network is back, so close the tab before you reconnect, and go on to the second check.

## Check 2: watch what the page sends

Edge and Chrome can list every request a page makes. With the network back on:

- Right-click anywhere on the page and choose Inspect. A panel opens beside the page.
- Choose the Network tab in that panel.
- Press the button named Clear network log, so the list starts empty.
- Choose your test file in the page and use the tool to the end.
- Read the list. The bar under it shows how many requests were made.

An empty list means nothing was sent while you worked. If rows did appear, click one. The Headers tab shows the address it went to, and the Payload tab shows what was sent.

The panel only records while it is open, so open it before you choose the file and leave it open until you have finished.

Some workplaces switch this panel off. If Inspect is missing from the menu, ask your IT team to run the check with you. It takes five minutes.

## Check 3: read the page's own rule

A page can carry a rule that tells the browser where the page is allowed to connect. The browser enforces the rule, and code in the page cannot switch it off. The article "Reading a sensitive file without receiving it" explains how the rule works.

On a ClinX tool page you can read the rule yourself. Right-click the page and choose View page source. Press Ctrl and F (Command and F on a Mac), and search for `connect-src`. You should find `connect-src 'none'`, which means the page may open no connection at all.

Other sites may send the same rule in a different way, or have no such rule. A tool with no rule can still be honest. It has to be checked with the first two checks each time, because nothing stops it from changing.

## What ClinX tools show you

Each ClinX file tool shows a count of the requests it has made since you chose your file. The count comes from the browser's own record. It should stay at zero while your file is read.

Cleaner Copy was tested the first way while it was being built. The page was opened, the server behind it was shut down, and the tool still made a copy of the sample report and checked it.

## Questions to ask about any tool

- Does my file leave my computer? If it does, where does it go, and how long is it kept?
- Does the tool still work with the network off?
- Can I see the requests it makes, and is the code public?

A vendor that does this work in the browser can answer all three in one line.
