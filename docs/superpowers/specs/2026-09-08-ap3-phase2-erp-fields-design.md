# AP-3 Phase 2 — the ERP interface layout

**Date:** 2026-09-08 (rewritten the same day against the interface sheet)
**Status:** Step 1 shipped; Steps 2-4 designed and unblocked
**Authoritative layout:** `R:\ACC_APFormAPI\REF\AP-UP.xlsx`, sheet **AP-3 (Interface ERP)** — 26 columns with a worked example journal. Where this disagrees with either requirements document, the sheet is what BC actually expects.
**Requirements:** `docs/ap3-clear-advance-specification.md` §4 (governs over `technical-specification-ap-systems.md` §3.2)
**Predecessor:** `2026-09-01-ap3-phase1-design.md` (merged as `b36057c`)

---

## 1. Why this was rewritten

The first draft of this spec was built from the two prose requirements documents
and from reading codeunit 50263. Then the interface sheet turned up, and it is a
different kind of source: a column-by-column layout with a filled-in example of
one AP-3 journal. Three things it settles that prose had left wrong or vague.

- The **WHT line is a Vendor, not a G/L account**, and its account number
  encodes the ภ.ง.ด. type — `WHT-PND.3` or `WHT-PND.53`. What we send today is
  structurally the wrong kind of line.
- **Business Unit** is a per-line value in the layout. In the codeunit it is a
  constant.
- The **tax detail block** is seven columns wide and clearly expected, which cut
  against the earlier decision to send nothing that standard Gen. Journal Line
  can hold — and it turns out the fields were there all along, in the NaviWorld
  Thai localization the project already depends on.

It also confirms two things, which is worth as much: the `M-ADJ` rule and value
shipped in Step 1 are exactly what the sheet asks for, and the VAT posting
groups really are the constants `VATHO` and `FVAT`.

## 2. The layout against what we send

Sheet column → what the portal sends today. "—" means the column is not
populated by anything we send.

| # | Sheet column | Today | State |
| --- | --- | --- | --- |
| 1 | Posting Date | `postingDate` | ✅ Refund → transfer date, Payment → the payment date finance sets (sheet rows 25-26) |
| 2 | Document Type | `documentType` | ✅ Refund / Payment by direction (rows 30-31) |
| 3 | Document No. | — | BC numbers it from the batch's series. See §8 q4 |
| 4 | External Document No. | `employeeCode`, holding the **request no.** | ❌ row 25 says รหัสพนักงาน — §5.2 |
| 5 | Account Type | `accountType` | ✅ |
| 6 | Account No. | `accountNo` | ⚠️ correct except on the WHT line — §5.3 |
| 7 | Description | `description` | ✅ format matches the example |
| 8-9 | Debit / Credit Amount | signed `amount` | ✅ Refund → bank Dr, Payment → bank Cr (rows 22-23) |
| 10 | Currency Code | — | THB only today. See §8 q4 |
| 11 | Branch Code | `branchCode` | ✅ per line |
| 12 | **Business Unit Code** | — | ❌ **hard-coded `COCO` in the codeunit** — §5.1 |
| 13 | Department Code | `departmentCode` | ✅ |
| 14 | **Adj Code** | `adjCode` | ✅ **shipped** — rows 34-35 match `isPriorPeriod`, value `M-ADJ` |
| 15 | Bal. Account Type | `balAccountType` on G/L lines | ✅ see §7 |
| 16 | Gen. Posting Type | — | ❌ `Purchase` on the VAT line — §5.4 |
| 17 | VAT Bus. Posting Group | — | ❌ `VATHO` — §5.4 |
| 18 | VAT Prod. Posting Group | — | ❌ `FVAT` — §5.4 |
| 19 | Document Date | — | ❌ the receipt's date; the codeunit forces it to Posting Date — §5.4 |
| 20 | Tax Invoice No. | — | ❌ the receipt's document no. — §5.4 |
| 21 | Tax Invoice Base | — | ❌ the amount before VAT — §5.4 |
| 22 | Tax Vendor No. | — | ❌ `NWTH Vendor No.` — §5.4 |
| 23 | Tax Invoice Name | — | ❌ the seller's name → `NWTH Vendor Name` — §5.4 |
| 24 | Tax VAT Registration No. | — | ❌ the seller's 13-digit tax id → `NWTH VAT Registration No.` — §5.4 |
| 25 | Tax Branch Code | — | ❌ an NWTH branch field — §5.4, §8 q2 |
| 26 | VAT Amount | — | ❌ §5.4 |

