import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `upsertVehicle` is the only `SET IDENTITY_INSERT` in `src/`. Its production
 * pass (`writeBothPools` runs production first) takes the plain-INSERT branch
 * — `OUTPUT INSERTED.Id` — and the UAT pass replays that captured id under
 * `IDENTITY_INSERT`, because `AccTravelVehiclePlace` has a foreign key to this
 * table and the two databases must agree on the parent id explicitly rather
 * than each trusting its own identity counter. See the comment above the
 * branch itself and the one on `writeBothPools` in `dual-write.ts`.
 *
 * Every column a new vehicle carries has to be written on BOTH of those
 * branches, or the two databases end up agreeing on the vehicle's id — the
 * whole point of the branch — while silently disagreeing on its data.
 * Nothing about that state trips `check:alignment`'s row-count check, only
 * its column-by-column comparison, and only once somebody happens to run it
 * after a dual-write failure rather than a schema change.
 *
 * `RequiresIdCard` (package C, migration 154) is the column this file pins.
 * This is a source-reading guard, not a behavioural one, because
 * `settings-service.ts` reaches `@/env` through `getAccPool()` and throws on
 * import inside a test run — the same constraint `perdiem-source-guard.test.ts`
 * and `booking-currency-guard.test.ts` are already written around. The
 * failure this catches is a column present on one write branch and silently
 * absent from another; no behavioural test of the exported functions could
 * see that, because a test run never actually reaches either database, and a
 * mocked one would just be asserting the mock's own behaviour back at itself.
 *
 * **Mutation-tested 2026-09-22, both directions.** Deleting `RequiresIdCard`
 * from the IDENTITY_INSERT branch alone (leaving the plain-INSERT and UPDATE
 * branches untouched) turned exactly the IDENTITY_INSERT test red, all others
 * green — confirming the three branch tests are independent rather than one
 * test accidentally covering all three. Restored, `git status` was clean
 * before the next mutation. Deleting it from the plain-INSERT branch alone
 * reproduced the same result on the plain-INSERT test. Both mutations were
 * reverted by hand (not `git checkout`, since the working tree already had
 * this file staged as new) and `git diff` against the committed version was
 * empty afterwards.
 *
 * **What that first round missed, added 2026-09-22 after the final review.**
 * Every assertion it contained read SQL *text*, and SQL text cannot tell which
 * field a parameter was bound from. Three more mutations — one per upsert,
 * rebinding `@requiresIdCard` to the neighbouring `needs*` flag — each survived
 * the entire suite. The three `binds requiresIdCard to row.requiresIdCard`
 * tests below are the answer; see the comment above `BIND` for what a wrong
 * bind costs and `final-fix-report.md` for the per-site RED/GREEN.
 */

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/** Comments quoting the column name must not satisfy the check for it. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SETTINGS_SERVICE = "lib/acc/travel-booking/settings-service.ts";

/** The body of `upsertVehicle`, isolated from the rest of the file. */
function upsertVehicleBody(): string {
  const src = code(SETTINGS_SERVICE);
  const start = src.indexOf("export async function upsertVehicle");
  assert.notEqual(start, -1, "upsertVehicle not found in settings-service.ts");
  const end = src.indexOf("export async function reorderVehicles", start);
  assert.notEqual(
    end,
    -1,
    "reorderVehicles not found after upsertVehicle — has the file been restructured?",
  );
  return src.slice(start, end);
}

/**
 * The three branches of `upsertVehicle`'s write (`if (row.id)` / `else if
 * (isUatPass)` / plain `else`), isolated by the SQL keyword that is unique to
 * each — UPDATE, IDENTITY_INSERT, plain INSERT — so a mutation to any one
 * branch cannot be masked by the presence of the column in another.
 */
