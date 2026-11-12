import { describe, expect, it } from "vitest";
import { CsvParser, parseCsv } from "../../src/scripts/no-phi/csv.js";

function parseChunks(chunks: string[]): string[][] {
  const p = new CsvParser();
  const out: string[][] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}

describe("csv parser", () => {
  it("parses plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("handles quotes and escaped quotes", () => {
    expect(parseCsv('"a ""b"" c",d\n')).toEqual([['a "b" c', "d"]]);
  });
  it("handles commas and newlines inside quotes", () => {
    expect(parseCsv('"x,y","l1\nl2\r\nl3",z\n')).toEqual([["x,y", "l1\nl2\r\nl3", "z"]]);
  });
  it("handles \\r\\n and \\n", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
  it("strips a byte-order mark", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("strips a byte-order mark that arrives alone in the first chunk", () => {
    expect(parseChunks(["﻿", "a,b\n"])).toEqual([["a", "b"]]);
  });
  it("returns a final row without a newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty fields and an empty quoted field", () => {
    expect(parseCsv('a,,"",\n')).toEqual([["a", "", "", ""]]);
  });
  it("skips blank lines", () => {
    expect(parseCsv("a\n\n\r\nb\n")).toEqual([["a"], ["b"]]);
  });
  it("splitting between \\r and \\n does not make an extra row", () => {
    expect(parseChunks(["a,b\r", "\n1,2\r", "\n"])).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("splitting inside a quoted field and between two quotes", () => {
    expect(parseChunks(['"ab', 'c"', '" d",e\n'])).toEqual([['abc" d', "e"]]);
  });

  it("gives identical rows for every possible single split point", () => {
    const text =
      '﻿id,note,n\r\n1,"a, ""quoted""\r\nsecond line",x\r\n2,,y\n"3","",\r\n4,last,no newline';
    const expected = parseCsv(text);
    expect(expected.length).toBe(5);
    for (let i = 0; i <= text.length; i++) {
      expect(parseChunks([text.slice(0, i), text.slice(i)])).toEqual(expected);
    }
  });
  it("gives identical rows for every pair of split points", () => {
    const text = 'a,"b""\r\n",c\r\n"d",e\r\nf';
    const expected = parseCsv(text);
    for (let i = 0; i <= text.length; i++) {
      for (let j = i; j <= text.length; j++) {
        expect(parseChunks([text.slice(0, i), text.slice(i, j), text.slice(j)])).toEqual(expected);
      }
    }
  });
  it("gives identical rows one character at a time", () => {
    const text = '﻿a,"b\r\nc"\r\n1,2';
    expect(parseChunks([...text])).toEqual(parseCsv(text));
  });
});