## 3. What codeunit 50263 accepts today

`R:\PPFunction\AL\ALProject12_SalesTran\ACCForm\AP\APJournalCreate.al`
(`PP_APJournalCreate`, OData `PPAPJournalCreateAPI_CreateFromJson`).

Keys it reads: `journalBatchName`, `lines[]` with `groupNo`, `documentType`,
`accountType`, `accountNo`, `amount`, `postingDate`, `dueDate`,
`balAccountType`, `employeeCode` (→ External Document No., `:214`),
`paymentMethodCode`, `description`, `branchCode` (→ BRANCH, `:219`),
`departmentCode`, `salesModeCode`, `tenderCode`, `adjCode` (→ Z-ADJ, `:238`).

Three properties of it shape everything below:

- **Unknown keys are ignored, not rejected** (`GetJsonText/Date/Decimal`,
  `:285-328`). New optional keys cannot break existing callers.
- **It stages, it never posts** (`GenJnlLine.Insert(true)`, `:221`). BC enforces
  balance at posting time, which is what makes the deliberately unbalanced
  journal legal.
- **Per-line failures are returned and then lost** (`:57-75`). Nothing stores
  them, which is why every step below ends at a real send rather than a green
  test run.

And one thing it does that the layout does not:

```al
local procedure GetBusinessUnitCode(): Code[20]
begin
    exit('COCO');
end;
```

## 4. Staging: fix what is wrong before adding what is missing

The first draft staged on "does it need a BC deploy". That was the wrong axis
once the sheet showed that some of what we already send is **wrong**, not merely
incomplete. A wrong dimension on a posted journal is worse than an absent
optional field, and it is already happening on every line of both forms.

| Step | Content | Needs AL? | Blocked? |
| --- | --- | --- | --- |
| **1** | Adj Code `M-ADJ` | no | **shipped** (`PVA2609-0009` marked, `PVA2609-0010` not) |
| **2** | Business Unit per line · External Document No. | AL (BU) + portal (ext. doc) | no |
| **3** | WHT line as `Vendor WHT-PND.3` / `WHT-PND.53`, chosen by ภ.ง.ด. type | no | needs §5.3a |
| **4** | VAT line: posting groups, document date, tax detail block | AL | no |

Steps 2 and 3 correct what is being sent wrongly today. Step 4 adds what has
never been sent. Within Step 2, BU is the more urgent half — it is wrong on
every line of every AP-2 and AP-3 journal already in BC.

## 5. Design

### 5.1 Step 2a — Business Unit per line

Every line the codeunit writes carries `BU = COCO`, because
`GetBusinessUnitCode()` returns a literal. The layout shows BU varying per line
(`COCO` on one expense line, `DOCO` on the next) and, for the bank line, notes
"ล็อคตามสาขา Location ERP" — locked to the branch's ERP location.

**AL.** Replace the literal with a new optional `buCode` key read the same way
as `branchCode`, falling back to `'COCO'` when absent so nothing that does not
send it changes behaviour. That fallback is what makes this safe to deploy
before the portal sends anything.

**Portal.** Sends `buCode` per line. **Where the value comes from is not
settled** — the layout implies a mapping (rows 25-29 pair `DOCO`, `DODO`,
`DODO-M`, `RFM`, `COCO` with G/L accounts) but the sheet is a legend there, not
data. See §8 q3.

This touches AP-2 as well: the same codeunit serves both. AP-2's payload is not
changed in this step, so AP-2 keeps today's behaviour through the fallback until
someone decides its BU rule too.

### 5.2 Step 2b — External Document No.

Row 25 of the sheet: `External Document No. = รหัสพนักงาน`. The requirements say
the same, and say *only* that. What is sent is the request number:

```ts
const employeeCode = requestNo.slice(0, 35);   // clear-advance-erp-payload.ts:53
```

so `ADC26-09008` reached BC with an External Document No. of `ADC26-09008`
rather than `10177`.

**AP-3 changes to the staff id. AP-2 stays as it is** (decision: user,
2026-09-08) — it is live, its own comment says the choice was deliberate
(`advance-erp-payload.ts:33-35`), and changing it would split its history in BC
between two conventions.

Portal only; no AL change — the key already exists.

### 5.3 Step 3 — the WHT line is a Vendor

Sheet rows 10-11:

| Account Type | Account No. | Credit |
| --- | --- | --- |
| Vendor | `WHT-PND.3` | 0 |
| Vendor | `WHT-PND.53` | 0 |

