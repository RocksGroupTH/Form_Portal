import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The display half of multi-currency, guarded at the source.
 *
 * There is no route or database harness in this repository, and none of what
 * follows is reachable from a unit test: it is which helper a component calls,
 * and which column a query selects. Both are exactly the kind of thing a later
 * edit undoes by accident — the ERP prep queue's total was a sum of ringgit and
 * baht for as long as the currency existed, printed as one figure with no unit,
 * on the screen an approver reads immediately before pressing Send.
 *
 * So this reads the sources, the way `currency-pool-guard.test.ts` and
 * `rate-override-guard.test.ts` already do.
 */

const ROOT = path.resolve(process.cwd(), "src");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so a comment quoting a rule cannot satisfy it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PREP_QUEUE = "features/accounting/components/ErpPrepQueue.tsx";
const EXPENSE_ROWS = "features/accounting/components/ExpenseRows.tsx";
const REPORT_TABLE = "features/accounting/components/AccountingReport.tsx";
const APPROVALS = "features/accounting/components/ApprovalsQueue.tsx";
const AP1_REPORT_SERVICE = "lib/acc/report-service.ts";
const AP17_REPORT_SERVICE = "lib/acc/travel-booking/report-service.ts";
const ERP_PREP_SERVICE = "lib/acc/erp-prep-service.ts";

/* ── The posting path ── */

/**
 * The one that matters most. `tableTotal` is the footer of the ERP prep queue,
 * and `displayDayAmountCell` is the claim's own currency — summing it adds MYR
 * to THB and prints the result as a single number.
 */
test("the ERP prep queue totals in baht, not in the claim's own currency", () => {
  const src = code(PREP_QUEUE);
  const total = src.slice(src.indexOf("const tableTotal"), src.indexOf("const hasForeignRow"));
  assert.ok(total.length > 0, "tableTotal / hasForeignRow not found");
  assert.ok(
    total.indexOf("displayDayAmountBaht") !== -1,
    "the footer must sum displayDayAmountBaht",
  );
  assert.equal(
    total.indexOf("displayDayAmountCell"),
    -1,
    "the footer must not sum the claim's own currency",
  );
});

/**
 * Every screen rendering a per-day figure needs the currency and the rate to
 * convert it, and both come off the request header.
 */
test("both queries that carry the per-day breakdown also carry the currency", () => {
  for (const rel of [AP1_REPORT_SERVICE, ERP_PREP_SERVICE]) {
    const src = code(rel);
    assert.ok(src.indexOf("TRAVEL_DAYS_CSV_SELECT") !== -1, `${rel}: no day breakdown`);
    assert.ok(
      /r\.Currency,\s*r\.ExchangeRate/.test(src),
      `${rel}: selects the day breakdown without the currency that denominates it`,
    );
  }
});

/** A GROUP BY that omits a selected column is a compile-time error in SQL Server. */
test("the erp-prep GROUP BY lists the currency columns it selects", () => {
  const src = code(ERP_PREP_SERVICE);
  const groupBy = src.slice(src.indexOf("GROUP BY r.Id"), src.indexOf("ORDER BY r.PaymentDate"));
  assert.ok(groupBy.length > 0, "GROUP BY not found");
  for (const col of ["r.Currency", "r.ExchangeRate", "r.ForeignAmount"]) {
    assert.ok(groupBy.indexOf(col) !== -1, `GROUP BY omits ${col}`);
  }
});

/* ── The exports ── */

test("both Excel exports carry a currency column", () => {
  assert.ok(
    code(AP1_REPORT_SERVICE).indexOf('"สกุลเงิน"') !== -1,
    "AP-1's export has no currency column",
  );
  assert.ok(
    code(AP17_REPORT_SERVICE).indexOf('"สกุลเงินค่าจอง"') !== -1,
    "AP-17's export has no currency column",
  );
});

/**
 * Both workbooks style their money columns by *heading*, never by a numeric
 * literal. Inserting a column above a hard-coded index silently moves a money
 * format onto somebody's per-diem rate — AP-17 records having been caught by
 * exactly that, and AP-1 gained three columns beside its total this task.
 */
test("no workbook addresses a styled column by a bare number", () => {
  for (const rel of [AP1_REPORT_SERVICE, AP17_REPORT_SERVICE]) {
    const src = code(rel);
    const offenders = src.match(/encode_cell\(\{\s*r:\s*rr,\s*c:\s*\d+\s*\}\)/g);
    assert.equal(
      offenders,
      null,
      `${rel}: styles a column by index — use columns.indexOf(<heading>)`,
    );
  }
});

/* ── The caption ── */

