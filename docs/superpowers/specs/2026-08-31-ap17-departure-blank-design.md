# AP-17 — จุดขึ้นรถ/ขึ้นเครื่อง defaults to blank

**Date:** 2026-08-31
**Status:** design agreed, not built
**Survey:** six-agent survey of the five-change AP-17 worldwide-travel brief (`ap17-survey.md`), change 3 — re-verified line-by-line in this session; every citation below was read directly, not copied from the survey

## Why (the problem, in the user's terms)

ข้อ13, "จุดขึ้นรถ/ขึ้นเครื่อง," silently writes a place into the field before the
requester has touched it: ขาไป (outbound) is pre-filled with `กรุงเทพมหานคร`
regardless of where the trip actually starts, and ขากลับ (return) is pre-filled
with the province just chosen on ข้อ8, regardless of where the return leg
actually departs from. Now that AP-17 is going worldwide (a separate, larger
piece of work — see "Out of scope"), a Bangkok default is not even usually
right for the outbound leg, and a same-as-destination default has never
correctly described the return leg for anyone whose trip does not end where it
began. The fix scoped here is narrower than the worldwide work and stands on
its own: stop guessing, leave both fields empty, and make every requester type
where they are actually leaving from.

## Decisions (each with its reason and what it costs if wrong)

**D-S1.1 — Delete the default outright; do not disable it behind a flag or
leave `nextDeparturePlace` in place unused.**
`nextDeparturePlace` (`src/features/travel-booking/lib/departure-default.ts:12-33`)
exists to answer one question — "what should this form silently write into a
field the requester has not touched" — and with no default to apply, that
question has no answer to compute. Its own JSDoc (`:1-11`) is explicit that the
whole design exists to tell "the requester typed this" apart from "the default
wrote this"; once nothing writes a default, that distinction stops describing
anything. **Cost if wrong:** leaving the module in "just in case" is exactly
the kind of dead code the next reader has to independently prove is dead
before they can trust removing it — the same trap this codebase's own history
warns about (see `ManagerId` in CLAUDE.md's Auth section: unread code left in
place invites a maintainer to assume it still matters).

**D-S1.2 — The field stays required. Removing the default is not the same
change as making the field optional, and this spec does not make that second
change.** Both validators — client `useTravelBookingForm.ts:310-315` and
server `src/lib/acc/travel-booking/request-service.ts:1047-1058` — are left
untouched. They already gate on the persisted `goNeedsDepartureLocations` /
`returnNeedsDepartureLocations` flags and on whether `departureLocations` holds
a non-blank entry for that direction, not on whether a default was ever
written, so removing the code that writes the *value* does not touch the code
that checks whether a value is *present*. **Cost if this were done instead:**
a requester could submit a booking whose vehicle needs a departure point with
none recorded — the Admin desk that books the ticket loses the one piece of
information the field exists to capture, silently, because nothing would flag
the gap.

**D-S1.3 — Delete `goAppliedDeparturePlace` / `returnAppliedDeparturePlace`
from `TabFormState`, rather than leaving them declared and unwritten.**
They were added for exactly one purpose, stated in their own JSDoc
(`useTravelBookingForm.ts:82-87`): "so a province change can tell its own
earlier fill apart from a place the requester typed." With no code left that
writes a default, there is nothing for them to disambiguate. They are UI-only —
`buildSaveInput` (`useTravelBookingForm.ts:196-237`) never assembles them into
`SaveTravelBookingInput`, confirmed by reading the whole function — so deleting
them is a pure client-side type change with no server, DTO, or migration
follow-up, and no draft saved before this change holds a value in them worth
preserving (a resumed draft already loads both as `null`,
`useTravelBookingForm.ts:183-184`). **Cost if kept:** two fields sit in the
type and in every object literal that builds a `TabFormState`, permanently
`null`, for a reader to wonder whether something still depends on them.

**D-S1.4 — CLAUDE.md's paragraph documenting this feature must be rewritten in
the same change, not left describing removed behavior.** It is the file
prospective implementers are told to read first (see this spec's own sourcing
instructions), and a paragraph asserting a default exists, after the code that
wrote it is gone, sends the next reader chasing a rule that no longer applies.
Replacement text is given verbatim below (UI section) so the implementer pastes
rather than re-derives it.

## Schema (exact DDL, migration number and target databases, or "none" — say which)

