import { CsvParser, type CsvRow } from "./csv.js";
import {
  PAYER_LABELS,
  SKIP_LABELS,
  addRow,
  addSkipped,
  formatCents,
  makeColumnPicker,
  newTotals,
  type SkipReason,
  type Sums,
  type TotalsState,
} from "./totals.js";
import { DEFAULT_ROWS, generateSampleFile } from "./sample.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e as T;
}

/* ---------- Proof panel: starts before anything is read ---------- */

/* Everything the page loads before a file is picked is its own (scripts, styles, fonts).
   From the moment a file is picked, every request is counted separately: that count is the proof. */
const ownEntries: string[] = performance.getEntriesByType("resource").map((e) => e.name);
const laterEntries: string[] = [];
const violations: string[] = [];
let filePicked = false;

const observer = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) (filePicked ? laterEntries : ownEntries).push(e.name);
  renderProof();
});
observer.observe({ type: "resource" });

document.addEventListener("securitypolicyviolation", (e) => {
  violations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
  renderProof();
});

/** The address without the site's own name in front: shorter to read. */
function shortName(address: string): string {
  return address.startsWith(location.origin) ? address.slice(location.origin.length) : address;
}

function renderProof(): void {
  byId("proof-count").textContent = String(ownEntries.length);
  byId("proof-load-list").replaceChildren(...ownEntries.map((n) => el("li", {}, shortName(n))));
  byId("proof-later-list").replaceChildren(...laterEntries.map((n) => el("li", {}, shortName(n))));
  byId("proof-later-count").textContent = String(laterEntries.length);
  byId("proof").classList.toggle("has-requests", laterEntries.length > 0);
  byId("proof-violation").textContent =
    violations.length > 0 ? `Refusals reported by your browser: ${violations.join("; ")}` : "";
}

/* ---------- Reading and totals ---------- */

const nextTurn = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(2);

async function processFile(file: File): Promise<void> {
  const totals = newTotals();
  const parser = new CsvParser();
  let pick: ReturnType<typeof makeColumnPicker> | null = null;
  let bytes = 0;
  const status = byId("progress");
  const started = performance.now();

  const handle = (rows: CsvRow[]): void => {
    for (const row of rows) {
      if (pick === null) {
        pick = makeColumnPicker(row); // first row is the header
        continue;
      }
      const r = pick(row);
      if (r.ok) addRow(totals, r.input);
      else addSkipped(totals, r.reason);
    }
  };

  const counter = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  filePicked = true;
  byId("results").hidden = true;
  byId("demo-area").classList.remove("done");
  setBusy(true);
  try {
    const reader = file
      .stream()
      .pipeThrough(counter)
      .pipeThrough(new TextDecoderStream())
      .getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(parser.push(value));
      status.textContent = `Reading: ${totals.rowsRead.toLocaleString("en-US")} rows, ${mb(bytes)} MB`;
      await nextTurn(); // let the page paint and stay responsive
    }
    handle(parser.end());
    const ms = performance.now() - started;
    status.textContent = `Done: ${totals.rowsRead.toLocaleString("en-US")} rows, ${mb(bytes)} MB`;
    renderResults(totals, ms, file.size);
  } catch (err) {
    status.textContent = `Could not read the file: ${(err as Error).message}`;
  } finally {
    setBusy(false);
    renderProof();
  }
}

function setBusy(busy: boolean): void {
  byId<HTMLButtonElement>("use-sample").disabled = busy;
  byId<HTMLInputElement>("file").disabled = busy;
  byId("demo-area").setAttribute("aria-busy", String(busy));
}

/* ---------- Rendering ---------- */

function table(caption: string, headers: string[], rows: string[][]): HTMLDivElement {
  const head = el("tr", {}, ...headers.map((h, i) => el("th", i === 0 ? { scope: "col" } : { scope: "col", class: "num" }, h)));
  const body = rows.map((r) =>
    el("tr", {}, ...r.map((c, i) => (i === 0 ? el("th", { scope: "row" }, c) : el("td", { class: "num" }, c)))),
  );
  const t = el("table", {}, el("caption", {}, caption), el("thead", {}, head), el("tbody", {}, ...body));
  // The wrapper scrolls sideways on a narrow screen, so the page itself never does.
  return el("div", { class: "table-wrap", tabindex: "0", role: "group", "aria-label": caption }, t);
}

/** Dollars and cents, for tables. */
const money = (cents: number): string => {
  const text = formatCents(cents);
  return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
};
/** Whole dollars, for the large figures. */
const dollars = (cents: number): string => {
  const whole = Math.round(Math.abs(cents) / 100).toLocaleString("en-US");
  return cents < 0 ? `-$${whole}` : `$${whole}`;
};

function tiles(items: [string, string][]): HTMLUListElement {
  return el(
    "ul",
    { class: "stats", "aria-label": "Totals for all counted rows" },
    ...items.map(([value, label]) => el("li", {}, el("strong", {}, value), el("span", {}, label))),
  );
}

const sumsRow = (label: string, s: Sums): string[] => [
  label,
  s.rows.toLocaleString("en-US"),
  money(s.paid),
  money(s.cost),
  money(s.fee),
  money(s.margin),
];

const SUM_HEADERS = ["Group", "Rows", "Paid", "Acquisition cost", "Dispensing fee", "Margin (paid minus cost)"];

