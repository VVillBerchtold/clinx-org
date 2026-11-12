import { describe, expect, it } from "vitest";
import totalsSource from "../../src/scripts/no-phi/totals.ts?raw";
import { parseCsv } from "../../src/scripts/no-phi/csv.js";
import { generateCsvText } from "../../src/scripts/no-phi/sample.js";
import { addRow, addSkipped, formatCents, makeColumnPicker, monthOf, newTotals, parseCents } from "../../src/scripts/no-phi/totals.js";

function totalsFor(text: string) {
  const [header, ...rows] = parseCsv(text);
  const pick = makeColumnPicker(header ?? []);
  const t = newTotals();
  for (const r of rows) {
    const p = pick(r);
    if (p.ok) addRow(t, p.input);
    else addSkipped(t, p.reason);
  }
  return t;
}

describe("parseCents", () => {
  it.each([
    ["1234.56", 123456],
    ["1,234.56", 123456],
    ["$1,234.56", 123456],
    ["(12.00)", -1200],
    ["-12.00", -1200],
    ["-$12.00", -1200],
    ["$-12.00", -1200],
    ["12", 1200],
    ["12.5", 1250],
    ["0.07", 7],
    [" 3.10 ", 310],
    ["0.10", 10],
    ["19.99", 1999],
  ])("%s -> %i", (s, c) => expect(parseCents(s)).toBe(c));
  it.each(["", "   ", "abc", "1.234", "1,23.00", "--1", "(-1)", "12.", ".5", "1e3", "$", "()"])(
    "rejects %j",
    (s) => expect(parseCents(s)).toBeNull(),
  );
  it("never drifts the way floats do", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += parseCents("0.10") ?? 0;
    expect(sum).toBe(10000);
  });
});

describe("monthOf", () => {
  it("buckets by year-month", () => {
    expect(monthOf("2025-03-15")).toBe("2025-03");
    expect(monthOf("2024-02-29")).toBe("2024-02");
  });
  it.each(["2025-02-29", "2025-13-01", "2025-00-10", "2025-01-00", "2025/01/05", "", "01-05-2025"])(
    "rejects %j",
    (s) => expect(monthOf(s)).toBeNull(),
  );
});

const HDR = "claim_id,fill_date,patient_id,patient_dob,prescriber_npi,ndc,drug_name,quantity,payer_type,amount_paid,acquisition_cost,dispensing_fee,pharmacy_name";
const row = (date: string, payer: string, paid: string, cost: string, fee: string) =>
  `SYN-C000001,${date},SYN-000001,1980-01-01,SYN-NPI-0001,00000-0001-01,Example Drug A 10 mg,30,${payer},${paid},${cost},${fee},Example Pharmacy 1`;

