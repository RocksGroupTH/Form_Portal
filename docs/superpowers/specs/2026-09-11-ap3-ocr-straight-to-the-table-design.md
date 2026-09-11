# AP-3 — the receipt read lands in the table, and says what it was unsure about

Date: 2026-09-11
Status: approved, ready for implementation
CR items: 2 (no confirm screen) and 3 (warn when files and rows disagree)

## Why

After the AI reads uploaded receipts, a confirm modal opens and the requester
ticks rows before they become expense lines. The CR asks for the rows to go
straight into `รายการค่าใช้จ่ายจริง`, where they can be edited like any other.

The modal is not a display screen — it owns network calls, two enforcement
points and every uncertainty signal the read produces. So the question was not
whether to delete a file but where each of those things goes. Most of them
already have a home; the rest is what this spec is about.

## What already covers itself

Work merged on 2026-09-10 moved the account officer's job onto their own grid,
and that is where most of the modal's checking belongs anyway.

| The modal did | Now |
|---|---|
| Revenue Department check on the seller's tax id | `RdCell` on the account grid, per row, with the comparison popover and `ตรวจใหม่` |
| Offer the registered name in place of the read one | the same popover's `ใช้ข้อมูลจากสรรพากร` |
| Normalise the tax id, warn on a bad one | the account grid's `เลขผู้เสียภาษี` cell |
| Refuse to save a receipt row with no branch | no branch ⇒ no G/L can be picked ⇒ `linesMissingGl` refuses the approval |
| Clear a stale G/L when the branch changes | `updateLine` on the requester's form does it unconditionally |
| Drop a junk row | deleting the receipt already removes the line it filled (`ClearAdvanceForm.tsx:1093-1099`) |
| Delete the uploaded files when the read is rejected | there is no rejected-read state any more: rows land with their file and go with it |

The seller's tax id, name, address and branch are not columns on the
requester's table and are not being added (decision: B1, user, 2026-09-11).
They ride to the account step, which has all four as editable columns and the
registry check beside them. The requester attaches the evidence; accounting
reads it.

## What this change has to carry

Three signals exist only inside the modal today and would otherwise go silent.
They become one dialog, shown after the read, that the requester acknowledges
before editing.

| Signal | Why it cannot be dropped |
|---|---|
| files in vs rows out, and pages classified as neither receipt nor slip | the CR's own item 3. A receipt that read as nothing leaves the clearing short and nobody is told |
| `dateText` — the date as the model copied it | a slip printed `08 ก.ย. 2026` came back as `08 ก.ค. 2026`; the characters themselves misread. Nothing downstream can catch it — date validation is "not empty", and this becomes the G/L posting date |
| `branchClose` — the model saw a near-tie | the branch it picked is real and correctly formatted, just possibly the wrong one of CKK / CKK2 / CKC. It decides the BU and the BRANCH dimension, and no gate can tell a wrong branch from a right one |

## The dialog

Opens once, after the read, only when there is something to say. It reports and
is acknowledged — it does not gate anything, and nothing is lost by dismissing
it, because every row it mentions is already in the table and editable.

```
อ่านใบเสร็จแล้ว — มีบางอย่างที่ควรตรวจ

  อ่านได้ 3 รายการ จาก 5 ไฟล์ที่แนบ
  ข้าม 1 หน้า (ไม่ใช่ใบเสร็จหรือสลิป)

  รายการที่ 2 — วันที่บนเอกสารอ่านว่า "08 ก.ค. 2026" แต่ระบบบันทึกเป็น 08/09/2026
  รายการที่ 3 — สาขาที่เลือกอาจไม่ใช่สาขานี้ มีสาขาชื่อคล้ายกัน

                                               [ตรวจแล้ว]
```

When the read is clean — every file produced a row, no pages skipped, no date
doubt, no near-tie — nothing opens and the rows simply appear. That is the
case the CR is really about.

## The G/L suggestion keeps running

The modal was the only caller of `/api/request/clear-advance/suggest-gl`, and
the decision from 2026-09-10 was explicit: the AI still guesses the account so
the officer arrives at a filled grid and only confirms it. So the suggestion
moves into the read path rather than dying with the modal — asked before the
rows are written, alongside the branch resolution that already happens there,
so a row reaches the table complete.

The requester never sees it. They have no G/L column; that was the point of
moving the account to accounting.

## Changes

| # | File | Change |
|---|---|---|
| 1 | `ai-receipt-core.ts` | Expose `thaiPrintedDate`'s disagreement — a row whose `dateText` parses to a different day than the date kept |
| 2 | `src/lib/clr/ocr-read-notes.ts` | **New, pure.** From the read plus the file count, the list of things worth saying. The dialog renders it; it decides nothing else |
| 3 | `ClearAdvanceForm.tsx` | `verifyReceipts` resolves branch **and** G/L, writes the rows, then opens the dialog if there are notes. `acceptOcrRows` keeps the merge logic, loses the include filter |
| 4 | `OcrReadNotesDialog.tsx` | **New.** Renders the notes. Acknowledge only |
| 5 | `OcrConfirmModal.tsx` | **Deleted** |

## Unchanged

The merge into lines (`acceptOcrRows`) — blank-line reuse, `taxBranchCode`
conversion, the slip filling the refund fields with its own mismatch warning,
WHT rows prefilled with `suggestPndType`. `verify-receipt`'s parsing, the
Buddhist-year conversion, `mergeDocs`, the escalation to a stronger model. The
account step's four approval gates. `/vat-registrant`, which the account grid
still calls.

## Accepted trade-offs

**A page classified as the wrong kind cannot be re-labelled.** An unlabelled
entry defaults to `receipt`, and the kind decides whether a page becomes an
expense line or fills the refund transfer. The remedy is to delete the receipt,
which removes the line with it. The dialog does not try to detect this.

**Two rows that are really one receipt cannot be merged by hand.** `mergeDocs`
already merges on `kind|docNo|payeeName`; a one-character misread in the
document number defeats it, and the modal was where a human fixed that. Now the
requester deletes one row's file and corrects the other.

## Tests

| Test | Where |
|---|---|
| `ocrReadNotes` — fewer rows than files, skipped pages, a date disagreement, a near-tie branch, several at once, and a clean read producing nothing | `ocr-read-notes.test.ts` |
| The date comparison — same day reported as clean, a different day reported, an unparseable `dateText` ignored rather than guessed | same |
| The dialog and the read path | not covered — React; the browser pass covers them |
