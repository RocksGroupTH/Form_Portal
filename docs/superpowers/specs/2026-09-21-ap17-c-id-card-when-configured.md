# AP-17 package C — the ID card is required only where a setting says so

Design, 2026-09-21. Approved by the user the same day.

Item 3 of the AP-17 batch. Today every AP-17 request must carry a verified
national ID scan. After this, only requests whose selected booking options are
configured to need one must.

---

## 1. What this replaces

The ID card is unconditional. CLAUDE.md records the consequence bluntly:

> **It fails closed** … **So while the check cannot run, AP-17 cannot be filed
> at all** — the card is required to submit.

So an Anthropic outage, a revoked key or a rate limit stops every AP-17 request
in the company, including a requester taking their own car to a site with no
accommodation and nothing to book. Making the requirement conditional shrinks
that blast radius to the requests that genuinely need a card. **The fail-closed
behaviour itself is unchanged** — where a card is required, an unverified image
is still refused, for the reason the 2026-08-24 work gives.

---

## 2. It is a setting, not a hardcoded list of booking types

The first cut of this was "require a card when any of `needsRoomBooking`,
`needsTicketBooking`, `needsRentBooking` is true". The user asked for it to be
configurable instead: *"น่าจะต้องมีเพิ่มในหน้า setting จองแบบไหน และมี check box
ให้ติ๊กว่าต้องแนบไหม"*.

That is the better shape for a reason worth writing down: which bookings need
identification is a supplier fact, not an application fact. A hotel chain that
stops asking, or a bus operator that starts, is a change to the world — not to
this codebase.

### Schema

A `RequiresIdCard BIT NOT NULL` column on the three option tables:

| table | the option a requester picks |
|---|---|
| `AccTravelAccommodation` | ที่พัก |
| `AccTravelVehicleOption` | พาหนะ |
| `AccTravelRentVehicle` | รถเช่า |

**All three are in `MASTER_TABLES`** (`verify-master-alignment.ts:77-79`) —
dual-written, ids identical in both form databases. Two consequences:

- **The migration goes to `Rocks_Portal_Form` AND `Rocks_Portal_Form_UAT`
  before the code deploys.** SQL Server binds column names at compile time, so
  the column missing from either side is `Invalid object name` on AP-17's form
  for whoever resolves that database — not a null.
- **`npm run check:alignment` must still read 30.** This adds a column, not a
  table; **31 means the wrong thing was created.** The checker compares every
  non-datetime column, so a one-sided apply also reds it — which is the check
  working.

`upsertVehicle` (`travel-booking/settings-service.ts`) is the one place in
`src/` that uses `SET IDENTITY_INSERT`, replaying production's id into UAT
because `AccTravelVehiclePlace` has an FK to it. **Both of its passes must carry
the new column**, or the two databases agree on the id and disagree on the flag.

### Default: unticked, and that is a control switched off on deploy day

Existing rows default to **0** (user, 2026-09-21 — "ไม่ติ๊กทั้งหมด — ค่อยไปติ๊ก
ทีหลัง"). The consequence, stated plainly because it is not the safe direction:

> **On the day this deploys, no AP-17 request asks for an ID card at all** —
> including hotel bookings — until an admin goes and ticks the options. The
> strongest control on this form is off, and nobody issued an instruction to
> turn it off for any particular booking.

The user chose this knowing it. Two things make it visible rather than silent,
and both are part of this package rather than a follow-up:

- **A commissioning banner on the settings page** whenever no option in any of
  the three tables has `RequiresIdCard = 1`: *"ยังไม่มีตัวเลือกใดกำหนดให้แนบ
  บัตรประชาชน/Passport"*. The shape AP-4's empty-approver banners already use.
- **A line in the deployment checklist** saying to tick the options immediately
  after applying, not eventually.

A default of 1 would have preserved today's behaviour and was rejected; do not
"fix" it back without asking.

---

## 3. What the requester sees

**The upload appears only once the booking selection requires it**, which is
what the user asked for: *"ให้แสดงตอนที่เลือกข้อมูลการจองก่อนเข้าเงื่อนไขถึงแสดง
ให้แนบไฟล์"*.

`deriveBookingFlags` gains a derived `needsIdCard`, true when **any** selected
option carries `RequiresIdCard = 1`. It is derived from the persisted option
rows and never from the posted DTO — the module's own docblock already states
that rule for the other flags and the reason applies unchanged: a client
posting `needsIdCard: false` beside a hotel that requires one must not be
believed.

The field is hidden, not disabled, when false. A disabled control invites the
question "why can't I?"; an absent one matches "this booking does not need it".

**Submit validation follows the same flag, on the server.** `validateTab` and
the submit path refuse a missing card only when `needsIdCard` is true.

---

## 4. Testing

`derive-flags.ts` is pure and already has `derive-flags.test.ts`. Extend it:

- `needsIdCard` is true when only the accommodation option requires it, when
  only the vehicle does, when only the rent vehicle does, and when several do;
- false when none does, which is the new default state of a fresh database;
- **the flag is derived from the option rows, never from a posted value** —
  the existing "the answer wins over the question" case in that file is the
  precedent to follow.

A settings-service test that both dual-write passes carry the column, so the
`IDENTITY_INSERT` path cannot drift. The banner gets no test; it reads the same
count the grid renders.

---

## 5. Out of scope

- **The verification itself.** `POST /api/request/travel-booking/id-card-check`,
  `ID_CARD_VISION_MODEL` (`claude-sonnet-5`), the fail-closed refusal and
  `statusForVisionError`'s 503-vs-502 mapping are all untouched. This package
  changes *when* a card is asked for, never *how* one is judged.
- **`id-card-access.ts`.** Who may see a stored scan is unchanged — data subject
  only.
- **Reuse of a previously stored card.** The "ใช้รูปเดิม" path still works where
  the field is shown.
- The field's title — that is package A.
