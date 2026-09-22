import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **พักห้องเดียวกับ REPLACES choosing an accommodation, and four separate
 * files have to agree about that.** This pins the agreement.
 *
 * AP-17 package E, spec §1: a room-share guest "books nothing themselves" —
 * so a guest's `AccommodationId` is null *by design*, and the control that
 * attaches them is an alternative to the accommodation grid rather than a
 * field beside it. Nothing in the schema says so; it is four coordinated
 * decisions in TypeScript:
 *
 * | file | its half of the rule |
 * |---|---|
 * | `TravelBookingTab.tsx` | the grid is not rendered for a guest, and attaching clears what it had set |
 * | `useTravelBookingForm.ts` | `validateTab` stops demanding an accommodation from a guest |
 * | `request-service.ts` | `validateTravelBookingTab` — the real check — does the same |
 * | `RoomShareControl.tsx` | the picker, and which directory search it calls |
 *
 * Source-reading, and it has to be. Every one of these is either JSX or
 * reaches `@/env` transitively, so none of it can be imported into a
 * `node:test` run — the same constraint `perdiem-room-guard.test.ts` and
 * `room-share-response-shape-guard.test.ts` already work under, and the same
 * class of failure: **a missing arm**, which no behavioural test of the
 * surviving arms would notice.
 *
 * ## The three failures each arm exists to catch
 *
 * - **Both controls on screen at once.** A tab holding an accommodation *and*
 *   a share is a state nothing downstream knows how to price: `roomBooked`
 *   reads true from either input while the Admin desk has a room to book for
 *   somebody who is not sleeping in it.
 * - **A stale `accommodationId` surviving the attach.** The grid is gone, so
 *   the requester can neither see nor change it — and `buildSaveInput` posts
 *   it on the next save, where `deriveBookingFlags` reads it as a live answer.
 *   The same shape as the rental bug `selectVehicleBoth` clears its fields to
 *   avoid.
 * - **The two validators drifting apart.** The client alone would let a guest
 *   press ส่งคำขอ into a server refusal with no field on screen to satisfy;
 *   the server alone would leave the form permanently red on a tab the server
 *   accepts. Either way the guest cannot file at all.
 *
 * ## Why the person search is asserted by NAME
 *
 * Spec §6 says the picker reuses `/api/users/search`. **That instruction
 * cannot be followed**: measured on this branch, that route is
 * `requireRole(["IT Admin", "System Admin"])`, so an ordinary requester —
 * the entire population of this control — gets a 403 before the picker
 * renders a row. It uses `/api/request/travel-booking/requesters` instead,
 * the HR-backed search the on-behalf เปลี่ยนผู้ขอเบิก picker already calls,
 * which is `requireAuth` and answers the `staffId` the hosts endpoint takes.
 * A later reader reconciling the code with the spec would reintroduce the
 * 403, so the divergence is asserted rather than only written down.
 *
 * ## Mutation-verified, 2026-09-22 — fifteen trials, none green
 *
 * Because a guard nobody has tried to defeat is a guard nobody knows the
 * strength of, and this branch has already shipped three guards with a green
 * mutation in them. Each was applied to the source, the file re-run, and the
 * tree restored and re-verified afterwards (`npm test` 2188/2188, typecheck
 * clean).
 *
 *  1. the `!tab.isRoomShareGuest` gate around the grid replaced by `true` →
 *     **red**, 2 tests.
 *  2. **`<RoomShareControl>` moved INSIDE that conditional, props intact** →
 *     **red**, 1 test — and this is the trial that earns `balancedAfter`. The
 *     element is still in the file, still after the gate's opening line, so
 *     every index-ordering check passes while an attached guest sees no
 *     accommodation grid, no host and no way to detach.
 *  3. `<RoomShareControl>` deleted outright → **red**, 3 tests (the two
 *     `onAttached`/`onDetached` arms fail closed rather than vacuously pass,
 *     which is what `balancedAfter`'s `assert.notEqual(at, -1)` is for).
 *  4. `onAttached` stops clearing `accommodationId` → **red**.
 *  5. `onAttached` stops setting `isRoomShareGuest` → **red**.
 *  6. `onAttached` stops clearing `needsRoomBooking` → **red**.
 *  7. `onDetached` restores an accommodation → **red**.
 *  8. the submit validator's guest exemption reverted → **red**.
 *  9. `validateTab`'s guest exemption reverted → **red**.
 * 10. the person picker pointed back at `/api/users/search`, i.e. spec §6
 *     followed literally → **red**.
 * 11. the agreement line removed from inside the picker dialog, left on the
 *     attached card → **red**. The "shown at least twice" count alone would
 *     have missed the reverse of this; the in-dialog arm is separate for that
 *     reason.
 * 12. `HostCandidateRow` redeclared locally instead of imported → **red**.
 * 13. `RequesterPickerModal` renamed to a hand-rolled picker → **red**.
 * 14. the agreement line stops mentioning per diem → **red**.
 * 15. the agreement line stops mentioning the cancellation → **red**.
 *
 * ## The press saves the draft — added 2026-09-22, mutation-verified, eight trials
 *
 * The button used to be disabled on an unsaved tab, beside "กรุณาบันทึกร่างก่อน
 * จึงจะเลือกห้องพักร่วมได้". The user asked for the choice without that step;
 * pressing it now saves the draft and then opens.
 *
 * **What the two arms below are actually defending is the gate that stayed.**
 * The hosts endpoint takes the caller's *own* request id in its path and
 * authorizes `authorizeAccRequest(…, "mutate", AP-17)` against it — without
 * which any authenticated employee could enumerate any colleague's AP-17
 * running numbers, travel dates and work locations. `room-share-response-
 * shape-guard.test.ts` pins that gate at the route (its own mutations 4 and
 * 5); these pin the only reason the requester never has to meet it by hand,
 * so that a later reader who finds the picker opening against nothing reaches
 * for the save rather than for the route.
 *
 * The second arm is the half that fails quietly: a revert of the *button*
 * without the *copy*, or the reverse, leaves either a dead control explaining
 * that the system will save for you, or a live one still telling the
 * requester to go and do it themselves.
 *
 * 16. `rid = await onRequireSave()` replaced by `rid = requestId` → **red**.
 * 17. `setPersonOpen(true)` hoisted above the save → **red** (the ordering
 *     assertion; the "is it called at all" one still passes, which is why the
 *     two are separate).
 * 18. the `if (rid == null) … return` refusal branch deleted, so a failed save
 *     opens the picker anyway → **red**.
 * 19. `disabled={requestId == null}` restored on the button → **red**.
 * 20. the old "กรุณาบันทึกร่างก่อน…" copy restored → **red**.
 * 21. `loading={opening}` removed, so a press in flight shows nothing and a
 *     second press is not refused by the button → **red**.
 * 22. **`await onRequireSave()` kept but its result discarded** (`rid =
 *     requestId` after it) → **red**, and this is the trial that earns the
 *     regex over a bare `indexOf` on the call. The save still runs, so a
 *     "is it called" check passes — while `rid` stays null on exactly the
 *     tab the feature exists for, the refusal branch fires, and the picker
 *     never opens at all.
 * 23. `openPicker` renamed → **red** ("not found — has it been renamed or
 *     removed?"). `balancedAfter` fails closed rather than handing the
 *     assertions an empty region that satisfies all of them; the same
 *     property trial 3 above proved for the other marker.
 *
 * 18 was run twice: deleting the refusal branch *and* an enclosing brace reds
 * too, but unbalanced source could have redded it for the wrong reason, so it
 * was re-run as a brace-balanced deletion and the assertion message checked.
 * Every trial was applied with `sed`, the file re-run, the tree restored from
 * a `cp` backup and the restore confirmed by `md5sum` — identical each time.
 *
 * ## The rework of 2026-09-22 — seventeen more trials, one GREEN
 *
 * Picking a host stopped being a POST and became tab state, so trials 16-23
 * above are about an arrangement that no longer exists; the arms that replaced
 * them were attacked in their own right.
 *
 * 24. `onChoose` spelling the patch out inline instead of calling
 *     `roomShareChoicePatch` → **red**, and so is a stray `isRoomShareGuest`
 *     spread beside the call (25) — two fields holding one fact must have one
 *     writer.
 * 26. `onClear` inlined, and (27) `onClear` restoring an accommodation →
 *     **red**.
 * 28. the tab redeclaring both patches locally instead of importing them →
 *     **red**.
 * 29. `openPicker` made `async` with an `await` in it → **red**; (30) an
 *     `onRequireSave` reintroduced → **red**. Both are the draft-save coming
 *     back in a different shape.
 * 31. `disabled={requestId == null}` restored on the button → **red**.
 * 32. the "ระบบจะบันทึกร่างให้ก่อนเปิดรายการ" copy restored → **red**.
 * 33. `params.set("requestNo"…)` removed, so the number tab searches nothing
 *     → **red**; (34) `excludeRequestId` dropped → **red**.
 * 35. `<DateRangeField>` replaced by two `<input type="date">` → **red**;
 *     (36) its `inline` removed, which is what makes the calendar clickable
 *     inside a Radix modal at all → **red**.
 * 37. **the default window removed from the PRESS while `switchMode` kept its
 *     copy — MEASURED GREEN.** The arm was a file-wide
 *     `indexOf("defaultHostFilterRange(new Date())")`, so it passed while the
 *     picker opened completely unfiltered and only acquired the window if the
 *     requester happened to toggle the date-mode tabs. Closed by asserting the
 *     call inside `openPicker`'s own balanced region, with a second arm for
 *     `switchMode`, and re-run: removing it from either is now red, as is
 *     seeding the press with fixed dates instead.
 * 38. `shownHosts`' `useMemo` removed, so the list stops being filterable →
 *     **red**.
 * 39. the "ยังไม่ได้บันทึก" note deleted → **red**; (40) shown
 *     unconditionally → **red**. Each fails differently: the first loses a
 *     room share silently when the page is closed, the second lies after every
 *     save.
 * 41. `openPicker` and `switchMode` renamed → **red** ("not found — has it
 *     been renamed or removed?"). `balancedAfter` still fails closed rather
 *     than handing the assertions an empty region.
 * 42. `← เปลี่ยนคน` clearing the person without reopening step 1 — the exact
 *     `2972e26` bug — → **red**; so is reopening without clearing (43), and so
 *     is closing the whole picker instead (44).
 *
 * Applied as literal replacements by a harness that restores from a `cp`
 * backup and verifies the restore by hash; identical each time.
 */

const SRC = path.resolve(process.cwd(), "src");

const TAB = "features/travel-booking/components/TravelBookingTab.tsx";
const CONTROL = "features/travel-booking/components/RoomShareControl.tsx";
const HOOK = "features/travel-booking/hooks/useTravelBookingForm.ts";
const SERVICE = "lib/acc/travel-booking/request-service.ts";

/** Source with comments stripped — this guard's own prose must never satisfy it. */
function code(rel: string): string {
  return fs
    .readFileSync(path.resolve(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The text of a balanced bracketed region that starts at the first `open`
 * after `marker`.
 *
 * Containment, not proximity: "is `data-field="accommodation"` *inside* the
 * guest conditional" is the question, and an index comparison answers a
 * different and weaker one — a grid moved out of the conditional but left
 * below it on the page would pass an ordering check while rendering both
 * controls at once, which is the exact regression this file exists for.
 *
 * Fail-closed. A marker that is not found, or a region that never balances,
 * is an assertion failure rather than an empty string that satisfies
 * everything asked of it.
 */
function balancedAfter(src: string, marker: string, open: "(" | "{"): string {
  const close = open === "(" ? ")" : "}";
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `${marker} not found — has it been renamed or removed?`);
  const start = src.indexOf(open, at + marker.length);
  assert.notEqual(start, -1, `no ${open} after ${marker}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail(`unbalanced ${open} after ${marker}`);
}

/* ─────────────────── the grid and the share are alternatives ─────────────────── */

test("the accommodation grid is rendered only when the tab is NOT a room-share guest", () => {
  const src = code(TAB);
  const guarded = balancedAfter(src, "!tab.isRoomShareGuest &&", "(");
  assert.ok(
    guarded.indexOf('data-field="accommodation"') !== -1,
    "the ที่พักค้างคืน block is no longer inside the `!tab.isRoomShareGuest` conditional, so a " +
      "room-share guest can book a room of their own as well as share one — a state " +
      "roomBookedOrShared reads as true from either input while the Admin desk has a booking " +
      "to make for somebody who is not sleeping there",
  );
  assert.ok(
    guarded.indexOf("<OptionCardSelect") !== -1,
    "the accommodation option grid itself has left the guarded block",
  );
});

test("the room-share control is mounted in both states, outside that conditional", () => {
  const src = code(TAB);
  const guarded = balancedAfter(src, "!tab.isRoomShareGuest &&", "(");
  assert.ok(
    src.indexOf("<RoomShareControl") !== -1,
    "TravelBookingTab no longer renders RoomShareControl at all — the feature is invisible",
  );
  assert.ok(
    guarded.indexOf("<RoomShareControl") === -1,
    "RoomShareControl has been moved inside the non-guest conditional, so an attached guest " +
      "sees neither the accommodation grid nor their own host — and has no way to detach",
  );
});

/* ─────────────────── attaching clears what the grid had set ─────────────────── */

/**
 * **The patches moved into `room-share-choice.ts` on 2026-09-22, and that is
 * why these two arms now assert a CALL rather than the fields.**
 *
 * `roomShareHostRequestId` joined `isRoomShareGuest` when picking stopped
 * being a POST and became tab state, and two fields holding one fact must be
 * written in one place — the module's own docblock carries that argument. The
 * fields themselves are asserted for real, by value, in
 * `room-share-choice.test.ts`, which can import the module because it is pure.
 * What cannot be asserted there and has to be asserted here is that
 * `TravelBookingTab` still routes through it: an inline object literal in the
 * tab would type-check, look right, and be the second copy.
 */
test("attaching goes through the shared patch, not a literal in the tab", () => {
  const patch = balancedAfter(code(TAB), "onChoose=", "{");
  assert.match(
    patch,
    /roomShareChoicePatch\(host\)/,
    "onChoose no longer applies roomShareChoicePatch. Written out here instead, the tab's " +
      "`isRoomShareGuest` and `roomShareHostRequestId` become two places for one fact — and " +
      "the host's dates stop travelling with the choice, which is final review I4 back again: " +
      "a guest attached on OVERLAP has its whole span replaced by the first cascade",
  );
  assert.ok(
    !/isRoomShareGuest:/.test(patch) && !/accommodationId:/.test(patch),
    "the tab spells the patch out beside the call. Two copies is exactly what the shared module " +
      "exists to prevent, and the copy here is the one no unit test covers",
  );
});

test("clearing goes through the shared patch, and restores nothing", () => {
  const patch = balancedAfter(code(TAB), "onClear=", "{");
  assert.match(
    patch,
    /roomShareClearPatch\(\)/,
    "onClear no longer applies roomShareClearPatch",
  );
  assert.ok(
    !/accommodationId:/.test(patch),
    "onClear restores an accommodation. Detaching must leave the required field unanswered: " +
      "resurrecting the choice the attach replaced re-books a room the requester had decided " +
      "against, and does it without them touching the control",
  );
});

/**
 * The patch module is pure and imported by name, so the tab cannot get a
 * *different* `roomShareChoicePatch`. Asserted because the two arms above
 * match on the identifier alone.
 */
test("the tab imports the patches from the shared module", () => {
  assert.match(
    code(TAB),
    /import\s*\{[^}]*\broomShareChoicePatch\b[^}]*\broomShareClearPatch\b[^}]*\}\s*from\s*["']@\/features\/travel-booking\/lib\/room-share-choice["']/,
    "TravelBookingTab no longer imports both patches from room-share-choice.ts",
  );
});

/* ─────────────────── the two validators say the same thing ─────────────────── */

/**
 * Matched as one statement rather than as two independent mentions, because
 * "the file contains `isRoomShareGuest` somewhere" is satisfied by a comment
 * about it — and by a *different* rule reading the same flag.
 */
const GUEST_EXEMPTION = /if\s*\(\s*!tab\.accommodationId\s*\)\s*\{\s*if\s*\(\s*!tab\.isRoomShareGuest\s*\)/;

test("the submit validator exempts a room-share guest from ที่พักค้างคืน", () => {
  const src = code(SERVICE);
  assert.match(
    src,
    GUEST_EXEMPTION,
    "validateTravelBookingTab demands an accommodation unconditionally again. A guest picks " +
      "none — the control replaces the choice — so every room share would be refused at submit " +
      "with a field the form does not even render",
  );
  assert.ok(
    src.indexOf('fail("กรุณาเลือกที่พักค้างคืน")') !== -1,
    "the accommodation requirement itself has gone from the submit validator — the exemption " +
      "is for guests only, and everybody else still has to choose one",
  );
});

test("the form's own validator carries the identical exemption", () => {
  const src = code(HOOK);
  assert.match(
    src,
    GUEST_EXEMPTION,
    "validateTab demands an accommodation from a guest again, so the form stays red and " +
      "ส่งคำขอ stays disabled on a tab the server would accept — with no input on screen to " +
      "satisfy it",
  );
  assert.ok(
    src.indexOf('key: "accommodation"') !== -1,
    "the accommodation issue has gone from validateTab entirely — a non-guest would then be " +
      "told nothing until the server refused the submit",
  );
});

/* ─────────────────── the picker, and what it may reach ─────────────────── */

test("the person search is the requester roster, never the admin-only directory", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf("/api/request/travel-booking/requesters") !== -1,
    "the room-share picker no longer calls the HR-backed requester search",
  );
  assert.ok(
    src.indexOf("/api/users/search") === -1,
    "the picker calls /api/users/search, which is requireRole([\"IT Admin\",\"System Admin\"]). " +
      "Spec §6 names it, and following that literally 403s every ordinary requester — which is " +
      "the whole population of this control. Use /api/request/travel-booking/requesters",
  );
});

test("the picker reuses the shared person modal rather than a second search", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf("RequesterPickerModal") !== -1,
    "RoomShareControl no longer reuses RequesterPickerModal. Spec §6 is explicit that the " +
      "directory search is not written twice, and that modal owns the debounce and the `seq` " +
      "staleness guard a hand-rolled copy would have to reproduce",
  );
});

test("the host row shape is imported from the service, never redeclared here", () => {
  const src = code(CONTROL);
  assert.match(
    src,
    /import\s+type\s*\{[^}]*\bHostCandidateRow\b[^}]*\}\s*from\s*["']@\/lib\/acc\/travel-booking\/room-share-service["']/,
    "RoomShareControl no longer imports HostCandidateRow from the service. The fetch result is " +
      "a cast over untyped JSON, so a locally declared shape can be widened to any field at all " +
      "— and the field allow-list room-share-response-shape-guard.test.ts pins would stop " +
      "binding this end of it",
  );
  assert.ok(
    !/\b(interface|type)\s+HostCandidateRow\b/.test(src),
    "RoomShareControl declares its own HostCandidateRow, which is a second host shape nothing " +
      "polices",
  );
});

/* ─────────────────── the warning reaches the guest BEFORE the choice ─────────────────── */

test("the agreement line is the shared constant, shown before the choice and after it", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf("ROOM_SHARE_AGREEMENT_LINE") !== -1,
    "the warning is no longer rendered from the shared constant, so the copy shown before the " +
      "decision can drift from the copy shown after it",
  );
  const uses = src.split("<AgreementLine />").length - 1;
  assert.ok(
    uses >= 2,
    `the agreement line is rendered ${uses} time(s). It belongs in BOTH places: inside the ` +
      "picker, because the host has no veto and the guest is the only person who can be warned " +
      "in advance (spec §2); and on the attached card, so the state stays self-describing",
  );
  const dialogAt = src.indexOf("<Dialog");
  assert.notEqual(dialogAt, -1, "the host picker dialog has gone");
  assert.ok(
    src.indexOf("<AgreementLine />", dialogAt) !== -1,
    "no agreement line inside the picker dialog — the warning now only appears AFTER the " +
      "requester has already attached, which is the one moment it is too late to be useful",
  );
});

test("the warning names all three consequences the requester is accepting", () => {
  // Asserted against the exported constant rather than as prose here, so a
  // rewording that keeps the meaning does not red the suite — package A's
  // precedent. What must survive any rewording is the three facts: no booking,
  // per diem all the same, and the request following the host's in both
  // directions.
  const constants = code("features/travel-booking/constants.ts");
  const at = constants.indexOf("export const ROOM_SHARE_AGREEMENT_LINE");
  assert.notEqual(at, -1, "ROOM_SHARE_AGREEMENT_LINE has gone from the AP-17 constants");
  // The declaration runs to its terminating semicolon; the value is a string
  // concatenation, so there is no bracketed region to balance here.
  const end = constants.indexOf(";", at);
  assert.notEqual(end, -1, "ROOM_SHARE_AGREEMENT_LINE's declaration is not terminated");
  const stated = constants.slice(at, end);
  assert.ok(stated.indexOf("เบี้ยเลี้ยง") !== -1, "the line no longer says the guest is still paid");
  assert.ok(
    stated.indexOf("ยกเลิก") !== -1,
    "the line no longer says the request is cancelled when the host's is",
  );
  assert.ok(
    stated.indexOf("วันเดินทาง") !== -1,
    "the line no longer says the travel dates follow the host's",
  );
});

/* ─────────────────── the press saves, and the copy agrees ─────────────────── */

/**
 * **The press opens the picker and does nothing else** (the user, 2026-09-22,
 * point 1: search straight away). The draft save that used to sit in front of
 * it — and, before that, the disabled button telling the requester to press
 * บันทึกร่าง themselves — are both gone with the endpoint that needed them.
 *
 * Three ways that gets quietly put back, one arm each:
 *
 * - the control asks the parent to save again (`onRequireSave`, or any
 *   `await` at all in `openPicker`, which is now synchronous);
 * - the button is re-gated on `requestId`;
 * - either of the two old copy lines returns, which is the half that fails
 *   *silently* — a live button beside a note telling the requester to go and
 *   save first reads as a bug in the button.
 */
test("pressing the button opens the picker, with no save in front of it", () => {
  const src = code(CONTROL);
  const open = balancedAfter(src, "const openPicker = useCallback", "(");

  const openAt = open.indexOf("setPickerOpen(true)");
  assert.notEqual(openAt, -1, "openPicker no longer opens the picker at all");

  assert.ok(
    open.indexOf("await") === -1,
    "openPicker awaits something. Browsing is `requireAuth` with no request id — there is " +
      "nothing to wait for before the picker can open, and anything awaited here is the draft " +
      "save coming back in a different shape",
  );
  assert.ok(
    src.indexOf("onRequireSave") === -1,
    "the control asks its parent to save the draft again. The hosts endpoint no longer takes " +
      "an owned request id, so there is nothing for that save to satisfy — and the requester " +
      "asked twice for it to stop happening",
  );
});

test("the button is never gated on an unsaved tab, and no copy tells anyone to save", () => {
  const src = code(CONTROL);

  const labelAt = src.indexOf("พักห้องเดียวกับเพื่อนร่วมงาน");
  assert.notEqual(labelAt, -1, "the พักห้องเดียวกับเพื่อนร่วมงาน button has gone");
  const btnAt = src.lastIndexOf("<Button", labelAt);
  assert.notEqual(btnAt, -1, "the label is no longer inside a <Button>");
  // Opening tag through to the label: everything the element is configured with.
  const btn = src.slice(btnAt, labelAt);

  assert.ok(
    !/disabled=\{/.test(btn),
    "the button is disabled again (user, 2026-09-22: เลือกได้ โดยยังไม่ต้องบันทึกร่างก่อน). " +
      "Nothing has to happen before the picker can open, so there is no state in which this " +
      "control should refuse a press",
  );

  for (const stale of [
    "กรุณาบันทึกร่างก่อนจึงจะเลือกห้องพักร่วมได้",
    "ระบบจะบันทึกร่างให้ก่อนเปิดรายการ",
    "กำลังบันทึกร่าง...",
  ]) {
    assert.ok(
      src.indexOf(stale) === -1,
      `the copy "${stale}" is back beside a button that saves nothing. Both of the arrangements ` +
        "it belonged to are gone; a note promising a save that never happens is worse than the " +
        "step it described",
    );
  }
});

/**
 * **The picker's two ways in, and the one range control** — the user's points
 * 2 and 3, 2026-09-22.
 *
 * Each arm pins a thing that reverts by deletion rather than by breaking:
 * drop the `requestNo` parameter and the number tab silently searches nothing;
 * put two `<input type="date">` back and the "one range control like
 * วันเดินทาง" is gone with no test noticing; lose `defaultHostFilterRange` and
 * the filter opens empty or on the guest's own dates again, which is what
 * point 4 made circular.
 */
test("the picker offers both ways in — a person, or a running number", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf('params.set("requestNo"') !== -1,
    "the picker no longer asks the hosts endpoint for a request by running number, so the " +
      "second tab searches nothing at all (user, 2026-09-22, point 2)",
  );
  assert.ok(
    src.indexOf('params.set("staffId"') !== -1,
    "the picker no longer asks for a colleague's requests by staffId",
  );
  assert.ok(
    src.indexOf('params.set("excludeRequestId"') !== -1,
    "the picker stops excluding this tab's own request, so a requester is offered their own " +
      "trip and the save refuses it with `self_attach` after the fact",
  );
});

test("the date filter is ONE range control, opened on the default window", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf("<DateRangeField") !== -1,
    "the host filter no longer uses DateRangeField. Two dd/mm/yyyy boxes is what it replaced " +
      "(user, 2026-09-22, point 3: one range control like วันเดินทาง)",
  );
  assert.ok(
    !/type="date"/.test(src),
    "a raw <input type=\"date\"> is back in the picker — that is the pair of boxes the single " +
      "range control replaced",
  );
  assert.match(
    src,
    /inline\s*\/?>/,
    "DateRangeField is rendered without `inline`. Radix puts pointer-events: none on <body> " +
      "while a modal is open and treats a body-level portal as OUTSIDE its content, so the " +
      "calendar would be both unclickable and a dismiss trigger — measured in this repository " +
      "already, see LinePickers.tsx",
  );
  /* Asserted INSIDE `openPicker`, not file-wide. The file-wide version was
     **measured green** on 2026-09-22 against a mutation that removed the
     default from the press and left `switchMode`'s copy behind: the picker
     then opened completely unfiltered and only acquired the window if the
     requester happened to toggle ตามวันเดินทาง / ตามวันที่ยื่นคำขอ. A call
     present and the feature gone, which is the exact shape this project keeps
     re-learning. */
  const open = balancedAfter(src, "const openPicker = useCallback", "(");
  assert.ok(
    open.indexOf("defaultHostFilterRange(new Date())") !== -1,
    "the PRESS no longer seeds today … today + 30, so the picker opens unfiltered. It must not " +
      "go back to the guest's own dates either: since final review I4 the picker WRITES the " +
      "host's dates into the tab, so seeding the search from a value it is about to overwrite " +
      "is circular — and the tab may have no dates at all by then, the picker no longer " +
      "requiring a saved draft",
  );
  const switchBody = balancedAfter(src, "const switchMode = useCallback", "(");
  assert.ok(
    switchBody.indexOf("defaultHostFilterRange(new Date())") !== -1,
    "switching back to ตามวันเดินทาง no longer re-seeds the window, so the toggle leaves the " +
      "filter on whatever the ยื่นคำขอ tab cleared it to",
  );
});

test("the fetched list is filterable by running number", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf("listQuery") !== -1,
    "the request list is no longer typeable (user, 2026-09-22, point 3)",
  );
  assert.match(
    src,
    /const shownHosts = useMemo/,
    "the list filter no longer narrows what is RENDERED. Filtering client-side over what was " +
      "already fetched is the deliberate choice — re-querying per keystroke would run a " +
      "person-and-date scan behind a database round trip for every character",
  );
});

/**
 * **`← เปลี่ยนคน` goes BACK a step, it does not close the picker** (fixed in
 * `2972e26`, and re-checked here because the rework moved every piece of state
 * it touches).
 *
 * The bug it fixes is subtle enough to come back by accident:
 * `RequesterPickerModal` calls its `onClose()` immediately after `onSelect()`,
 * so `personOpen` is **already false** by the time step 2 is on screen.
 * Clearing `person` alone therefore leaves step 1's own `open` condition false
 * as well, and the control closes the whole picker instead of reopening the
 * person list. Both setters, or neither.
 */
test("← เปลี่ยนคน reopens the person list rather than closing the picker", () => {
  const src = code(CONTROL);
  // The label sits at the END of its <Button>, so the handler is read
  // backwards from it rather than forwards through a balanced region.
  const labelAt = src.indexOf("← เปลี่ยนคน");
  assert.notEqual(labelAt, -1, "the ← เปลี่ยนคน control has gone");
  const onClickAt = src.lastIndexOf("onClick={", labelAt);
  assert.notEqual(onClickAt, -1, "the ← เปลี่ยนคน button has no onClick above its label");
  const handler = src.slice(onClickAt, labelAt);
  assert.match(
    handler,
    /setPerson\(null\)/,
    "← เปลี่ยนคน no longer clears the chosen colleague, so it goes nowhere",
  );
  assert.match(
    handler,
    /setPersonOpen\(true\)/,
    "← เปลี่ยนคน clears the person WITHOUT reopening the person list. " +
      "RequesterPickerModal calls onClose() straight after onSelect(), so personOpen is already " +
      "false by then — clearing `person` alone closes the whole picker instead of going back a " +
      "step, which is the exact bug 2972e26 fixed",
  );
});

/**
 * **The choice is an unsaved edit, and the card has to say so.**
 *
 * This is the one thing the rework takes away from the requester that the old
 * immediate POST gave them for free: attaching used to be durable the instant
 * they clicked. Now it lands with บันทึกร่าง / ส่งคำขอ like every other field
 * on this form — which is the point — but a card that looked identical
 * before and after a save would leave somebody believing their room share was
 * recorded when closing the tab would lose it.
 */
test("an unsaved choice says it is unsaved", () => {
  const src = code(CONTROL);
  assert.ok(
    src.indexOf("ยังไม่ได้บันทึก") !== -1,
    "the attached card no longer distinguishes a saved binding from an unsaved choice. The " +
      "picker writes tab state now, so a requester who closes the page before saving loses it " +
      "— silently, from a card that looked exactly like a persisted one",
  );
  assert.match(
    src,
    /savedView === null &&/,
    "the unsaved note is no longer conditional on there being no STORED binding — shown always " +
      "it is a lie after every save, and shown never it is the silent loss above",
  );
});
