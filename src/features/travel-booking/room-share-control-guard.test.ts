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
 * ## The press saves the draft — added 2026-09-22, mutation-verified, six trials
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

test("attaching sets the flag and clears the accommodation in one patch", () => {
  const patch = balancedAfter(code(TAB), "onAttached=", "{");
  assert.match(
    patch,
    /isRoomShareGuest:\s*true/,
    "onAttached no longer marks the tab as a guest, so the per-diem estimate goes on " +
      "withholding money the submit will store",
  );
  assert.match(
    patch,
    /accommodationId:\s*null/,
    "onAttached no longer clears accommodationId. The grid is hidden for a guest, so the " +
      "requester can neither see nor change the stale value — and buildSaveInput posts it on " +
      "the next save, where deriveBookingFlags reads it as a live answer and books a room",
  );
  assert.match(
    patch,
    /needsRoomBooking:\s*false/,
    "onAttached no longer clears needsRoomBooking, so a guest who had chosen a room-booking " +
      "accommodation still reaches the Admin queue with a room to book",
  );
});

test("detaching clears only the flag", () => {
  const patch = balancedAfter(code(TAB), "onDetached=", "{");
  assert.match(patch, /isRoomShareGuest:\s*false/, "onDetached no longer clears the guest flag");
  assert.ok(
    !/accommodationId:/.test(patch),
    "onDetached restores an accommodation. Detaching must leave the required field unanswered: " +
      "resurrecting the choice the attach replaced re-books a room the requester had decided " +
      "against, and does it without them touching the control",
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

test("pressing the button saves the draft first, and opens only once it has an id", () => {
  const src = code(CONTROL);
  const open = balancedAfter(src, "const openPicker = useCallback", "(");

  const saveAt = open.indexOf("await onRequireSave()");
  assert.notEqual(
    saveAt,
    -1,
    "openPicker no longer saves the draft. The hosts endpoint takes an OWNED request id in its " +
      "path and authorizes `mutate` against it, so a tab that is not a row yet has nothing to " +
      "authorize — this save is the only reason the picker can open from an unsaved tab without " +
      "the endpoint being relaxed, and relaxing it would let any authenticated employee " +
      "enumerate any colleague's AP-17 running numbers, dates and work locations",
  );

  const openAt = open.indexOf("setPersonOpen(true)");
  assert.notEqual(openAt, -1, "openPicker no longer opens the picker at all");
  assert.ok(
    saveAt < openAt,
    "the picker is opened before the save has been awaited, so the host list fetches against a " +
      "request id the tab does not have yet — the requester gets โหลดรายการคำขอไม่สำเร็จ on a " +
      "press that did nothing wrong",
  );

  assert.match(
    open,
    /if\s*\(\s*rid\s*==\s*null\s*\)\s*\{[^}]*\breturn;[^}]*\}/,
    "a refused save no longer abandons the press. `saveDraft` fails for real reasons — a form " +
      "closed by assertFormWritable, a validation message, a dropped connection — and every one " +
      "of them must leave the picker shut rather than open on an id that was never allocated",
  );
});

test("the button is not gated on an unsaved tab, and the copy no longer tells anyone to save", () => {
  const src = code(CONTROL);

  const labelAt = src.indexOf("พักห้องเดียวกับเพื่อนร่วมงาน");
  assert.notEqual(labelAt, -1, "the พักห้องเดียวกับเพื่อนร่วมงาน button has gone");
  const btnAt = src.lastIndexOf("<Button", labelAt);
  assert.notEqual(btnAt, -1, "the label is no longer inside a <Button>");
  // Opening tag through to the label: everything the element is configured with.
  const btn = src.slice(btnAt, labelAt);

  assert.ok(
    !/disabled=\{[^}]*requestId/.test(btn),
    "the button is disabled on an unsaved tab again (user, 2026-09-22: เลือกได้ โดยยังไม่ต้อง" +
      "บันทึกร่างก่อน). Pressing it saves the draft itself — re-gating it on requestId puts the " +
      "manual step back without removing the save that replaced it",
  );
  assert.ok(
    /loading=\{/.test(btn),
    "the button shows nothing while the save is in flight, and `Button` disables itself only " +
      "when `loading` is set — so a second press during a save posts a SECOND draft group, the " +
      "group having no anchor id to update yet",
  );

  assert.ok(
    src.indexOf("กรุณาบันทึกร่างก่อนจึงจะเลือกห้องพักร่วมได้") === -1,
    "the copy telling the requester to save the draft first is back, beside a button that now " +
      "does it for them — one of the two has been reverted without the other",
  );
});