describe("totals", () => {
  it("sums, margin, payer grouping and month bucketing", () => {
    const t = totalsFor(
      [
        HDR,
        row("2025-01-05", "Commercial", "$100.00", "60.00", "10.50"),
        row("2025-01-20", "medicaid", "50.00", "70.00", "10.50"),
        row("2025-02-01", "Self-pay", "(5.00)", "1.00", "0.00"),
        row("2025-02-02", "Mystery", "1.00", "1.00", "1.00"),
      ].join("\n"),
    );
    expect(t.rowsRead).toBe(4);
    expect(t.total).toEqual({ rows: 4, paid: 14600, cost: 13200, fee: 2200, margin: 1400 });
    expect(t.byPayer["Commercial"]?.margin).toBe(4000);
    expect(t.byPayer["Medicaid"]?.margin).toBe(-2000);
    expect(t.byPayer["Self-pay"]?.paid).toBe(-500);
    expect(t.byPayer["Other"]?.rows).toBe(1);
    expect(t.byMonth["2025-01"]?.rows).toBe(2);
    expect(t.byMonth["2025-02"]?.rows).toBe(2);
  });

  it("counts skipped rows by reason only", () => {
    const t = totalsFor(
      [
        HDR,
        row("2025-01-05", "Commercial", "", "1.00", "1.00"),
        row("2025-01-05", "Commercial", "1.00", "x", "1.00"),
        row("not-a-date", "Commercial", "1.00", "1.00", "1.00"),
        "SYN-C000009,2025-01-05,SYN-000001",
        row("2025-01-05", "Commercial", "1.00", "1.00", "1.00"),
      ].join("\n"),
    );
    expect(t.skipped).toEqual({ missingColumn: 1, unparseableAmount: 2, unparseableDate: 1 });
    expect(t.total.rows).toBe(1);
    expect(t.rowsRead).toBe(5);
  });

  it("skips every row when a needed header column is missing", () => {
    const t = totalsFor("claim_id,fill_date\nSYN-C000001,2025-01-01\nSYN-C000002,2025-01-02\n");
    expect(t.skipped.missingColumn).toBe(2);
    expect(t.total.rows).toBe(0);
  });

  it("serialised totals contain none of the sensitive values", () => {
    const text = generateCsvText(300, 7);
    const t = totalsFor(text);
    const json = JSON.stringify(t);
    const [header, ...rows] = parseCsv(text);
    const col = (n: string) => (header ?? []).indexOf(n);
    for (const name of ["claim_id", "patient_id", "patient_dob", "prescriber_npi"]) {
      const i = col(name);
      expect(i).toBeGreaterThanOrEqual(0);
      for (const r of rows.slice(0, 300)) {
        const v = r[i] ?? "";
        expect(v.length).toBeGreaterThan(3);
        expect(json.includes(v)).toBe(false);
      }
    }
    expect(json).not.toMatch(/SYN-/);
  });

  it("totals.ts never mentions the sensitive column names", () => {
    const src = totalsSource;
    expect(src.length).toBeGreaterThan(1000);
    for (const name of ["claim_id", "patient_id", "patient_dob", "prescriber_npi"]) {
      expect(src.includes(name)).toBe(false);
    }
  });

  it("a 50,000-row generated file matches an independent computation", () => {
    const text = generateCsvText(50_000);
    const t = totalsFor(text);

    // Independent: split lines naively (the generated quoted field has no newline) and use BigInt-free integer maths.
    const lines = text.split("\r\n").filter((l) => l !== "");
    let paid = 0, cost = 0, fee = 0, rows = 0;
    const payer: Record<string, number> = {};
    const month: Record<string, number> = {};
    const cents = (s: string): number => {
      const neg = s.startsWith("-");
      const [w = "0", f = "0"] = s.replace("-", "").split(".");
      const v = parseInt(w, 10) * 100 + parseInt(f.padEnd(2, "0"), 10);
      return neg ? -v : v;
    };
    for (const line of lines.slice(1)) {
      const tail = line.split(",").slice(-5); // payer, paid, cost, fee, pharmacy
      const date = line.split(",")[1] ?? "";
      const [p, a, c, f] = tail;
      rows++;
      paid += cents(a ?? "");
      cost += cents(c ?? "");
      fee += cents(f ?? "");
      payer[p ?? ""] = (payer[p ?? ""] ?? 0) + cents(a ?? "");
      month[date.slice(0, 7)] = (month[date.slice(0, 7)] ?? 0) + cents(a ?? "");
    }
    expect(rows).toBe(50_000);
    expect(t.total).toEqual({ rows, paid, cost, fee, margin: paid - cost });
    expect(t.skipped).toEqual({ missingColumn: 0, unparseableAmount: 0, unparseableDate: 0 });
    for (const [k, v] of Object.entries(payer)) expect(t.byPayer[k]?.paid).toBe(v);
    for (const [k, v] of Object.entries(month)) expect(t.byMonth[k]?.paid).toBe(v);
  });
});

describe("formatCents", () => {
  it("formats", () => {
    expect(formatCents(123456)).toBe("1,234.56");
    expect(formatCents(-5)).toBe("-0.05");
    expect(formatCents(0)).toBe("0.00");
  });
});