function branches(body: string) {
  const updateStart = body.indexOf("if (row.id) {");
  const identityStart = body.indexOf("else if (isUatPass) {");
  const plainStart = body.indexOf("} else {", identityStart);
  const placesGuardStart = body.indexOf("if (row.places !== undefined", plainStart);
  assert.ok(
    updateStart !== -1 && identityStart !== -1 && plainStart !== -1 && placesGuardStart !== -1,
    "upsertVehicle's three write branches, or the place-list guard that follows them, were not " +
      "all found — has the shape of the function changed?",
  );
  assert.ok(
    updateStart < identityStart && identityStart < plainStart && plainStart < placesGuardStart,
    "upsertVehicle's branches are no longer in UPDATE, IDENTITY_INSERT, plain-INSERT order",
  );
  return {
    update: body.slice(updateStart, identityStart),
    identityInsert: body.slice(identityStart, plainStart),
    plainInsert: body.slice(plainStart, placesGuardStart),
  };
}

test("upsertVehicle's plain-INSERT branch (the production pass for a new vehicle) writes RequiresIdCard", () => {
  const { plainInsert } = branches(upsertVehicleBody());
  assert.ok(
    /RequiresIdCard/.test(plainInsert),
    "the plain INSERT branch no longer names RequiresIdCard — a vehicle created in production " +
      "would never carry the flag at all, on either database",
  );
});

test("upsertVehicle's IDENTITY_INSERT branch (the UAT replay pass for a new vehicle) writes RequiresIdCard", () => {
  const { identityInsert } = branches(upsertVehicleBody());
  assert.ok(
    /RequiresIdCard/.test(identityInsert),
    "the IDENTITY_INSERT branch no longer names RequiresIdCard — production and UAT would agree " +
      "on the new vehicle's id (the whole point of this branch) while silently disagreeing on " +
      "whether it requires an ID card, and check:alignment would only catch it if somebody ran it",
  );
});

test("upsertVehicle's UPDATE branch also writes RequiresIdCard", () => {
  const { update } = branches(upsertVehicleBody());
  assert.ok(
    /RequiresIdCard/.test(update),
    "the UPDATE branch no longer names RequiresIdCard — editing an existing vehicle would silently " +
      "stop changing this flag on both databases",
  );
});

/**
 * **The bind, and the VALUE bound to it — not just the parameter name.**
 *
 * Every test above this one reads SQL *text*, and SQL text is satisfied by a
 * parameter whose value came from the wrong field. The final review measured
 * that on 2026-09-22: changing `upsertAccommodation`'s bind to
 * `row.needsRoomBooking ? 1 : 0` — the line directly above it, one copy-paste
 * away — left the whole suite at 2088/2088 and `tsc --noEmit` clean, because
 * both fields are `boolean | undefined` and the SQL still names the column.
 * The bind test that did exist stopped its regex at `sql.Bit`, so the identical
 * mutation survived on the vehicle too.
 *
 * What that buys: an admin ticks "ต้องแนบบัตรประชาชน / Passport", sees
 * บันทึกสำเร็จ, and the column is written from a different tick — off where it
 * should be on, and on where it should be off, for every option of that kind,
 * on both databases at once (so `check:alignment` says nothing either). **The
 * whole feature is one bit wide and this is the write that sets it.** Nothing
 * surfaces it until somebody notices that hotel bookings stopped asking for a
 * card, by which point requests have been filed without one.
 *
 * One pattern, asserted per upsert rather than once over the file, so a
 * mutation to any single one cannot be masked by the other two.
 */
const BIND = /\.input\(\s*"requiresIdCard"\s*,\s*sql\.Bit\s*,\s*row\.requiresIdCard\s*\?\s*1\s*:\s*0\s*\)/;

/** The reason text is the same for all three; only the function name differs. */
function bindMessage(fn: string): string {
  return (
    `${fn} no longer binds @requiresIdCard to \`row.requiresIdCard ? 1 : 0\`. Either nothing is ` +
    "bound at all — which fails at the database on every save — or, far worse, it is bound to a " +
    "different field of the same type: the SQL text still names RequiresIdCard, every other test " +
    "in this file still passes, the typechecker is silent, and the admin's tick is written from " +
    "the wrong box. Measured as surviving the whole suite on 2026-09-22."
  );
}

test("upsertVehicle binds requiresIdCard to row.requiresIdCard", () => {
  assert.ok(BIND.test(upsertVehicleBody()), bindMessage("upsertVehicle"));
});

