# AP-17 package D — a foreign trip pays on the approval date alone

Design, 2026-09-21. Approved by the user the same day.

Item 7 of the AP-17 batch, and the smallest change in the batch by line count.
It gets its own spec because it **reverses a decision this codebase argues
against in writing**, and a reversal needs its reason recorded where the old
one was.

---

## Amendment — 2026-09-21 (same-day correction, found in the fix-wave review)

**§3's worked example proves the opposite of what it claims.** "Approved 18
Sep, returns 25 Sep … pays 30 Sep … the money arrives before the traveller
does" is false as written: **30 Sep is after 25 Sep**, so the money does not
arrive before the traveller. The claim about the *class* of change — foreign
now pays roughly a month earlier than the later-of-two rule would have — is
correct; the specific worked case cited does not demonstrate "before the
traveller," and a maintainer who checks the arithmetic discounts the whole
paragraph, including the part that is true.

**The case that genuinely does is the foreign 1–5 band**, which §1 already
flags as the band no worked case covered: approved 2 Oct, trip 20–28 Oct →
pays 10 Oct, ten days before the traveller leaves on the 20th.

18 Sep / 25 Sep is kept as a plain illustration that the payout moves a month
earlier; the "before the traveller" language now attaches only to the 1–5
case. Corrected in the same commit, in `payout-rule.ts`'s own header and in
CLAUDE.md's AP-17 payout section — both carried the same wrong example and
must not drift apart from this note or from each other.

---

## 1. The bands the user asked for are already live

The request read: *"ต่างประเทศ: อนุมัติ/กลับ วันที่ 6–20 จ่ายสิ้นเดือน ·
วันที่ 21–5 จ่ายวันที่ 10"*. Measured against `payout-rule.ts:19-26`:

```
D = the later of (manager approval date, travel return date)
foreign  D.day 1..5    -> the 10th of D's OWN month
         D.day 6..20   -> last day of D's month
         D.day 21..end -> the 10th of the NEXT month
```

6–20 pays the month end. 21–5 pays the 10th — the code writes that one band as
two arms straddling the month boundary, and both resolve to the same day
(21 Sep and 3 Oct both pay 10 Oct). The bands are identical to what was asked
for. **Nothing about them changes.**

What changes is one input.

---

## 2. D becomes the approval date, for foreign trips only

**Foreign: `D = manager approval date`.** The trip's return date stops being
consulted (user, 2026-09-21 — "นับจากวันที่ผู้จัดการอนุมัติอย่างเดียว ไม่เอาวัน
กลับ").

**Domestic: `D` stays the later of the two** (user, same day — "ในประเทศยังนับ
จากวันที่มากกว่า"). Its bands are unchanged as well.

So the two branches now disagree about what D is, not only about how D maps to
a payout day. `payoutDate` keeps taking both dates and the country; it picks D
differently per branch.

**The asymmetry must be commented at the branch**, because it reads exactly like
a bug: a maintainer who notices foreign ignoring `returnDate` will "fix" it to
match domestic. The comment says it is deliberate, dated, and whose call it was.

---

## 3. What this costs, recorded because the code currently argues the opposite

`payout-rule.ts:30-34` exists to explain why approval-alone was rejected:

> It replaces `computePayoutDate`, which read the approval date alone. Neither
> single input reproduces the cases this was specified with: approval-alone
> (i.e. the old behaviour) pays a trip returning on the 21st at the end of the
> approval month … Both are wrong by a month, in opposite directions.

That paragraph is now false for the foreign branch, and **leaving it there would
leave the file arguing against its own behaviour.** It is rewritten, not
deleted: the new text says approval-alone was the rule until 2026-09-04, was
replaced for the reason above, and was restored for foreign trips on 2026-09-21
by the user's decision — so the next reader finds the history rather than
re-deriving it and "correcting" the file back.

The concrete effect, which is the thing to check against real cases:

> Approved 18 Sep, returns 25 Sep. Old: D = 25 Sep → pays 10 Oct. New:
> D = 18 Sep → pays 30 Sep. **The money arrives before the traveller does.**

That is inherent to the rule as chosen, not a defect in it. CLAUDE.md's AP-17
payout table and its "Neither date alone reproduces the rule" paragraph are
corrected in the same commit for the same reason.

---

## 4. Everything else about the rule stays

- **`approveByManager` still mints the date from one instant**, used for the
  rule and for `AccApproval.ActionedAt` alike. That guard exists because a
  transaction crossing midnight into the 21st otherwise reads two clocks; it is
  more load-bearing now, not less, since the approval date is the only input on
  the foreign path.
- **No weekend or holiday shifting**, deliberately, as confirmed 2026-09-04.
  This package does not revisit it.
- **A missing return date no longer degrades the foreign path at all** — it was
  never read there. The existing `payment_date_fallback` activity row stays for
  the domestic path, which still needs it.
- **`CountryCode` absent means Thailand**, unchanged. Rows filed before
  migration 129 carry NULL and take the domestic branch, which is the branch
  that did not change — so no historical row's rule moves.
- `scripts/checks/recompute-ap17-payout.ts` exists and re-derives the date for
  requests parked at `(ManagerApproved, ACCOUNT)`. **Whether to run it after
  this lands is the user's call**, since it would move already-suggested dates
  on live foreign requests; the spec does not decide it.

---

## 5. Testing

`payout-rule.ts` is pure and `payout-rule.test.ts` already covers the bands.
Add, and keep the existing cases passing unchanged:

- foreign, approval 18 Sep + return 25 Sep → 30 Sep (the worked case above);
  the same pair on the domestic branch → 10 Oct, asserted **side by side in one
  test**, because each looks like the other's bug and the existing file already
  uses that pairing for the 1–5 asymmetry;
- foreign ignores `returnDate` entirely — same approval date, three different
  return dates, one answer;
- foreign with a null return date still answers (it cannot refuse any more);
- domestic with a null return date still refuses, unchanged.

---

## 6. Out of scope

- The domestic bands, and the foreign bands. Only D's definition moves.
- AP-1's and AP-4's payment calendars. Different forms, different rules,
  different files.
- Re-running the recompute script against live data.
