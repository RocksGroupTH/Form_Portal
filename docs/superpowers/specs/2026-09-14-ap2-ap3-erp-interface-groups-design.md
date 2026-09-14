# AP-2 and AP-3 — Interface ERP, grouped by target Company

Design, 2026-09-14. Approved by the user the same day.

Three forms configure where their journals post and each screen is shaped
differently. AP-1 and AP-4 group by the **target Company**: one card per PCTH /
KSI / PCMY / UNO holding the claim brands mapped into it, a summary on the card
and the form behind **แก้ไข**. AP-2 and AP-3 still show a card per *claim brand*
with every field inline. This makes those two match.

> **Scope: AP-2 and AP-3 only. AP-1 is not touched** (user, 2026-09-14). It is
> already grouped — AP-4 copied its shape — and there is an uncommitted stash
> against `BrandErpInterfaceSettings.tsx` from before this branch
> (`WIP (pre-existing, not mine)`), so editing it now would collide with
> somebody else's work.

---

## 1. The shape

Identical to AP-4's tab, which is identical to AP-1's:

- one card per interface target, carrying the claim brands mapped into it;
- the card is a **summary** — what the group is set to, in words;
- **แก้ไข** opens a `Dialog` with the group's fields and its member rows;
- a `ยังไม่ได้จัดกลุ่ม` bucket for claim brands with no target.

### Where each field sits

| | Group level | Per member row |
|---|---|---|
| **AP-2** | Journal Batch · BC connection | Bank Account · Branch · Active |
| **AP-3** | Journal Batch · VAT input · WHT payable · BC connection | — |

AP-3 has nothing left per brand, which is the point: every value it configures
is a fact about the company whose books the clearing posts into.

---

## 2. Storage does not move. A "group value" is a fan-out

Every value stays keyed on the **claim brand**, exactly as today —
`AccBrandErpInterface` / `AccBrandJournalBatch` / `AccBrandBankAccount` /
`AccBrandBranchCode` for AP-2, `AccClearAdvanceInterfaceConfig` for AP-3.
Saving a group-level field writes it to **every member of that group**.

Two measured reasons, either one sufficient:

- **`resolveJournalBatchName` is target-first.** It looks a claim brand's batch
  up by its *interface* brand before any claim-brand row, so a batch stored on
  the target beats every per-brand row. That is the AP-2 failure this repository
  has already shipped once — "the screen displayed `TRAVELING` while the payload
  correctly sent `BEE`" — and CLAUDE.md records it as the rule AP-4 had to
  follow.
- **AP-3's payload reads `clrMap[claimBrand]`.** `loadClearAdvanceErpContext`
  indexes `listClrInterfaceConfig()` by the claim brand. A value stored against
  the target would be read by nothing.

So the grouping is a **presentation** over per-brand rows. Nothing about the
tables, the routes or the payload builders changes.

---

## 3. Membership is AP-2's, and AP-3 has no say

AP-2 owns `AccBrandErpInterface` with `FormCode='AP-2'`; AP-3 inherits whatever
that resolves to. So:

- **AP-2's cards carry `เพิ่มแบรนด์` and a trash control**, and moving a brand
  between cards is what changing its target now means — the same upsert the
  per-brand dropdown performed, addressed differently.
- **AP-3's cards carry neither**, and say on the card that membership is set on
  AP-2's tab. A control that looked editable and silently was not would be worse
  than not having one.

---

## 4. Members whose values already disagree

**This is not hypothetical.** Measured 2026-09-14, in both form databases:

```
AccClearAdvanceInterfaceConfig
  PCTH    batch=Q   vat=—           wht=—
  ROCKS   batch=Q   vat=110741001   wht=211112004
```

PCTH and ROCKS are one group — both post into PCTH — and their VAT and WHT
accounts differ. Reading the code says this is PCTH never having been filled in
rather than a deliberate difference: AP-3's payload throws
`มี VAT แต่ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อ` for a PCTH clearing that carries VAT, so
that configuration is not "different", it is broken.

The rule, in two cases:

- **One side blank** — the group shows the value that exists, with a line saying
  it will be written to the members that have none when saved. That is the case
  above, and saving fixes PCTH as a side effect of an admin looking at the
  screen.
- **Two different non-blank values** — the group shows the conflict and refuses
  to guess. An admin picks; nothing is written until they do.

A silent pick would overwrite a real decision with another real decision, on
configuration that decides where money posts.

---

## 5. What is NOT changing

- No migration. No table, column or unique key moves.
- No route: `settings/erp-interface` on both forms keeps its shape, and the
  group save loops it per member exactly as AP-4's does.
- The payload builders, `resolveJournalBatchName`, and every reader are
  untouched.
- AP-1's screen and its pending stash.

---

## 6. Testing

The grouping and the fan-out rules are pure and get their own tests; the screens
themselves are not behaviourally tested here, as in the rest of this repository.

- `groupByTarget` — claim brands into target groups, the unassigned bucket,
  a brand whose target resolves to nothing, and ordering.
- `groupValue` — the three cases of §4: all members agree; some blank and one
  set; two different non-blank values (a conflict, never a pick).
- A source guard that AP-3's screen renders no membership control, since the
  failure is a control that appears to work.

`npm test`, `npx next build` and a live read of both forms' settings before the
commit.
