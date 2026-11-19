// The Schedule Designer engine: everything the page needs, from one place.
//
// In plain words: the engine is the part of the tool that knows what a schedule is and does the
// arithmetic. It draws nothing, opens no connection and keeps nothing. The page hands it a
// schedule and gets back a new schedule, a tally, a list of findings or a workbook.
//
// - types: the shape of a schedule, the swatch names and the limits.
// - time: minutes to "9:20 am", lengths, hours, and snapping to a person's grid.
// - find: looking things up in a schedule, and the facts needed to draw a block.
// - edit: every change, each giving back a new schedule (the same one when nothing changed).
// - work: a person's working hours: entering them, reading them, and what falls outside them.
// - team: support staff and the providers they work with: who is with whom, filling a week from a
//   provider's patient time, and changing a person's kind.
// - tally: a person's week and the clinic's appointments added up; `careTarget`.
// - rooms: who is in each room, clashes, free rooms, and each room's hours across the week.
// - overview: every person's mornings and afternoons in a few words.
// - check: the findings, in plain sentences.
// - validate: checks a value read from a file is a schedule this version can open.
// - sample: the invented clinic.
// - workbook: saving as an .xlsx workbook and opening one again.

export * from './types';
export * from './time';
export * from './find';
export * from './edit';
export * from './work';
export * from './team';
export * from './tally';
export * from './rooms';
export * from './overview';
export * from './check';
export * from './validate';
export * from './sample';
export * from './workbook';
