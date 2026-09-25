# AP-3's reports: the reader's column order, and clicking an ADC number — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ACC Portal the column drag-to-reorder Form Portal already has, carry the reader's order into the Excel file in both consoles, and make a dead ADC number open the claim's detail and approval timeline.

**Architecture:** One pure module per repo decides the export's column order from the reader's screen order, and the export is rebuilt as a single ordered list of column descriptors so the header, the body and the totals row cannot drift apart. The ADC link is routing, not new UI: `ClearAdvanceDetail` already renders detail *and* timeline.

**Tech Stack:** Next.js 16, TypeScript, `xlsx-js-style`. **Form Portal has no vitest** — `npm test` runs `tsx scripts/run-tests.ts` over `node --test`; tests use `node:test` + `node:assert/strict`. **ACC Portal uses vitest** — `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-09-24-ap3-report-columns-and-adc-link-design.md`

---

## Global constraints

1. **Never run `npm run build`** in either repo — a dev server owns `.next`. Use `npx tsc --noEmit` plus the repo's own runner.
2. `next-env.d.ts` in Form Portal carries an unrelated pre-existing diff. **Stage by name, never `git add -u` / `.` / `-a`.**
3. **Never `git checkout --`.** Use `cp` backups when reverting a mutation test.
4. **Do not change which columns either report has, or what the export contains.** This plan changes *order* and *what a click does*. A column added or dropped means something went wrong.
5. The two repos are independent copies. Every change lands in both unless a task says otherwise, and the two copies of the ordering module must stay behaviourally identical.
6. Commit trailer, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## The two column mappings, once, for reference

**Control** — screen key → export column keys, in this fixed internal order:

| screen key | export keys |
| --- | --- |
| `submittedAt` | `submittedAt` |
| `requestNo` | `requestNo` |
| `staffId` | `staffId` |
| `advanceRequestNo` | `advanceRequestNo` |
| `requesterFullName` | `requesterFullName` |
| `requesterPosition` | *(none)* |
| `requesterDepartmentName` | `requesterDepartmentName` |
| `advanceAmount` | `advanceAmount` |
| `expenseOf` | `expenseOf` |
| `actualTotal` | `actualTotal` |
| `adjustment` | `refundToCompany`, `extraToEmployee` |
| `refundTransferDate` | *(none)* |
| `pvDocNo` | `pvDocNo`, `paymentDate` |
| `managerApproved` | `managerApproved` |
| `accountActioned` | `accountActioned` |
| `pendingOn` | `pendingOn` |
| `overallStatus` | `overallStatus` |

17 screen columns → 17 export columns.

**Detail** — 1:1 by key, all 21, in this order: `requestNo`, `requestDate`, `lineNo`, `staffId`, `requesterFullName`, `expenseOf`, `branchCode`, `expenseDate`, `docNo`, `glAccountNo`, `glAccountName`, `description`, `amountBeforeVat`, `vatAmount`, `totalInclVat`, `whtAmount`, `netAmount`, `taxId`, `payeeName`, `payeeAddress`, `advanceRequestNo`.

---

# Slice A — the ordering rule (pure, both repos)

## Task 1: Form Portal's export column order