**None.** No table, column or migration is touched. The field this work
affects — `AccTravelDepartureLocation.Name NVARCHAR(300) NOT NULL`, with
`Direction NVARCHAR(10) NOT NULL CHECK (Direction IN ('go','return'))`
(`migrations/048_portal_acc_travel_booking.sql:101-110`) — was always free
text with no default at the database layer; the default was applied entirely
in the browser, before save. What changes is only what the browser puts into
that free-text input before the requester edits it: nothing, instead of a
guess.

## Server (services, functions, signatures, transactions)

**No server change.** Verified by reading `request-service.ts`'s full
departure-location validation block (`:1047-1058`, quoted under Decisions
above) and by grepping the whole repository for every reference to this
feature's identifiers (`nextDeparturePlace`, `departure-default`,
`GO_DEFAULT_DEPARTURE_PLACE`, `departureDefaults`, `AppliedDeparturePlace`):
the only files that reference any of them are the two files being deleted, two
components under `src/features/travel-booking/`, and CLAUDE.md. No route,
service, or migration under `src/lib/acc/travel-booking/` or `src/app/api/`
appears in that list. The server-side requirement rule
(`request-service.ts:1047-1058`) is the same rule the client mirrors and is
unchanged by this spec — restated here only so an implementer does not go
looking for a server-side default to remove:

```
// ข้อ13 — จุดขึ้นรถ/ขึ้นเครื่อง ต่อทิศทาง เมื่อทิศทางนั้นต้องระบุ (12.1)
if (
  tab.goNeedsDepartureLocations &&
  !(tab.departureLocations ?? []).some((d) => d.direction === "go" && d.name?.trim())
) {
  return fail("กรุณาระบุจุดขึ้นรถ/ขึ้นเครื่องขาไปอย่างน้อย 1 แห่ง");
}
if (
  tab.returnNeedsDepartureLocations &&
  !(tab.departureLocations ?? []).some((d) => d.direction === "return" && d.name?.trim())
) {
  return fail("กรุณาระบุจุดขึ้นรถ/ขึ้นเครื่องขากลับอย่างน้อย 1 แห่ง");
}
```

## Routes (method, path, gate, request/response shape)

**No route change.** The save/submit routes under
`/api/request/travel-booking/requests/[id]` already carry `departureLocations`
as free-typed strings; nothing about the wire shape changes, since the default
was never sent to the server in the first place (`buildSaveInput`,
`useTravelBookingForm.ts:196-237`, never included
`goAppliedDeparturePlace`/`returnAppliedDeparturePlace`, and always sent
whatever `departureLocations` held — a default-filled value or an empty one,
indistinguishably).

## UI (components, files, states, Thai copy where it is user-visible)

**Delete two files whole:**

1. `src/features/travel-booking/lib/departure-default.ts` (33 lines) — its one
   export, `nextDeparturePlace` (`:12-33`).
2. `src/features/travel-booking/lib/departure-default.test.ts` (86 lines, 8
   `test()` cases) — `npm test` discovers files by walking `src/` for
   `*.test.ts` (CLAUDE.md, Quick Start), so deleting the file is enough; there
   is no registry entry to also edit.

**Edit `src/features/travel-booking/constants.ts`:**

- Delete `GO_DEFAULT_DEPARTURE_PLACE` and its JSDoc, `:85-91`:
  ```
  /**
   * Default จุดขึ้นรถ/ขึ้นเครื่อง for ขาไป — nearly every trip starts from head
   * office. ขากลับ has no constant: its default is the province being travelled
   * to. Spelt as the province master spells it (migration 049), not the everyday
   * short "กรุงเทพ", so the two directions read alike.
   */
  export const GO_DEFAULT_DEPARTURE_PLACE = "กรุงเทพมหานคร";
  ```
  It has exactly two other references in `src/`, both in the file below —
  verified by grep.

**Edit `src/features/travel-booking/components/TravelBookingTab.tsx`:**

- Delete the import of `nextDeparturePlace` (`:12`) and of
  `GO_DEFAULT_DEPARTURE_PLACE` (`:25`).
- Delete the `departureDefaults` function and its JSDoc whole, `:56-95`
  (the two small helpers immediately above it, `placeOf` at `:44-46` and
  `writePlace` at `:48-54`, are used **only** by `departureDefaults` — verified
  by reading the file — so they go with it, not left as unused exports).
- In `selectVehicleBoth` (`:167-200`):
  - Delete the `departureDefaults([], null, null, selectedProvinceName)` spread
    at `:198` and the six-line comment immediately above it explaining why it
    is gated on `needDep` (`:189-197`).
  - Delete the two lines that reset the applied-default trackers,
    `goAppliedDeparturePlace: null, returnAppliedDeparturePlace: null,`
    (`:187-188`) — the fields they reset no longer exist (D-S1.3).
  - `departureLocations: []` at `:186` stays: switching vehicle still clears
    both directions' places, it just no longer refills either with a guess.