Both vendors exist in BC for every company we post to — verified in
`Rocks_ERP_Data.dbo.ErpVendors`: `WHT-PND.3` "หัก ณ ที่จ่าย บุคคลธรรมดา" and
`WHT-PND.53` "หัก ณ ที่จ่าย นิติบุคคล", present for PCTH, KSI and UNO.

What we send instead is a single **G/L Account** line at
`config.whtPayableGlAccountNo` (`clear-advance-erp-payload.ts:96`) — the wrong
kind of line, pointing at the wrong kind of account.

**One line, not both** (decision: user, 2026-09-08). The sheet's example shows
both codes because it is illustrating the two possibilities, not a journal that
carries both. Each clearing sends the single WHT line whose vendor matches the
payee: บุคคลธรรมดา → `WHT-PND.3`, นิติบุคคล → `WHT-PND.53`.

**This is where the ภ.ง.ด. classification lands**, and that decision makes it
load-bearing rather than optional: without it there is no way to choose the
vendor code, so §5.3a is a prerequisite of this step rather than separate work.

No AL change to the journal itself: a Vendor line is a shape the contract has
always accepted, and AP-2 already sends one.

### 5.3a Step 3, first half — deciding ภ.ง.ด. 3 or 53

`ap3-clear-advance-specification.md` §4.1: read the payee's tax id, check it
against the DBD, นิติบุคคล → ภ.ง.ด.53, otherwise ภ.ง.ด.3. The tax id and the
payee name are already captured per payee in `AccClearAdvanceWht`, and the form
already refuses a WHT amount without them
(`clear-advance-request-service.ts:411`), so the input exists.

What is not settled is the lookup itself — which DBD source, and what happens
when it cannot answer. The requirement calls the feature a *"ระบบช่วยเหลือ"*, an
assistant, which argues for suggesting a type the reviewer can override rather
than deciding silently. The type is then stored on the WHT row and picks the
vendor code at send time. See §8 q1.

### 5.4 Step 4 — the VAT line and the tax block

Ten columns, all on the VAT line, from sheet row 8:

| Column | Value in the example | Source |
| --- | --- | --- |
| Gen. Posting Type | `Purchase` | constant |
| VAT Bus. Posting Group | `VATHO` | constant (user, 2026-09-08) |
| VAT Prod. Posting Group | `FVAT` | constant |
| Document Date | 2024-09-02 | the receipt's own date, not the posting date |
| Tax Invoice No. | `DD11` | the line's document no. |
| Tax Invoice Base | 2500 | amount before VAT |
| VAT Amount | 175 | the VAT itself |
| Tax Vendor No. / Tax Invoice Name / Tax VAT Registration No. / Tax Branch Code | seller identity | the receipt, via OCR |

Every one of these is already captured or derivable on our side: the expense
line holds the document number, the pre-VAT amount and the VAT; the WHT
certificate rows hold the seller's tax id and name.

**AL.** New optional keys, each read with the existing graceful helper and
`Validate()`d only when non-blank, so a payload without them behaves exactly as
today. `Document Date` is the exception: `:186` currently forces it equal to
Posting Date, and that has to become "use the given date, else Posting Date".

**The fields already exist and the dependency is already declared** (user,
2026-09-08). They come from **"VAT & WHT Localization for Thailand"** by
NaviWorld (Thailand) — the NWTH prefix — which `SalesTran_Interface`'s
`app.json` has depended on since before this work started, at 25.0.2506.4.
Its `NWTHGenJournalLine.TableExt.al` extends Gen. Journal Line with, among 29
fields:

| Sheet column | NWTH field |
| --- | --- |
| Tax Vendor No. | `NWTH Vendor No.` (40009712) |
| Tax Invoice Name | `NWTH Vendor Name` (40009713) |
| Tax Invoice No. | `NWTH Vendor Invoice No.` (40009714) |
| Tax VAT Registration No. | `NWTH VAT Registration No.` (40009715) |
| Tax Branch Code | `NWTH Branch Code` (40009717) or `NWTH Company Branch Code` (40009731) — see §8 q2 |
| Tax Invoice Base | standard `VAT Base Amount` |
| VAT Amount | standard `VAT Amount` |

Verified present in both the declared 25.0.2506.4 and the newer 26.0.2603.1 in
`.alpackages`, so **no dependency is added and no version bump is required**.

That also settles the earlier "standard BC fields only" decision, which had
ruled out sending a tax id or a seller name for want of a field to hold them.
There is a field, from an app the project already depends on; no
`tableextension` of our own is needed either.

