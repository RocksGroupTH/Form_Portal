# AP-17 package C — the ID card only where a setting says so

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AP-17 requester is asked for a national ID / Passport scan only when one of the booking options they selected is configured to need one.

**Architecture:** A `RequiresIdCard BIT NOT NULL DEFAULT 0` column on the three option tables; `deriveBookingFlags` gains a derived `needsIdCard`; the form's upload block and both validators gate on that derived flag. No change to how a card is judged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target), MSSQL via `mssql`, `node:test` + `node:assert/strict` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-21-ap17-c-id-card-when-configured.md` — read it before Task 1. The plan argues from it; where they disagree, the spec wins and you report the disagreement.

## Global Constraints

- **The migration number is `154`, not 153.** `ls migrations/` on this branch stops at 152, but `153_acc_report_access.sql` exists on the unmerged `feat/all-requests-report` branch. CLAUDE.md records eleven already-duplicated numbers and says a number alone does not name a file; do not make it twelve.
- **The migration goes to BOTH `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`, before the code deploys.** SQL Server binds column names at compile time, so the column missing from either side is `Invalid object name` on AP-17's form for whoever resolves that database — not a null.
- **`npm run check:alignment` must still read 30.** This adds a column to three tables that are already in `MASTER_TABLES` (`verify-master-alignment.ts:77-79`). **31 means the wrong thing was created.** The checker compares every non-datetime column, so a one-sided apply also reds it — that is the check working, not a fault.
- **`@/env` validates the whole environment at import time.** Anything reachable from a DB pool throws on import inside a test. Pure modules get direct tests; everything else gets a source-reading guard. The placeholder-env + dynamic `import()` escape hatch is `src/lib/acc/sharepoint-path.test.ts:11-17`. `import type` is erased and always safe.
- **ES5 target:** `Array.from()`, never `[...set]` or `[...map.values()]`.
- **Thai wall-clock dates, local getters only.** Never slice `YYYY-MM-DD` off an ISO string.
- **Parameterized SQL only.**
- **Never delete or reword an existing explanatory comment** unless the change it describes is the change you are making.
- **The verification itself is out of scope.** `POST /api/request/travel-booking/id-card-check`, `ID_CARD_VISION_MODEL`, the fail-closed refusal and `statusForVisionError`'s 503-vs-502 mapping are untouched. This package changes *when* a card is asked for, never *how* one is judged.

## File Structure

| file | responsibility |
|---|---|
| `migrations/154_travel_option_requires_id_card.sql` | the column, both form databases |
| `src/lib/acc/travel-booking/derive-flags.ts` | `needsIdCard` joins the derived flags |
| `src/lib/acc/travel-booking/derive-flags.test.ts` | its truth table |
| `src/lib/acc/travel-booking/settings-service.ts` | read and write the flag on all three option types |
| `src/features/travel-booking/components/settings/TravelOptionSettings.tsx` | the tick box and the commissioning banner |
| `src/lib/acc/travel-booking/request-service.ts` | server validator gates on the flag |
| `src/features/travel-booking/hooks/useTravelBookingForm.ts` | client validator gates on the flag |
| `src/features/travel-booking/components/TravelBookingTab.tsx` | the upload block is hidden, not disabled |
| `CLAUDE.md` | the rule, the default, and the deployment step |

---

### Task 1: the column

**Files:**
- Create: `migrations/154_travel_option_requires_id_card.sql`

**Interfaces:**
- Produces: `RequiresIdCard BIT NOT NULL DEFAULT 0` on `AccTravelAccommodation`, `AccTravelVehicleOption`, `AccTravelRentVehicle`.

- [ ] **Step 1: Read a recent two-database migration first**

Open `migrations/144_acc_reimburse_approver_brand.sql` and one other recent file. Match this repo's house style: a header naming the **target database**, the ordering rule, what `check:alignment` must read afterwards, and an idempotency guard. Every migration here states its own target; a file that does not is the defect.

- [ ] **Step 2: Write it**

Three `ALTER TABLE ... ADD RequiresIdCard BIT NOT NULL CONSTRAINT DF_<table>_RequiresIdCard DEFAULT (0)`, each guarded by `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.<table>') AND name = 'RequiresIdCard')` so a re-run is a no-op.

The header must say, in its own words:

