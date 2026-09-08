# AP-3 Phase 2 Step 1 — Z-ADJ adjustment marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `adjCode: "M-ADJ"` on every AP-3 expense line whose receipt is dated in an earlier month than the journal's posting date, so BC tags it on the Z-ADJ dimension as a prior-period adjustment.

**Architecture:** Nothing changes in Business Central. Codeunit 50263 already reads an `adjCode` key and writes it to the Z-ADJ dimension (`APJournalCreate.al:238`); the portal has simply never sent it. The work is three small links in one chain — carry each expense line's date into the payload builder, decide the marker from that date against the posting date, and let the reviewer see the result before sending.

**Tech Stack:** TypeScript, `node:test` via `npm test` (`tsx scripts/run-tests.ts`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-ap3-phase2-erp-fields-design.md` §4.1

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/acc/erp-ppap-payload.ts` | The wire shape of a PPAP journal line | Add optional `adjCode` |
| `src/lib/clr/clear-advance-erp-payload.ts` | Build the AP-3 journal from a clearing | Add `expenseDate` to `ClrJournalItem`, add the period rule, set `adjCode` on expense lines |
| `src/lib/clr/clear-advance-erp-payload.test.ts` | Unit tests for the builder | New tests |
| `src/lib/clr/clear-advance-erp-send.ts` | Load a request and hand it to the builder | Carry `expenseDate` through `toJournalItems`; expose `adjCode` on the preview line |
| `src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx` | The ERP queue and its Preview BC Journal modal | Show the marker beside the branch |

---

## Task 1: The period rule

A pure predicate, separate from payload assembly, because it is the one piece of
this feature with edge cases worth naming: a year boundary, a missing date, and
a date in the same month.

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `src/lib/clr/clear-advance-erp-payload.test.ts`:

```ts
/* ── isPriorPeriod — the Z-ADJ marker rule (spec §4.1) ────────────────────
 *
 * A receipt belonging to an earlier accounting month than the journal it lands
 * in is an adjustment, and BC wants it tagged on Z-ADJ. Months, not days: two
 * dates inside the same month are the same period however far apart they are.
 */

test("a receipt from an earlier month is a prior period", () => {
  assert.equal(isPriorPeriod("2026-07-31", "2026-08-01"), true);
});

test("same month is not a prior period, whatever the day", () => {
  assert.equal(isPriorPeriod("2026-08-01", "2026-08-31"), false);
  assert.equal(isPriorPeriod("2026-08-31", "2026-08-01"), false);
});

test("a later month is not a prior period", () => {
  assert.equal(isPriorPeriod("2026-09-01", "2026-08-31"), false);
});

test("December against January crosses the year correctly", () => {
  assert.equal(isPriorPeriod("2025-12-31", "2026-01-01"), true);
});

test("no receipt date means the rule cannot be true", () => {
  assert.equal(isPriorPeriod(null, "2026-08-01"), false);
  assert.equal(isPriorPeriod("", "2026-08-01"), false);
  assert.equal(isPriorPeriod("2026-07-01", ""), false);
});
```

Add `isPriorPeriod` to the import at the top of that file:

```ts
import { buildClearAdvanceJournalPayload, isPriorPeriod, type ClrJournalInput } from "./clear-advance-erp-payload";
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"` (PowerShell)
Expected: `# fail 5`, with `isPriorPeriod is not a function`.

- [x] **Step 3: Implement it**

Add to `src/lib/clr/clear-advance-erp-payload.ts`, above `buildClearAdvanceJournalPayload`:

```ts
/** The Z-ADJ dimension value for a prior-period adjustment (spec §4.1). The
 *  requirements call it "MS"; the value that exists in BC is `M-ADJ`. */
export const PRIOR_PERIOD_ADJ_CODE = "M-ADJ";

/**
 * Is this receipt from an accounting month earlier than the one it is posting
 * into?
 *
 * Compared as `YYYY-MM` text, which handles the year boundary without date
 * arithmetic: "2025-12" < "2026-01" sorts correctly as a string. Either date
 * missing answers false — the rule needs a date to be true, and an absent one
 * makes it unknown rather than false, which is the same decision here: no
 * marker.
 */
export function isPriorPeriod(expenseDate: string | null | undefined, postingDate: string): boolean {
  const a = (expenseDate ?? "").slice(0, 7);
  const b = (postingDate ?? "").slice(0, 7);
  if (a.length !== 7 || b.length !== 7) return false;
  return a < b;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"`
Expected: `# fail 0`, pass count up by 5.

- [x] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "feat(ap-3): the rule for a prior-period receipt"
```

---

## Task 2: Carry the receipt date into the payload, and mark the line

**Files:**
- Modify: `src/lib/acc/erp-ppap-payload.ts` (add `adjCode` to the line type)
- Modify: `src/lib/clr/clear-advance-erp-payload.ts` (`ClrJournalItem`, `glLine`, the item loop)
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `src/lib/clr/clear-advance-erp-payload.test.ts`:

```ts
test("an expense line from an earlier month carries the Z-ADJ marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-07-15" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.adjCode, "M-ADJ");
});