/**
 * The caption has to hold for rows recorded under two different feeds — the ECB
 * mid-market fallback before a `BOT_CURRENCY_RATE` key was registered on
 * 2026-09-04, the Bank of Thailand selling rate since. One definition of the
 * caption means one sentence to be right about, instead of a wording per surface
 * that only some of the rows it is shown against actually fit.
 */
test("the reference-rate caption is defined exactly once", () => {
  const defs: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        if (/export function referenceRateNote/.test(fs.readFileSync(p, "utf8"))) {
          defs.push(path.relative(ROOT, p));
        }
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(defs, [path.join("lib", "acc", "currency-display.ts")], defs.join(", "));
});

/**
 * A claim in a currency the reader cannot see is the defect this task closes.
 * Each of these three tables shows a foreign figure beside the baht one.
 */
test("every AP-1 table that shows a day figure also shows its currency", () => {
  for (const rel of [PREP_QUEUE, REPORT_TABLE, APPROVALS]) {
    const src = code(rel);
    assert.ok(
      src.indexOf("showsForeignCurrency") !== -1,
      `${rel}: renders money without ever asking whether it is baht`,
    );
    assert.ok(
      src.indexOf("fmtAmountWithCurrency") !== -1,
      `${rel}: never prints a figure with its own currency beside it`,
    );
  }
});

/* ── The line's own currency control ── */

/** `LineCurrencyChoice`'s body, ending at the next top-level declaration. */
function lineCurrencyChoiceBody(): string {
  const src = code(EXPENSE_ROWS);
  const start = src.indexOf("function LineCurrencyChoice");
  assert.notEqual(start, -1, "LineCurrencyChoice not found");
  // Not `\n}` — the destructured parameter list closes with `}: {` at column 0,
  // which would cut the body off at the signature and pass every check below
  // against an empty string.
  const next = src.indexOf("\nexport function ", start);
  assert.notEqual(next, -1, "no declaration follows LineCurrencyChoice");
  return src.slice(start, next);
}

/**
 * **A Thai claim renders no currency control at all**, and that promise is one
 * predicate rather than a condition retyped per branch. It is the thing most
 * likely to be broken by a later edit — a one-option control, a disabled
 * placeholder, an empty group — and none of them would fail a type check.
 */
test("the line's currency control is gated on the single Thailand predicate", () => {
  const src = code(EXPENSE_ROWS);
  assert.ok(
    /const showsCurrency = currencyOptions\.length > 0;/.test(src),
    "the one Thailand test must stay one test",
  );
  const uses = src.match(/<LineCurrencyChoice/g) ?? [];
  assert.equal(uses.length, 1, `expected one currency control in the row, found ${uses.length}`);
});

/**
 * Segments or dropdown is decided by the pure rule, not by a length compared
 * against a number typed here. A second copy is how the control and the test
 * that fixes the threshold come to disagree about where a strip stops being
 * usable.
 */
test("the control picks its shape from the shared threshold", () => {
  const body = lineCurrencyChoiceBody();
  assert.ok(/usesCurrencySegments\(options\)/.test(body), "the threshold must come from claim-currency");
  assert.equal(
    /options\.length\s*[<>=]/.test(body),
    false,
    "a hand-written length test here is a second copy of the threshold",
  );
  // And the dropdown it degrades to is the one that was already there.
  assert.ok(/<select/.test(body), "the fallback dropdown must survive, not be rebuilt later");
});

/**
 * `a5a2234` made "no currency yet" a stored state that refuses submit, so a
 * group with nothing filled in has to read as an **open question** rather than
 * as a control that failed to render. The frame and both segments say so.
 */
test("the unanswered currency reads as a question, not as an absence", () => {
  const body = lineCurrencyChoiceBody();
  const signals = body.match(/unanswered/g) ?? [];
  assert.ok(
    signals.length >= 4,
    `the blank state must be visibly distinct in more than one way, found ${signals.length}`,
  );
  assert.ok(/var\(--color-danger\)/.test(body), "the blank state must be marked with the danger token");
  // Tokens only — never a raw hex, per the house rule.
  assert.equal(
    /#[0-9a-fA-F]{3,8}\b/.test(body),
    false,
    "a raw colour reached the control; use var(--token)",
  );
});

/**
 * The read fills the currency in, so changing it mid-flight would have the
 * model's answer admitted against a question nobody asked. Every segment is
 * locked with the amount field, not only the group.
 */
test("the control is locked while the receipt read is in flight", () => {
  const body = lineCurrencyChoiceBody();
  const locks = body.match(/disabled=\{disabled\}/g) ?? [];
  assert.ok(locks.length >= 2, `both the dropdown and the segments must lock, found ${locks.length}`);
});
