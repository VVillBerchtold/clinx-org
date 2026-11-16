# What an Excel workbook carries besides its cells

A workbook looks like a grid of cells. The file behind it is a set of smaller files zipped together, and the grid is only some of them. You can see this for yourself: make a copy of a workbook, change the ending of its name from .xlsx to .zip, and open it.

This matters when a workbook is about to be sent to someone. Deleting a column or clearing a sheet changes what is on the screen, and the other parts of the file can go on holding what was removed. The list below was put together while building Cleaner Copy, the ClinX tool that makes a randomized copy of a report. Each item is something the tool had to learn to look for.

## A pivot table keeps its own copy of the data

When a pivot table is built, Excel saves the rows it was built from inside the file. The saved rows stay when the sheet they came from is deleted. A workbook that shows only a summary by month can still hold every row behind that summary.

There is a setting for this in the pivot table's options, on the Data tab: "Save source data with file". It is on unless someone turns it off.

## Formulas remember their last answer

Each formula cell stores two things: the formula, and the value it last worked out. A lookup that pulls a name from another sheet keeps that name as its saved answer. If the other sheet is removed, the name is still in the cell's saved answer until the workbook is worked out again.

## Links to other workbooks bring values with them

A formula that points at a second workbook makes Excel save the path to that file and a copy of the cells it read. The path often contains a person's user name or the name of a shared drive. The copied cells are values from a file that nobody chose to send.

## Filters, rules and lists store the words they use

A filter remembers which values were ticked. A colour rule that highlights cells containing a certain word stores that word. A drop-down list typed straight into the validation box stores each of its choices.

An early version of Cleaner Copy replaced every cell in a test workbook and still left eight values behind. All eight were inside colour rules.

## Charts carry their numbers

A chart keeps a copy of the labels and numbers it draws. A chart on a summary sheet can hold the names of providers or sites from a sheet that has since been cleared.

## Hidden sheets, and sheets hidden twice

A hidden sheet can be shown again from the right-click menu on the sheet tabs. Excel has a second kind of hidden sheet, set from the code editor, that does not appear in that menu. Both kinds are in the file in full.

## Names of people

The file records who created it and who saved it last, and often the name of the organization. Comments carry their authors' names. The newer threaded comments keep a list of the people who took part, and that list can include the addresses they sign in with.

## Connections and queries

A workbook that pulls its rows from a database keeps the connection: the server's name, the database, and sometimes a user name. A workbook that uses Get & Transform, also called Power Query, keeps the steps of each query, and those steps name the files, folders and web addresses the query reads from.

These are not patient data, but they describe the inside of a network to whoever receives the file.

## Smaller things

Named ranges and tables keep their names, and a name can itself say something, such as the site or the program a range belongs to. The printer's name is saved with the page setup. Labels and properties added by a document system travel with the file. A workbook that was once shared with change tracking can keep a history of old values.

## What to do about it

Excel has a tool for part of this. Under File, then Info, then Check for Issues, choose Inspect Document. It finds and removes comments, document properties and hidden sheets. It also reports pivot tables, filters and links to other files, and leaves those for you to deal with. Run it on a copy of the workbook, because what it removes cannot always be brought back.

When only a few cells need to go to someone, the plain method works well. Copy the cells, open a new workbook, and paste them as values. The new file has no pivot tables, no links and no formulas. It does carry your own name as its author.

When the whole shape of the file is needed, to have a script written or a layout designed, Cleaner Copy looks in each of the places above. Its second step only reads the file and lists what it found, and that list can be useful even if you go no further. If you go on, it replaces or clears what it can outside the cells and lists what it has left alone, such as macros and saved connections.