test("an expense line from the posting month carries no marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-08-02" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.adjCode, undefined);
});

test("an expense line with no receipt date carries no marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.adjCode, undefined);
});

test("each expense line is judged on its own date", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    advanceAmount: 3000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-07-15" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-08-15" },
    ],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.adjCode, "M-ADJ");
  assert.equal(p.lines.find((l) => l.accountNo === "610319001")!.adjCode, undefined);
});

/* The VAT, WHT, vendor and bank lines have no document date of their own, so a
 * marker on them would be derived from someone else's receipt (spec §4.1). */
test("only expense lines are ever marked", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    advanceAmount: 5000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01", expenseDate: "2026-07-15" }],
  }));
  for (const l of p.lines) {
    const isExpense = l.accountNo === "610322005";
    assert.equal(l.adjCode, isExpense ? "M-ADJ" : undefined, `line ${l.accountType} ${l.accountNo}`);
  }
});
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"`
Expected: `# fail 5` — `adjCode` is not a property, and `expenseDate` is not accepted on an item.

- [x] **Step 3: Add `adjCode` to the wire shape**

In `src/lib/acc/erp-ppap-payload.ts`, inside `interface PpapJournalLinePayload`, after `departmentCode`:

```ts
  /**
   * Z-ADJ dimension value. Codeunit 50263 reads this key and writes the
   * dimension (`APJournalCreate.al:238`); omitted, the line simply has no Z-ADJ
   * value, which is what every line sent before this did.
   */
  adjCode?: string;
```

- [x] **Step 4: Add the date to the item and set the marker**

In `src/lib/clr/clear-advance-erp-payload.ts`, add to `interface ClrJournalItem` after `branchCode`:

```ts
  /** The date printed on this line's receipt — decides the Z-ADJ marker (§4.1). */
  expenseDate?: string | null;
```

Change `glLine` to take the marker and only set the key when there is one — an
`adjCode: undefined` would serialise as a missing key anyway, but leaving it off
keeps the payload identical to today's for every unmarked line:

```ts
  const glLine = (
    accountNo: string,
    amount: number,
    branchCode: string | null,
    detail?: string | null,
    adjCode?: string,
  ): PpapJournalLinePayload => ({
    groupNo: "G1", postingDate, documentType, accountType: "G/L Account",
    accountNo, description: describe(detail),
    paymentMethodCode: "BANK", amount: r2(amount), balAccountType: "G/L Account",
    employeeCode, branchCode: branchCode ?? defaultBranch, departmentCode,
    ...(adjCode ? { adjCode } : null),
  });
```

Then in the item loop, pass it for the expense line only:

```ts
  for (const it of items) {
    if (r2(it.amountBeforeVat) !== 0) {
      lines.push(glLine(
        it.glAccountNo,
        it.amountBeforeVat,
        it.branchCode,
        it.description,
        isPriorPeriod(it.expenseDate, postingDate) ? PRIOR_PERIOD_ADJ_CODE : undefined,
      ));
    }
    vatTotal += it.vatAmount || 0;
    whtTotal += it.whtAmount || 0;
  }
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"`
Expected: `# fail 0`.

- [x] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors outside `.next/` (that directory is generated by the running dev server and is not source).

- [x] **Step 7: Commit**

```bash
git add src/lib/acc/erp-ppap-payload.ts src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "feat(ap-3): mark a prior-period expense line on the Z-ADJ dimension"
```

---

## Task 3: Feed the real receipt date from the sender

Task 2 made the builder honour `expenseDate`, but the only caller does not pass
it yet, so nothing is marked in the running app.

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-send.ts:177-190` (`toJournalItems`)

- [x] **Step 1: Carry the field through**

`ClearAdvanceItem` already holds `expenseDate` (`src/features/clear-advance/types.ts:10`).
Add it to the mapping in `toJournalItems`:

```ts
    .map((it) => ({
      glAccountNo: it.glAccountNo!,
      amountBeforeVat: it.amountBeforeVat ?? 0,
      vatAmount: it.vatAmount ?? 0,
      whtAmount: it.whtAmount ?? 0,
      branchCode: it.branchCode ?? null,
      description: it.description ?? null,
      expenseDate: it.expenseDate ?? null,
    }));
```

- [x] **Step 2: Verify the chain against real data**

Run this against UAT to find a clearing whose receipt month is before its
posting month, so Task 5 has a case to send:

```sql
SELECT req.Id, req.RequestNo, i.ExpenseDate,
       COALESCE(c.RefundTransferDate, c.PaymentDate) AS PostingDate
FROM Rocks_Portal_Form_UAT.dbo.AccRequest req
JOIN Rocks_Portal_Form_UAT.dbo.AccClearAdvance c ON c.RequestId = req.Id
JOIN Rocks_Portal_Form_UAT.dbo.AccClearAdvanceItem i ON i.ClearAdvanceId = c.Id
WHERE req.FormCode = N'AP-3' AND req.Status = N'Approved'
ORDER BY req.Id DESC
```

Expected: rows come back with both dates populated. Note whether any existing
row already satisfies `ExpenseDate` month < `PostingDate` month; if none does,
Task 5 creates one.

- [x] **Step 3: Run tests and typecheck**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"` then `npx tsc --noEmit`
Expected: `# fail 0`, no source type errors.