**Files:**
- Create: `R:\Form_Portal\src\lib\clr\report-export-order.ts`
- Create: `R:\Form_Portal\src\lib\clr\report-export-order.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/clr/report-export-order.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_EXPORT_ORDER,
  DETAIL_EXPORT_ORDER,
  controlExportOrder,
  detailExportOrder,
} from "./report-export-order";

/**
 * The reader drags a column; the Excel file follows.
 *
 * The property that matters is at the bottom: whatever comes in, what comes out
 * is a PERMUTATION of the default export columns. The Control export is not the
 * Control screen — one screen column owns two export columns, two own none — so
 * an off-by-one here does not throw, it silently ships a file with a column
 * missing or doubled.
 */

test("no order given -> the default, unchanged", () => {
  assert.deepEqual(controlExportOrder([]), CONTROL_EXPORT_ORDER);
  assert.deepEqual(detailExportOrder([]), DETAIL_EXPORT_ORDER);
});

test("the reader's order is followed", () => {
  const out = controlExportOrder(["requestNo", "submittedAt"]);
  assert.equal(out[0], "requestNo");
  assert.equal(out[1], "submittedAt");
});

test("a screen column owning two export columns keeps them together, in order", () => {
  const out = controlExportOrder(["adjustment", "submittedAt"]);
  assert.deepEqual(out.slice(0, 3), ["refundToCompany", "extraToEmployee", "submittedAt"]);
  const pv = controlExportOrder(["pvDocNo", "submittedAt"]);
  assert.deepEqual(pv.slice(0, 3), ["pvDocNo", "paymentDate", "submittedAt"]);
});

test("a screen column with no export column contributes nothing", () => {
  const out = controlExportOrder(["requesterPosition", "refundTransferDate", "requestNo"]);
  assert.equal(out[0], "requestNo");
});

test("an unknown key is ignored and a duplicate is taken once", () => {
  const out = controlExportOrder(["nope", "requestNo", "requestNo"]);
  assert.equal(out[0], "requestNo");
  assert.equal(out.filter((k) => k === "requestNo").length, 1);
});

test("columns the reader did not name are appended in the default order", () => {
  const out = controlExportOrder(["overallStatus"]);
  assert.equal(out[0], "overallStatus");
  assert.deepEqual(
    out.slice(1),
    CONTROL_EXPORT_ORDER.filter((k) => k !== "overallStatus"),
  );
});

test("the output is always a permutation of the default columns", () => {
  const inputs: string[][] = [
    [],
    ["requestNo"],
    ["adjustment"],
    ["pvDocNo", "adjustment"],
    ["nope", "", "requestNo", "requestNo", "requesterPosition"],
    [...CONTROL_EXPORT_ORDER].reverse(),
  ];
  for (const input of inputs) {
    const out = controlExportOrder(input);
    assert.deepEqual(
      [...out].sort(),
      [...CONTROL_EXPORT_ORDER].sort(),
      `input ${JSON.stringify(input)}`,
    );
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/report-export-order.test.ts
```

Expected: fails to resolve `./report-export-order`.

- [ ] **Step 3: Write the module**

Create `src/lib/clr/report-export-order.ts`:

```ts
/**
 * Which order the AP-3 report exports write their columns in, given the order
 * the reader dragged them into on screen.
 *
 * The reader's order lives in `localStorage` (see `makeColumnPrefs`), so this
 * function's input is untrusted: a stale value, a hand-edited URL, or a column
 * a newer build added and this one has not heard of. It never throws and never
 * changes WHICH columns the file has — it only permutes them. Everything the
 * reader did not name is appended in the default order, so the worst a bad
 * input can do is "the default order".
 *
 * ## Why this is not just `screenOrder`
 *
 * The Control export is not the Control screen. `adjustment` is one signed
 * column on screen and two columns in the file (โอนคืนบริษัท / เบิกเพิ่ม);
 * `pvDocNo` packs the payment date into a sub-line on screen and is two columns
 * in the file. `requesterPosition` and `refundTransferDate` are on screen and
 * not in the file at all. The file's column SET is deliberately its own — see
 * the design doc, §1.2 — and only the order follows the reader.
 */

/** Export column keys, in the order the file has always written them. */
export const CONTROL_EXPORT_ORDER = [
  "submittedAt", "requestNo", "staffId", "advanceRequestNo", "requesterFullName",
  "requesterDepartmentName", "advanceAmount", "expenseOf", "actualTotal",
  "refundToCompany", "extraToEmployee", "pvDocNo", "paymentDate",
  "managerApproved", "accountActioned", "pendingOn", "overallStatus",
] as const;

export const DETAIL_EXPORT_ORDER = [
  "requestNo", "requestDate", "lineNo", "staffId", "requesterFullName", "expenseOf",
  "branchCode", "expenseDate", "docNo", "glAccountNo", "glAccountName", "description",
  "amountBeforeVat", "vatAmount", "totalInclVat", "whtAmount", "netAmount",
  "taxId", "payeeName", "payeeAddress", "advanceRequestNo",
] as const;

export type ControlExportKey = (typeof CONTROL_EXPORT_ORDER)[number];
export type DetailExportKey = (typeof DETAIL_EXPORT_ORDER)[number];

/**
 * Screen column key -> the export columns it owns, in the order they appear in
 * the file. A screen column absent from this map owns none: it is on screen and
 * not in the file.
 */
const CONTROL_OWNS: Record<string, readonly ControlExportKey[]> = {
  submittedAt: ["submittedAt"],
  requestNo: ["requestNo"],
  staffId: ["staffId"],
  advanceRequestNo: ["advanceRequestNo"],
  requesterFullName: ["requesterFullName"],
  requesterDepartmentName: ["requesterDepartmentName"],
  advanceAmount: ["advanceAmount"],
  expenseOf: ["expenseOf"],
  actualTotal: ["actualTotal"],
  adjustment: ["refundToCompany", "extraToEmployee"],
  pvDocNo: ["pvDocNo", "paymentDate"],
  managerApproved: ["managerApproved"],
  accountActioned: ["accountActioned"],
  pendingOn: ["pendingOn"],
  overallStatus: ["overallStatus"],
};

const DETAIL_OWNS: Record<string, readonly DetailExportKey[]> = Object.fromEntries(
  DETAIL_EXPORT_ORDER.map((k) => [k, [k] as readonly DetailExportKey[]]),
);

function order<K extends string>(
  screenOrder: readonly string[],
  owns: Record<string, readonly K[]>,
  fallback: readonly K[],
): K[] {
  const out: K[] = [];
  const seen = new Set<K>();
  const take = (k: K) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const screenKey of screenOrder) for (const k of owns[screenKey] ?? []) take(k);
  for (const k of fallback) take(k);
  return out;
}

export function controlExportOrder(screenOrder: readonly string[]): ControlExportKey[] {
  return order(screenOrder, CONTROL_OWNS, CONTROL_EXPORT_ORDER);
}

export function detailExportOrder(screenOrder: readonly string[]): DetailExportKey[] {
  return order(screenOrder, DETAIL_OWNS, DETAIL_EXPORT_ORDER);
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/report-export-order.test.ts
```

Expected: all 7 pass.

- [ ] **Step 5: Prove the tests bite**

`cp` the module aside, then make each break in turn, running the suite after each and restoring from the copy:

1. Drop the `seen` guard (`const take = (k) => out.push(k)`) — the duplicate case and the permutation property must both go red.
2. Give `adjustment` only `["refundToCompany"]` — the permutation property must go red (a column vanishes).
3. Remove the fallback loop — the "appended in the default order" case and the permutation property must go red.

Report which cases failed for each. **A mutation that leaves everything green means a test is not pulling its weight — say so rather than moving on.**

- [ ] **Step 6: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

