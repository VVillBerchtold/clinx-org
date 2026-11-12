/**
 * Deterministic synthetic file generator. Seeded; the platform random source is never used. Every value
 * is made up and obviously so: ids SYN-nnnnnn, drugs "Example Drug A 10 mg",
 * pharmacies "Example Pharmacy n", NDC-shaped codes beginning 00000-.
 */

export const HEADER =
  "claim_id,fill_date,patient_id,patient_dob,prescriber_npi,ndc,drug_name,quantity,payer_type,amount_paid,acquisition_cost,dispensing_fee,pharmacy_name";

export const DEFAULT_ROWS = 50_000;
export const DEFAULT_SEED = 20260101;

const PAYERS = ["Commercial", "Medicaid", "Medicare", "Self-pay"] as const;
const DRUG_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const STRENGTHS = [5, 10, 20, 40] as const;

/** mulberry32: small seeded generator, returns floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, w: number): string => n.toString().padStart(w, "0");
const cents = (c: number): string => `${Math.trunc(c / 100)}.${pad(c % 100, 2)}`;

/** Yields the file line by line (header first), without a line terminator. */
export function* generateLines(rows: number = DEFAULT_ROWS, seed: number = DEFAULT_SEED): Generator<string> {
  const rnd = makeRng(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  yield HEADER;
  for (let i = 1; i <= rows; i++) {
    const month = int(1, 12);
    const day = int(1, 28);
    const dobYear = int(1940, 2010);
    const drug = int(0, DRUG_LETTERS.length - 1);
    const strength = STRENGTHS[int(0, STRENGTHS.length - 1)] ?? 10;
    const cost = int(150, 25000);
    const payer = PAYERS[int(0, PAYERS.length - 1)] ?? "Commercial";
    // paid is somewhere around cost, sometimes below it; occasionally a reversal (negative)
    let paid = Math.round(cost * (0.8 + rnd() * 0.6));
    if (int(1, 100) === 1) paid = -paid;
    const fee = int(0, 1) === 0 ? 1050 : 1475;
    const ndc = `00000-${pad(drug * 10 + 1, 4)}-${pad(int(1, 99), 2)}`;
    const drugName = `Example Drug ${DRUG_LETTERS[drug]} ${strength} mg`;
    const cols = [
      `SYN-C${pad(i, 6)}`,
      `2025-${pad(month, 2)}-${pad(day, 2)}`,
      `SYN-${pad(int(1, 9000), 6)}`,
      `${dobYear}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`,
      `SYN-NPI-${pad(int(1, 400), 4)}`,
      ndc,
      // a quoted field with a comma and an escaped quote, to exercise the parser
      i % 7 === 0 ? `"${drugName}, ""synthetic"" lot"` : drugName,
      String(int(1, 90)),
      payer,
      cents(Math.abs(paid)).replace(/^/, paid < 0 ? "-" : ""),
      cents(cost),
      cents(fee),
      `Example Pharmacy ${int(1, 5)}`,
    ];
    yield cols.join(",");
  }
}

/** The whole file as text, CRLF line ends, trailing newline. */
export function generateCsvText(rows: number = DEFAULT_ROWS, seed: number = DEFAULT_SEED): string {
  const parts: string[] = [];
  for (const line of generateLines(rows, seed)) parts.push(line, "\r\n");
  return parts.join("");
}

/** The file as an in-memory File. No network request involved. */
export function generateSampleFile(rows: number = DEFAULT_ROWS, seed: number = DEFAULT_SEED): File {
  return new File([generateCsvText(rows, seed)], "synthetic-pharmacy-claims.csv", { type: "text/csv" });
}
