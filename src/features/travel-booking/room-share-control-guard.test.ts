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
 * *(42–44 were written against the two-dialog arrangement, where `personOpen`
 * existed. The merge below made the middle one unrepresentable and rewrote
 * the arms; the trials are left recorded because they are why the surviving
 * ones are shaped as they are.)*
 *
 * ## The two dialogs merged — 2026-09-22, mutation-verified, seven trials
 *
 * The person search was a **second dialog** stacked over this one
 * (`RequesterPickerModal`, portalled at `z-[80]`, with the host dialog closing
 * itself to let it through). The user asked for one screen:
 * "อยากปรับให้ 2 หน้านี้รวมกัน". `RequesterPickerBody` — the modal's
 * frame-less half, extracted so both render one implementation — is now
 * rendered inline on the first tab.
 *
 * 45. `<RequesterPickerBody>` deleted from the `person === null` step → **red**
 *     (the step is blank; nothing else notices).
 * 46. the shared import swapped for a hand-rolled search in this file →
 *     **red**.
 * 47. `<RequesterPickerModal>` rendered again beside the dialog → **red**.
 * 48. `frame="inline"` dropped, so the body falls back to the modal frame →
 *     **red**. This is the one that reverts by *deletion* and type-checks
 *     perfectly: a second `flex-1 overflow-y-auto` scroller with the modal's
 *     own padding, inside a panel that already scrolls.
 * 49. `self={null}` dropped → **red** (a "ตัวฉันเอง" row that can only ever
 *     be refused by the save).
 * 50. **`<RequesterPickerBody>` moved OUT of the `person === null` step and
 *     rendered unconditionally, props intact** → **red**. The trial that
 *     earns `balancedAfter` here, exactly as 2 did for the grid: the element
 *     is still in the file with every prop, and only containment tells the
 *     difference between the merged first step and a search box sitting on
 *     top of the chosen colleague's request list.
 * 51. `← เปลี่ยนคน` calling `closePicker()` beside `setPerson(null)` — the
 *     `2972e26` bug in the only form the merge leaves open to it → **red**.
 * 52. `setPersonOpen` reintroduced beside `person` → **red**.
 * 53. `RequesterPickerModal` given back a search of its own instead of
 *     rendering the shared body → **red**. The other end of "one
 *     implementation, two frames": every assertion about `RoomShareControl`
 *     stays green while the four on-behalf callers drift onto a second copy.
 * 54. the request list region rendered unconditionally again, so both steps
 *     are on screen together → **red**.
 *
 * Applied as literal replacements by a harness that restores from a `cp`
 * backup and verifies the restore by hash; identical each time.
 *
 * ## The 2026-09-23 round — points 1 to 4, twenty-nine more trials, one GREEN
 *
 * The picker's leading tab, the running-number gate, the host's identity, the
 * prefill and the opening prompt all arrived together, and each was attacked
 * in its own right rather than assumed to be covered by the arm written for
 * it. Same harness: `cp` backup, `perl -0pi` literal replacement, re-run,
 * restore, `md5sum` compared — and a trial whose replacement did not apply
 * was reported as such rather than scored as red.
 *
 * **Point 1 — the leading tab**
 * 18. `PICK_MODES` reordered to `["person", "number"]` → **red**.
 * 19. `openPicker` naming a mode literally while `PICK_MODES` keeps its order
 *     → **red**. This is the half that reverts silently: the buttons still
 *     draw ระบุเลขที่คำขอ first and the picker still opens on the other one.
 * 20. the two buttons rendered from a literal array again → **red**, twice
 *     over (the tab-order arm, and the agreement-line arm, whose picker-
 *     identity check reads `PICK_MODES.map(`).
 *
 * **Point 1's other half — the running-number gate**
 * 21. the gate reverted to `trimmedNo.length < 3` → **red**.
 * 22. **the call kept and the condition changed to a length test** — the
 *     mutation-37 shape, and the reason the CONDITION is matched rather than
 *     the call → **red**.
 * 23. the gate's `return;` deleted, so an unfinished number falls through to
 *     the fetch → **red**.
 * 24. the old "พิมพ์อย่างน้อย 3 ตัวอักษร" copy restored → **red**.
 * 25. the placeholder's example hardcoded instead of generated → **red**.
 * 26. the import swapped for a regex retyped in this file → **red**.
 *
 * **Point 2 — whose booking it is**
 * 27. `hostStaffId` reverted to the saved binding alone → **red**.
 * 28. the resolved colleague stored without the staff id it belongs to →
 *     **red**.
 * 29. the `resolved.staffId === hostStaffId` comparison dropped on render →
 *     **red**. 28 and 29 are the two halves of "a cache that trusts itself",
 *     and each reverts without touching the other.
 * 30. the card's label read off the saved binding again → **red**.
 *
 * **Point 3 — the prefill**
 * 31. `roomSharePrefillPatch` dropped from `onChoose` → **red**.
 * 32. the two patches spread in the other order → **red**.
 * 33. the prefill handed a blank object instead of `tab`, so it believes the
 *     requester has answered nothing and overwrites everything → **red**, and
 *     this is why the arm matches `(host, tab)` rather than the call alone.
 * 34. the import deleted → **red**.
 *
 * **Point 4 — the opening prompt**
 * 35. `useState(() => shouldAskRoomShare(initial))` → `useState(true)`, i.e.
 *     asked on every resumed draft → **red**.
 * 36. a second `setAskRoomShare(true)` added, so the question comes back →
 *     **red** (the call-count arm; the "turned off" arm still passes, which
 *     is why they are separate).
 * 37. the form stops handing the prompt and its answer to the tab → **red**.
 * 38. the one write turned the prompt ON instead of off → **red**.
 * 39. the prompt's `onOpenChange` made a no-op, so Escape and the backdrop
 *     leave it unanswered → **red**.
 * 40. `askYes` stops answering the prompt → **red**; 41. `askYes` stops
 *     opening the picker → **red**; 42. `askNo` opens the picker too →
 *     **red**. Three arms because all three are different lies to the
 *     requester.
 * 43. a latch of its own reintroduced inside `RoomShareControl` → **red**.
 * 44. **`open={askRoomShare && hostRequestId == null}` — MEASURED GREEN, and
 *     deliberately left green.** The arm read `/open=\{askRoomShare\}/`, an
 *     exact spelling, and this narrowing is not a regression: the attached
 *     branch returns before this JSX, so the extra condition is redundant
 *     rather than wrong. A guard that reds on a harmless refinement is one
 *     the next reader deletes, so the arm was **loosened** to require
 *     `askRoomShare` *within* the open expression, and 46 below was added to
 *     prove the loosened form still bites.
 * 45. the prompt dialog deleted outright → **red**.
 * 46. the latch dropped out of the open expression (`open={true}`) → **red**.
 *
 * **The agreement line, now that there are two dialogs**
 * 47. the agreement line removed from the PICKER while the prompt and the
 *     attached card keep theirs → **red**. This is the trial the slice exists
 *     for: the old arm was "an agreement line anywhere after the first
 *     `<Dialog`", which the prompt's own copy would have satisfied.
 * 48. a third dialog carrying an agreement line inserted **before** the
 *     picker → **red**, twice (the picker-identity check and the
 *     dialog-count check). That is the reordering hazard in the form it would
 *     actually arrive in.
 */