```bash
cd /r/Form_Portal
git add src/lib/clr/report-export-order.ts src/lib/clr/report-export-order.test.ts
git commit -m "feat(clr): the export's column order, from the reader's

The Excel file's column order and the screen's are two lists today, so
dragging a column moves nothing in the file. This is the rule that joins
them, and it is a permutation: the file keeps its own column SET, because
the Control export splits one screen column into two, omits two others, and
is read by people who are not looking at the screen.

The input is localStorage, so it is untrusted. Unknown keys are dropped,
duplicates taken once, and anything unnamed is appended in the default
order -- the worst a bad value can do is the order we ship today.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ACC Portal's copy

**Files:**
- Create: `R:\Acc_Portal\src\lib\clr\report-export-order.ts`
- Create: `R:\Acc_Portal\src\lib\clr\report-export-order.test.ts`

- [ ] **Step 1: Port the module**

Copy `R:\Form_Portal\src\lib\clr\report-export-order.ts` **byte for byte**, then add one paragraph to its docblock recording that it is kept identical to Form Portal's, and why: a file whose column order depends on which console produced it is worse than either order.

Read Form Portal's file rather than retyping it.

- [ ] **Step 2: Port the tests, in vitest**

Translate `report-export-order.test.ts`: `import { describe, it, expect } from "vitest"` (follow a neighbouring ACC test — `src/lib/acc/ap234-roles.test.ts` is a good model for the `describe` convention), `assert.deepEqual(a, b)` → `expect(a).toEqual(b)`, `assert.equal(a, b)` → `expect(a).toBe(b)`. **Keep every comment** — they say why each case exists.

- [ ] **Step 3: Prove they bite here too**

Repeat Task 1 Step 5's three mutations in this repo, with `cp` backups. Report the results.

- [ ] **Step 4: Confirm the two copies agree**

```bash
diff <(sed -n '/^export const CONTROL_EXPORT_ORDER/,/^}/p' /r/Form_Portal/src/lib/clr/report-export-order.ts) \
     <(sed -n '/^export const CONTROL_EXPORT_ORDER/,/^}/p' /r/Acc_Portal/src/lib/clr/report-export-order.ts)
```

Expected: no output. Do the same for `CONTROL_OWNS` and the `order` function.

- [ ] **Step 5: Verify and commit**

```bash
cd /r/Acc_Portal && npx tsc --noEmit && npm test
```

Commit both files with a message in this repo's voice, saying it is ported so the two consoles cannot write differently-ordered files.

---

# Slice B — the exports follow the order

## Task 3: Form Portal's Control export becomes descriptors

**Files:**
- Modify: `R:\Form_Portal\src\app\api\request\clear-advance\report\export\route.ts`
- Create: `R:\Form_Portal\src\app\api\request\clear-advance\report\export\route.test.ts`

- [ ] **Step 1: Read the route first**

Its `header` (line ~51), `body` (line ~57) and `totalRow` (line ~70) are **three positional arrays that must agree**. `totalRow` puts its sums at indices 6, 8, 9 and 10. Permuting the header without permuting the totals row puts the sums under the wrong headers — a file that looks right and is not. This is why the rewrite is to descriptors, not to a reordered header.

- [ ] **Step 2: Rewrite as one ordered list**

Replace the three arrays with a single map from export key to a descriptor, then derive all three rows from `controlExportOrder(...)`:

```ts
type Row = (typeof rows)[number];
type Col = { header: string; value: (r: Row) => string | number; total?: () => number };

const sum = (k: "advanceAmount" | "actualTotal" | "refundToCompany" | "extraToEmployee") =>
  Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) * 100) / 100;

/* One list, three rows derived from it. The header, the body and the totals row
   used to be three positional arrays; the totals row put its sums at fixed
   indices, so reordering the header alone would have moved every sum under the
   wrong heading — silently, since nothing checks that a spreadsheet means what
   it says. */
const COLS: Record<ControlExportKey, Col> = {
  submittedAt:             { header: "วันที่ส่ง",              value: (r) => fmtDt(r.submittedAt) },
  requestNo:               { header: "เลขที่เคลียร์ (ADC)",     value: (r) => r.requestNo ?? "" },
  staffId:                 { header: "รหัสพนักงาน",            value: (r) => r.staffId ?? "" },
  advanceRequestNo:        { header: "เลขที่ Advance (AP-2)",   value: (r) => r.advanceRequestNo ?? "" },
  requesterFullName:       { header: "ชื่อ",                   value: (r) => r.requesterFullName ?? "" },
  requesterDepartmentName: { header: "แผนก",                  value: (r) => r.requesterDepartmentName ?? "" },
  advanceAmount:           { header: "วงเงินที่ได้รับ",         value: (r) => r.advanceAmount ?? 0,    total: () => sum("advanceAmount") },
  expenseOf:               { header: "เป็นค่าใช้จ่ายของ",       value: (r) => r.expenseOf ?? "" },
  actualTotal:             { header: "รวมใช้จริง",             value: (r) => r.actualTotal ?? 0,      total: () => sum("actualTotal") },
  refundToCompany:         { header: "โอนคืนบริษัท",           value: (r) => r.refundToCompany ?? 0,  total: () => sum("refundToCompany") },
  extraToEmployee:         { header: "เบิกเพิ่ม",               value: (r) => r.extraToEmployee ?? 0,  total: () => sum("extraToEmployee") },
  pvDocNo:                 { header: "PV",                    value: (r) => reportPv(r).text ?? "" },
  paymentDate:             { header: "Payment Date",          value: (r) => fmtD(r.paymentDate) },
  managerApproved:         { header: "ผู้จัดการอนุมัติ",        value: (r) => withDate(r.managerApprovedName, r.managerApprovedAt) },
  accountActioned:         { header: "บัญชี Action",           value: (r) => withDate(r.accountActionedName, r.accountActionedAt) },
  pendingOn:               { header: "รออนุมัติที่",            value: (r) => r.pendingOn ?? "" },
  overallStatus:           { header: "สถานะ",                  value: (r) => STATUS_LABEL_TH[r.overallStatus as keyof typeof STATUS_LABEL_TH] ?? r.overallStatus },
};

