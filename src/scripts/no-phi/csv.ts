/**
 * Streaming RFC 4180 parser. Feed it text chunks with push(); it returns the
 * rows completed by that chunk. Call end() after the last chunk to get a final
 * row that had no trailing newline. Only the row being built is kept in memory.
 *
 * Handles: quotes, escaped quotes (""), commas and newlines inside quotes,
 * \r\n, \n and a lone \r as row ends, a leading UTF-8 byte-order mark, and a
 * chunk boundary at any position. Lines that are completely empty are skipped.
 */

export type CsvRow = string[];

const enum State {
  FieldStart,
  Unquoted,
  Quoted,
  QuoteInQuoted, // saw a quote inside quotes: either an escaped quote or the closing one
}

export class CsvParser {
  private state: State = State.FieldStart;
  private field = "";
  private row: string[] = [];
  private atStart = true;
  private skipLf = false; // the previous char ended a row with \r; swallow one following \n
  private rowTouched = false; // anything (even an empty quoted field or a comma) seen on this row

  push(chunk: string): CsvRow[] {
    const out: CsvRow[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk.charAt(i);

      if (this.atStart) {
        this.atStart = false;
        if (ch === "﻿") continue;
      }
      if (this.skipLf) {
        this.skipLf = false;
        if (ch === "\n") continue;
      }

      switch (this.state) {
        case State.FieldStart:
        case State.Unquoted:
          if (ch === '"' && this.state === State.FieldStart) {
            this.state = State.Quoted;
            this.rowTouched = true;
          } else if (ch === ",") {
            this.endField();
            this.rowTouched = true;
          } else if (ch === "\n" || ch === "\r") {
            this.endRow(out);
            this.skipLf = ch === "\r";
          } else {
            this.field += ch; // a stray quote inside an unquoted field is kept literally
            this.state = State.Unquoted;
            this.rowTouched = true;
          }
          break;

        case State.Quoted:
          if (ch === '"') this.state = State.QuoteInQuoted;
          else this.field += ch;
          break;

        case State.QuoteInQuoted:
          if (ch === '"') {
            this.field += '"';
            this.state = State.Quoted;
          } else if (ch === ",") {
            this.endField();
          } else if (ch === "\n" || ch === "\r") {
            this.endRow(out);
            this.skipLf = ch === "\r";
          } else {
            // Text after a closing quote: tolerate it, treat as part of the field.
            this.field += ch;
            this.state = State.Unquoted;
          }
          break;
      }
    }
    return out;
  }

  /** Call once after the last chunk. Returns the final row if one is pending. */
  end(): CsvRow[] {
    const out: CsvRow[] = [];
    if (this.rowTouched || this.field !== "" || this.row.length > 0) this.endRow(out);
    this.state = State.FieldStart;
    return out;
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = "";
    this.state = State.FieldStart;
  }

  private endRow(out: CsvRow[]): void {
    if (!this.rowTouched && this.field === "" && this.row.length === 0) {
      this.state = State.FieldStart;
      return; // blank line
    }
    this.row.push(this.field);
    out.push(this.row);
    this.row = [];
    this.field = "";
    this.rowTouched = false;
    this.state = State.FieldStart;
  }
}

/** Convenience for tests and small inputs: parse a whole string. */
export function parseCsv(text: string): CsvRow[] {
  const p = new CsvParser();
  return [...p.push(text), ...p.end()];
}
