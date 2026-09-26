import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **The host picker lists somebody else's requests, and this pins what it may
 * say about them.**
 *
 * AP-17 package E, spec §6: listing another person's requests is new reach in
 * this application, and the endpoint returns *only* the running number, the
 * travel dates and the work location — "not the amount, not the attachments,
 * not the ID card". The failure to catch is a **field arriving by
 * inheritance**: somebody widens a column list, reuses the detail read shape,
 * or adds a key to the row type, and nothing anywhere goes red because the new
 * field is perfectly valid data that simply should not leave the building.
 *
 * Source-reading, and it has to be: `room-share-service.ts` reaches
 * `getAccPool()` → `@/lib/db/mssql` → `@/env`, which validates the whole
 * environment at import time and throws in a test run. Nothing here can be
 * imported, so nothing here can be tested behaviourally. The same constraint
 * `perdiem-source-guard.test.ts` and `booking-brand-scope-guard.test.ts`
 * already work under.
 *
 * ## Mutation-verified, 2026-09-22
 *
 * Because a guard nobody has tried to defeat is a guard nobody knows the
 * strength of, and this branch has already shipped two that were green against
 * six real regressions each. Each of these was applied to the source and the
 * suite re-run; every one went red, and the tree was confirmed clean
 * afterwards:
 *
 * 1. `r.TotalAmount` appended to `HOST_DISPLAY_COLUMNS` → red ("the picker's
 *    display columns are exactly…").
 * 2. `totalAmount: number;` added to `HostCandidateRow` → red ("…returns
 *    exactly the fields spec §6 allows").
 * 3. `SELECT ${HOST_DISPLAY_COLUMNS}` rewritten to `SELECT r.*` → red, twice
 *    over (the no-`SELECT *` test and the interpolation test).
 * 4. the `authorizeAccRequest` gate deleted from the hosts route → red.
 * 5. the gate moved to *after* `loadHostableRequests` → red.
 * 6. a new `export async function loadHostFullDetail` added → red ("the
 *    service exports exactly…"), which is the arm that catches a wide reader
 *    arriving beside the narrow one rather than inside it.
 *
 * ## Re-verified after the 2026-09-22 rework — fifteen more trials, one GREEN
 *
 * Browsing lost its object gate and the write moved into the tab's own save,
 * so most of the arms below now guard a *different* property from the one they
 * were written for. Each was re-attacked rather than assumed to still bite.
 * Every trial was applied as a literal replacement, the file re-run, the tree
 * restored from a `cp` backup and the restore confirmed by hash — identical
 * each time.
 *
 *  7. `requireAuth` deleted from the hosts route → **red**.
 *  8. `requireAuth`'s refusal computed but not returned → **red**. Separate
 *     from 7 because that is the arm 7 would pass without.
 *  9. `await applyRoomShareSelection(tx, {` removed from `saveTravelBookingDraft`
 *     → **red**. With no attach endpoint, this call IS the feature.
 * 10. `!== undefined` relaxed to a truthiness test, collapsing "absent" into
 *     "clear it" → **red**. That mutation deletes a binding on an ordinary save.
 * 11. a `POST` handler added back to the binding route → **red**.
 * 12. the hosts route importing `applyRoomShareSelection` → **red**.
 * 13. `{ lock: true }` → `{ lock: false }` on the save's candidate re-read →
 *     **red** (M13's own argument, unchanged; only its host function moved).
 * 14. `canAttach(guestAfterClear, host)` → `canAttach(guest, host)` → **red**.
 *     That reverts "changing your mind" to a `guest_has_host` refusal.
 * 15. `guestAfterClear` widened to also blank `hostsFor` → **red**. It would
 *     disable the one-hop check on exactly the replacement path.
 * 16. `hostHasBeenFiled` dropped from `loadHostByRequestNo` → **red**.
 * 17. `getAccPool()` called inside `applyRoomShareSelection` → **red**.
 * 18. **`tx.commit()` spelled through a cast — MEASURED GREEN.** The arm read
 *     `body.indexOf("tx.commit()") === -1`, and
 *     `await (tx as unknown as { commit: … }).commit()` contains no such
 *     substring. Closed by matching `/\.\s*commit\s*\(/`, which no rename or
 *     cast can dodge, and re-run: red, as is a plain `tx.commit()` and a
 *     `begin()` beside it.
 * 19. a field spread beside `{ ok: true, data }` → **red**.
 * 20. a second `ok: true` response added → **red**.
 * 21. a `SELECT r.*` string introduced into the route → **red**, twice over.
 * 22. `HostLookupResult` un-exported, and `loadHostByRequestNo` renamed →
 *     **red** (the export list, and the per-site rule list).
 * 23. `requireEditableGuest` dropped from the save path → **red**.
 *
 * ## Re-verified after the 2026-09-23 widening — seven more trials, none green
 *
 * The shape went from five fields to nine on the user's explicit decision, so
 * the two allow-lists changed and the forbidden list lost two entries.
 * **An allow-list that has just been edited is exactly the one nobody has
 * tried to defeat since**, which is why these were run rather than assumed.
 * Same harness as above: `cp` backup, literal replacement, re-run, restore,
 * hash compared.
 *
 * Trials 24 and 25 were run **twice**, because the work locations' pin was
 * argued out of the shape and then back into it inside this same round —
 * `validateTravelBookingTab` refuses an unpinned place, so bare names were
 * the broken answer rather than the narrow one. Both spellings are recorded,
 * because the pair is the useful part: the allow-lists bit in **both**
 * directions.
 *
 * 24. **First pass**, while the shape was `string[]`: `w.Lat, w.Lng` appended
 *     to `HOST_LOCATION_COLUMNS` → **red**, twice over (the column list, and
 *     the forbidden list those two then sat on). **Second pass**, after the
 *     reversal: `w.Lat, w.Lng` *removed* → **red** on the column list. A
 *     narrowing here is silent in every other way — the guest's submit is
 *     what fails, one screen and one save later.
 * 25. **First pass**: `workLocations` widened from `string[]` to objects
 *     carrying `lat`/`lng` → **red**. **Second pass**, after the reversal:
 *     narrowed back to `string[]` → **red**. The types half of the field
 *     allow-list is what catches both; a name-only list would have called
 *     either unchanged.
 * 26. `t.AccommodationName` appended to `HOST_DISPLAY_COLUMNS` → **red**,
 *     twice over. Worth running because the `clearGuestOwnAccommodation`
 *     carve-out strips an identifier containing "Accommodation", and this
 *     proves the carve-out is still exactly that identifier.
 * 27. `HOST_DISPLAY_COLUMNS` rewritten as a `"…" + "…"` concatenation →
 *     **red**. `columnsOf` reads one double-quoted string, so a
 *     concatenation would have left every column after the `+` unchecked —
 *     which is why the constant carries a comment saying to keep it one
 *     literal however long it grows.
 * 28. `r.TotalAmount` added to the display columns but not to the emitted
 *     shape → **red**, twice. A column read and dropped is where a later
 *     mapping picks a field up for free.
 * 29. `staffId` removed from `HostCandidateRow` with its column left in place
 *     → **red**. The other direction of 28.
 * 30. `export async function loadHostFullDetail` added beside the narrow
 *     readers → **red** (the export list) — re-run because that arm's list
 *     was not touched this round and a stale allow-list is the one that
 *     quietly stops meaning anything.
 * 31. `hasUsablePin` dropped from `room-share-prefill.ts`, so an unpinned
 *     place is copied into the guest's tab → **red** in
 *     `room-share-prefill.test.ts`. Recorded here rather than there because
 *     it is the behavioural half of this file's decision about the shape: the
 *     columns are carried so that the prefill can be selective, and a prefill
 *     that is not selective makes carrying them pointless.
 *
 * ## The 2026-09-26 widening — a TENTH field, and it is display data about
 * SOMEBODY ELSE'S guest, not about the host
 *
 * Rule 2: a host already chosen by somebody must not be choosable again, and
 * the picker must say who took it (migration 165's own header carries the
 * full history of that reversal against spec §8). `takenByMessage` is
 * `canHost`'s own "host_taken" sentence, carried verbatim — never re-worded
 * on this side, the same discipline the route-level `notice` field already
 * follows — and it is `null` for every host nobody has attached to, which is
 * the overwhelming majority of rows. The field test below is updated for it;
 * so is "hostability is decided by canHost, not re-expressed as SQL", because
 * a plain `canHost(candidate) !== null` filter can no longer tell "admit"
 * from "show disabled" apart — the listing now holds the refusal and reads
 * its `code`, and the assertion follows that shape rather than the literal
 * text it used to match.
 */

const ROOT = process.cwd();
const SERVICE = path.resolve(ROOT, "src/lib/acc/travel-booking/room-share-service.ts");
const SHARE_ROUTE = path.resolve(
  ROOT,
  "src/app/api/request/travel-booking/room-share/[guestRequestId]/route.ts",
);
const HOSTS_ROUTE = path.resolve(
  ROOT,
  "src/app/api/request/travel-booking/room-share/hosts/route.ts",
);
/** Where the binding is actually written, since there is no attach endpoint. */
const SAVE_SERVICE = path.resolve(ROOT, "src/lib/acc/travel-booking/request-service.ts");

/** Source with comments removed — this guard's own prose must never satisfy it. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A top-level function's body, from its declaration to the next top-level
 * declaration.
 *
 * Deliberately **not** "to the next line starting with `}`", which is the
 * obvious version and is wrong here: a function whose parameter is an inline
 * object type closes it with `}): Promise<…> {` in column 0, so that version
 * returns the signature and calls every assertion about the body vacuously
 * true. Measured on `attachRoomShare` while writing this file.
 *
 * Fail-closed: a declaration this cannot find is an assertion failure, never
 * an empty string quietly satisfying whatever is asked of it.
 */
function bodyOf(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found — has it been renamed?`);
  const re = /^(?:export\s+)?(?:async\s+)?(?:function|const|interface|type)\s+[A-Za-z_]/gm;
  let end = src.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > start) {
      end = m.index;
      break;
    }
  }
  assert.ok(end > start + decl.length, `could not find the end of ${decl}`);
  return src.slice(start, end);
}

/**
 * A top-level interface's fields as `name: type`, in order.
 *
 * **Types, not names alone**, and that is not tidiness. `workLocations`
 * carries `{ name; lat; lng }`, a shape this feature arrived at by measuring
 * (see the field list below); widened to carry the phone number of the hotel,
 * or narrowed back to `string[]`, it keeps its field name either way and a
 * name-only allow-list would call both unchanged. One of those two directions
 * ships something nobody asked for and the other silently breaks the guest's
 * submit; the types are what tell either of them from the shape that is here.
 */
function interfaceFields(src: string, name: string): string[] {
  const m = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  assert.ok(m, `interface ${name} not found — has it been renamed?`);
  const fields: string[] = [];
  for (const line of m![1].split("\n")) {
    const f = /^\s*([A-Za-z_][A-Za-z0-9_]*\s*\??\s*:\s*.+?);\s*$/.exec(line);
    if (f) fields.push(f[1].replace(/\s+/g, " ").trim());
  }
  return fields;
}

/** Every `alias.Column` token inside a SQL column-list constant. */
function columnsOf(src: string, constName: string): string[] {
  const m = new RegExp(`const ${constName}\\s*=\\s*"([^"]*)"`).exec(src);
  assert.ok(m, `${constName} not found, or no longer a plain double-quoted string`);
  return m![1]
    .split(",")
    .map((c) => c.trim())
    // `t.Id AS TravelBookingId` → `t.Id`; the alias is not another column.
    .map((c) => c.split(/\s+/)[0])
    .filter((c) => c.length > 0);
}

/* ─────────────────────────── the emitted shape ─────────────────────────── */

/**
 * The whole point — **and the list moved on 2026-09-23, on the user's explicit
 * decision, from five fields to nine.**
 *
 * Spec §6 named three facts and `requestId`, the handle the picker posts back.
 * Every brief on this feature said "do not add a sixth without asking"; the
 * user was asked, was told in plain terms that it lets any authenticated
 * employee read who went where, when, why and what the work was for any AP-17
 * request by walking sequential running numbers, and said yes. So this list
 * grew by design, and it must still be **a list** rather than a shape that
 * drifts:
 *
 * - `staffId` — the host's identity, so a request found on the ระบุเลขที่คำขอ
 *   tab renders a name and an avatar instead of "เพื่อนร่วมงาน" beside a blank
 *   circle (point 2). **The id alone**; the name and the photograph come from
 *   the `requireAuth` roster search the picker already calls;
 * - `brandCode`, `reasonId`, `reasonCustomText`, `workDetail` — the trip
 *   fields `room-share-prefill.ts` fills the guest's own tab in from, where
 *   the guest has not filled them in themselves (point 3).
 *
 * What did **not** move is the exclusions, each of which was argued on its own
 * merits and none of which is inertia: no amount, no attachments, no ID card,
 * no per-diem figures.
 *
 * **`workLocations` gained its pin in the same round, and that one was argued
 * out before it was argued in.** Bare names are the narrower answer and the
 * broken one: since 2026-09-01 `validateTravelBookingTab` refuses a submit
 * whose work location is unpinned, so a name copied into the guest's tab
 * without its coordinates produces a field that looks filled in, cannot be
 * submitted, and names Google Maps at a requester who never typed it. The pin
 * is part of สถานที่ไปปฏิบัติงาน rather than a fact beside it. The `types`
 * half of this assertion is what bounds it to exactly `{ name; lat; lng }` —
 * widened to carry, say, the place's phone number, the field name would be
 * unchanged and a name-only allow-list would say nothing.
 */
test("HostCandidateRow returns exactly the fields the user's decision allows, and no others", () => {
  assert.deepEqual(interfaceFields(code(SERVICE), "HostCandidateRow"), [
    "requestId: number",
    "requestNo: string | null",
    "departDate: string | null",
    "returnDate: string | null",
    // The name AND the pin (migration 135). The picker does not draw a map;
    // the guest's SUBMIT is what needs the coordinates — see this test's
    // docblock for the measurement that reversed the original decision.
    "workLocations: { name: string; lat: number | null; lng: number | null }[]",
    // 2026-09-23, points 2 and 3. See this test's docblock.
    "staffId: number | null",
    "brandCode: string | null",
    "reasonId: number | null",
    "reasonCustomText: string | null",
    "workDetail: string | null",
    // 2026-09-26, rule 2: a host already taken must be shown, disabled, with
    // canHost's own reason — never simply dropped from the list. `null` for
    // a host nobody has attached to.
    "takenByMessage: string | null",
  ]);
});

/**
 * `RoomShareView` is what a guest is told about their own binding, and it must
 * not become a second, wider shape for the same host. Its `host` is typed as
 * `HostCandidateRow` precisely so the test above governs it too.
 */
test("RoomShareView adds only the binding itself, and reuses HostCandidateRow for the host", () => {
  const src = code(SERVICE);
  assert.deepEqual(interfaceFields(src, "RoomShareView"), [
    "guestRequestId: number",
    "hostStaffId: number | null",
    "host: HostCandidateRow",
  ]);
  assert.match(
    src,
    /host\s*:\s*HostCandidateRow\s*;/,
    "RoomShareView.host must stay typed as HostCandidateRow — an inline object type here " +
      "would be a second host shape the field allow-list above does not police",
  );
});

/* ─────────────────────────── the columns behind it ─────────────────────────── */

/**
 * One column per emitted field and nothing else — the other half of the test
 * above, and the half that catches a column read for a *reason* rather than
 * for a field. The two lists are asserted separately because they fail
 * separately: a column here with no field there is a value fetched and
 * dropped, which is where a later mapping picks it up for free.
 *
 * `HOST_LOCATION_COLUMNS` carries `w.Lat, w.Lng` beside `w.Name` since
 * 2026-09-23, and must keep carrying them: `room-share-prefill.ts` copies a
 * place into the guest's tab only when `hasUsablePin` admits it, so a name
 * arriving without its pin is a place the prefill silently drops and the
 * requester re-types — the work the prefill exists to save.
 */
test("the picker's display columns are exactly the nine the response needs", () => {
  const src = code(SERVICE);
  assert.deepEqual(columnsOf(src, "HOST_DISPLAY_COLUMNS"), [
    "r.Id",
    "r.RequestNo",
    "r.StaffId",
    "r.BrandCode",
    "t.DepartDate",
    "t.ReturnDate",
    "t.ReasonId",
    "t.ReasonCustomText",
    "t.WorkDetail",
  ]);
  assert.deepEqual(columnsOf(src, "HOST_LOCATION_COLUMNS"), [
    "t.RequestId",
    "w.Name",
    "w.Lat",
    "w.Lng",
  ]);
});

/**
 * The admission read is a SEPARATE query on purpose, and its columns are
 * separately bounded: it feeds `canHost`, never the response. Widening it is
 * not a leak on its own — nothing maps it into a row — but it is the first half
 * of one, and it is where a `SELECT *` would look harmless.
 */
test("the admission columns stay the four canHost needs", () => {
  assert.deepEqual(columnsOf(code(SERVICE), "CANDIDATE_COLUMNS"), [
    "r.Id",
    "r.RequestNo",
    "r.Status",
    "t.NeedsRoomBooking",
  ]);
});

test("nothing in the room-share service selects *", () => {
  for (const file of [SERVICE, SHARE_ROUTE, HOSTS_ROUTE]) {
    assert.ok(
      !/SELECT\s+(\w+\.)?\*/i.test(code(file)),
      `${path.basename(file)} contains a SELECT * — the picker's shape must come from an ` +
        "explicit column list, which is how a field nobody intended to expose arrives",
    );
  }
});

/**
 * `loadHostDisplayRows` is the only function that builds a `HostCandidateRow`,
 * so every `SELECT` inside it must come from one of the two constants above.
 * A hand-spelled column list here would be a second, unpoliced source of the
 * response — the exact failure `perdiem-source-guard.test.ts` records having
 * been measured on its own subject.
 */
test("every SELECT that feeds the response interpolates a checked column list", () => {
  const body = bodyOf(code(SERVICE), "async function loadHostDisplayRows");
  const selects = body.match(/SELECT[^\n]*/gi) ?? [];
  assert.ok(selects.length >= 2, "expected the display read and the work-location read");
  for (const s of selects) {
    assert.match(
      s,
      /SELECT\s+\$\{HOST_(DISPLAY|LOCATION)_COLUMNS\}/,
      `loadHostDisplayRows spells a column list out instead of interpolating one: ${s.trim()}`,
    );
  }
});

/**
 * Defence in depth, and the stronger half of it: a column the service never
 * *reads* cannot be emitted however the mapping is later rewritten. These are
 * the AP-17 fields spec §6 names, plus the neighbours a careless join would
 * bring with them.
 */
test("the service never names a column the picker must not carry", () => {
  /* ONE carve-out, and it is deliberately the narrowest possible shape.
     `clearGuestOwnAccommodation` (final review I1) is a WRITE to the guest's
     OWN `AccTravelBooking` row, not a read of a colleague's — the invariant
     "a guest books nothing themselves", which until then lived only in a
     React state patch. This list is about what the picker may carry out of
     somebody else's request, and a file-wide `indexOf` cannot tell a write
     from a read.

     So the identifier is stripped — the EXACT identifier, and only after
     asserting it appears exactly twice (the import and the single call), so
     the carve-out cannot quietly grow. Every other occurrence of
     "Accommodation" in this file, `t.AccommodationName` in a SELECT column
     list very much included, still trips the ban below. Renaming the helper
     to dodge the substring was the alternative and was rejected: it would
     leave this list looking intact while meaning less. */
  const raw = code(SERVICE);
  const permitted = raw.match(/clearGuestOwnAccommodation/g) ?? [];
  assert.equal(
    permitted.length,
    2,
    `clearGuestOwnAccommodation appears ${permitted.length} times in room-share-service.ts, ` +
      "not the import plus one call. The carve-out below is sized to exactly those two — a " +
      "third occurrence is a new use nobody has argued for, and it must be argued for here",
  );
  const src = raw.split("clearGuestOwnAccommodation").join("");
  /* **`BrandCode` and `WorkDetail` came OFF this list on 2026-09-23** — they
     are two of the five trip fields the user asked the picker to fill the
     guest's tab in from, so naming them is now the feature rather than a
     leak. They are the only two that moved, and the rest of the list is
     unchanged: the exclusions below were each argued on their own merits, and
     the decision to widen was about *these five fields*, not about the
     principle of the list.

     **`Lat` and `Lng` were added to this list in the same round and taken
     straight back off, and that reversal is the useful part of the record.**
     Bare names look like the narrower answer. They are the broken one: since
     2026-09-01 `validateTravelBookingTab` refuses a submit whose work
     location is unpinned, so a name copied into the guest's tab without its
     coordinates produces a field that looks filled in, cannot be submitted,
     and names Google Maps at a requester who never typed it. The pin is part
     of สถานที่ไปปฏิบัติงาน rather than a sixth fact beside it. What bounds it
     instead is the *shape* assertion above — `{ name; lat; lng }` and nothing
     more — and `room-share-prefill.ts` copying a row only when
     `hasUsablePin` admits it. */
  const forbidden = [
    "TotalAmount",
    "ForeignAmount",
    "ExchangeRate",
    "PerDiem",
    "AllowanceSnapshot",
    "PaymentDate",
    "Phone",
    "Notes",
    "CompanyName",
    "ManagerStaffId",
    "ManagerEmail",
    "Requester",
    "AccRequestFile",
    "AccTravelBookingDetail",
    "IdCard",
    "Accommodation",
  ];
  for (const column of forbidden) {
    assert.ok(
      src.indexOf(column) === -1,
      `room-share-service.ts names "${column}". The picker answers the nine fields listed at ` +
        "the top of this file and nothing else — if this column is genuinely needed, that is a " +
        "decision for the user, whose 2026-09-23 widening is the only reason the list is nine " +
        "rather than five, not a change to this list",
    );
  }
});

/* ─────────────────────────── the endpoint's gate ─────────────────────────── */

/**
 * **Browsing lost its object gate on 2026-09-22, and that was the user's call,
 * made twice.** The endpoint used to take the caller's own request id in its
 * path and authorize `authorizeAccRequest(…, "mutate", AP-17)` against it,
 * which forced the requester to save a draft before they could so much as
 * look. It is now `requireAuth`, so any authenticated employee can list a
 * colleague's hostable requests and look one up by running number.
 *
 * What survives is the floor under it: **it is not anonymous, and the refusal
 * is RETURNED rather than merely computed.** A `requireAuth` whose result is
 * dropped compiles, type-checks and reads almost identically — the exact shape
 * of regression `approvals-route-authz-guard.test.ts` and
 * `erp-queue-route-authz-guard.test.ts` were both written after measuring a
 * green suite against.
 */
test("the hosts endpoint authenticates, and returns the refusal, before it reads", () => {
  const src = code(HOSTS_ROUTE);
  const gate = src.indexOf("await requireAuth()");
  assert.notEqual(
    gate,
    -1,
    "the hosts endpoint no longer calls requireAuth — browsing colleagues' AP-17 running " +
      "numbers, dates and work locations would be open to anybody at all, which is a long way " +
      "past the widening that was actually decided",
  );
  assert.match(
    src.slice(gate),
    /^await requireAuth\(\);\s*if \(session instanceof Response\) return session;/,
    "requireAuth's refusal must be returned immediately, not computed and dropped",
  );

  for (const reader of ["await loadHostableRequests(", "await loadHostByRequestNo("]) {
    const read = src.indexOf(reader);
    assert.notEqual(read, -1, `${reader} is no longer called — has it been renamed?`);
    assert.ok(gate < read, `requireAuth must run BEFORE ${reader}`);
  }
});

/**
 * **The write kept the gate the read gave up, and this is where that is
 * pinned.** Browsing and attaching were split deliberately: listing five
 * fields about a colleague's trip is one thing, binding two people's documents
 * together is another, and only the second still demands an owned, editable
 * request.
 *
 * There is no attach endpoint any more, so the assertion has to follow the
 * write to where it went — `saveTravelBookingDraft`, whose own route is
 * `authorizeAccRequest(…, "mutate", AP-17)` and which re-asserts
 * creator-and-`Draft`/`Returned` per tab before this runs.
 */
test("the binding is written from the group save, and nowhere else", () => {
  const save = code(SAVE_SERVICE);
  assert.ok(
    save.indexOf("await applyRoomShareSelection(tx, {") !== -1,
    "saveTravelBookingDraft no longer applies the room-share selection on its own transaction. " +
      "Picking a host is tab state now; if the save stops persisting it, the choice silently " +
      "never happens — and if it is moved off `tx`, the binding can commit while the trip it " +
      "belongs to does not",
  );
  for (const routeFile of [SHARE_ROUTE, HOSTS_ROUTE]) {
    assert.ok(
      code(routeFile).indexOf("applyRoomShareSelection") === -1,
      `${path.basename(path.dirname(routeFile))}/route.ts writes the binding directly. Two paths ` +
        "that both bind two people's documents are two places for the one-hop invariant to be " +
        "got wrong — and this one has no group transaction around it",
    );
  }
});

/**
 * **`undefined` and `null` must not collapse**, and the cost of collapsing them
 * is a binding deleted on an ordinary save of a tab nobody touched.
 * `roomShareHostFieldFor` answers `undefined` for a tab that believes it is a
 * guest but cannot name its host; a truthiness test here would read that as
 * "clear it".
 */
test("an absent host field leaves the stored binding alone", () => {
  const save = code(SAVE_SERVICE);
  assert.match(
    save,
    /if \(tab\.roomShareHostRequestId !== undefined\) \{/,
    "the save no longer distinguishes an ABSENT roomShareHostRequestId from an explicit null. " +
      "Absent means leave the stored row alone; null means delete it. Collapsing them deletes a " +
      "binding the requester never touched, on a save that changed something else entirely",
  );
});

test("the binding route reads only — there is no attach or detach endpoint", () => {
  const src = code(SHARE_ROUTE);
  const use = src.indexOf("await loadRoomShare(");
  assert.notEqual(use, -1, "loadRoomShare is no longer called from the route");
  const gate = src.slice(0, use).lastIndexOf("await authorizeAccRequest(");
  assert.notEqual(gate, -1, "loadRoomShare is reached without authorizeAccRequest above it");
  assert.match(
    src.slice(gate, use),
    /authorizeAccRequest\(\s*session,\s*guestRequestId,\s*"read"/,
    'loadRoomShare must be gated with authorizeAccRequest(..., "read", AP17_FORM_CODE)',
  );
  assert.match(
    src.slice(gate, use),
    /if \(gate instanceof Response\) return gate;/,
    "loadRoomShare's gate refusal must be returned",
  );

  for (const verb of ["POST", "DELETE", "PUT", "PATCH"]) {
    assert.ok(
      !new RegExp(`export async function ${verb}\\b`).test(src),
      `a ${verb} handler is back on the room-share route. The binding is written by the tab's ` +
        "own save, inside the transaction that writes the rest of the trip — a second writer " +
        "here would re-open the shape that forced the picker to demand a saved draft, and would " +
        "have to re-implement the one-hop check, the lock and the host's notice",
    );
  }
});

/**
 * The routes must hold no SQL of their own, and must not reach for a wide
 * reader. `getTravelBookingRequest` is the detail read spec §6 names as the
 * thing this endpoint must not become.
 */
test("the routes hold no query of their own and reach for no wide reader", () => {
  for (const file of [SHARE_ROUTE, HOSTS_ROUTE]) {
    const src = code(file);
    assert.ok(
      !/\bSELECT\b/i.test(src) && !/getAccPool\s*\(/.test(src),
      `${path.basename(file)} has grown SQL of its own — every read belongs in the service, ` +
        "where the column lists above police it",
    );
    assert.ok(
      src.indexOf("getTravelBookingRequest") === -1,
      `${path.basename(file)} imports the detail read shape. That is precisely how a field ` +
        "nobody intended to expose arrives by inheritance (spec §6)",
    );
  }
});

/**
 * One success response, carrying the bare `data` the service returned.
 *
 * A second `ok: true` arm, or a spread beside `data`, is how a caller's own
 * extra field joins the payload without touching any column list.
 */
test("the hosts endpoint answers the service's rows and nothing beside them", () => {
  const src = code(HOSTS_ROUTE);
  // Counted on the RESPONSE, not on `ok: true` alone — `parseYmd` answers its
  // own `{ ok: true, value }` and is not a payload.
  const successes = src.match(/NextResponse\.json\(\{\s*ok:\s*true/g) ?? [];
  assert.equal(successes.length, 1, "the hosts endpoint has more than one success response");
  assert.match(
    src,
    /NextResponse\.json\(\{\s*ok:\s*true,\s*data\s*\}\)/,
    "the success response must be the bare `{ ok: true, data }` — anything assembled " +
      "alongside it is outside every check in this file",
  );
});

/* ─────────────────────────── the module's surface ─────────────────────────── */

/**
 * A wide reader added *beside* the narrow one is the case none of the tests
 * above would see: they police `HostCandidateRow` and the two column lists, not
 * a brand-new function with its own. Pinning the export list means such a
 * function cannot be added silently — it fails here, and whoever adds it has to
 * say what it is for.
 */
test("the service exports exactly the surface Task 4 defines", () => {
  const src = code(SERVICE);
  const found: string[] = [];
  const re = /export\s+(?:async\s+function|function|interface|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.push(m[1]);
  found.sort();
  // `attachRoomShare` and `detachRoomShare` are gone, replaced by the one
  // `applyRoomShareSelection` the tab save calls; `loadHostByRequestNo` and
  // its `HostLookupResult` are the picker's second tab (2026-09-22).
  // `claimRoomShareHostNotice` is the host notice, moved off the tab save on
  // 2026-09-23 — it reads no host row and returns nothing about one, so it
  // adds no reach for this file's own subject; it is listed because the
  // surface is pinned whole. `room-share-notify-guard.test.ts` is what
  // polices what it does. `releaseGuestShare` is rule 3's layer 1
  // (2026-09-26) — the mirror of `applyRoomShareDeath`, reacting to the
  // GUEST dying instead of the host; `room-share-cascade-guard.test.ts` pins
  // that it is actually called from every death site.
  assert.deepEqual(found, [
    "HOST_NOT_FILED_MESSAGE",
    "HostCandidateRow",
    "HostLookupResult",
    "HostSearchFilters",
    "RoomShareView",
    "applyRoomShareSelection",
    "claimRoomShareHostNotice",
    "loadGuestsOf",
    "loadHostByRequestNo",
    "loadHostableRequests",
    "loadRoomShare",
    "releaseGuestShare",
  ]);
});

/* ─────────────────────────── the cascade's loader ─────────────────────────── */

/**
 * `loadGuestsOf` is called by Task 6 from **inside** the transaction that is
 * cancelling or re-dating the host — that is the whole safety property of the
 * cascade (spec §4: if it fails, the host's own cancellation rolls back). A
 * loader that opened its own pool would read from outside that transaction and
 * miss the change it is reacting to, silently.
 */
test("loadGuestsOf takes a runner and opens no pool of its own", () => {
  const src = code(SERVICE);
  assert.match(
    src,
    /export async function loadGuestsOf\(\s*runner:\s*SqlRunner,/,
    "loadGuestsOf must take a SqlRunner (a pool OR an open transaction) as its first " +
      "parameter — the shape perdiem-dependency-load.ts already uses",
  );
  const body = bodyOf(src, "export async function loadGuestsOf");
  assert.ok(
    body.indexOf("getAccPool(") === -1,
    "loadGuestsOf opens its own pool, so the cascade would read the host's guests from " +
      "OUTSIDE the transaction that is changing the host",
  );
});

/**
 * **A list and an action that disagree about what is offerable is the whole
 * hazard here**, so every rule this module adds has to be applied at both
 * sites. `hostHasBeenFiled` is the one condition beyond `canHost`;
 * `requireEditableGuest` is the guest's own `Draft`/`Returned` rule, which
 * Task 2's `canAttach` deliberately does not test and which therefore has no
 * other home.
 */
test("the filed-host rule and the guest editability rule are applied at every site", () => {
  const src = code(SERVICE);
  const sites: [string, string[]][] = [
    ["export async function loadHostableRequests", ["hostHasBeenFiled(", "canHost("]],
    // The picker's second tab reaches ONE request by the number somebody
    // typed, so it must apply the same two admission rules the list applies —
    // or a running number becomes a way to a request the list would have
    // hidden.
    ["export async function loadHostByRequestNo", ["hostHasBeenFiled(", "canHost("]],
    // `applyRoomShareSelection` covers both of what used to be two functions:
    // it clears as well as sets, and the editability rule applies to both.
    [
      "export async function applyRoomShareSelection",
      ["requireEditableGuest(", "hostHasBeenFiled(", "canAttach("],
    ],
  ];
  for (const [decl, calls] of sites) {
    const body = bodyOf(src, decl);
    for (const call of calls) {
      assert.ok(
        body.indexOf(call) !== -1,
        `${decl.replace("export async function ", "")} no longer calls ${call} — the picker ` +
          "and the attach must apply the same rules or one of them is decoration",
      );
    }
  }
});

/**
 * **Final review I1.** "A guest books nothing themselves" (spec §1) was
 * enforced by `TravelBookingTab.tsx`'s `onAttached` patch and by nothing
 * else, so a reload between the attach and the next save restored the
 * accommodation from the server — into a grid that `isRoomShareGuest` hides,
 * where the requester could neither see nor clear it — and the next save
 * posted it back, `deriveBookingFlags` set `NeedsRoomBooking`, and
 * `approveByManager` routed the request to `ADMIN` for a room nobody needed.
 *
 * Both halves are asserted, because each fails differently: the call missing
 * is the invariant back in the browser, and the call after `tx.commit()` is
 * the binding surviving a failed clear — the same half-state, reached by a
 * crash instead of by a reload.
 */
test("the attach clears the guest's own accommodation, on the caller's transaction", () => {
  const src = code(SERVICE);
  const body = bodyOf(src, "export async function applyRoomShareSelection");
  const clear = body.indexOf("clearGuestOwnAccommodation(tx");
  assert.notEqual(
    clear,
    -1,
    "applyRoomShareSelection no longer calls clearGuestOwnAccommodation(tx, …). The guest's own " +
      "AccommodationId/NeedsRoomBooking survive the attach, the grid that would show them is " +
      "hidden, and the next save hands the Admin desk a hotel room to book for somebody who " +
      "is sharing one — a client-side state patch is not an invariant",
  );
  const insert = body.indexOf("INSERT INTO [dbo].[AccTravelRoomShare]");
  assert.notEqual(insert, -1, "the binding is no longer inserted — has it been restructured?");
  assert.ok(
    insert < clear,
    "the clear runs before the insert, so a refusal after it would leave the guest's own " +
      "accommodation withdrawn with no share to replace it",
  );
  /* **It does not commit, and must not.** The commit belongs to
     `saveTravelBookingDraft`, which is what makes the binding, the withdrawal
     of the room it replaces, the trip's own columns and the host's notice one
     atomic thing. A transaction opened here would commit the share while the
     tab that owns it might still roll back. */
  /* `.commit(` rather than `tx.commit()`: the literal spelling was **measured
     green** on 2026-09-22 against a mutation that cast `tx` and committed
     through the cast. A receiver-agnostic pattern cannot be dodged by
     renaming the variable. */
  assert.ok(
    body.indexOf("getAccPool(") === -1 && !/\.\s*commit\s*\(/.test(body),
    "applyRoomShareSelection opens a pool or commits. It takes the CALLER's open transaction — " +
      "the binding and the trip it belongs to must commit or roll back together, which is the " +
      "whole reason there is no attach endpoint any more",
  );
});

/* ═════ mutation M13 — the lock IS the one-hop invariant ═════
 *
 * **Measured GREEN on 2026-09-22.** Changing `{ lock: true }` to
 * `{ lock: false }` on the attach's candidate re-read left the suite at
 * 2211/2211, and nothing else in the repository asserts it.
 *
 * That hint is the ONLY thing serialising two concurrent attaches, and
 * therefore the only thing making "one hop" hold under a race rather than
 * merely under a sequence. Tx1 attaching B→A while Tx2 attaches C→B contend
 * on B's `AccRequest` row: whichever loses blocks until the winner commits,
 * then re-reads the share rows and sees the new binding, so `canHost`
 * refuses with `host_is_guest`. Without the hint both read the pre-attach
 * state, both pass `canAttach`, and a two-hop chain exists — which the
 * cascade is not sound for, because depth one is what makes cancellation
 * terminate.
 *
 * `UQ_AccTravelRoomShare_Guest` does NOT cover this. It stops one guest
 * having two hosts; it says nothing about a guest that is also a host, which
 * is the other direction of the same invariant and the one the chain is
 * built from.
 *
 * Asserted three ways because each fails differently: the lock is requested
 * at the attach, it is requested NOWHERE else (a pool-level `UPDLOCK` is
 * pointless contention, which is why the picker does not ask), and the hint
 * itself still spells both parts — `UPDLOCK` alone releases at statement end
 * and would leave exactly the window this closes.
 */
test("the attach re-reads its candidates under UPDLOCK, HOLDLOCK", () => {
  const src = code(SERVICE);
  const body = bodyOf(src, "export async function applyRoomShareSelection");
  assert.match(
    body,
    /loadShareCandidates\([\s\S]*?\{\s*lock:\s*true\s*\}/,
    "applyRoomShareSelection's candidate re-read no longer passes { lock: true }. That UPDLOCK, " +
      "HOLDLOCK is the ONLY thing serialising two concurrent attaches, so without it the " +
      "one-hop invariant is a plain read-then-write: two transactions both see the " +
      "pre-attach state, both pass canAttach, and a two-hop chain exists — which the cascade " +
      "is only sound at depth one for. The unique index does not help; it stops a guest " +
      "having two hosts, not a guest that is also a host",
  );
  assert.ok(
    /const lockHint = opts\?\.lock \? " WITH \(UPDLOCK, HOLDLOCK\)" : "";/.test(src),
    "loadShareCandidates' lock hint is no longer exactly ` WITH (UPDLOCK, HOLDLOCK)`. UPDLOCK " +
      "alone releases at statement end under READ COMMITTED, which reopens the very window " +
      "the hint exists to close, and a hint that is merely PRESENT is not a hint that holds",
  );
  const asked = src.match(/\{\s*lock:\s*true\s*\}/g) ?? [];
  assert.equal(
    asked.length,
    1,
    `{ lock: true } is passed ${asked.length} times in room-share-service.ts, not once. The ` +
      "picker deliberately does not ask for it — on a pool the hint is pointless contention " +
      "on other people's requests — so a second caller is either the picker having acquired " +
      "it by accident or a new write that should say why it needs it here",
  );
});

/**
 * The same three conditions in two places is how a list and an action drift
 * apart. Spec §6's "alive, not already a guest, needsRoomBooking = true" is
 * `canHost`'s, and the service must ask it rather than re-express it in SQL —
 * where the attach path could not ask the same question.
 */
test("hostability is decided by canHost, not re-expressed as SQL", () => {
  const src = code(SERVICE);
  /* Until rule 2 (2026-09-26) this was a plain `canHost(candidate) !== null`
     filter: refused meant dropped. Rule 2 needs the refusal's own reason as
     well — `host_taken` is shown (disabled) rather than dropped — so the
     listing now holds the refusal and inspects its `code`. The property this
     test polices is unchanged: hostability is still `canHost`'s decision,
     never re-expressed as SQL, which is what the loop below and the
     forbidden-string checks continue to assert. */
  assert.match(
    src,
    /const refusal = canHost\(candidate\);/,
    "loadHostableRequests no longer calls canHost(candidate) and holds its result — the listing " +
      "must decide admitted / taken / dropped from canHost's own answer, never re-derive any of " +
      "the three in SQL",
  );
  assert.match(
    src,
    /refusal\.code === "host_taken"/,
    "loadHostableRequests no longer branches on canHost's host_taken code, so rule 2 (a taken " +
      "host is shown, disabled, with the reason) has no way to tell that refusal apart from " +
      "every other one this function still drops",
  );
  /* `guestAfterClear`, not `guest`: a REPLACEMENT deletes the old row in the
     same transaction, so the question `canAttach` must answer is about the
     guest as it will be once that delete lands. Asserted by name because the
     difference between the two identifiers is the difference between
     "changing your mind is allowed" and "changing your mind is refused with
     `guest_has_host` every time". */
  assert.match(
    src,
    /canAttach\(guestAfterClear,\s*host\)/,
    "the save no longer re-checks canAttach against the guest as the delete will leave it",
  );
  assert.match(
    src,
    /const guestAfterClear: ShareCandidate =\s*\n?\s*currentHostId === null \? guest : \{ \.\.\.guest, isGuest: false \}/,
    "the replacement candidate is no longer derived from the locked read by flipping exactly " +
      "`isGuest`. Anything wider is a candidate built on something other than what the " +
      "transaction is about to commit — and `hostsFor`, the one-hop check's input, must NOT be " +
      "cleared: deleting the guest's own guest-row cannot change who is attached TO it",
  );
  for (const sqlish of ["NeedsRoomBooking = 1", "Status NOT IN", "Status <> 'Cancelled'"]) {
    assert.ok(
      src.indexOf(sqlish) === -1,
      `the service re-expresses part of canHost as SQL ("${sqlish}"), which the attach path ` +
        "cannot ask and so cannot agree with",
    );
  }
});

/* ═════════════════ rule 2 (2026-09-26) — a host has at most one guest ═════════════════ */

/**
 * **`loadShareCandidates` is the ONLY place `ShareCandidate.takenBy` is ever
 * built**, and every one of its three callers (`loadHostableRequests`,
 * `loadHostByRequestNo`, `applyRoomShareSelection`) reads it through
 * `canHost`/`canAttach` rather than a hand-rolled check — the same discipline
 * `hostsFor` and `isGuest` already have. A candidate built with `takenBy`
 * always null "because this caller only needs isGuest" would be a lie the
 * next caller inherits, exactly the failure this file's own comment already
 * names for the other two fields.
 */
test("loadShareCandidates populates takenBy from the same share-row read as hostsFor", () => {
  const body = bodyOf(code(SERVICE), "async function loadShareCandidates");
  assert.ok(
    /takenBy\.set\(\s*s\.HostRequestId\s*,/.test(body),
    "loadShareCandidates no longer records which guest currently takes each host into a " +
      "takenBy map — canHost's new host_taken refusal (rule 2) would have nothing to read, and " +
      "every host would appear available no matter how many guests actually occupy it",
  );
  assert.ok(
    /takenBy:\s*takenBy\.get\(row\.Id\)\s*\?\?\s*null/.test(body),
    "the constructed ShareCandidate no longer carries takenBy from the map above — the field " +
      "would silently read undefined/missing on every candidate this function ever builds",
  );
  // The guest's own RequestNo travels with it, because canHost's refusal must
  // NAME the request that took the host, not merely say "taken".
  assert.ok(
    /GuestRequestNo/.test(body),
    "loadShareCandidates no longer selects the guest's own RequestNo, so canHost's host_taken " +
      "message could not name the request that took the host — only that SOME request did",
  );
});

/**
 * **Rule 3, layer 2 — the defence for an unforeseen death path.** Layer 1
 * (`releaseGuestShare`, called from `recomputeAfterDeath`) deletes a dying
 * guest's own binding synchronously; this is what happens if some future
 * death path is not wired into that call — package E's own final review
 * found a *fifth* way a request dies that its spec had not listed, and an
 * unforeseen sixth must degrade to "the host is free", never "locked for
 * ever". Asserted as `DEAD.indexOf`, the exact idiom `canHost`/`canAttach`
 * and the cascade already use for "alive" — NOT a SQL predicate, which is
 * precisely what "hostability is decided by canHost, not re-expressed as
 * SQL" (above) already bans from this file.
 */
test("a dead guest's share row is excluded from isGuest, hostsFor AND takenBy alike", () => {
  const body = bodyOf(code(SERVICE), "async function loadShareCandidates");
  assert.ok(
    /DEAD\.indexOf\(\s*String\(\s*s\.GuestStatus/.test(body),
    "loadShareCandidates no longer excludes a share row whose GUEST has already died. A stale " +
      "binding left behind by an unforeseen death path would then keep the host permanently " +
      "taken, and under rule 2's UQ_AccTravelRoomShare_Host nobody could ever attach to it again",
  );
  // Structural: the exclusion must run BEFORE every map it protects, or a
  // `continue` added below one of them (rather than at the top of the loop)
  // would leave that one map still counting the dead guest.
  const deadAt = body.search(/DEAD\.indexOf\(\s*String\(\s*s\.GuestStatus/);
  const guestOfAt = body.indexOf("guestOf.set(");
  const hostsForAt = body.indexOf("hostsFor.set(");
  const takenByAt = body.indexOf("takenBy.set(");
  for (const [label, at] of [
    ["guestOf", guestOfAt],
    ["hostsFor", hostsForAt],
    ["takenBy", takenByAt],
  ] as const) {
    assert.notEqual(at, -1, `${label}.set( not found in loadShareCandidates`);
    assert.ok(
      deadAt < at,
      `the DEAD-status exclusion no longer runs before ${label} is populated, so a dead guest's ` +
        "row could still be counted there even though it is excluded elsewhere",
    );
  }
  assert.ok(
    /import\s*\{[^}]*\bDEAD\b[^}]*\}\s*from\s*["']@\/lib\/acc\/travel-booking\/room-share-policy["']/.test(
      code(SERVICE),
    ),
    "room-share-service.ts no longer imports DEAD from room-share-policy.ts — a re-spelled " +
      "['Cancelled','Rejected'] here would be an eighth definition of 'alive', which is exactly " +
      "the disagreement room-share-policy.ts's own DEAD comment warns against",
  );
});

/**
 * **The picker must not simply DROP a taken host — it must show it, disabled,
 * with the reason.** This is the behavioural half of the field test above:
 * carrying `takenByMessage` on the type is pointless if the row carrying it
 * never reaches the response.
 */
test("loadHostableRequests keeps a taken host in the list rather than dropping it", () => {
  const body = bodyOf(code(SERVICE), "export async function loadHostableRequests");
  assert.ok(
    /refusal\.code === "host_taken"/.test(body),
    'loadHostableRequests no longer branches on "host_taken" specifically — every other ' +
      "canHost refusal must still drop the row, so this is what tells the one exception apart",
  );
  assert.ok(
    /takenMessages\.set\(/.test(body),
    "loadHostableRequests no longer records the host_taken message per id, so the disabled row " +
      "the picker renders would carry no reason at all",
  );
  assert.ok(
    /takenByMessage/.test(body),
    "loadHostableRequests no longer threads a takenByMessage onto the rows it returns — the " +
      "field exists on HostCandidateRow and nothing populates it for a genuinely taken host",
  );
});

/** `releaseGuestShare` takes a runner and opens no pool of its own — the same shape `loadGuestsOf` requires, for the same reason: it is called from inside a caller-owned transaction. */
test("releaseGuestShare takes a runner and opens no pool of its own", () => {
  const src = code(SERVICE);
  assert.match(
    src,
    /export async function releaseGuestShare\(\s*tx:\s*SqlRunner,/,
    "releaseGuestShare must take a SqlRunner (a pool OR an open transaction) as its first " +
      "parameter, so the caller's own transaction is used rather than a separate connection",
  );
  const body = bodyOf(src, "export async function releaseGuestShare");
  assert.ok(
    body.indexOf("getAccPool(") === -1,
    "releaseGuestShare opens its own pool, so a guest's dying transaction could commit while " +
      "the release runs on a different connection outside it — or not at all, if the caller's " +
      "own transaction then rolls back",
  );
});
