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
| Revenue Department check on the seller's tax id | `RdCell` on the account grid, per row, with the comparison popover and `ตรวจใหม่` — **and, since the addendum below, in the read path too** |
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

> **Reversed the same day** — see the second addendum. Three of the four are
> columns on the requester's table now, with the same registry check and the
> same "use the registered name" button the account grid has.

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

---

## Addendum, 2026-09-11 — the Revenue Department check comes back to the read

The table above sent the RD check to the account grid and left it there, on the
reasoning that accounting is who acts on it. The requester's own page was then
the only place in the flow that does not check, and the user asked for it back
(option A of three: automatic during the read, reported in this dialog; not a
column on the requester's table, which would reverse decision B1).

So the read now asks the register about the seller of every receipt, before the
rows are written, and two more things can be said:

| Note | When |
|---|---|
| `rd-unregistered` | the register holds no VAT registration for the tax id the reader took off the receipt |
| `rd-name` | it holds one, and the registered name is not the name on the row — compared with `sameRegisteredName`, so spacing is not a difference |

Asked once per distinct tax id rather than once per row: six receipts from one
seller are one question, and the register is a SOAP service behind a long
timeout. A failure answers nothing and says nothing — `unknown` is not a
finding, and telling someone who cannot see the field that a check they did not
ask for could not run teaches them to dismiss this dialog. The account
officer's `ตรวจสรรพากร` button asks again on a screen where the number is
visible and editable, which is where an unanswered check belongs.

The requester still has no tax-id column, so the note is the whole of what they
get. That is also why it is worth saying: a name the model invented and a
number that belongs to nobody both reach accounting looking like ordinary data.

---

## Second addendum, 2026-09-11 — the seller is a column on the requester's table

B1 kept the seller off the requester's table and left the finding to the dialog
above. The user then asked for the columns themselves, with the account step's
check and suggestion: `เลขผู้เสียภาษี`, `ชื่อผู้ขาย`, `สาขาผู้ขาย` and the `RD`
cell, editable by the requester.

It is the right way round. The fields were always saved by this form — the
reader filled them and nothing showed them — and the person who can tell a
misread name from a real one is the one holding the receipt. A wrong tax id is
what makes the input VAT unclaimable, and under B1 that was discovered at the
account step, by which time the receipt is a scan and the seller is a memory.

| | |
|---|---|
| Columns | `เลขผู้เสียภาษี` (13-digit, `normalizeTaxIdInput` + `taxIdNotice`), `ชื่อผู้ขาย`, `สาขาผู้ขาย`, and `RdCell` — the same components the account grid uses, not copies |
| Answers | `useRdVatByTin` over the lines on screen. The endpoint answers from our own table once a number has been asked, so the check the read already ran costs nothing to show, and a hand-typed number is checked as soon as it is thirteen digits |
| Suggestion | the cell's popover: invoice against register, `ใช้ข้อมูลจากสรรพากร` writes the registered name and branch onto the line |
| Bulk | `ตรวจสรรพากร (N รายการ)` beside `เพิ่มแถว`, counted by `tinsNeedingRdCheck` — this is what retries the ids the registry dropped |
| Mobile | the three fields in the line card, the chip beside the tax id |

The existing `สาขา *` column is renamed `สาขาที่ใช้จ่าย *`. It is the expense
branch — the BU and the BRANCH dimension — and having two columns called
`สาขา` on one row, one of them the seller's, is how the wrong one gets typed
into.

The tax id is required to submit on a line that claims input VAT (user, same
day): `เลขผู้เสียภาษี *`, and `collectErrors` refuses such a line without one.
A line with no VAT is left alone — a plain `ใบเสร็จรับเงิน` from a small seller
carries no tax id and there is nothing to identify. Same shape as the rule one
table down, where the certificate's payee is required only once WHT has been
withheld, and the header keeps its `*` for the same reason that one does.

Whatever *is* typed must be a whole tax id, VAT or not: thirteen digits or the
submit is refused with the count, because a half-typed number looks filled in
and silently checks against nothing — the state `taxIdNotice` already names on
the row.

The name and the branch stay optional: the register supplies both from the
number, and neither is what the VAT is claimed against.

`ดึงจากรายการ` carries the tax id, the payee name and the address from the
expense line into the WHT certificate row, and suggests the ภ.ง.ด. type from
the number. The certificate's payee is the seller of the invoice the tax was
withheld from, so retyping it was work the form created for itself.

The columns themselves gate nothing else. They are advisory on the requester's
form exactly as they are on the account grid, and the account step's four
approval gates are untouched.

The read-time RD check and its dialog notes stay. They are not the same job:
the dialog is what says "look at this" once, after a read of perhaps a dozen
receipts; the column is where it gets fixed.