const screenOrder = (req.nextUrl.searchParams.get("cols") ?? "").split(",").filter(Boolean);
const keys = controlExportOrder(screenOrder);

const header = keys.map((k) => COLS[k].header);
const body = rows.map((r) => keys.map((k) => COLS[k].value(r)));
/* "รวมทั้งหมด" sits in the first cell whatever that column now is, the way it
   always sat in the first cell. Every other cell is its column's own total or
   blank, so the sums travel with their headings. */
const totalRow = keys.map((k, i) => (i === 0 ? "รวมทั้งหมด" : COLS[k].total?.() ?? ""));
```

**Check the real column names against the current file before you finalise** — `refundToCompany`, `extraToEmployee`, `paymentDate`, `managerApprovedName`/`At`, `accountActionedName`/`At` are read off the existing `body` and `totalRow`; if any differs, use the real one and say so.

Import `controlExportOrder` and `type ControlExportKey` from `@/lib/clr/report-export-order`.

- [ ] **Step 3: Test the route's validation**

Create `route.test.ts` in the same folder. **Do not import the route** — it pulls `@/lib/db/mssql` → `@/env`, which validates the environment at import and throws under `tsx` with no env file (the same constraint `payment-calendar-core.ts`'s header documents). Test the parsing and ordering the route does, by exercising `controlExportOrder` against the exact strings a URL can carry:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { controlExportOrder, CONTROL_EXPORT_ORDER } from "@/lib/clr/report-export-order";

/** What the route does to `?cols=` before ordering: split, drop empties. */
const parse = (raw: string | null) => (raw ?? "").split(",").filter(Boolean);

test("no cols parameter -> today's file, unchanged", () => {
  assert.deepEqual(controlExportOrder(parse(null)), CONTROL_EXPORT_ORDER);
  assert.deepEqual(controlExportOrder(parse("")), CONTROL_EXPORT_ORDER);
});

test("a hand-edited or stale value cannot lose a column", () => {
  for (const raw of [",,,", "nope,alsonope", "requestNo,,requestNo", "<script>"]) {
    assert.deepEqual(
      [...controlExportOrder(parse(raw))].sort(),
      [...CONTROL_EXPORT_ORDER].sort(),
      raw,
    );
  }
});
```

If the route parses `cols` differently from `parse` above, make the test match the route — and say so in your report, because the two must agree.

- [ ] **Step 4: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

Commit with a message explaining the descriptor rewrite and the totals-row hazard it removes.

---

## Task 4: Form Portal's Detail export

**Files:**
- Modify: `R:\Form_Portal\src\app\api\request\clear-advance\report\detail\export\route.ts`

Same rewrite, `detailExportOrder`, 21 columns, 1:1. **Its export headers are worded differently from the screen's** ("Request no." against "เลขที่เคลียร์", "รหัสสาขา" against "สาขา"). That stays — the mapping is by key, not by label. Do not tidy the two wordings into agreement.