- In `selectProvince` (`:202-216`): delete the whole conditional spread that
  calls `departureDefaults(tab.departureLocations, tab.goAppliedDeparturePlace,
  tab.returnAppliedDeparturePlace, provinces.find(...)?.nameTh ?? null)`
  (`:205-214`), including its explanatory comment. `selectProvince` becomes
  `onChange({ provinceId: id })` and nothing else.
- Delete `selectedProvinceName` (`:157`) — verified by grep it has exactly one
  other reference in the file, the call site just removed above; once that
  call site is gone it is unused.
- The ORS province auto-detect callback, `onProvinceDetected` inside
  `WorkLocationList`'s props (`:315-330`), is **not edited** — it still calls
  `selectProvince(match.id)` at `:329` when it recognizes a province from a
  work-location search result, and `selectProvince` still needs to update
  `provinceId`. It simply no longer has a departure default to propagate
  through that call, which was always implicit (it never called
  `departureDefaults` directly — `selectProvince` did, on its behalf).

**Edit `src/features/travel-booking/hooks/useTravelBookingForm.ts`:**

- Delete the two field declarations and their JSDoc from `TabFormState`,
  `:82-89`:
  ```
  /**
   * What the จุดขึ้นรถ default last wrote into each direction, so a province
   * change can tell its own earlier fill apart from a place the requester
   * typed. UI-only — `buildSaveInput` never sends it. See
   * `../lib/departure-default.ts`.
   */
  goAppliedDeparturePlace: string | null;
  returnAppliedDeparturePlace: string | null;
  ```
- Delete their initialization in `emptyTab()`, `:132-133`
  (`goAppliedDeparturePlace: null, returnAppliedDeparturePlace: null,`).
- Delete their initialization in `tabFromRequest()`, `:181-184` — including the
  comment explaining why they load as `null` on a resumed draft, which no
  longer applies once the fields are gone:
  ```
  // Null on purpose: a saved place is the requester's, whatever first wrote
  // it, so a province change on a resumed draft must leave it alone.
  goAppliedDeparturePlace: null,
  returnAppliedDeparturePlace: null,
  ```
- `buildSaveInput` (`:196-237`) needs no edit — it never referenced either
  field.
- The client validator (`:310-315`) needs no edit (D-S1.2).

**No edit to `TransportSection.tsx`.** The required-field star
(`requiredStar` at `:58`, inside the `needsDeparture` block `:55-67`) and the
`OrsPlaceField` it wraps are unchanged; the field simply now opens with
`value={null}` (rendered by `OrsPlaceField` as an empty input,
`OrsPlaceField.tsx:41`, `useState(value ?? "")`) instead of a filled-in guess.

**Pre-existing looseness this spec does not touch, but an implementer will
notice:** `TransportSection` renders the field whenever the *selected
vehicle's* `needsDepartureLocations` flag is true (`:37`,
`!!vehicle?.needsDepartureLocations`), while both validators gate on the
*persisted* `goNeedsDepartureLocations`/`returnNeedsDepartureLocations` flags,
which `selectVehicleBoth` sets to `!!(v?.needsDepartureLocations &&
v.places.length)` (`TravelBookingTab.tsx:169`). A vehicle configured with the
flag on but zero admin-configured places therefore shows the field but never
requires it — that gap predates this change, this spec does not close it, and
removing the default does not make it any wider or narrower.

**CLAUDE.md — replace the paragraph at line 493** (found by searching for
"จุดขึ้นรถ", the only match in the file) with:

> - **จุดขึ้นรถ/ขึ้นเครื่อง has no default, since 2026-08-31.** It used to
>   pre-fill ขาไป with `กรุงเทพมหานคร` and ขากลับ with the province being
>   travelled to; both guesses are gone (`src/features/travel-booking/lib/
>   departure-default.ts` deleted along with its test file and the two
>   `TabFormState` fields — `goAppliedDeparturePlace` /
>   `returnAppliedDeparturePlace` — that existed only to track it). Every
>   requester now types both directions by hand. **The field is exactly as
>   required as before** — removing the default is not the same change as
>   making the field optional, and nobody has made that second change: the
>   client validator (`useTravelBookingForm.ts:310-315`) and the server
>   validator (`request-service.ts:1047-1058`) are untouched, and both still
>   gate on the vehicle's persisted `goNeedsDepartureLocations` /
>   `returnNeedsDepartureLocations` flags, not on whether a default was ever
>   written.

