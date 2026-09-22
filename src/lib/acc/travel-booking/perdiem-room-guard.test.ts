import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Three things decide whether an AP-17 trip earns per diem, and they must
 * not answer it differently.** The submit (`request-service.ts`), the
 * recompute after a cancellation (`perdiem-recompute.ts`) and the form's live
 * estimate (`useTravelBookingForm.ts` with
 * `perdiem-estimate-inputs.ts`) each build `computePerDiem`'s `roomBooked`
 * argument, and since AP-17 package E that argument has **two** inputs rather
 * than one: `needsRoomBooking`, and whether the request is a พักห้องเดียวกับ
 * **guest** — who books no room and is paid anyway (spec §1, the user's own
 * *"(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)"*).
 *
 * Two inputs and three consumers is exactly the shape that drifts. So there
 * is one predicate, `roomBookedOrShared` (`perdiem-room.ts`), and this file
 * is what keeps all three asking it.
 *
 * Source-reading rather than behavioural, and it has to be, twice over: the
 * failure is a **missing call** — a fourth consumer arriving with
 * `needsRoomBooking || isGuest` typed out inline, which no unit test of the
 * three would notice — and two of the three reach `@/env` transitively and
 * cannot be imported into a test run at all. The same constraint
 * `perdiem-source-guard.test.ts` works under, and this file is its sibling:
 * that one pins *which rate log* applies, this one pins *whether the trip is
 * paid at all*.
 *
 * **The report is deliberately not among the consumers.**
 * `computeReportPerDiemDisplay` (`report-service.ts`) prints the stored
 * `PerDiemDays`/`PerDiemTotal` columns and derives only the RATE from the
 * log, so it never re-answers the room question and cannot disagree with the
 * three that do. If it ever starts computing a figure, it joins the list
 * below.
 *
 * ## Mutation-verified, 2026-09-22 — and it was green against one of them
 *
 * Because a guard nobody has tried to defeat is a guard nobody knows the
 * strength of, and this branch has already shipped guards that were green
 * against real regressions. Each mutation below was applied to the source and
 * the suite re-run; the tree was confirmed clean afterwards.
 *
 *  1. the submit's `roomBookedOrShared(...)` replaced by `tabs[i].needsRoomBooking`
 *     → **red**, 2 tests.
 *  2. the recompute's replaced by `!!x.NeedsRoomBooking` → **red**, 2 tests.
 *  3. the estimate's replaced by the inline `t.needsRoomBooking ||
 *     t.isRoomShareGuest` — the shortcut a reader actually reaches for →
 *     **red**, 2 tests (the per-call arm and the disjunction arm).
 *  4. `${IS_ROOM_SHARE_GUEST_COLUMN}` deleted from `listMyTravelBookings`'
 *     SELECT only, leaving the other reader's intact → **red**. This is the
 *     arm a file-wide "does the name appear" check would have missed.
 *  5. **a fourth pricing consumer added to `report-service.ts` importing
 *     `computePerDiem as computePerDiemProbe` → GREEN, 8 pass / 0 fail.** A
 *     real weakness, found by trying: the call scanner matches the literal
 *     identifier, and an aliased import renames every call site. Closed by
 *     `computePerDiemImporters` below, which matches the IMPORT SPECIFIER and
 *     pins the importer list; re-run against the same mutation → red.
 *  6. the same fourth consumer with a plain, unaliased import → **red**, both
 *     arms, which is why neither is redundant.
 *  7. `roomKnown`'s `|| t.isRoomShareGuest` arm deleted → **red**.
 *  8. `moneyWithheldForRoom` reverted to its pre-package-E body → **red**,
 *     3 tests (2 behavioural in `perdiem-estimate-inputs.test.ts`, 1 here).
 *  9. `tabFromRequest`'s `isRoomShareGuest: r.isRoomShareGuest` hardcoded to
 *     `false` → **red**.
 * 10. an `import` added to `perdiem-room.ts` → **red**.
 * 11. `IS_ROOM_SHARE_GUEST_COLUMN` dropped from `PERDIEM_ROW_COLUMNS` → **red**.
 * 12. `mapTravelBookingRow`'s `!!r.IsRoomShareGuest` hardcoded to `false` →
 *     **red**.
 */

const SRC = path.resolve(process.cwd(), "src");

/** Source with comments stripped — this guard's own prose must never satisfy it. */
function code(rel: string): string {
  return fs
    .readFileSync(path.resolve(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Every `computePerDiem(...)` call in `src`, as `[file, the whole call text]`
 * — argument list balanced by paren counting rather than matched by a regex,
 * because the calls here span several lines and carry nested calls and object
 * literals of their own, which no flat pattern survives.
 *
 * Test files and `perdiem.ts` itself (the declaration) are excluded; the
 * declaration is recognised by the `function` keyword immediately before the
 * name, so a *call* inside that same file would still be found.
 */
function computePerDiemCalls(): { file: string; call: string }[] {
  const found: { file: string; call: string }[] = [];
  for (const abs of sourceFiles(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    const src = code(rel);
    const re = /(\bfunction\s+)?\bcomputePerDiem\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m[1]) continue; // the declaration, not a call
      let depth = 0;
      let i = re.lastIndex - 1;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      found.push({ file: rel, call: src.slice(m.index, i + 1) });
    }
  }
  return found;
}

/**
 * A file split at its top-level declarations, so "the function that calls X
 * also does Y" can be asked without parsing TypeScript. Same splitter
 * `room-share-response-shape-guard.test.ts` uses, for the same reason.
 */
function topLevelChunks(src: string): string[] {
  const re = /^(?:export\s+)?(?:async\s+)?(?:function|const|interface|type)\s+[A-Za-z_]/gm;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) starts.push(m.index);
  assert.ok(starts.length > 0, "no top-level declarations found — has the splitter broken?");
  return starts.map((s, i) => src.slice(s, i + 1 < starts.length ? starts[i + 1] : src.length));
}

/**
 * Every non-test file that imports `computePerDiem`, **however it names it
 * locally**.
 *
 * The import specifier is matched rather than the call, because
 * `import { computePerDiem as price }` renames every call site and makes the
 * scanner above blind — measured, not imagined: mutation 5 in this task's
 * report added a fourth pricing consumer that way and left the whole file
 * green at 8 pass / 0 fail. The two arms are complementary and neither is
 * redundant: this one sees an aliased or indirect caller the other cannot,
 * and the other sees a namespace import (`ns.computePerDiem(...)`) this one
 * cannot.
 */
function computePerDiemImporters(): string[] {
  const importers: string[] = [];
  const IMPORT = /import\s*(?:type\s*)?\{[^}]*\bcomputePerDiem\b[^}]*\}\s*from\s*["'][^"']*\/perdiem["']/;
  for (const abs of sourceFiles(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    if (IMPORT.test(code(rel))) importers.push(rel);
  }
  return importers.sort();
}

/** The three, and only the three. Shared by both arms so they cannot drift apart. */
const PRICERS = [
  "features/travel-booking/hooks/useTravelBookingForm.ts",
  "lib/acc/travel-booking/perdiem-recompute.ts",
  "lib/acc/travel-booking/request-service.ts",
];

/* ─────────────────────── the predicate is the only answer ─────────────────────── */

/**
 * The headline. A `computePerDiem` call that works its `roomBooked` out any
 * other way is a fourth answer to a two-input question, on the path that
 * writes `AccRequest.TotalAmount`.
 *
 * Asserted over **every** call found rather than over a named list, so the
 * consumer that has not been written yet is covered too — which is the one
 * this guard exists for.
 */
test("every computePerDiem call decides roomBooked through roomBookedOrShared", () => {
  const calls = computePerDiemCalls();
  assert.equal(
    calls.length,
    3,
    "expected exactly the submit, the recompute and the form's estimate — found " +
      `${calls.length}: ${calls.map((c) => c.file).join(", ")}. A new caller must apply ` +
      "roomBookedOrShared like the other three; if one has gone, say so here rather than " +
      "relaxing the count.",
  );
  assert.deepEqual(
    calls.map((c) => c.file).sort(),
    PRICERS,
    "the set of things that price an AP-17 trip has changed",
  );
  for (const { file, call } of calls) {
    assert.ok(
      /\broomBookedOrShared\s*\(/.test(call),
      `${file} calls computePerDiem without working roomBooked out through ` +
        "roomBookedOrShared — a room-share guest will be priced at ฿0 there while the other " +
        `two pay them: ${call.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }
});