Check whether this route has a totals row; if it does, it takes the same treatment, and if it does not, say so.

- [ ] Verify (`npx tsc --noEmit && npm test`) and commit.

---

## Task 5: Form Portal's report screens send their order

**Files:**
- Modify: `R:\Form_Portal\src\features\clear-advance\components\report\ClrControlReport.tsx`
- Modify: `R:\Form_Portal\src\features\clear-advance\components\report\ClrDetailReport.tsx`

- [ ] **Step 1: Find where each builds its export URL**

Each has a download control that hits its export route with the current filters as a query string. Append the reader's order as `cols=<comma-joined order>`, taken from the same state the table renders from (`makeColumnPrefs`'s order value) — **the order, not the visible subset**: a hidden column still exports (design §1.2).

- [ ] **Step 2: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

---

## Task 6: ACC Portal's two exports

**Files:**
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\report\ClrControlReport.tsx` (`EXPORT_HEADER` ~:350, `totalRow` ~:490)
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\report\ClrDetailReport.tsx` (`EXPORT_HEADER` ~:141)

ACC builds its files in the browser, so the order is already in hand — no query string. Same descriptor rewrite as Tasks 3 and 4, same hazard: ACC's Control export has the identical positional `totalRow`.

Note ACC's export also styles the header row and sets `!cols` widths from `EXPORT_HEADER`; both must follow the derived header array, not the constant.

- [ ] Verify (`npx tsc --noEmit && npm test`) and commit.

---

# Slice C — ACC gets drag-to-reorder

## Task 7: ACC's ColumnToggleMenu learns to reorder

**Files:**
- Modify: `R:\Acc_Portal\src\features\travel-booking\components\ColumnToggleMenu.tsx`
- Modify: both ACC report components

- [ ] **Step 1: Port the capability, not the file**

Form Portal's `src/features/travel-booking/components/ColumnToggleMenu.tsx` has the `onReorder` prop, the draggable row and `arrayMove` (lines ~29-111). ACC's copy has show/hide only. **Read Form Portal's and port the reorder half into ACC's**, keeping everything ACC's copy already does — the two files have diverged and this is not a wholesale overwrite. Say in your report what else differs between them.

- [ ] **Step 2: Both ACC reports pass it**

Each passes `onReorder` and persists the order through its own `makeColumnPrefs` keys, the way visibility already is. Follow Form Portal's two report components for the exact wiring.

- [ ] **Step 3: Remove the comment that says this cannot happen**

`ClrControlReport.tsx`'s header docblock states ACC has no drag-to-reorder as a deliberate divergence. After this task that is false. Rewrite it.

- [ ] **Step 4: Verify and commit**

```bash
cd /r/Acc_Portal && npx tsc --noEmit && npm test
```

---

# Slice D — clicking an ADC number

## Task 8: Form Portal's dead ADC numbers become links

**Files:**
- Modify: `R:\Form_Portal\src\features\clear-advance\components\admin\ClrApprovalsQueue.tsx:164`
- Modify: `R:\Form_Portal\src\features\clear-advance\components\admin\ClrErpInterfaceQueue.tsx` (~8 places: :316, :875, :1000, :1087, :1176, :1212, :1277, :1309)
- Modify: `R:\Form_Portal\src\features\clear-advance\components\report\ClrDetailReport.tsx`

- [ ] **Step 1: Use the href that already exists**

`clearAdvanceDetailHref(id)` is what the Control report already uses. Match the Control report's link styling so an ADC number looks the same everywhere.

- [ ] **Step 2: Mind the ERP queue's existing click targets**

Rows in `ClrErpInterfaceQueue` already respond to clicks — they open the BC-response modal, the cancel dialog and the pull-back dialog. The ADC link must not steal those: stop propagation on the link, and **check each of the ~8 sites individually** — some are inside a modal's own title, where a link away may make no sense. Report any site you decided to leave as text and why.

- [ ] **Step 3: Verify and commit**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

---

## Task 9: ACC's ADC numbers open a read-only drawer