const SRC = path.resolve(process.cwd(), "src");

const TAB = "features/travel-booking/components/TravelBookingTab.tsx";
const CONTROL = "features/travel-booking/components/RoomShareControl.tsx";
/** Where the opening prompt's latch lives — see the point-4 section below. */
const FORM = "features/travel-booking/components/TravelBookingForm.tsx";
/** The on-behalf frame around the same shared search body — see the inline-search test. */
const PERSON_MODAL = "components/RequesterPickerModal.tsx";
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

/**
 * **The person search is rendered INSIDE this dialog, and it is the shared
 * one** (the user, 2026-09-22: "อยากปรับให้ 2 หน้านี้รวมกัน").
 *
 * Two different regressions, one test, because they are the two ways the
 * merge comes undone:
 *
 * - the search is **copied** into this file rather than shared. Spec §6 is
 *   explicit that the directory search is not written twice, and the body
 *   owns the 220 ms debounce and the `seq` staleness guard a hand-rolled copy
 *   would have to reproduce — badly, since neither is visible in a screenshot.
 * - a **second dialog** comes back. That is what was removed: a modal
 *   portalled to `document.body` over a dialog that had to close itself to
 *   let it through, which is the arrangement `personOpen` existed for and the
 *   arrangement `← เปลี่ยนคน` kept breaking under.
 *
 * `frame="inline"` is asserted because it reverts by **deletion**: the prop
 * defaults to `"modal"`, whose list region is `flex-1 overflow-y-auto` with
 * the modal's own `px-5 pb-4`, so dropping it puts a second scroller and a
 * stray inset inside a panel that already scrolls — and nothing type-checks
 * differently.
 */
