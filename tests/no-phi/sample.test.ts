import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/scripts/no-phi/csv.js";
import { HEADER, generateCsvText, generateSampleFile } from "../../src/scripts/no-phi/sample.js";

describe("sample generator", () => {
  it("same seed gives the same bytes; another seed differs", () => {
    expect(generateCsvText(500, 1)).toBe(generateCsvText(500, 1));
    expect(generateCsvText(500, 1)).not.toBe(generateCsvText(500, 2));
  });

  it("makes a File of the requested size class", async () => {
    const f = generateSampleFile(1000, 3);
    expect(f.size).toBeGreaterThan(50_000);
    expect(await f.text()).toBe(generateCsvText(1000, 3));
  });

  it("default 50,000 rows is a few MB", () => {
    const f = generateSampleFile();
    expect(f.size).toBeGreaterThan(3_000_000);
    expect(f.size).toBeLessThan(15_000_000);
  });

  it("every value matches the synthetic patterns", () => {
    const rows = parseCsv(generateCsvText(3000, 11));
    expect(rows[0]?.join(",")).toBe(HEADER);
    expect(rows.length).toBe(3001);
    for (const r of rows.slice(1)) {
      expect(r.length).toBe(13);
      const [claim, date, pid, dob, npi, ndc, drug, qty, payer, paid, cost, fee, pharm] = r as string[];
      expect(claim).toMatch(/^SYN-C\d{6}$/);
      expect(date).toMatch(/^2025-(0[1-9]|1[0-2])-(0[1-9]|1\d|2[0-8])$/);
      expect(pid).toMatch(/^SYN-\d{6}$/);
      expect(dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(npi).toMatch(/^SYN-NPI-\d{4}$/);
      expect(ndc).toMatch(/^00000-\d{4}-\d{2}$/);
      expect(drug).toMatch(/^Example Drug [A-H] (5|10|20|40) mg(, "synthetic" lot)?$/);
      expect(qty).toMatch(/^\d{1,2}$/);
      expect(payer).toMatch(/^(Commercial|Medicaid|Medicare|Self-pay)$/);
      expect(paid).toMatch(/^-?\d+\.\d{2}$/);
      expect(cost).toMatch(/^\d+\.\d{2}$/);
      expect(fee).toMatch(/^\d+\.\d{2}$/);
      expect(pharm).toMatch(/^Example Pharmacy [1-5]$/);
    }
  });
});
