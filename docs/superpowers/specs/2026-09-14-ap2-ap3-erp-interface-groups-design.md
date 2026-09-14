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
>
> **Amended the same day: AP-1's CARD SHAPE was changed after all**, on the
> user's direct instruction — *"ของ AP-1 ต้องเป็น cards เหมือน AP-4"*. Its
> grouping, its edit form and every rule in that file are untouched; what
> changed is that `TargetErpSummaryCard` renders AP-4's tile instead of a
> full-width row, and the list is a three-across grid. The stash hazard is real
> and the edit was kept to those two places because of it.

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
| **AP-3** | BC connection | Journal Batch · VAT input · WHT payable |

> **Amended at implementation, 2026-09-14 — AP-3's row was the other way round
> in this table and shipped that way for one commit.** It read "Journal Batch ·
> VAT input · WHT payable · BC connection" at group level with nothing per
> brand, on the reasoning that every value AP-3 configures is a fact about the
> company whose books the clearing posts into. The user reversed it the same day
> — *"Interface ERP AP-3 ต้องแยกเป็นของแต่ละ brand เหมือนกับ AP-2"* — and the
> measured data agrees: PCMY sits in the PCTH group carrying **none** of the
> three, so one value for the group made "unset" and "deliberately different"
> the same thing, and resolving the group meant overwriting whatever a member
> already had. `AccClearAdvanceInterfaceConfig` has always been one row per
> `BrandCode` with these three columns; the dialog now matches it, and the save
> writes only the brands whose values actually changed.

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

- **AP-2's cards carry `เพิ่มแบรนด์`**, and moving a brand between cards is what
  changing its target now means — the same upsert the per-brand dropdown
  performed, addressed differently.
  > **Amended at implementation, 2026-09-14: there is no trash control**, and
  > that is the route rather than the screen. `POST .../settings/erp-interface`
  > refuses an empty `interfaceBrandCode` outright
  > (`กรุณาเลือก Company ปลายทาง`), so a brand cannot be un-mapped from AP-2 at
  > all — only moved to another Company. A trash icon would have had nothing to
  > call. The card says so instead.
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

> **Amended at implementation, 2026-09-14 — AP-2 has a real conflict, and
> "an admin picks" needed one more guard.** Measured the same day:
>
> ```
> AP-2, group PCTH:  PCTH batch=Q   ROCKS batch=Q   PCMY batch=TRANSFER
>                    PCTH bank=K-CA6999             PCMY bank=UOB-2726
> ```
>
> PCMY genuinely posts into PCTH with its own batch, so the group's box starts
> empty — and an empty box saved as-is would null out three working
> configurations in one click, on a dialog somebody may have opened only to fix
> a bank account. So **Save is blocked while the box is empty and any member has
> a batch**, naming them, and whichever value is chosen the dialog lists whose
> current value it will replace. The same guard is on AP-3's card. AP-3's own
> PCTH group is the §4 *fill* case rather than a conflict, and saving it repairs
> PCMY's batch and both PCMY's and PCTH's tax accounts.

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
  failure is a control that appears to work —
  `src/lib/acc/erp-interface-group-screens-guard.test.ts`, which also pins that
  **both** saves post one body per member keyed on the claim brand, the property
  §2 exists for.

> **Amended at implementation, 2026-09-14:** a fourth thing had to be derived on
> the screens rather than read off the view. Both view builders resolve
> `interfaceTarget` with a final `?? code`, so a brand with **no**
> `AccBrandErpInterface` row reports as posting into itself — PLM and SMR,
> measured — which would render a card for a Company that is not an interface
> target, whose Save AP-2's route refuses. Those are the `ยังไม่ได้จัดกลุ่ม`
> bucket. A target outside the four that is *not* the brand's own code keeps its
> group, because an unexpected mapping is what needs to be seen.

`npm test`, `npx next build` and a live read of both forms' settings before the
commit.
