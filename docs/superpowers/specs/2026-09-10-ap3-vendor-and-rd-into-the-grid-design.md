# AP-3 — the vendor and the Revenue Department check move into the account grid

Date: 2026-09-10
Status: approved, ready for planning
Base branch: `feat/ap3-gl-to-account-step` (this work depends on the `รายการ` column that branch adds)

## Why

The account officer's screen is a grid of expense lines with a stack of
`SellerVendorCard`s underneath it — one card per line, holding that line's
Revenue Department answer and its BC vendor. **The only thing tying a card to
its row is the ordinal printed on it.** No highlight, no scroll link, nothing.
The officer reads row 4, scrolls, counts to card 4, and hopes.

Both belong on the row they describe. Moving them there is not a relocation; it
removes the counting.

Two things fall out of the move:

- The Revenue Department is asked once per **card**, deduped by a ref holding a
  single value, so six lines sharing a tax id make six HTTP calls. Lifted to the
  page and keyed by tax id, that becomes one.
- `ClearAdvanceDetail` still declares `vatByTin`, `setVatByTin`, `VatCheck`,
  `VatRegistrant`, `TaxVendorCandidate`, `vendorsByRow` and `vendorNameTerm`
  (lines 125-144, 233, 242, 245) and **reads none of them** — leftovers from the
  design that existed before the cards. Their comments describe what this change
  reinstates; one of them literally says "Checked on demand here rather than on
  open". The page-level state goes back where it used to live.

## Decisions

| | |
|---|---|
| The vendor picker | Into the grid as a column |
| `SellerVendorCard.tsx` | Deleted, all 506 lines — everything in it has a new home |
| RD result | A status chip per row |
| RD automatic check | Stays. The button is for gaps and retries, not a replacement |
| The button's scope | Only tax ids with no answer or a failed check. It never sends `refresh=1` |
| Re-asking one tax id | Stays per row, in the chip's popover |
| Name/branch comparison and "ใช้ข้อมูลจากสรรพากร" | In a popover on the RD chip |
| An unregistered seller | Warns, never blocks — unchanged |

## Components

Three new pieces, following `GlCell` / `GlPicker`, which is this grid's existing
in-cell picker precedent:

- **`useTaxVendors(brandCode)`** — the module-level `vendorListCache` lifted out
  of the card. One fetch of the brand's whole vendor list (the largest company
  is about 1,604 cards, 93KB), shared by every row.
- **`<VendorCell>`** — the in-cell picker. Keeps `vendorMatches` and its
  browser-side matching: the same match in SQL went through `Thai_CI_AS`, where
  a consonant and the mark above it are one collation element, so `'%พิษณุพจน%'`
  did not match "พิษณุพจน์". Keeps the seed-from-invoice-name behaviour and the
  `ตรงเลขภาษี` badge.
- **`<RdCell>`** — the chip and its popover: the invoice-versus-registry
  comparison, `ใช้ข้อมูลจากสรรพากร`, `ตรวจใหม่`, and `ตรวจเมื่อ`.

And **`useRdVatByTin(taxIds)`** — page-level RD state keyed by tax id rather
than by row, deduped with a Set the way `OcrConfirmModal` already does it.
The automatic check keeps its current trigger; it simply stops asking twice.

## The grid

```
# · วันที่ · รายละเอียด · รายการ · เลขที่ใบกำกับ · เลขผู้เสียภาษี · ชื่อผู้ขาย · สาขาผู้ขาย · RD · Vendor · ก่อน VAT · VAT · WHT
```

RD sits directly right of `สาขาผู้ขาย` because it is what judges those two
fields; Vendor follows RD because it is chosen once the answer is known.

`minWidth` goes from 1240 to about 1500. That number is hand-tuned to the sum of
the fixed input widths, so it moves with the columns. The horizontal scan gets
longer; the page gets much shorter, since N cards disappear, and nobody counts
ordinals any more.

## The button

Above the grid, beside `SaveStatus`:

```
[ตรวจสรรพากร (3 รายการ)]        บันทึกอัตโนมัติ · บันทึกแล้ว 19:42
```

The count is **distinct tax ids** with no stored answer or a failed check, not
rows — six lines sharing one id are one thing to ask about. At zero the button
is disabled and says everything has been checked. It never forces a refresh: a
stored answer never expires by design, and the way to get a newer one is
`ตรวจใหม่` on that row's popover.

## Unchanged

`linesMissingTaxVendor` already takes
`Pick<ClearAdvanceItem, "vatAmount" | "taxVendorNo">[]`, so it works from a grid
row with no change, and it keeps guarding both the approve button and the server
at the `ACCOUNT` step. `AccClearAdvanceItem.TaxVendorNo` is already per line
(migration 143). The RD service, its `AccVatRegistrant` cache and the
never-expires rule are untouched, as is the ERP payload builder, which still
emits `taxVendorNo` on the VAT line only.

`accountBlocked` stays exactly three conditions — vendor, ภ.ง.ด., G/L account.
The Revenue Department's answer has never blocked an approval and still does
not.

## Changes that follow

**The blocking banner points at furniture that will not exist.** It currently
reads "เลือกในการ์ด "ผู้ขาย" ด้านล่าง (ค้นด้วยเลขผู้เสียภาษีหรือชื่อผู้ขาย)". With the
cards gone that is an instruction to go and find something deleted. It becomes
"เลือกในตารางด้านบน".

**Three copies of the same two types.** `VatRegistrant` and `VatCheck` are
declared in `ClearAdvanceDetail` (dead), in `SellerVendorCard`, and in
`OcrConfirmModal`, while `rd-vat-core.ts` holds the canonical `RdVatRegistrant`
that none of them import. Deleting the card removes one; the page's revived
state imports the canonical type instead of redeclaring it. That leaves two.
`OcrConfirmModal` is a different screen and is not touched here.

## Accepted trade-off

The row is narrower than a card, so the comparison and the apply button move
behind a click rather than being visible at rest. An officer scanning for
mismatches now reads chips instead of paragraphs. That is the intended trade:
the chip says *whether* there is a problem on the row that has it, and the
popover says what — where the card said everything, always, somewhere else on
the page.

## Tests

| Test | Where |
|---|---|
| `linesMissingTaxVendor` still guards from grid rows | already covered in `tax-vendor-core.test.ts:51-74`; no change expected, re-run |
| `vendorMatches` / `buildVendorNameTerms` unchanged by the move | already covered in `tax-vendor-core.test.ts`; re-run |
| The button's count is distinct tax ids needing a check, not rows — including the six-rows-one-id case, an already-answered id, and a failed one | new pure helper + test |
| `useTaxVendors`, `<VendorCell>`, `<RdCell>` rendering | not covered — React hooks and components, and this repo carries no renderer. Recorded here rather than promised; the browser pass covers them |

## Open questions

None.