/**
 * The same rule asked of the IMPORT rather than the call, which is what makes
 * it survive a rename.
 *
 * Pinning the importer list is `perdiem-source-guard.test.ts`'s own shape
 * (`ALLOWED_PERDIEM_LOG_IMPORTERS`) and it is the arm with teeth here: a
 * fourth file importing `computePerDiem` cannot go unnoticed whatever it
 * calls it locally, and whatever shape its `roomBooked` argument takes.
 */
test("only the three price a trip, and each of them calls the predicate", () => {
  const importers = computePerDiemImporters();
  assert.deepEqual(
    importers,
    PRICERS,
    "a file imports computePerDiem that is not one of the three known pricers. Whatever it " +
      "names the import locally, it must decide roomBooked through roomBookedOrShared — or a " +
      "room-share guest is paid by some consumers of this figure and not by others",
  );
  for (const file of importers) {
    assert.ok(
      /\broomBookedOrShared\s*\(/.test(code(file)),
      `${file} imports computePerDiem but never calls roomBookedOrShared`,
    );
  }
});

/**
 * The disjunction typed out in place is the specific regression this whole
 * module exists to prevent, and it is the one a reader reaches for because it
 * is shorter. Matched in either order; the pattern stops at a `;` so it
 * cannot span two statements and report a false positive.
 *
 * Deliberately NOT "no `|| …isRoomShareGuest` anywhere": `roomKnown` in
 * `useTravelBookingForm.ts` is legitimately `accommodationId != null ||
 * t.isRoomShareGuest`, which answers a different question (is the room state
 * DECIDED) and must stay. Only the two payment inputs being OR-ed together is
 * the copy.
 */
test("nothing re-expresses the predicate as an inline disjunction", () => {
  const offenders: string[] = [];
  for (const abs of sourceFiles(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    if (rel === "lib/acc/travel-booking/perdiem-room.ts") continue; // the one place it lives
    const src = code(rel);
    if (
      /needsRoomBooking[^;]{0,120}\|\|[^;]{0,120}isRoomShareGuest/.test(src) ||
      /isRoomShareGuest[^;]{0,120}\|\|[^;]{0,120}needsRoomBooking/.test(src)
    ) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these OR the two room inputs together instead of calling roomBookedOrShared, which is " +
      "how the three consumers start disagreeing about whether a guest is paid: " +
      offenders.join(", "),
  );
});

/**
 * Client-bundle safety, the same rule `perdiem-source-guard.test.ts` states
 * for the form hook, applied at the other end. `useTravelBookingForm.ts` is a
 * `"use client"` file and imports this module; one import here of anything
 * reaching `@/lib/db/mssql` → `@/env` breaks the build, which no type error
 * predicts.
 */
test("perdiem-room.ts imports nothing", () => {
  const src = code("lib/acc/travel-booking/perdiem-room.ts");
  assert.ok(
    !/^\s*import\s/m.test(src) && !/\brequire\s*\(/.test(src),
    "perdiem-room.ts has grown an import. It is imported by a client component; anything " +
      "reaching @/env from here breaks the build rather than failing a typecheck",
  );
});

/* ─────────────────────── the column that feeds it ─────────────────────── */

/**
 * `isRoomShareGuest` is server-derived, never posted — the same rule
 * `needsRoomBooking` follows (`derive-flags.ts`). `IS_ROOM_SHARE_GUEST_COLUMN`
 * is the one SQL expression that produces it, so a reader that forgets it
 * gets `!!undefined === false` and prices every guest at ฿0 with no error
 * anywhere. That is the exact failure `PERDIEM_ROW_COLUMNS`' own doc comment
 * records for `t.NeedsRoomBooking`, narrowed to one population.
 */
test("the recompute's shared column list carries the room-share column", () => {
  const src = code("lib/acc/travel-booking/perdiem-recompute.ts");
  assert.match(
    src,
    /const PERDIEM_ROW_COLUMNS\s*=[\s\S]*?IS_ROOM_SHARE_GUEST_COLUMN/,
    "PERDIEM_ROW_COLUMNS no longer interpolates IS_ROOM_SHARE_GUEST_COLUMN — every " +
      "room-share guest this recompute touches will be re-priced at ฿0, inside the " +
      "transaction that cancels somebody else's trip",
  );
  assert.match(
    src,
    /isRoomShareGuest:\s*!!x\.IsRoomShareGuest/,
    "the recompute no longer reads IsRoomShareGuest off the row it selected",
  );
});

/**
 * `mapTravelBookingRow` reads `r.IsRoomShareGuest`, so **every** query feeding
 * it has to select the column. Asked of the calling function rather than of
 * the file, because "the name appears somewhere in the file" is precisely the
 * check `perdiem-source-guard.test.ts` measured as green against a rogue
 * reader with its own hand-spelled column list.
 */
test("every reader that builds a TravelBookingRequest selects the room-share column", () => {
  const src = code("lib/acc/travel-booking/request-service.ts");
  const callers = topLevelChunks(src).filter(
    (c) => /\bmapTravelBookingRow\s*\(/.test(c) && !/^(?:export\s+)?function\s+mapTravelBookingRow\b/.test(c),
  );
  assert.ok(
    callers.length >= 2,
    `expected at least the single-request read and listMyTravelBookings (found ${callers.length})`,
  );
  for (const chunk of callers) {
    assert.ok(
      /\$\{IS_ROOM_SHARE_GUEST_COLUMN\}/.test(chunk),
      "a function builds a TravelBookingRequest from a SELECT that does not interpolate " +
        "IS_ROOM_SHARE_GUEST_COLUMN, so isRoomShareGuest arrives undefined and reads false — " +
        "the submit would then price a room-share guest at ฿0: " +
        chunk.slice(0, 120).replace(/\s+/g, " "),
    );
  }
  assert.match(
    src,
    /isRoomShareGuest:\s*!!r\.IsRoomShareGuest/,
    "mapTravelBookingRow no longer maps the column onto the read shape",
  );
});

/**
 * The submit's own arm, stated separately from the "every computePerDiem
 * call" test above because it is the one that writes money: it must read the
 * flag off the **persisted** tab it already loaded, not off anything posted.
 */
test("the submit takes both room inputs from the tab it loaded", () => {
  const src = code("lib/acc/travel-booking/request-service.ts");
  assert.match(
    src,
    /needsRoomBooking:\s*tabs\[i\]\.needsRoomBooking,\s*isRoomShareGuest:\s*tabs\[i\]\.isRoomShareGuest,/,
    "the submit no longer passes both room inputs from the persisted tab row — either it has " +
      "started trusting a posted value, or the two now come from different reads",
  );
});

/* ─────────────────────── the form's live estimate ─────────────────────── */

/**
 * **The estimate is the consumer that gets forgotten**, and this branch's own
 * history says so: it shipped disagreeing with the submit once already. A
 * guest whose card reads ฿0 while the submit stores real money is that same
 * defect with the sign flipped, so the flag has to reach the tab state and
 * both of the estimate's two room decisions.
 */
test("the form's tab state carries the flag and the estimate uses it in both places", () => {
  const hook = code("features/travel-booking/hooks/useTravelBookingForm.ts");
  assert.match(
    hook,
    /isRoomShareGuest:\s*r\.isRoomShareGuest/,
    "a resumed tab no longer takes isRoomShareGuest off the loaded request, so every guest " +
      "resuming a draft sees ฿0 — the estimate disagreeing with the submit, again",
  );
  assert.match(
    hook,
    /roomKnown\s*=\s*t\.accommodationId\s*!=\s*null\s*\|\|\s*t\.isRoomShareGuest/,
    "a guest picks NO accommodation — attaching to a host replaces the choice — so without " +
      "the second arm the estimate treats their settled room state as undecided",
  );
  assert.match(
    hook,
    /moneyWithheldForRoom\(\{[\s\S]{0,200}?isRoomShareGuest:\s*t\.isRoomShareGuest/,
    "the money shaping no longer sees whether the tab is a guest, so it withholds a figure " +
      "the submit will store",
  );
});

/**
 * The withholding predicate has to route the *payment* half through the
 * shared one rather than keep a private copy. Its other half — "is the room
 * state settled at all" — is genuinely its own question and stays local.
 */
test("moneyWithheldForRoom asks the shared predicate rather than re-deriving it", () => {
  const src = code("features/travel-booking/lib/perdiem-estimate-inputs.ts");
  assert.match(
    src,
    /\broomBookedOrShared\s*\(/,
    "perdiem-estimate-inputs.ts no longer calls roomBookedOrShared — the estimate now has a " +
      "private answer to the question the submit and the recompute share",
  );
  assert.match(
    src,
    /export function moneyWithheldForRoom\(\s*tab:\s*\{/,
    "moneyWithheldForRoom must keep its object parameter: three positional arguments, two of " +
      "them adjacent booleans, are transposable with no type error on a predicate about money",
  );
});