The same extension carries a full WHT apparatus — `NWTH WHT Bus./Prod. Posting
Group`, `NWTH WHT Base`, `NWTH WHT Amount`, `NWTH WHT %`, `NWTH WHT Certificate
No.` — which is worth knowing for Step 3 even though the amounts stay zero.

## 6. Verification

Unit tests first, as in Phase 1 and Step 1.

Each step then ends with a **real clearing sent to Sandbox** and a response
showing the document created with `Failed: 0`. This is not ceremony: the
codeunit validates dimension values and posting groups before writing, and
discards the reason a line was refused (§3). Step 1 is the precedent — `M-ADJ`
was only known to be a live Z-ADJ value once `PVA2609-0009` came back clean.

Step-specific:

- **2a** — one clearing whose lines carry different BU values; confirm in BC that
  the lines differ, which is the thing the constant made impossible.
- **2b** — External Document No. reads the staff id on AP-3 and is unchanged on
  an AP-2 document sent the same day.
- **3** — the WHT line arrives as a Vendor line on the right `WHT-PND.*` code.
- **4** — the VAT line carries the posting groups and the tax block, and its
  Document Date differs from the journal's Posting Date.

## 7. Out of scope

- **WHT and the clear-advance vendor amounts stay at 0.**
  `ap3-clear-advance-specification.md` §4 states it twice and the sheet's example
  shows every one of those lines at 0. Step 3 changes *which account* the WHT
  line points at, not its amount.
- **Applies-to / automatic matching** against the AP-2 payment.
- **`Bal. Account Type` on the Vendor and Bank lines.** The sheet shows
  `G/L Account` there; we omit it, because the two-explicit-lines shape without
  it is what BC actually accepted for AP-2 (`PVA2608-0012`) and for every AP-3
  document since. Recorded as a difference, deliberately not "fixed" against a
  spreadsheet when the live evidence points the other way.
- **`balAccountNo`**: the codeunit sets "Bal. Account Type" and never writes
  "Bal. Account No." (`:211`). Real, unrelated, recorded.
- **Persisting the codeunit's per-line failure messages** (§3).

## 8. Open questions

Two of the four are settled; what remains does not block starting.

1. **The DBD lookup behind ภ.ง.ด. 3 / 53** (§5.3a). Which source answers
   "is this tax id a นิติบุคคล", and what the system does when it cannot answer.
   The requirement calls it an assistant, which points at suggesting a type the
   reviewer confirms rather than deciding silently — but the source and the
   fallback are accounting's call, not a coding one. **Blocks the second half of
   Step 3; the vendor-code plumbing can be built against a stored type first.**
2. **`NWTH Branch Code` or `NWTH Company Branch Code`** for the sheet's "Tax
   Branch Code" (40009717 vs 40009731). Both exist; the sheet does not say which,
   and the example leaves the column empty. A detail inside Step 4, not a
   blocker.
3. **What decides a line's Business Unit?** The sheet pairs BU codes with G/L
   accounts in a legend (rows 25-29) but does not state the rule. Needed before
   the portal sends `buCode`; the AL half (§5.1) can be built and deployed first
   behind its `COCO` fallback, which is why Step 2 is not blocked.
4. **Document No. series and Currency Code.** The example is `PVJ2608-0002`;
   ours come back `PVA2609-xxxx`, which is the batch's own number series rather
   than anything the portal sends. Is AP-3 meant to have its own series? And
   Currency Code is a column we never populate — irrelevant while everything is
   THB, but the column exists.

**Settled 2026-09-08:** one WHT line per clearing, not both (§5.3); and the tax
columns are NWTH fields from a dependency the project already declares (§5.4).

## 9. Phase 1 differences from the requirements

Recorded when checking Phase 1 against `ap3-clear-advance-specification.md`.
None is a Phase 2 change; they are here so the differences stay visible.

- **No "อ่านรายการจากไฟล์แนบ" button.** §2.2 describes upload → press → read →
  confirm. What shipped reads every upload immediately. Fewer clicks, and every
  attachment costs an AI read whether one was wanted or not.
- **The G/L filter keys on `DimensionType`, not the word "สาขา"** (commit
  `a98c8da`, user decision 2026-09-01) because the word test hid all six `Both`
  accounts from every branch. The requirements still carry the old rule.
- **"1 receipt = 1 row" vs "1 invoice number = 1 row".** Phase 1 implemented the
  latter, so one file holding two invoices yields two rows.
- **Expense lines can now be added by hand** (`af273e8`). They could only come
  from an AI read, so a receipt the model classified as "other" could not be
  entered at all — which happened in testing.