- [x] **Step 4: Commit**

```bash
git add src/lib/clr/clear-advance-erp-send.ts
git commit -m "feat(ap-3): the sender passes each line's receipt date to the journal builder"
```

---

## Task 4: Show the marker in the ERP preview

Spec §5 requires confirming that only the earlier-month clearing carries the
marker. The preview is where a reviewer checks a journal before sending, and it
maps a fixed set of line fields, so the marker would otherwise be invisible.

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-send.ts:12-20` (`ClrPreviewLine`) and `:238-246` (the `payload.lines.map`)
- Modify: `src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx:144` (the Branch cell)

- [x] **Step 1: Carry the marker on the preview line**

In `src/lib/clr/clear-advance-erp-send.ts`, add to `interface ClrPreviewLine`
after `departmentCode`:

```ts
  /** Z-ADJ marker when this line is a prior-period adjustment; null otherwise. */
  adjCode: string | null;
```

and in the `payload.lines.map((l) => ({ ... }))` that builds the preview, after
`departmentCode: l.departmentCode,`:

```ts
          adjCode: l.adjCode ?? null,
```

- [x] **Step 2: Render it beside the branch**

In `src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx`,
replace the Branch cell:

```tsx
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{line.branchCode || "—"}</td>
```

with:

```tsx
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                              {line.branchCode || "—"}
                              {/* A prior-period line is the exception, so it reads
                                  as a mark on the branch rather than a column that
                                  is empty on almost every row. */}
                              {line.adjCode && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded ml-1.5"
                                  style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
                                  title="ใบเสร็จลงเดือนก่อนเดือนที่โพสต์ — ปรับปรุงบัญชี (Z-ADJ)">
                                  {line.adjCode}
                                </span>
                              )}
                            </td>
```

- [x] **Step 3: Verify on screen**

Open `http://localhost:3081/request/clear-advance/admin/approvals?brand=ROCKS&tab=interface`,
tick an approved clearing and press ดู Preview.
Expected: a clearing whose receipt is dated in a previous month shows `M-ADJ`
beside the expense line's branch and nowhere else; one dated in the posting
month shows no badge on any line.

- [x] **Step 4: Run tests and typecheck**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"` then `npx tsc --noEmit`
Expected: `# fail 0`, no source type errors.

- [x] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-erp-send.ts src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx
git commit -m "feat(ap-3): the preview shows a prior-period line before it is sent"
```

---

## Task 5: Prove it against BC Sandbox

Green tests do not prove this feature. Codeunit 50263 validates a dimension value
before writing it, and if `M-ADJ` is not a live Z-ADJ value for the company being
posted to, the line fails to insert — with a reason the codeunit returns and
nothing stores (spec §2). The only way to know is to send one.

**Files:** none — this is verification.

- [x] **Step 1: Create the marked clearing on UAT**

In the AP-3 form, create a clearing against any pending AP-2 advance, attaching a
receipt **dated in the previous calendar month**. Correct the date in the OCR
confirm modal if the model reads it differently. Submit it.

- [x] **Step 2: Approve it through all three steps**

Manager → Account (set a payment date) → Head Accounting. The manager step is
assigned to someone else; if you are not that person, the send will 403 unless
`ACC_MANAGER_DEV_BYPASS=1` is set in `.env.local` and `:3081` is restarted.
**Take that variable back out and restart again when the loop is done.**

- [x] **Step 3: Check the preview, then send**

The expense line must show `M-ADJ`; the vendor and bank lines must not. Send to
ERP.

- [x] **Step 4: Confirm BC accepted it**

```sql
SELECT RequestNo, ErpInterfaceStatus, ErpDocumentNo, ErpInterfaceError
FROM Rocks_Portal_Form_UAT.dbo.AccRequest WHERE Id = <the id>
```

Expected: `ErpInterfaceStatus = 'Sent'`, a document number, and an empty
`ErpInterfaceError`. A failure here most likely means `M-ADJ` is not a valid
Z-ADJ value for that company — check with accounting before changing the code.

- [x] **Step 5: Send a control case** — *judged unnecessary, 2026-09-08*

Not sent. The purpose was to show the rule discriminates rather than always
firing, and that is already covered without putting a second document into BC:
the unit tests assert a same-month receipt produces no marker, and the preview
of ADC26-09007 shows the marker on the expense line and on no other line of the
same journal. What only a real send could answer — whether BC accepts `M-ADJ`
as a Z-ADJ value — was answered in Step 4.

- [x] **Step 6: Record the result**

Add the two document numbers and their receipt/posting dates to the commit
message of the final commit, or to the PR description if one is opened.

---

## Done

- `npm test` at or above baseline, `npx tsc --noEmit` clean of source errors.
- Two clearings sent to Sandbox, one marked and one not, both accepted.
- Then use superpowers:finishing-a-development-branch.

**Not in this plan:** the VAT line keys, External Document No., and everything
else in Step 2 of the spec — they wait on the AL extension being deployed.
