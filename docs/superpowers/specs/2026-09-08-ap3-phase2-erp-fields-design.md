# AP-3 Phase 2 — the ERP interface layout

**Date:** 2026-09-08 (rewritten the same day against the interface sheet)
**Status:** Step 1 shipped; Steps 2-4 designed, two blocking questions open
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
- The **tax detail block** is seven columns wide and clearly expected, which cuts
  against the earlier decision to send nothing that standard Gen. Journal Line
  cannot hold.

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
| 22 | Tax Vendor No. | — | ❌ §5.4, §8 q2 |
| 23 | Tax Invoice Name | — | ❌ the seller's name — §5.4, §8 q2 |
| 24 | Tax VAT Registration No. | — | ❌ the seller's 13-digit tax id — §5.4, §8 q2 |
| 25 | Tax Branch Code | — | ❌ §5.4, §8 q2 |
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
| **3** | WHT line as `Vendor WHT-PND.3` / `WHT-PND.53` | no | **q1** |
| **4** | VAT line: posting groups, document date, tax detail block | AL | **q2** |

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

**This is where the ภ.ง.ด. classification lands.** It was previously scoped as a
separate group with nothing to consume it; the vendor code *is* the consumer —
บุคคลธรรมดา → `WHT-PND.3`, นิติบุคคล → `WHT-PND.53`. Whether the classification
is needed at all depends on q1.

No AL change: a Vendor line with an amount is a shape the contract has always
accepted, and AP-2 already sends one.

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

**Blocked on q2** — whether these are fields on Gen. Journal Line in this BC (the
Thai localization has several of them) or need a `tableextension`. The earlier
"standard BC fields only" decision was taken before this sheet was on the table
and should be revisited against it.

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

1. **One WHT line or two?** The sheet's example journal contains **both**
   `WHT-PND.3` and `WHT-PND.53`, each at 0. Two readings: (a) always send both
   zero lines and let accounting use the right one — which fits the
   zero-amount rule and needs no classification at all; or (b) send one line
   whose vendor code comes from classifying the payee's tax id. Reading (a) is
   what the sheet literally shows. **Blocks Step 3, and decides whether the
   ภ.ง.ด. work exists at all.**
2. **Where do the seven tax columns live in BC?** Fields on Gen. Journal Line in
   the Thai localization, or a `tableextension`? The "standard BC fields only"
   decision (user, 2026-09-08) was taken without this sheet and reads
   differently now that the columns are known to be expected. **Blocks Step 4.**
3. **What decides a line's Business Unit?** The sheet pairs BU codes with G/L
   accounts in a legend (rows 25-29) but does not state the rule. Needed before
   the portal can send `buCode`; the AL half (§5.1) can be built and deployed
   first behind its `COCO` fallback.
4. **Document No. series and Currency Code.** The example is `PVJ2608-0002`;
   ours come back `PVA2609-xxxx`, which is the batch's own number series rather
   than anything the portal sends. Is AP-3 meant to have its own series? And
   Currency Code is a column we never populate — irrelevant while everything is
   THB, but the column exists.

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