/**
 * `upsertAccommodation` and `upsertRentVehicle` have no IDENTITY_INSERT split
 * — each runs the identical statement on both `writeBothPools` passes — but
 * the same "written on the UPDATE and the INSERT, or not at all" property
 * still holds for each of them, and it is exactly as easy to lose one arm
 * while editing the other.
 */
/** The body of one upsert, isolated by the `reorder*` function that follows it. */
function upsertBody(fn: string, endMarker: string): string {
  const src = code(SETTINGS_SERVICE);
  const start = src.indexOf(`export async function ${fn}`);
  assert.notEqual(start, -1, `${fn} not found in settings-service.ts`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} not found after ${fn} — has the file been restructured?`);
  return src.slice(start, end);
}

test("upsertAccommodation binds requiresIdCard to row.requiresIdCard", () => {
  const body = upsertBody("upsertAccommodation", "export async function reorderAccommodations");
  assert.ok(BIND.test(body), bindMessage("upsertAccommodation"));
});

test("upsertRentVehicle binds requiresIdCard to row.requiresIdCard", () => {
  const body = upsertBody("upsertRentVehicle", "export async function reorderRentVehicles");
  assert.ok(BIND.test(body), bindMessage("upsertRentVehicle"));
});

test("upsertAccommodation writes RequiresIdCard on both its UPDATE and INSERT", () => {
  const src = code(SETTINGS_SERVICE);
  const start = src.indexOf("export async function upsertAccommodation");
  const end = src.indexOf("export async function reorderAccommodations", start);
  assert.ok(start !== -1 && end !== -1, "upsertAccommodation not found");
  const body = src.slice(start, end);
  const updateStart = body.indexOf("if (row.id) {");
  const insertStart = body.indexOf("} else {", updateStart);
  assert.ok(updateStart !== -1 && insertStart !== -1, "upsertAccommodation's two branches not found");
  assert.ok(
    /RequiresIdCard/.test(body.slice(updateStart, insertStart)),
    "upsertAccommodation's UPDATE branch no longer names RequiresIdCard",
  );
  assert.ok(
    /RequiresIdCard/.test(body.slice(insertStart)),
    "upsertAccommodation's INSERT branch no longer names RequiresIdCard",
  );
});

test("upsertRentVehicle writes RequiresIdCard on both its UPDATE and INSERT", () => {
  const src = code(SETTINGS_SERVICE);
  const start = src.indexOf("export async function upsertRentVehicle");
  const end = src.indexOf("export async function reorderRentVehicles", start);
  assert.ok(start !== -1 && end !== -1, "upsertRentVehicle not found");
  const body = src.slice(start, end);
  const updateStart = body.indexOf("if (row.id) {");
  const insertStart = body.indexOf("} else {", updateStart);
  assert.ok(updateStart !== -1 && insertStart !== -1, "upsertRentVehicle's two branches not found");
  assert.ok(
    /RequiresIdCard/.test(body.slice(updateStart, insertStart)),
    "upsertRentVehicle's UPDATE branch no longer names RequiresIdCard",
  );
  assert.ok(
    /RequiresIdCard/.test(body.slice(insertStart)),
    "upsertRentVehicle's INSERT branch no longer names RequiresIdCard",
  );
});

/** The read side: a column written but never read back would show as `false` everywhere, forever. */
test("all three list functions select RequiresIdCard", () => {
  const src = code(SETTINGS_SERVICE);
  for (const fn of ["listAccommodations", "listVehicles", "listRentVehicles"]) {
    const start = src.indexOf(`export async function ${fn}`);
    assert.notEqual(start, -1, `${fn} not found`);
    const end = src.indexOf("export async function", start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    assert.ok(
      /SELECT[\s\S]*RequiresIdCard/.test(body),
      `${fn} no longer selects RequiresIdCard — every accommodation/vehicle/rental would read back ` +
        "as not requiring an ID card regardless of what was saved",
    );
    assert.ok(
      /requiresIdCard:\s*!!x\.RequiresIdCard/.test(body),
      `${fn} no longer maps RequiresIdCard onto the returned row's requiresIdCard field`,
    );
  }
});