function barChart(months: [string, Sums][]): HTMLElement {
  const w = 720;
  const h = 200;
  const top = 8;
  const bottom = 28;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("class", "demo-chart");
  svg.setAttribute("aria-label", "Bar chart of the amount paid in each month. The table of months has the same numbers.");
  const base = document.createElementNS(SVG_NS, "line");
  base.setAttribute("x1", "0");
  base.setAttribute("x2", String(w));
  base.setAttribute("y1", String(h - bottom + 0.5));
  base.setAttribute("y2", String(h - bottom + 0.5));
  svg.append(base);
  const max = Math.max(1, ...months.map(([, s]) => Math.abs(s.paid)));
  const slot = w / Math.max(1, months.length);
  const step = Math.ceil(months.length / 12);
  months.forEach(([m, s], i) => {
    const bh = Math.max(1, (Math.abs(s.paid) / max) * (h - top - bottom));
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(i * slot + slot * 0.14));
    rect.setAttribute("y", String(h - bottom - bh));
    rect.setAttribute("width", String(slot * 0.72));
    rect.setAttribute("height", String(bh));
    rect.setAttribute("rx", "4");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${m}: ${money(s.paid)}`;
    rect.append(title);
    svg.append(rect);
    if (i % step === 0) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(i * slot + slot / 2));
      t.setAttribute("y", String(h - 8));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "13");
      t.setAttribute("font-weight", "600");
      t.setAttribute("fill", "currentColor");
      t.textContent = months.length > 12 ? m : m.slice(5);
      svg.append(t);
    }
  });
  return el("figure", { class: "demo-figure" }, el("figcaption", {}, "Paid, by month of fill date"), svg);
}

function renderResults(t: TotalsState, ms: number, size: number): void {
  const area = byId("results-body");
  const payerRows = [...PAYER_LABELS, "Other"]
    .filter((p) => t.byPayer[p])
    .map((p) => sumsRow(p, t.byPayer[p] as Sums));
  const monthEntries = Object.entries(t.byMonth).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const skippedTotal = Object.values(t.skipped).reduce((a, b) => a + b, 0);
  const reasons = (Object.keys(SKIP_LABELS) as SkipReason[]).map((k) => [
    SKIP_LABELS[k],
    t.skipped[k].toLocaleString("en-US"),
  ]);

  const seconds = (ms / 1000).toFixed(2);

  area.replaceChildren(
    tiles([
      [t.total.rows.toLocaleString("en-US"), "rows counted"],
      [dollars(t.total.paid), "paid"],
      [dollars(t.total.cost), "acquisition cost"],
      [dollars(t.total.margin), "margin (paid minus cost)"],
    ]),
    barChart(monthEntries),
    table("Totals by payer type", SUM_HEADERS, [...payerRows, sumsRow("All counted rows", t.total)]),
    table("Totals by month of fill date", SUM_HEADERS, monthEntries.map(([m, s]) => sumsRow(m, s))),
    table("Rows skipped, by reason", ["Reason", "Rows"], reasons),
    el(
      "p",
      { class: "demo-summary" },
      `Rows read: ${t.rowsRead.toLocaleString("en-US")}. Counted: ${t.total.rows.toLocaleString("en-US")}. ` +
        `Skipped: ${skippedTotal.toLocaleString("en-US")}. File size: ${mb(size)} MB (${size.toLocaleString("en-US")} bytes). ` +
        `Time taken: ${seconds} seconds.`,
    ),
  );
  byId("results").hidden = false;
  byId("demo-area").classList.add("done");
  byId("proof-ran").textContent =
    `Your browser read ${t.rowsRead.toLocaleString("en-US")} rows in ${seconds} seconds. Requests made while it did: ${laterEntries.length}.`;
  byId("live").textContent = `Finished. ${t.total.rows} rows counted, ${skippedTotal} skipped, in ${(ms / 1000).toFixed(1)} seconds. Requests made: ${laterEntries.length}.`;
}

/* ---------- Wiring ---------- */

function start(): void {
  const input = byId<HTMLInputElement>("file");
  const drop = byId("drop");

  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) void processFile(f);
    input.value = "";
  });
  byId("use-sample").addEventListener("click", () => {
    void processFile(generateSampleFile(DEFAULT_ROWS));
  });

  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) void processFile(f);
  });
  /* The one deliberate connection attempt on the page. It sends nothing from any
     file, goes to a reserved address that cannot exist, and the page's policy
     (connect-src 'none') makes the browser refuse it before it leaves. */
  byId("try-send").addEventListener("click", () => {
    const out = byId("send-result");
    out.textContent = "Trying…";
    fetch("https://example.invalid/", { method: "POST", body: "test" }).then(
      () => {
        out.textContent = "The request was NOT refused. The page's policy is not in force; do not trust this copy of the page.";
      },
      (err: unknown) => {
        const why = err instanceof Error ? err.message : String(err);
        out.textContent = `Refused by the browser. Nothing was sent. The browser's message: "${why}"`;
      },
    );
  });
  renderProof();
  /* The page's own files (fonts included) finish loading before a file can be picked,
     so nothing of the page's own can be counted as a request made afterwards. */
  if (document.readyState !== "complete") {
    setBusy(true);
    window.addEventListener(
      "load",
      () => {
        setBusy(false);
        renderProof();
      },
      { once: true },
    );
  }
}

start();