- target: **both** `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`, before the code deploys, and why (compile-time binding — `Invalid object name`, not a null);
- `check:alignment` must still read **30**; 31 means the wrong thing was created;
- the default is **0 and that is a control switched off**: on the day this deploys no AP-17 request asks for a card at all, including hotel bookings, until an admin ticks the options. The user chose this (2026-09-21, "ไม่ติ๊กทั้งหมด — ค่อยไปติ๊กทีหลัง"). **A default of 1 was rejected; do not "fix" it back without asking.**

- [ ] **Step 3: Do NOT apply it**

Applying migrations against the live databases is the user's call, not this plan's. Leave it for the deployment checklist in Task 6. Say in your report that it is unapplied.

- [ ] **Step 4: Commit**

```bash
git add migrations/154_travel_option_requires_id_card.sql
git commit -m "feat(ap-17): RequiresIdCard on the three booking-option tables"
```

---

### Task 2: `needsIdCard` is derived, never posted

**Files:**
- Modify: `src/lib/acc/travel-booking/derive-flags.ts`
- Modify: `src/lib/acc/travel-booking/derive-flags.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `requiresIdCard: boolean` on `AccommodationOption`, `VehicleFlagOption` and `RentVehicleOption`; `needsIdCard: boolean` on `DerivedBookingFlags` and on `NO_BOOKING_FLAGS`.

- [ ] **Step 1: Write the failing tests**

`derive-flags.test.ts` already exists — read it and match its fixture style rather than inventing one. Add:

```typescript
test("needsIdCard is true when only the accommodation requires one", () => {
  const flags = deriveBookingFlags({
    accommodation: { id: 1, isActive: true, needsRoomBooking: true, requiresIdCard: true },
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.equal(flags.needsIdCard, true);
});

test("needsIdCard is true when only the go vehicle requires one", () => { /* … */ });
test("needsIdCard is true when only the return vehicle requires one", () => { /* … */ });
test("needsIdCard is true when only the rent vehicle requires one", () => { /* … */ });
test("needsIdCard is true when several options require one", () => { /* … */ });

test("needsIdCard is false when no option requires one — the fresh-database state", () => {
  const flags = deriveBookingFlags({
    accommodation: { id: 1, isActive: true, needsRoomBooking: true, requiresIdCard: false },
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.equal(flags.needsIdCard, false);
});

test("NO_BOOKING_FLAGS carries needsIdCard false", () => {
  assert.equal(NO_BOOKING_FLAGS.needsIdCard, false);
});
```

The **last case is the load-bearing one** and must not be dropped as trivial: it is the state every database is in the moment migration 154 lands, so it is what the whole company experiences on deploy day.

- [ ] **Step 2: Run them and watch them fail**

`npm test -- src/lib/acc/travel-booking/derive-flags.test.ts`. Expected: type errors and failures on the missing property. Confirm the file **loads** — a suite that reports zero tests has not run yours.

- [ ] **Step 3: Implement**

Add `requiresIdCard: boolean` to the three option interfaces, `needsIdCard: boolean` to `DerivedBookingFlags`, `needsIdCard: false` to `NO_BOOKING_FLAGS`, and in `deriveBookingFlags`:

```typescript
    // **Derived, never posted** — the same rule the rest of this module states
    // and for the same reason: a client posting `needsIdCard: false` beside a
    // hotel that requires one must not be believed. ANY selected option that
    // requires a card makes the request require one; a null option contributes
    // nothing, because an unselected vehicle asks for no identification.
    needsIdCard:
      (options.accommodation?.requiresIdCard ?? false) ||
      (options.goVehicle?.requiresIdCard ?? false) ||
      (options.returnVehicle?.requiresIdCard ?? false) ||
      (options.rentVehicle?.requiresIdCard ?? false),
```

**Note the asymmetry with `needsRentBooking` and do not copy that pattern here.** That field has an "answer wins over the question" rule because `ไม่เช่า` is a real answer meaning no. There is no such answer for identification — nobody picks an option meaning "and no card". A plain OR is correct.

- [ ] **Step 4: Run them and watch them pass**

Then the full `npm test`. **Every caller that constructs one of the three option interfaces now fails to typecheck** — that is the point of adding a required rather than optional property, and it is how you find every call site. Run `npm run typecheck` and fix each one by threading the real column through, never by writing `requiresIdCard: false` to silence it. If a call site genuinely has no row to read from, report it rather than defaulting it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/derive-flags.ts src/lib/acc/travel-booking/derive-flags.test.ts
git commit -m "feat(ap-17): derive needsIdCard from the selected options"
```

---

### Task 3: the settings service reads and writes it

**Files:**
- Modify: `src/lib/acc/travel-booking/settings-service.ts`
- Modify: whichever route files under `src/app/api/request/travel-booking/settings/` carry the three option types' POST/PATCH bodies
- Create: `src/lib/acc/travel-booking/settings-id-card-guard.test.ts`

**Interfaces:**
- Consumes: the column from Task 1.
- Produces: `requiresIdCard` on each option's read shape and accepted on each option's write.

- [ ] **Step 1: Thread it through all three, reads and writes**

`AccTravelAccommodation`'s SELECT is at `settings-service.ts:178` and its upsert at `:209`/`:213` — add the column to both, and to the mapped row at `:189`. Do the same for `AccTravelVehicleOption` and `AccTravelRentVehicle`; find their own SELECT/upsert pairs rather than assuming they match the accommodation one.

- [ ] **Step 2: `upsertVehicle`'s two passes must BOTH carry it**

`settings-service.ts:294-320` is the only `SET IDENTITY_INSERT` in `src/`. `writeBothPools` runs production first; the UAT pass (`isUatPass`, `:294`) replays production's id so `AccTravelVehiclePlace`'s FK resolves. **Both branches must write `RequiresIdCard`**, or the two databases agree on the id and disagree on the flag — and `check:alignment` would then red on a column nobody changed deliberately.

Read the comment above that block before editing it. It explains why the branch exists; CLAUDE.md warns that a reader who believes it is dead code and removes it breaks a cross-database FK silently.

- [ ] **Step 3: A guard test, because the dual-write pass cannot be unit-tested**

`settings-service.ts` reaches `@/env` through its pool, so it is not importable in a test. Write a source-reading guard in the established shape — `perdiem-source-guard.test.ts` and `booking-currency-guard.test.ts` are the two to copy, including their docblock style, which states *what failure the guard catches* rather than what the test does.

Assert that **both** the plain-INSERT branch and the `IDENTITY_INSERT` branch of `upsertVehicle` name `RequiresIdCard`. Then **mutation-test your own guard**: delete the column from one branch only, confirm the guard reds, restore, confirm `git status` is clean. Report what you saw. A guard nobody has tried to defeat is a guard nobody knows the strength of — this branch has already shipped two that were green against six real regressions.

- [ ] **Step 4: Verify and commit**

`npm run typecheck`, full `npm test`.

```bash
git commit -m "feat(ap-17): settings service carries RequiresIdCard on all three option types"
```

---

### Task 4: the tick box, and the banner that says the control is off

**Files:**
- Modify: `src/features/travel-booking/components/settings/TravelOptionSettings.tsx`

**Interfaces:**
- Consumes: `requiresIdCard` from Task 3's read shape.

- [ ] **Step 1: A checkbox per option row, on all three lists**

Label it for what it does, in Thai, matching the surrounding copy's register — the field it controls now reads `แนบรูปบัตรประชาชน หรือ Passport` (package A changed it), so the setting should not say only `บัตรประชาชน`. Follow the file's existing pattern for a per-row boolean; `NeedsRoomBooking` is already one, so there is a precedent in this very component. Do not invent a second way to render a row toggle.

- [ ] **Step 2: The commissioning banner**

Render it whenever **no option in any of the three lists** has `requiresIdCard = true`:

> ยังไม่มีตัวเลือกใดกำหนดให้แนบบัตรประชาชน/Passport

AP-4's empty-approver banners are the shape to copy. It must say what the consequence is, not only the state — that no AP-17 request will ask for a card until an option is ticked. A banner stating a fact the reader cannot act on is decoration.

**It reads the same rows the grid renders**, so it gets no test of its own; say that in your report rather than adding a vacuous one.

- [ ] **Step 3: Verify and commit**

`npm run typecheck`, full `npm test`.

```bash
git commit -m "feat(ap-17): tick which booking options need an ID card"
```

---

### Task 5: the requester is asked only when the flag is true

**Files:**
- Modify: `src/lib/acc/travel-booking/request-service.ts` (~:1209)
- Modify: `src/features/travel-booking/hooks/useTravelBookingForm.ts` (~:378)
- Modify: `src/features/travel-booking/components/TravelBookingTab.tsx`

**Interfaces:**
- Consumes: `needsIdCard` from Task 2.

- [ ] **Step 1: The server refuses only when required**

`request-service.ts:1209-1212` currently reads:

```typescript
  // ข้อ17 — แนบบัตรประชาชน (>=1)
  if (!tab.idCardFiles || tab.idCardFiles.length === 0) {
    return fail("กรุณาแนบรูปบัตรประชาชน หรือ Passport อย่างน้อย 1 ไฟล์");
  }
```

Gate it on the derived flag. **Derive it from the persisted option rows inside the validator's own transaction/read, exactly as the other flags are** — this function already has the option rows in hand for the rent-vehicle rule a few lines above, so find how they arrive rather than adding a second read, and never read `needsIdCard` off the posted DTO.

**The server is the real check.** The client gate in Step 2 is an affordance; a resumed draft, a direct POST, or an option whose flag was ticked after the draft was saved all reach here.

- [ ] **Step 2: The client validator matches**

`useTravelBookingForm.ts:378` is the twin:

```typescript
  if ((!tab.idCardFiles || tab.idCardFiles.length === 0) && !tab.pendingIdCard) {
```

Gate it on the same derived answer. **Determine how the tab learns the flag** — the form already knows each selected option's other `needs*` values, so establish whether `requiresIdCard` arrives with them or whether the options payload needs widening, and say which you found. Do not compute a second, client-local version of the rule from a hardcoded list of booking types; that is precisely what the spec rejected.

- [ ] **Step 3: The upload block is hidden, not disabled**

In `TravelBookingTab.tsx`, render the ID-card block only when the flag is true. The spec is explicit: *"A disabled control invites the question 'why can't I?'; an absent one matches 'this booking does not need it'."*

**One case to get right rather than guess at**: a draft saved while a card was required, resumed after the option was un-ticked, that already has files attached. Hiding the block would strand visible evidence the requester can no longer see or remove. Decide what happens, implement it, and say what you chose and why. Leaning: if files exist, show the block regardless — the same shape AP-1's expense row uses, where the amount field appears once `amount > 0` even though the normal path reveals it another way.

- [ ] **Step 4: Verify and commit**

`npm run typecheck`, full `npm test`. Report real counts.

```bash
git commit -m "feat(ap-17): ask for an ID card only where the booking requires one"
```

---

### Task 6: CLAUDE.md and the deployment checklist

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: The rule, in the AP-17 section's own voice**

Read the existing ID-card bullets before writing — they are dense, they state costs, and **one of them already records the passport contradiction** (the field invites a Passport; the check refuses one four ways and fails closed). Your new text sits beside it and must not contradict it.

Record: the flag, that it is derived and never posted, that the field is hidden rather than disabled, and that **the fail-closed behaviour itself is unchanged** — where a card is required, an unverified image is still refused. That last clause matters because a reader skimming "the ID card is now conditional" will otherwise assume the 2026-08-24 fail-closed decision was softened.

- [ ] **Step 2: The default, stated as the control it switches off**

This is the paragraph that must not be softened:

> On the day 154 deploys, **no AP-17 request asks for an ID card at all**, hotel bookings included, until an admin ticks the options. The strongest control on this form is off, and nobody issued an instruction to turn it off for any particular booking. The user chose this on 2026-09-21 knowing it. A default of 1 was considered and rejected — do not "fix" it back without asking.

- [ ] **Step 3: The deployment checklist entry**

In the deployment section, in the shape the 144/151/152 entries use: 154 goes to **both** form databases **before** the code; `check:alignment` must still read **30**, and **31 means the wrong thing was created**; and — the part unique to this one — **tick the options immediately after applying, not eventually**, because the window between the apply and the first tick is a window with no ID-card requirement anywhere.

- [ ] **Step 4: Verify and commit**

`npm run typecheck` and the full `npm test` — both must be unchanged, since this task edits no code. A change means something other than this task moved.

```bash
git add CLAUDE.md
git commit -m "docs: record AP-17's conditional ID-card rule"
```
