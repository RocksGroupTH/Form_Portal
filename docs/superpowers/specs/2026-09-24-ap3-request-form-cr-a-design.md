# AP-3's request form: the CR's three form changes — Design

Date: 2026-09-24
Status: design approved (user, 2026-09-24)
Scope: **Form Portal only** — one file, `src/features/clear-advance/components/ClearAdvanceForm.tsx`

## Purpose

Three items from the user's CR of 2026-09-23, all of them on the screen the requester
fills in. They are grouped because they touch one file, change no data, reach no database
and post nothing to Business Central — the cheapest and least dangerous third of the CR.

| CR item | Asked for |
| --- | --- |
| 3 | เอา PND.53/PND.3 ออกจากหน้า User ของฟอร์ม AP-3 |
| 4 | ตาราง Detail ขอปุ่มขยายอันใหญ่ |
| 5 | เปลี่ยนชื่อปุ่มของ AP-3 แนบไฟล์อ่านด้วย AI และ ถ่ายรูปอ่านด้วย AI และเพิ่มปุ่ม แนบไฟล์ กับ ถ่ายรูป ปกติโดยไม่ผ่านการประมวลจาก AI |

## Decisions taken

| # | Decision | Who, when |
| --- | --- | --- |
| 1 | **Form Portal only.** The other CR items ship to both consoles, but ACC Portal has no AP-3 requester form at all — its routes are approvals, report and settings. There is nothing there to change. | this design, from the user's "ทำทั้งสองแอปให้เหมือนกัน" plus the fact on disk |
| 2 | Item 4 means the **"รายการค่าใช้จ่ายจริง" card on the request form**, not the Detail report. | user, 2026-09-24 |
| 3 | Item 4 is built **exactly like AP-4's**, not as a full-screen overlay. | user, 2026-09-24 |
| 4 | Item 5's plain buttons go on the **receipt section only**. The refund-slip section keeps its two buttons and its AI read. | user, 2026-09-24 |
| 5 | All four receipt buttons sit **in one row**, wrapping on a narrow screen. | user, 2026-09-24 |

An overlay was proposed first and rejected: the user named AP-4 as the reference, and AP-4
widens the card rather than covering the page.

## 1 · The ภ.ง.ด. selector leaves the requester's screen

`ClearAdvanceForm.tsx` renders the selector **twice** — `:1979` in the wide table and
`:2070` in the narrow-screen card. Both go.

**No data path changes.** The value is still produced and still stored:

- `suggestPndType(taxId)` fills it in the browser when a tax id is typed (`:527`) and when
  a receipt is read (`:1283`);
- `clear-advance-request-service.ts:624` decides it again server-side on save, from the row's
  own prior value and then the tax id.

**Accounting keeps its control** — `ClearAdvanceDetail.tsx:997` in this app and
`ClrAccountWorkspace.tsx:763` in ACC Portal. Removing the requester's copy strands nobody.

**Why the data path must not be touched while doing this.** The ERP payload refuses to send
a clearing whose WHT rows have no decided ภ.ง.ด. type. The automatic fill is what keeps a
claim from reaching that refusal, so the selector can go but the suggestion cannot.

The read-only row that prints the stored type on a submitted claim stays: a requester
looking at their own claim should still see what was filed.

## 2 · The expense card expands to the viewport's width

Ported from `src/features/reimburse/components/ReimburseForm.tsx` — AP-4 already solved
this for a card of the same name.

| AP-4's part | What it does |
| --- | --- |
| `const WIDE_INSET = 12` (`:118`) | the gap left at each edge in wide mode |
| `const [itemsWide, setItemsWide] = useState(false)` (`:256`) | the whole state |
| `viewportWidth` + its effect (`:264-274`) | measured **only while wide**, so a narrow-mode render costs nothing |
| the wrapper style (`:1378-1382`) | `width: viewportWidth - WIDE_INSET*2` and `marginLeft: calc(50% - …)` — the card breaks out of the page column and centres on the viewport |
| the button (`:1396-1415`) | `Maximize2` → **ขยายเต็มความกว้าง**, `Minimize2` → **ย่อกลับ** |

Two of AP-4's judgements come across with it:

- **The control belongs in the card's own header**, beside the card's name, because it is
  that card which expands. AP-4 says so in a comment; AP-3 gets the same placement.
- **It is hidden until there is at least one row.** AP-4's comment: *an empty table full
  screen is a blank page.*

**The one structural difference.** AP-4 hangs the button on `SectionCard`'s `extra` slot.
AP-3's form does not use `SectionCard` at all — its card is a plain
`<div className="rounded-2xl p-4 sm:p-5 …">` at `:1573` whose header is already a
`flex items-center justify-between` holding the label and a ตรวจสรรพากร button (`:1576`).
The new control joins that existing row. No restructuring.

"หุบ" in the CR is AP-4's **ย่อกลับ**. There is no separate control that hides the table.