test("the person search is rendered inline in this dialog, from the shared body", () => {
  const src = code(CONTROL);
  assert.match(
    src,
    /import\s*\{[^}]*\bRequesterPickerBody\b[^}]*\}\s*from\s*["']@\/components\/RequesterPickerBody["']/,
    "RoomShareControl no longer imports the shared RequesterPickerBody, so the roster search " +
      "it renders is a second copy of one that already exists",
  );
  assert.ok(
    src.indexOf("<RequesterPickerModal") === -1,
    "a second, stacked RequesterPickerModal is back on top of this dialog. The user asked for " +
      "the two screens to become one (2026-09-22), and the two-dialog arrangement is what " +
      "needed `personOpen` beside `person` — the pair that could disagree about which step was " +
      "showing, and did",
  );
  // Containment, not presence: the search belongs on the step that has no
  // colleague yet. Rendered anywhere else it is decoration, and the person
  // tab is the empty panel with a button on it that this replaced.
  const step1 = balancedAfter(src, "person === null ?", "(");
  assert.ok(
    step1.indexOf("<RequesterPickerBody") !== -1,
    "the shared person search is not rendered on the step where no colleague has been chosen. " +
      "That step is the whole first half of the merged dialog; without it the tab is blank",
  );
  assert.ok(
    /frame="inline"/.test(step1),
    'the inline search is rendered without frame="inline", so it falls back to the modal ' +
      "frame — a second `flex-1 overflow-y-auto` scroller, with the modal's own padding, " +
      "inside a dialog body that is already the scroll region. Two nested scrollers in one " +
      "90vh panel is what makes this unusable on a phone",
  );
  assert.ok(
    /self=\{null\}/.test(step1),
    'the inline search offers a "ตัวฉันเอง" row again. This asks whose room, and your own is ' +
      "not one — the save refuses a self-attach, so the row can only ever be a dead end",
  );
  /* The two steps stay mutually exclusive inside the one dialog, which is
     what keeps the merged panel no taller than the taller of the two it
     replaced — the thing that decides whether this works on a phone. Without
     the gate the search step also carries the request list's reserved
     `min-h-[120px]`, and, for as long as the fetch effect takes to clear
     them, the PREVIOUS colleague's requests underneath the colleague search.
     The class strings are deliberately not pinned; the gate is. */
  assert.match(
    src,
    /className=\{hostListWanted \?/,
    "the request list region is no longer gated on there being a query for it to answer, so " +
      "the colleague search step renders it too — blank space on a phone at best, and the " +
      "colleague you just stepped away from at worst",
  );
  // The other end of "one implementation, two frames". Four on-behalf callers
  // reach the search through this modal, and it keeping its own copy is how
  // the two drift — the room-share tab would stay green throughout.
  assert.ok(
    code(PERSON_MODAL).indexOf("<RequesterPickerBody") !== -1,
    "RequesterPickerModal no longer renders the shared RequesterPickerBody, so the on-behalf " +
      "เปลี่ยนผู้ขอเบิก picker and AP-17's room-share tab are running two copies of the roster " +
      "search again — the thing the extraction existed to prevent",
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
  /* **Sliced to the PICKER's own dialog, not "anywhere after the first
     `<Dialog`".** A second dialog joined this file on 2026-09-23 — the
     opening พักห้องเดียวกับเพื่อนร่วมงานหรือไม่ prompt — and it carries an
     agreement line of its own, quite rightly, because it is now the first
     place the choice is offered. An index-only check would let that one
     satisfy this assertion while the picker's had been deleted, which is
     precisely the regression the arm exists for. The two dialogs are
     siblings, so the first `</Dialog>` after the first `<Dialog` closes the
     picker; that is asserted rather than assumed. */
  const dialogAt = src.indexOf("<Dialog");
  assert.notEqual(dialogAt, -1, "the host picker dialog has gone");
  const dialogEnd = src.indexOf("</Dialog>", dialogAt);
  assert.notEqual(dialogEnd, -1, "the picker dialog is never closed");
  const nextDialog = src.indexOf("<Dialog", dialogAt + 1);
  assert.ok(
    nextDialog === -1 || nextDialog > dialogEnd,
    "a <Dialog> is nested inside the picker dialog, so the slice below no longer names the " +
      "picker's own region and every assertion over it is about something else",
  );
  const picker = src.slice(dialogAt, dialogEnd);
  /* The slice has to IDENTIFY itself as the picker, or reordering the two
     dialogs would silently point this assertion at the prompt — whose own
     agreement line would then satisfy it while the picker's had gone. The
     two-tab strip exists in one of them and not the other. */
  assert.ok(
    picker.indexOf("PICK_MODES.map(") !== -1,
    "the file's first <Dialog> is no longer the host picker. Every assertion below slices that " +
      "region; pointed at the opening prompt instead, the warning arm is satisfied by the " +
      "prompt's own copy and the picker could lose its agreement line entirely",
  );
  assert.ok(
    picker.indexOf("<AgreementLine />") !== -1,
    "no agreement line inside the PICKER dialog — the warning would then reach the requester " +
      "only in the opening prompt or after they had already attached, and the prompt is not a " +
      "substitute: somebody who reaches the picker from the พักห้องเดียวกับเพื่อนร่วมงาน button " +
      "never sees the prompt at all",
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
 * `2972e26`; re-checked here through every rework because the state it reads
 * has now been rewritten twice).
 *
 * The history is the reason for the shape of the assertions. While the person
 * search was a **second dialog**, which step was showing took two values —
 * `person` and `personOpen` — and `RequesterPickerModal` calls its
 * `onClose()` immediately after `onSelect()`, so `personOpen` was **already
 * false** by the time step 2 rendered. Clearing `person` alone therefore left
 * step 1's own `open` condition false as well and the whole picker closed.
 * Both setters, or neither.
 *
 * Since the two dialogs merged (2026-09-22) there is only `person`, so that
 * particular disagreement is unrepresentable — which is most of why the merge
 * was worth doing. **Two things still have to hold**, and each has an arm:
 * the handler must clear the person, and it must not reach for the dialog
 * itself. The third arm is the structural one: `setPersonOpen` must not come
 * back at all, because the moment a second value decides this again, so does
 * the bug.
 */
test("← เปลี่ยนคน goes back to the search step rather than closing the picker", () => {
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
  assert.ok(
    handler.indexOf("closePicker") === -1 && handler.indexOf("setPickerOpen(false)") === -1,
    "← เปลี่ยนคน closes the whole dialog instead of stepping back to the search. That is the " +
      "2972e26 bug in the only form the merged dialog still leaves open to it — the requester " +
      "loses the number tab, the date filter and everything else in one press",
  );
  assert.ok(
    src.indexOf("setPersonOpen") === -1,
    "a second piece of state decides which step is showing again. Which step it is has been " +
      "`person === null` alone since the two dialogs merged; reintroducing `personOpen` beside " +
      "it restores exactly the pair that could disagree, and did",
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

/* ═════════════════ the 2026-09-23 round — points 1 to 4 ═════════════════ */

/**
 * **ระบุเลขที่คำขอ is the LEADING tab** (the user's point 1).
 *
 * Two things have to agree and they are deliberately one fact: the order the
 * buttons render in, and the tab `openPicker` opens on. `PICK_MODES` is that
 * fact. Reverting either half alone is the failure worth catching — a picker
 * that opens on เลือกเพื่อนร่วมงาน with ระบุเลขที่คำขอ drawn first is not
 * "mostly right", it is the old behaviour with a new label order.
 */
test("the picker leads with the running-number tab, and opens on it", () => {
  const src = code(CONTROL);
  assert.match(
    src,
    /const PICK_MODES: readonly PickMode\[\] = \["number", "person"\];/,
    "PICK_MODES no longer declares ระบุเลขที่คำขอ first (user, 2026-09-23, point 1). This one " +
      "array is both the button order and openPicker's default; changing it here is the " +
      "supported way to change the leading tab, and changing it anywhere else makes the two " +
      "disagree",
  );
  assert.ok(
    src.indexOf("PICK_MODES.map(") !== -1,
    "the two tab buttons are rendered from a literal array again instead of from PICK_MODES, " +
      "so the order on screen and the tab the picker opens on are two facts that can drift",
  );
  const open = balancedAfter(src, "const openPicker = useCallback", "(");
  assert.ok(
    open.indexOf("setPickMode(PICK_MODES[0])") !== -1,
    "the press no longer opens on the LEADING tab. Naming a mode literally here is how the " +
      "picker ends up opening on whichever tab is drawn second",
  );
});

/**
 * **The number lookup waits for a COMPLETE running number** (2026-09-23), and
 * this closes a real wrinkle as well as applying the mitigation the user
 * approved beside the endpoint's widening.
 *
 * It used to fire at three characters. The lookup is an exact match on
 * `RequestNo`, so every partial can only answer "no such number" — which is
 * why typing `TRL26-09024` showed `ไม่พบคำขอเลขที่ TRL` first, a refusal for a
 * number nobody had finished typing. And it made one request per keystroke to
 * an endpoint that now carries who went where, when and why.
 *
 * **The condition itself is pinned, not merely the call.** A call present
 * while the gate reads `.length >= 3` is the exact shape of mutation 37, which
 * this project measured GREEN against a file-wide `indexOf`.
 */
test("the running-number search fires only on a complete running number", () => {
  const src = code(CONTROL);
  assert.match(
    src,
    /import\s*\{[^}]*\bisCompleteRequestNo\b[^}]*\}\s*from\s*["']@\/features\/travel-booking\/lib\/running-number["']/,
    "RoomShareControl no longer imports isCompleteRequestNo. The shape of a running number is " +
      "derived from allocateRequestNo's own mint in that module; a regex retyped here is a " +
      "second answer that nothing keeps in step with the mint",
  );
  assert.match(
    src,
    /if\s*\(\s*byNumber\s*&&\s*!\s*isCompleteRequestNo\(/,
    "the number tab's gate is no longer `the typed value is a complete running number`. A call " +
      "to isCompleteRequestNo somewhere else in the file satisfies an indexOf and changes " +
      "nothing — which is why the CONDITION is what is matched here",
  );
  const gate = balancedAfter(src, "if (byNumber && !isCompleteRequestNo", "{");
  assert.ok(
    gate.indexOf("return;") !== -1,
    "the incomplete-number branch no longer returns, so an unfinished number falls straight " +
      "through to the fetch — the gate is then decoration",
  );
  assert.ok(
    src.indexOf("trimmedNo.length") === -1,
    "a length test on the typed number is back. Three characters is what produced " +
      "`ไม่พบคำขอเลขที่ TRL` mid-word, and a round trip per keystroke to an endpoint that " +
      "answers where a colleague went and why",
  );
  assert.ok(
    src.indexOf("พิมพ์อย่างน้อย 3 ตัวอักษร") === -1,
    "the copy telling the requester three characters is enough is back beside a search that " +
      "waits for a whole number — a note describing a rule that no longer exists",
  );
  assert.ok(
    src.indexOf("exampleRequestNo(RUNNING_PREFIX") !== -1,
    "the placeholder and hint no longer generate their example from running-number.ts, so the " +
      "shape a requester copies and the rule that admits it are two facts — and the example " +
      "goes stale on 1 January",
  );
});

/**
 * **The card names the colleague on BOTH tabs** (the user's point 2).
 *
 * It read the binding's denormalised `hostStaffId`, which exists only once the
 * tab has been saved — so a host found by running number rendered
 * "เพื่อนร่วมงาน" beside a blank avatar, with no way to tell whose booking it
 * was. `HostCandidateRow.staffId` comes with the pick.
 *
 * The stored column stays as the fallback and is not asserted away: it is
 * what a binding saved before this change resolves through.
 */
test("the host's identity is read off the host row, not off the saved binding alone", () => {
  const src = code(CONTROL);
  assert.match(
    src,
    /const hostStaffId\s*=[^;]*hostRow\?\.staffId/,
    "the host's staff id is derived from the stored binding alone again. That column exists " +
      "only after a save, so the ระบุเลขที่คำขอ tab renders `เพื่อนร่วมงาน` and a blank avatar " +
      "for a host it has every field of (user, 2026-09-23, point 2)",
  );
  assert.ok(
    src.indexOf("personLabel(hostPerson, hostStaffId)") !== -1,
    "the card's name no longer falls back to the id the avatar was resolved from, so the two " +
      "can name different people",
  );
  /* The resolved row is stored WITH the staff id it was fetched for, and the
     render compares them. Without that, picking host B renders host A's name
     and photograph for as long as the roster round trip takes — on a card
     whose whole job is saying whose booking this is. */
  assert.match(
    src,
    /setResolved\(\{ staffId: hostStaffId, person: p \}\)/,
    "the resolved colleague is stored without the staff id it belongs to, so a change of host " +
      "renders the previous colleague until the next fetch lands",
  );
  assert.match(
    src,
    /resolved\.staffId === hostStaffId/,
    "the resolved colleague is rendered without checking it is THIS host's. A cache that " +
      "trusts itself is the same trap `chosen` is keyed by host id to avoid",
  );
});

/**
 * **Picking fills the rest of the trip in** (the user's point 3), and the rule
 * is "(ถ้ายังไม่เติม)" — never overwrite what the requester has already put in.
 *
 * The rule itself is asserted by value in `room-share-prefill.test.ts`, which
 * can import the module because it is pure. What cannot be asserted there and
 * has to be asserted here is that the tab still routes through it: an inline
 * object literal would type-check, look right, and be a second copy with no
 * test over it — exactly what the `roomShareChoicePatch` arm above already
 * guards for the other half of this patch.
 */
test("picking a host fills the tab in through the shared prefill module", () => {
  const src = code(TAB);
  assert.match(
    src,
    /import\s*\{\s*roomSharePrefillPatch\s*\}\s*from\s*["']@\/features\/travel-booking\/lib\/room-share-prefill["']/,
    "TravelBookingTab no longer imports roomSharePrefillPatch",
  );
  const patch = balancedAfter(src, "onChoose=", "{");
  assert.match(
    patch,
    /roomSharePrefillPatch\(host, tab\)/,
    "onChoose no longer fills the trip in from the host (user, 2026-09-23, point 3). It must " +
      "be called with THIS tab: the whole rule is `only where the guest has not answered`, and " +
      "a prefill handed anything else cannot tell what they answered",
  );
  /* Both patches spread into ONE object, prefill first. They touch disjoint
     fields today, so the order is not observable — it is pinned because the
     day they stop being disjoint, the CHOICE has to win: it carries the
     host's dates, and those are a correctness requirement (final review I4),
     not a convenience like the five fields beside them. */
  assert.match(
    patch,
    /\{\s*\.\.\.roomSharePrefillPatch\(host, tab\),\s*\.\.\.roomShareChoicePatch\(host\)\s*\}/,
    "the two patches are no longer spread into one object with the prefill first. Applied " +
      "separately they are two renders and two `updateTab` calls over stale state; applied in " +
      "the other order the convenience fields would outrank the host's dates the day the two " +
      "sets overlap",
  );
});

/**
 * **The opening question** (the user's point 4): "พักห้องเดียวกับเพื่อน
 * ร่วมงานหรือไม่", asked before the requester starts filling the form.
 *
 * Three properties the user named, one arm each, because each fails
 * differently:
 *
 * - **not on a resumed draft.** `shouldAskRoomShare` reads the resumed group.
 *   Replaced by `useState(true)` it asks a requester every time they reopen
 *   their own saved draft.
 * - **"No" is final for the session.** The latch is the FORM's and is taken
 *   once, in a `useState` initialiser. Moved into `RoomShareControl`, or
 *   re-derived in an effect, it comes back on the next tab switch or SWR
 *   revalidation — a modal that will not stay shut.
 * - **it blocks nothing.** Escape and the backdrop answer it, exactly as
 *   ไม่ใช่ does. Without `onOpenChange` the prompt is a modal with only one
 *   way out, in front of somebody who came to fill a form.
 */
test("the opening prompt is asked once per form session, and never on a resumed draft", () => {
  const form = code(FORM);
  assert.match(
    form,
    /import\s*\{\s*shouldAskRoomShare\s*\}\s*from\s*["']@\/features\/travel-booking\/lib\/room-share-prompt["']/,
    "TravelBookingForm no longer imports shouldAskRoomShare",
  );
  assert.match(
    form,
    /useState\(\(\)\s*=>\s*shouldAskRoomShare\(initial\)\)/,
    "the prompt is no longer decided ONCE from the resumed group. A literal here asks a " +
      "requester who saved yesterday every time they reopen their own draft; anything " +
      "recomputed on render can put the question back after it has been answered",
  );
  const sets = form.match(/setAskRoomShare\(/g) ?? [];
  assert.equal(
    sets.length,
    1,
    `setAskRoomShare is called ${sets.length} times in TravelBookingForm. Exactly one call, ` +
      "turning it off, is what makes `ไม่ใช่` final — a second one is the question coming back",
  );
  assert.match(form, /setAskRoomShare\(false\)/, "the one write no longer turns the prompt OFF");
  assert.ok(
    form.indexOf("askRoomShare={askRoomShare}") !== -1 &&
      form.indexOf("onAskAnswered={answerRoomSharePrompt}") !== -1,
    "the form no longer hands the prompt and its answer to the tab, so the question is either " +
      "never asked or can never be answered",
  );
});

test("the prompt's latch is not re-created below the form", () => {
  for (const [rel, file] of [
    [CONTROL, "RoomShareControl"],
    [TAB, "TravelBookingTab"],
  ] as const) {
    const src = code(rel);
    assert.ok(
      src.indexOf("setAskRoomShare") === -1 && src.indexOf("shouldAskRoomShare") === -1,
      `${file} decides the opening prompt for itself. Both of these are re-rendered with ` +
        "whichever tab is active, so a latch here is re-taken on every tab switch — the " +
        "requester answers ไม่ใช่ and is asked again on the next trip, which is the " +
        "four-modals-for-one-group defect the per-session rule exists to prevent",
    );
    assert.ok(
      src.indexOf("askRoomShare") !== -1 && src.indexOf("onAskAnswered") !== -1,
      `${file} no longer carries the prompt through, so it never reaches the control`,
    );
  }
});

test("the prompt blocks nothing, and ใช่ opens the picker", () => {
  const src = code(CONTROL);

  // Exactly two dialogs: the picker and the prompt. The count is what keeps
  // the agreement-line slice above naming the picker's own region.
  const dialogs = src.match(/<Dialog\b/g) ?? [];
  assert.equal(
    dialogs.length,
    2,
    `RoomShareControl renders ${dialogs.length} dialogs, not the picker plus the opening ` +
      "prompt. A third is either a stacked person picker coming back (the arrangement " +
      "`personOpen` existed for) or a second prompt",
  );

  const titleAt = src.indexOf('title="พักห้องเดียวกับเพื่อนร่วมงานหรือไม่"');
  assert.notEqual(titleAt, -1, "the opening prompt has gone");
  const promptAt = src.lastIndexOf("<Dialog", titleAt);
  const prompt = src.slice(promptAt, titleAt);
  /* `askRoomShare` must be IN the open expression, not be the whole of it.
     Pinning the exact spelling reds on a narrowing somebody might legitimately
     add — `askRoomShare && hostRequestId == null`, say — and a guard that
     reds on non-regressions is one the next reader deletes. What must not
     happen is the latch dropping out of it altogether. */
  assert.match(
    prompt,
    /open=\{[^}]*\baskRoomShare\b[^}]*\}/,
    "the prompt is no longer opened by the form's own latch, so it is shown on a resumed " +
      "draft, or after it has been answered, or never",
  );
  assert.match(
    prompt,
    /onOpenChange=\{\(next\) => \{\s*if \(!next\) askNo\(\);\s*\}\}/,
    "Escape and the backdrop no longer answer the prompt. A modal in front of somebody who " +
      "came to fill a form has to be dismissable every way a modal normally is — and every " +
      "dismissal has to LATCH, or the question returns on the next render",
  );

  const yes = balancedAfter(src, "const askYes = useCallback", "(");
  assert.ok(
    yes.indexOf("onAskAnswered()") !== -1,
    "ใช่ no longer answers the prompt, so the question can come back over the open picker",
  );
  assert.ok(
    yes.indexOf("openPicker()") !== -1,
    "ใช่ no longer opens the picker, so the only answer that does anything does nothing",
  );
  const no = balancedAfter(src, "const askNo = useCallback", "(");
  assert.ok(no.indexOf("onAskAnswered()") !== -1, "ไม่ใช่ no longer answers the prompt");
  assert.ok(
    no.indexOf("openPicker") === -1 && no.indexOf("setPickerOpen") === -1,
    "ไม่ใช่ opens the picker. `No` must land the requester exactly where they are today — at " +
      "the ที่พักค้างคืน grid, with the button still there if they change their mind",
  );
});