**Files:**
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\report\ClrControlReport.tsx`
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\report\ClrDetailReport.tsx`
- Modify: `R:\Acc_Portal\src\features\clear-advance\components\ClrErpInterfaceQueue.tsx`

- [ ] **Step 1: Follow the drawer that exists**

`ClrApprovalsQueue.tsx` (~:234-295) opens a `SidePanel` with `ClearAdvanceDetail` + `ClrAccountWorkspace` on `setDrawerId(r.id)`. Copy the panel, the fetch and the loading/​error handling.

- [ ] **Step 2: Render `ClearAdvanceDetail` ALONE**

**Do not include `ClrAccountWorkspace`.** A report spans every status and so does the ERP queue; offering the ACCOUNT-step actions beside a claim that is sent, cancelled or still with the manager invites an action that is not the reader's job. The approvals queue stays the one place that step is taken. Put that reason in a comment at each of the three sites — it is a decision a later edit would otherwise quietly undo.

- [ ] **Step 3: Remove the comment that says there is nowhere to go**

`ClrControlReport.tsx` explains its plain-text ADC as *"there is nowhere for a click to go"*, and its header docblock says the same as point 2. Both are now false. Rewrite them, and record what replaced them: a drawer, not a route, and that the view therefore has no URL to send anyone — the user's choice, 2026-09-24.

- [ ] **Step 4: Verify and commit**

```bash
cd /r/Acc_Portal && npx tsc --noEmit && npm test
```

---

## Task 10: Guards for the two things review cannot see

**Files:**
- Create: `R:\Form_Portal\src\lib\clr\adc-link-guard.test.ts`
- Create: `R:\Acc_Portal\src\lib\clr\adc-link-guard.test.ts`

Source-scan guards in the established style — read `src/lib/acc/payday-form-scope-guard.test.ts` in each repo first and follow its shape: strip comments before matching, walk rather than hard-code where sensible, and assert the scan actually found something.

- [ ] **Step 1: The read-only drawers stay read-only (ACC)**

Assert that ACC's two report components and `ClrErpInterfaceQueue.tsx` do **not** reference `ClrAccountWorkspace`, and that `ClrApprovalsQueue.tsx` still does — a guard that would pass if the component were deleted outright is not a guard.

- [ ] **Step 2: No named ADC cell is plain text again (both repos)**

Assert each file from Tasks 8 and 9 contains the link/drawer trigger it gained. Keep the assertion specific enough to fail if the link is removed and loose enough not to fail on a re-style.

- [ ] **Step 3: Prove both bite**

`cp` a file aside, remove the link (and separately, add a `ClrAccountWorkspace` import to a report), run, confirm each fails **naming the file**, restore, delete the copy. Report the failure output.

- [ ] **Step 4: Verify and commit in both repos.**

---

## Task 11: Drive it in the browser

**Files:** none. This task changes nothing.

Form Portal runs on `:3081`, ACC Portal on `:3060`. Both were running as of 2026-09-24; **ACC's dev server was returning 500 on every page render while its API routes answered normally** — if that is still true, say so rather than reporting a check as passed, and restart only if the user agrees.

- [ ] **Step 1: The drag works in ACC** — open AP-3's report, drag a column, confirm it moves and survives a reload.
- [ ] **Step 2: The file follows** — download the Excel from that same screen and confirm the column order matches, the totals row's sums are still under วงเงินที่ได้รับ / รวมใช้จริง / โอนคืนบริษัท / เบิกเพิ่ม, and the file still has all 17 columns. **This is the check Task 3 exists for.**
- [ ] **Step 3: A hidden column still exports** — hide one, download, confirm it is in the file.
- [ ] **Step 4: The same in Form Portal**, whose export is a server route — confirm the order reaches it.
- [ ] **Step 5: Clicking an ADC** — from ACC's Control report (drawer, no account actions visible), from Form Portal's approvals queue (navigates), and from one ERP interface queue in each repo.
- [ ] **Step 6: Report what could not be checked**, plainly, rather than implying it passed.