## 3 · Four buttons on the receipt section

`FileArea` (`:2291`) is one component used twice:

- `:1556` — receipts, `onPick={(list) => uploadFiles(list, "clear_doc")}`
- `:2116` — the refund slip, `onPick={(list) => uploadFiles(list, "refund_proof")}`

It gains one optional prop, `onPickRaw`. **The receipt call site passes it; the slip call
site does not**, so the slip section keeps exactly the two buttons it has today and the
scoping needs no conditional of its own.

| Button | Calls |
| --- | --- |
| แนบไฟล์อ่านด้วย AI | `onPick` — today's behaviour |
| ถ่ายรูปอ่านด้วย AI | `onPick`, camera capture |
| แนบไฟล์ | `onPickRaw` |
| ถ่ายรูป | `onPickRaw`, camera capture |

All four render in the existing `flex flex-wrap items-center gap-2` row and wrap on a narrow
screen, which the user accepted over hiding two of them behind a menu.

**What "without AI" means, precisely.** `uploadFiles` ends with
`if (ocrDocs.length) void verifyReceipts(ocrDocs);`, where `ocrDocs` collects the uploaded
files that `isOcrable(f)` accepts. The raw path is **the same `uploadFiles` with a third
argument** — an options object whose `read: false` skips collecting `ocrDocs` and therefore
the `verifyReceipts` call. Not a second upload function, and not a filter applied afterwards:
one function, one extra argument, so the two paths cannot drift apart. **The file is still
uploaded, stored and listed exactly as before** — only the read is skipped.

### The consequences worth writing down

Skipping the read is one line, but that one call is the root of a large tree. Everything up to
it is identical on both paths — the 4MB check, the draft auto-create, the POST, the stored
file, the thumbnail in the list, the แนบไฟล์แล้ว toast. What does not happen, enumerated during the
spec review of the implementation rather than guessed at here:

| Skipped | What the requester or accounting sees |
| --- | --- |
| `acceptOcrRows` | **No expense row.** The requester adds one with เพิ่มแถว and types it. |
| `/suggest-gl` | **No G/L account** on that row — see below. |
| `suggestBranch` | No `branchCode`, which is also why the G/L could not be suggested even if the read had run. |
| `/vat-registrant` and the `vendorByTin` fallback | No Revenue-Department check and no payee-name correction. Recoverable: the RD button on the lines grid still works once a 13-digit tax id is typed. |
| the read-notes dialog | No warning about skipped pages, a truncated PDF, or a file that produced nothing. |
| the scanning overlay | Nothing appears; the upload finishes when the POST returns. **This one is the point**, not a loss. |
| kind-based re-routing | Normally the model's `kind`, not the box, decides where values land — a transfer slip dropped in the receipt box fills the refund fields. That cross-routing cannot happen on the raw path. |

And one asymmetry further downstream: `doRemoveFile` deletes the expense line whose
`sourceFileId` matches the file being removed. A raw-attached file tagged no line, so deleting
it removes the file alone and any hand-typed row stays until it is deleted separately.

That is the gap CR item 8 describes, and this change widens the door to it. Item 8 (a
suggest button at the account step) closes it. **These two should ship in the same release,
or accounting gets more empty rows than before with no way to fill them but by hand.**

## Not in scope

- The refund-slip section: unchanged, still two buttons, still read by AI.
- The Detail report, which is where item 4 was first assumed to live.
- ACC Portal.
- Any change to what is stored, sent, or posted.

## Tests

This repo runs `node:test` through `tsx scripts/run-tests.ts`; there is no vitest and no
component-rendering harness, so a React file of this size is not driven directly. What can
be proved honestly:

- **A source scan**, in the style of `src/lib/acc/*-guard.test.ts`, asserting that
  `ClearAdvanceForm.tsx` no longer renders a ภ.ง.ด. selector while
  `clear-advance-request-service.ts` still decides the type, and that `FileArea`'s slip call
  site passes no `onPickRaw`.
- **Pure logic, if any is extracted.** The wide-mode width arithmetic is a candidate:
  `(viewport, inset) => { width, marginLeft }` is a function with no React in it, and AP-4
  currently inlines it. Extracting it makes it testable for both forms.
- The rest is verified by driving the running app: the four buttons appear on receipts and
  two on the slip, a raw attach adds a file and no row, and the card widens and restores.

## What a reader in six months needs to know

The ภ.ง.ด. value did not stop existing when the selector disappeared — it is still filled
from the tax id and still required by the ERP send. If a claim ever reaches the send with no
type decided, look at `suggestPndType` and the server-side decision in
`clear-advance-request-service.ts`, not at this form.

And the raw attach is not a lesser upload: the file lands in exactly the same place. What it
skips is the read, which is also what fills the G/L account — so a claim built entirely from
raw attachments is a claim accounting will have to account for by hand.