## Tests (what must be asserted, and which of them need a source-reading guard test)

- **Deleted, not replaced:** `departure-default.test.ts`'s 8 cases tested
  `nextDeparturePlace`, which no longer exists. There is no pure function left
  to unit-test in its place — "write nothing" is the whole feature now, and
  that has no interesting cases (an empty string is an empty string).
- **No new test is needed for D-S1.2**, because the two validators it protects
  are unedited by this spec and already have no test file of their own today —
  verified by globbing `src/features/travel-booking/hooks/*.test.ts` and
  `src/features/travel-booking/components/*.test.ts*`: neither exists. If the
  requirement rule is ever loosened later, the review for *that* change is
  where it should be caught; this spec does not touch the rule, so it does not
  need to newly guard it.
- **No source-reading guard test applies here.** That pattern (e.g.
  `settings-tabs.test.ts:224-260`'s check that every settings handler calls
  its gate as its first `await`) exists to keep an authorization rule from
  drifting silently across many call sites. This change has no authorization
  surface — it deletes a pure UI helper and two dead fields — so there is
  nothing analogous to guard.
- **Manual verification after the edit** (`npm run typecheck` and `npm test`
  are the automated half): open ข้อ13 on a fresh trip, confirm both fields are
  blank on load, pick a vehicle that needs departure locations, confirm they
  are still blank, and confirm submit is refused with the existing Thai
  message when either is left empty.

## Hazards (ranked, each with the concrete failure it causes)

1. **Deleting the default is silently reinterpreted as deleting the
   requirement.** The two changes look adjacent in the diff (both touch
   ข้อ13) but are unrelated in effect — see D-S1.2. Concrete failure: an
   implementer, seeing the field is now blank by default, "helpfully" also
   relaxes `request-service.ts:1047-1058` or the client mirror so an empty
   trip submits, and the Admin desk starts receiving bookings with no
   departure point to book against.
2. **`selectedProvinceName` is left behind as an unused variable.** It has
   exactly one other use in the file (the deleted `departureDefaults` call at
   `:198`) — verified by grep — so leaving the declaration in after removing
   its only consumer is a lint/dead-code smell, not a runtime bug, but a
   careless diff can miss it since it sits several lines away (`:157`) from
   every edit site.
3. **`placeOf`/`writePlace` are removed along with `departureDefaults` without
   checking they have no other caller.** Verified in this session (read the
   whole file) that they do not, but a future re-read after other AP-17 work
   has landed on top of this file should re-check before assuming that still
   holds — these are file-local (not exported), so a stale assumption cannot
   silently break another file, only fail to compile.
4. **CLAUDE.md is left describing removed behavior.** Lowest-severity because
   it costs a future reader time, not correctness, but CLAUDE.md is
   explicitly the first file this repository tells an implementer to read
   (see this spec's own sourcing instructions and the file's own front
   matter) — a stale paragraph here is read before any code that would
   contradict it.

## Deployment (migration order, what must be applied before the code, what to verify after)

No migration, no database change, no environment variable. This is a
client-side deletion deployed exactly like any other UI change: land the code,
`next build`, ship. There is nothing to sequence relative to it and no
before/after database check to run. The one thing to verify post-deploy is the
manual check under Tests — the fields render blank and the existing submit
refusal still fires.

## Out of scope (what this spec deliberately does not do, and which spec does it)

- **Making either field optional.** Explicitly not this change — D-S1.2.
- **Worldwide places, foreign countries, or the province field's future.**
  This spec is change 3 of the five-change AP-17 worldwide-travel brief
  surveyed in `ap17-survey.md`; changes 1 (country picker), 2 (worldwide ORS
  search + `TravelProvince` widening), 4 (brand-scoped approver access) and 5
  (per-country per diem) are separate specs, none of which this spec's
  deletion depends on or blocks — the survey's own dependency analysis (its
  §C) lists change 3 as independent of the other four in both directions, and
  nothing read in this session contradicts that.
- **Any change to `AccTravelDepartureLocation`'s schema, or to what
  `TransportSection` renders the field on.** Both stay exactly as they are —
  see Schema and the "pre-existing looseness" note under UI.
- **A smarter default** (e.g. the requester's HR office, or their last trip's
  departure point). Not proposed, not requested — the brief is to remove the
  guess, not to improve it.
